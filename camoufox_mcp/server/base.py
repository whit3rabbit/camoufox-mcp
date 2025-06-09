"""Core server implementation for Camoufox MCP Server"""

import asyncio
import logging
import os
import sys
from typing import Any, Dict, List, Optional
from contextlib import contextmanager

from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, Tool, TextContent
import uvicorn

# Third-party imports
from playwright.async_api import Error as PlaywrightError

# Camoufox imports
from camoufox.async_api import AsyncCamoufox

# Local imports
from ..config import Config
from ..tools import (
    NavigationTools, InteractionTools, ContentTools, JavaScriptTools,
    GeolocationTools, BrowserManagementTools, CaptchaTools
)
from .utils import redirect_stdout_to_stderr


class CamoufoxMCPServer(FastMCP):
    """Main Camoufox MCP Server class.

    This server provides browser automation capabilities via the Camoufox library,
    exposing them as tools compliant with the Model Context Protocol (MCP).
    It handles browser initialization, tool registration, and execution.
    The version of this specific Camoufox MCP Server implementation can be retrieved
    using the 'get_server_version' tool.
    """
    
    def __init__(self, config: Config):
        """Initialize the CamoufoxMCPServer.

        Sets up the server name, configuration, version, and initializes
        placeholders for browser components and logging.

        Args:
            config: The configuration object for the server and browser.
        """
        super().__init__("camoufox-mcp") # Initialize FastMCP base
        self.config = config
        # self.server is no longer needed, 'self' is the server instance.
        self.browser: Optional[AsyncCamoufox] = None
        self.browser_instance = None  # Browser instance when not using persistent context
        self.browser_context = None
        self.page = None
        self._browser_starting = False  # Flag to track browser startup
        
        # Get a logger specific to this class instance.
        # BasicConfig is done in main(), so we just get the logger here.
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        # The effective level will be set by basicConfig in main.
        # If specific level needed for this logger: 
        # self.logger.setLevel(logging.DEBUG if config.debug else logging.INFO)
        
        # Initialize tool classes
        self.navigation_tools = NavigationTools(self)
        self.interaction_tools = InteractionTools(self)
        self.content_tools = ContentTools(self)
        self.javascript_tools = JavaScriptTools(self)
        self.geolocation_tools = GeolocationTools(self)
        self.browser_mgmt_tools = BrowserManagementTools(self)
        self.captcha_tools = CaptchaTools(self)
        
        # Check for captcha solver availability
        if config.browser.captcha_solver and not self.captcha_tools.is_available:
            self.logger.warning("CAPTCHA solver requested but camoufox-captcha not installed")
            config.browser.captcha_solver = False
    
    @contextmanager
    def _redirect_stdout_to_stderr(self):
        """Context manager to redirect stdout to stderr during browser operations"""
        with redirect_stdout_to_stderr(self.config):
            yield
    
    async def list_tools(self) -> List[Tool]:
        """List available tools provided by this MCP server.

        This method is overridden from FastMCP to define the specific tools
        that this Camoufox server offers for browser automation, as well as
        a tool to retrieve the server's version.

        Returns:
            A list of Tool objects describing the available tools.
        """
        tools = [
            Tool(
                name="browser_navigate",
                description="Navigate to a URL with stealth capabilities",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The URL to navigate to"
                        },
                        "wait_until": {
                            "type": "string",
                            "enum": ["load", "domcontentloaded", "networkidle"],
                            "description": "When to consider navigation finished",
                            "default": "load"
                        }
                    },
                    "required": ["url"]
                }
            ),
            Tool(
                name="browser_click",
                description="Click on an element with human-like movement",
                inputSchema={
                    "type": "object", 
                    "properties": {
                        "selector": {
                            "type": "string",
                            "description": "CSS selector, XPath (prefix with //), or text content"
                        },
                        "button": {
                            "type": "string",
                            "enum": ["left", "right", "middle"],
                            "description": "Mouse button to click",
                            "default": "left"
                        }
                    },
                    "required": ["selector"]
                }
            ),
            Tool(
                name="browser_type",
                description="Type text into an element with human-like timing",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "selector": {
                            "type": "string", 
                            "description": "CSS selector, XPath, or text content"
                        },
                        "text": {
                            "type": "string",
                            "description": "Text to type"
                        },
                        "delay": {
                            "type": "number",
                            "description": "Delay between keystrokes in ms",
                            "default": 100
                        },
                        "clear": {
                            "type": "boolean",
                            "description": "Clear existing text first",
                            "default": False
                        }
                    },
                    "required": ["selector", "text"]
                }
            ),
            Tool(
                name="browser_wait_for",
                description="Wait for elements, text, or conditions",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "selector": {
                            "type": "string",
                            "description": "CSS selector or XPath to wait for"
                        },
                        "text": {
                            "type": "string",
                            "description": "Text content to wait for"
                        },
                        "timeout": {
                            "type": "number",
                            "description": "Timeout in milliseconds",
                            "default": 30000
                        },
                        "state": {
                            "type": "string",
                            "enum": ["attached", "detached", "visible", "hidden"],
                            "description": "Element state to wait for",
                            "default": "visible"
                        }
                    }
                }
            ),
            Tool(
                name="browser_get_content",
                description="Get page content or element text",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "selector": {
                            "type": "string",
                            "description": "CSS selector (optional, gets full page if not provided)"
                        },
                        "attribute": {
                            "type": "string",
                            "description": "Get specific attribute instead of text content"
                        },
                        "inner_html": {
                            "type": "boolean",
                            "description": "Get innerHTML instead of text",
                            "default": False
                        }
                    }
                }
            ),
            Tool(
                name="browser_screenshot",
                description="Take a screenshot of the page or element",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "filename": {
                            "type": "string",
                            "description": "Optional filename for screenshot"
                        },
                        "selector": {
                            "type": "string",
                            "description": "CSS selector to screenshot specific element"
                        },
                        "full_page": {
                            "type": "boolean",
                            "description": "Capture full page including scrollable content",
                            "default": False
                        }
                    }
                }
            ),
            Tool(
                name="browser_execute_js",
                description="Execute JavaScript code in the page",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "JavaScript code to execute"
                        },
                        "main_world": {
                            "type": "boolean",
                            "description": "Execute in main world (can modify DOM but detectable)",
                            "default": False
                        }
                    },
                    "required": ["code"]
                }
            ),
            Tool(
                name="browser_set_geolocation",
                description="Set browser geolocation",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "latitude": {"type": "number"},
                        "longitude": {"type": "number"},
                        "accuracy": {"type": "number", "default": 100}
                    },
                    "required": ["latitude", "longitude"]
                }
            ),
            Tool(
                name="browser_close",
                description="Close the browser and clean up resources",
                inputSchema={"type": "object", "properties": {}}
            ),
            Tool(
                name="get_server_version",
                description="Get the current version of the Camoufox MCP server implementation.",
                inputSchema={"type": "object", "properties": {}},
                outputSchema={
                    "type": "object",
                    "properties": {"version": {"type": "string"}}
                }
            )
        ]
        
        if self.config.browser.captcha_solver and self.captcha_tools.is_available:
            tools.append(
                Tool(
                    name="browser_solve_captcha",
                    description="Automatically solve CAPTCHA on current page",
                    inputSchema={
                        "type": "object",
                        "properties": {
                            "captcha_type": {
                                "type": "string",
                                "enum": ["recaptcha", "hcaptcha", "turnstile", "auto"],
                                "description": "Type of CAPTCHA to solve",
                                "default": "auto"
                            },
                            "timeout": {
                                "type": "number",
                                "description": "Timeout in seconds",
                                "default": 60
                            }
                        } 
                    } 
                ) 
            )
            
        return tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> CallToolResult:
        """Handle incoming tool calls from an MCP client.

        This method is overridden from FastMCP. It routes tool calls to their
        respective implementation methods based on the tool's 'name'.
        It also handles the 'get_server_version' tool call.

        Args:
            name: The name of the tool to call.
            arguments: A dictionary of arguments for the tool.

        Returns:
            A CallToolResult object containing the output of the tool execution.
        
        Raises:
            NotImplementedError: If the requested tool name does not match any of the
                                 defined handlers in this method.
        """
        try:
            if name == "browser_navigate":
                return await self.navigation_tools.navigate(arguments["url"], arguments.get("wait_until", "load"))
            if name == "browser_click":
                return await self.interaction_tools.click(arguments["selector"], arguments.get("button", "left"))
            if name == "browser_type":
                return await self.interaction_tools.type_text(
                    arguments["selector"], 
                    arguments["text"],
                    arguments.get("delay", 100),
                    arguments.get("clear", False)
                )
            if name == "browser_wait_for":
                return await self.navigation_tools.wait_for(
                    arguments.get("selector"),
                    arguments.get("text"), 
                    arguments.get("timeout", 30000),
                    arguments.get("state", "visible")
                )
            if name == "browser_get_content":
                return await self.content_tools.get_content(
                    arguments.get("selector"),
                    arguments.get("attribute"),
                    arguments.get("inner_html", False)
                )
            if name == "browser_screenshot":
                return await self.content_tools.screenshot(
                    arguments.get("filename"),
                    arguments.get("selector"),
                    arguments.get("full_page", False)
                )
            if name == "browser_execute_js":
                return await self.javascript_tools.execute_js(
                    arguments["code"],
                    arguments.get("main_world", False)
                )
            if name == "browser_set_geolocation":
                return await self.geolocation_tools.set_geolocation(
                    arguments["latitude"],
                    arguments["longitude"],
                    arguments.get("accuracy", 100)
                )
            if name == "get_server_version":
                return self.browser_mgmt_tools.get_server_version()
            if name == "browser_close":
                return await self.browser_mgmt_tools.close_browser()
            if name == "browser_solve_captcha":
                if not (self.config.browser.captcha_solver and self.captcha_tools.is_available):
                    return CallToolResult(
                        content=[TextContent(type="text", text="CAPTCHA solver not available/enabled.")],
                        isError=True
                    )
                return await self.captcha_tools.solve_captcha(
                    arguments.get("captcha_type", "auto")
                )
            else:
                return CallToolResult(
                    content=[TextContent(type="text", text=f"Unknown tool: {name}")],
                    isError=True
                )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error during tool %s: %s", name, e_playwright)
            # For critical browser errors, clean up resources
            try:
                if name == "browser_navigate" and "startup" in str(e_playwright).lower():
                    await self._close_browser_resources()
            except Exception as cleanup_error:
                self.logger.error("Error during PlaywrightError cleanup: %s", cleanup_error)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW Error in {name}: {e_playwright}")],
                isError=True
            )
        except Exception as e:
            self.logger.error("Error in tool %s: %s", name, e)
            # For critical browser errors, clean up resources but don't close the whole browser
            # Only close browser on startup errors or explicit close commands
            try:
                if name == "browser_navigate" and "startup" in str(e).lower():
                    # Only cleanup on browser startup failures
                    await self._close_browser_resources()
            except Exception as cleanup_error:
                self.logger.error("Error during cleanup: %s", cleanup_error)
            
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Error: {str(e)}")],
                isError=True
            )
    
    async def _ensure_browser(self):
        """Ensure browser is running"""
        if self.browser_context is None and not self._browser_starting:
            self._browser_starting = True
            self.logger.info("Starting Camoufox browser...")
            
            try: # Outer try block for the entire browser setup process
                # Build Camoufox options
                options = {
                    "headless": self.config.browser.headless,
                    "humanize": self.config.browser.humanize,
                    "geoip": self.config.browser.geoip,
                    "block_webrtc": self.config.browser.block_webrtc,
                    "block_images": self.config.browser.block_images,
                    "block_webgl": self.config.browser.block_webgl,
                    "disable_coop": self.config.browser.disable_coop,
                    "enable_cache": self.config.browser.enable_cache,
                    "main_world_eval": self.config.browser.main_world_eval,
                    "output_dir": self.config.browser.output_dir
                }
                if self.config.browser.os:
                    options["os"] = self.config.browser.os
                if self.config.browser.locale:
                    options["locale"] = self.config.browser.locale
                if self.config.browser.fonts:
                    options["fonts"] = self.config.browser.fonts
                if self.config.browser.proxy:
                    options["proxy"] = self.config.browser.proxy
                if self.config.browser.user_agent:
                    options["user_agent"] = self.config.browser.user_agent
                if self.config.browser.window:
                    options["window"] = self.config.browser.window
                if self.config.browser.addons:
                    options["addons"] = self.config.browser.addons
                if self.config.browser.user_data_dir:
                    options["user_data_dir"] = self.config.browser.user_data_dir
                    
                # Handle persistent context
                if self.config.browser.persistent_context:
                    if not self.config.browser.user_data_dir:
                        raise ValueError("persistent_context requires user_data_dir")
                    options["persistent_context"] = True
                    
                self.browser = AsyncCamoufox(**options)
                
                # Critical section for browser context management
                with self._redirect_stdout_to_stderr():
                    # The type ignore is used because pylint might not fully understand
                    # the __aenter__ return type with conditional logic inside AsyncCamoufox.
                    async with self.browser as instance_or_context: # type: ignore
                        if self.config.browser.persistent_context:
                            # For persistent context, __aenter__ returns the context directly
                            self.browser_context = instance_or_context
                            self.browser_instance = None 
                        else:
                            # For non-persistent, __aenter__ returns the browser instance
                            self.browser_instance = instance_or_context
                            # Create a new context from the browser instance
                            self.browser_context = await self.browser_instance.new_context() # type: ignore
                
                self.logger.info("Camoufox browser started successfully")
                self._browser_starting = False
            
            # Exception handlers for the outer try block
            except asyncio.TimeoutError as e_timeout:
                self.logger.error("Browser startup timed out")
                self._browser_starting = False
                await self._cleanup_browser_on_error() # Attempt cleanup
                # Re-raise as a more generic runtime error for the MCP client
                raise RuntimeError("Browser startup timed out (45s)") from e_timeout
            except PlaywrightError as e_playwright:
                self.logger.error("Playwright error during browser startup: %s", e_playwright)
                self._browser_starting = False
                await self._cleanup_browser_on_error()
                raise RuntimeError(f"PW error at startup: {e_playwright}") from e_playwright
            except (TypeError, ValueError, FileNotFoundError) as e_config_or_file:
                self.logger.error("Configuration or file error during browser startup: %s", e_config_or_file)
                self._browser_starting = False
                await self._cleanup_browser_on_error()
                raise RuntimeError(f"Config/file error at startup: {e_config_or_file}") from e_config_or_file
            except Exception as e_general: # Catch-all for other unexpected startup errors
                self.logger.error("Unexpected error during browser startup: %s", e_general)
                self._browser_starting = False
                await self._cleanup_browser_on_error() # Attempt cleanup
                # Re-raise as a more generic runtime error for the MCP client
                raise RuntimeError(f"Unexpected startup error: {e_general}") from e_general
        elif self._browser_starting:
            # Wait for browser to finish starting
            for _ in range(50):  # Wait up to 5 seconds
                if self.browser_context is not None:
                    break
                await asyncio.sleep(0.1)
            if self.browser_context is None:
                raise RuntimeError("Browser startup failed or timed out")
    
    async def _cleanup_browser_on_error(self):
        """Clean up browser resources on error"""
        if self.browser:
            try:
                await self.browser.__aexit__(None, None, None)
            except Exception as e:
                self.logger.error("Error during browser cleanup: %s", e)
            finally:
                self.browser = None
                self.browser_instance = None
                self.browser_context = None
                self.page = None
                self._browser_starting = False

    async def _close_browser_resources(self):
        """Internal method to actually close browser resources without returning CallToolResult."""
        if self.page:
            try:
                await self.page.close()
                self.logger.debug("Page closed.")
            except PlaywrightError as e_pw:
                self.logger.error("PW error closing page: %s", e_pw)
            except Exception as e:
                self.logger.error("Unexpected err closing page: %s", e)
            finally:
                self.page = None
                
        if self.browser:
            try:
                # __aexit__ is the correct way to close AsyncCamoufox context manager
                await self.browser.__aexit__(None, None, None) 
                self.logger.info("Camoufox browser context closed.")
            except PlaywrightError as e_pw:
                self.logger.error("PW error closing browser ctx: %s", e_pw)
            except Exception as e:
                self.logger.error("Unexpected err closing browser ctx: %s", e)
            finally:
                self.browser = None
                self.browser_instance = None
                self.browser_context = None
    
    async def run_sse(self):
        """Run server with SSE transport using uvicorn"""
        self.logger.info(
            "Starting HTTP server on %s:%s",
            self.config.server.host, self.config.server.port
        )
        
        # Use uvicorn.Server for proper async support
        config = uvicorn.Config(
            self,
            host=self.config.server.host,
            port=self.config.server.port,
            log_level=logging.getLevelName(self.logger.getEffectiveLevel()).lower(),
        )
        server = uvicorn.Server(config)
        await server.serve()