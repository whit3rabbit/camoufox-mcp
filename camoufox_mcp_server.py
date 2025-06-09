#!/usr/bin/env python3
"""
Camoufox MCP Server
A Model Context Protocol server providing browser automation via Camoufox
"""

import asyncio
import json
import logging
import os
import base64
import time
import sys
from typing import Any, Dict, List, Optional, Union
import argparse
from dataclasses import dataclass, field
from contextlib import contextmanager

from mcp.server.fastmcp import FastMCP
from mcp.types import (
    CallToolResult,
    Tool,
    TextContent,
    ImageContent,
)
import uvicorn

# Third-party imports
from playwright.async_api import Error as PlaywrightError

# Camoufox imports
from camoufox.async_api import AsyncCamoufox
try:
    from camoufox_captcha import CamoufoxCaptcha
    CAPTCHA_AVAILABLE = True
except ImportError:
    CAPTCHA_AVAILABLE = False
    CamoufoxCaptcha = None


@dataclass
class CamoufoxConfig:
    """Configuration for the Camoufox browser instance.

    This dataclass holds all settings related to how the Camoufox browser
    will be launched and behave, including headless mode, humanization,
    fingerprinting options, security settings, and proxy configuration.
    """
    # Basic options
    headless: Union[bool, str] = True  # True, False, or 'virtual'
    humanize: Union[bool, float] = True  # Enable human cursor movement
    
    # Fingerprinting options
    os: Optional[Union[str, List[str]]] = None  # 'windows', 'macos', 'linux' or list
    geoip: Union[bool, str, None] = True  # True, False, or IP address
    locale: Optional[Union[str, List[str]]] = None  # Language/region
    fonts: Optional[List[str]] = None  # Custom fonts to load
    
    # Security & Privacy
    block_webrtc: bool = True
    block_images: bool = False
    block_webgl: bool = False
    disable_coop: bool = False  # For CAPTCHA solving
    
    # Browser options
    proxy: Optional[Dict[str, str]] = None  # Playwright proxy format
    user_agent: Optional[str] = None
    window: Optional[tuple[int, int]] = None  # (width, height)
    addons: Optional[List[str]] = None  # Paths to Firefox addons
    
    # Advanced options
    enable_cache: bool = False
    persistent_context: bool = False
    user_data_dir: Optional[str] = None
    main_world_eval: bool = True  # Enable DOM manipulation
    
    # MCP-specific options
    captcha_solver: bool = False
    output_dir: str = "/tmp/camoufox-mcp"


@dataclass 
class ServerConfig:
    """Configuration for the MCP server itself.

    Specifies network parameters like port and host for the server.
    """
    port: Optional[int] = None
    host: str = "localhost"


@dataclass
class Config:
    """Main configuration container for the Camoufox MCP Server.

    Aggregates browser-specific and server-specific configurations,
    as well as global settings like debug mode.
    """
    browser: CamoufoxConfig = field(default_factory=CamoufoxConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    debug: bool = False


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
        self.version = "1.9.3"  # Version of this Camoufox MCP Server implementation
        # self.server is no longer needed, 'self' is the server instance.
        self.browser: Optional[AsyncCamoufox] = None
        self.browser_instance = None  # Browser instance when not using persistent context
        self.browser_context = None
        self.page = None
        self.captcha_solver: Optional[CamoufoxCaptcha] = None
        self._browser_starting = False  # Flag to track browser startup
        
        # Get a logger specific to this class instance.
        # BasicConfig is done in main(), so we just get the logger here.
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
        # The effective level will be set by basicConfig in main.
        # If specific level needed for this logger: 
        # self.logger.setLevel(logging.DEBUG if config.debug else logging.INFO)
        
        # Check for captcha solver availability
        if config.browser.captcha_solver and not CAPTCHA_AVAILABLE:
            self.logger.warning("CAPTCHA solver requested but camoufox-captcha not installed")
            config.browser.captcha_solver = False
        
        # Tool registration is now done by overriding list_tools and call_tool methods directly.
        # No self._register_handlers() call needed.
    
    @contextmanager
    def _redirect_stdout_to_stderr(self):
        """Context manager to redirect stdout to stderr during browser operations"""
        # For STDIO mode, we need to redirect at the file descriptor level
        # to catch output from subprocesses (like Camoufox downloads)
        if hasattr(self, 'config') and not self.config.server.port:
            # STDIO mode - redirect at OS level
            stdout_fd = sys.stdout.fileno()
            stderr_fd = sys.stderr.fileno()
            
            # Save the original stdout
            stdout_copy = os.dup(stdout_fd)
            try:
                # Redirect stdout to stderr
                os.dup2(stderr_fd, stdout_fd)
                yield
            finally:
                # Restore original stdout
                os.dup2(stdout_copy, stdout_fd)
                os.close(stdout_copy)
        else:
            # HTTP mode - simple redirect
            original_stdout = sys.stdout
            try:
                sys.stdout = sys.stderr
                yield
            finally:
                sys.stdout = original_stdout
    
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
            )
        ]
        
        if self.config.browser.captcha_solver and CAPTCHA_AVAILABLE:
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
            tools.append(
                Tool(
                    name="get_server_version",
                    description="Get the current version of the Camoufox MCP server implementation.",
                    inputSchema={"type": "object", "properties": {}},
                    outputSchema={
                        "type": "object",
                        "properties": {"version": {"type": "string"}}
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
                return await self._navigate(arguments["url"], arguments.get("wait_until", "load"))
            if name == "browser_click":
                return await self._click(arguments["selector"], arguments.get("button", "left"))
            if name == "browser_type":
                return await self._type(
                    arguments["selector"], 
                    arguments["text"],
                    arguments.get("delay", 100),
                    arguments.get("clear", False)
                )
            if name == "browser_wait_for":
                return await self._wait_for(
                    arguments.get("selector"),
                    arguments.get("text"), 
                    arguments.get("timeout", 30000),
                    arguments.get("state", "visible")
                )
            if name == "browser_get_content":
                return await self._get_content(
                    arguments.get("selector"),
                    arguments.get("attribute"),
                    arguments.get("inner_html", False)
                )
            if name == "browser_screenshot":
                return await self._screenshot(
                    arguments.get("filename"),
                    arguments.get("selector"),
                    arguments.get("full_page", False)
                )
            if name == "browser_execute_js":
                return await self._execute_js(
                    arguments["code"],
                    arguments.get("main_world", False)
                )
            if name == "browser_set_geolocation":
                return await self._set_geolocation(
                    arguments["latitude"],
                    arguments["longitude"],
                    arguments.get("accuracy", 100)
                )
            if name == "get_server_version":
                self.logger.info("Reporting server version: %s", self.version)
                return CallToolResult(content=[TextContent(text=self.version)])
            if name == "browser_close":
                return await self._close()
            if name == "browser_solve_captcha":
                if not (self.config.browser.captcha_solver and CAPTCHA_AVAILABLE):
                    return CallToolResult(
                        content=[TextContent(type="text", text="CAPTCHA solver not available/enabled.")],
                        isError=True
                    )
                return await self._solve_captcha(
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
                
                # Initialize captcha solver if enabled
                if self.config.browser.captcha_solver and CAPTCHA_AVAILABLE:
                    # Placeholder for captcha solver initialization if it needs the context
                    # For example: self.captcha_solver = CamoufoxCaptcha(self.browser_context)
                    pass
            
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
    
    async def _navigate(self, url: str, wait_until: str = "load") -> CallToolResult:
        """Navigate to URL with stealth capabilities"""
        try:
            # Ensure browser is ready
            await self._ensure_browser()
            
            self.logger.info("Navigating to: %s", url)
            
            # Create new page if needed with shorter timeout
            if self.page is None:
                with self._redirect_stdout_to_stderr():
                    self.page = await asyncio.wait_for(
                        self.browser_context.new_page(),
                        timeout=15.0
                    )
            
            # Navigate with specified wait condition and reasonable timeout
            with self._redirect_stdout_to_stderr():
                await asyncio.wait_for(
                    self.page.goto(url, wait_until=wait_until),
                    timeout=20.0  # Reduced timeout to prevent session timeouts
                )
            
            # Get page info with timeout
            try:
                title = await asyncio.wait_for(self.page.title(), timeout=3.0)
            except asyncio.TimeoutError:
                title = "Page title unavailable"
            
            current_url = self.page.url
            
            self.logger.info("Successfully navigated to: %s", current_url)
            
            return CallToolResult(
                content=[TextContent(
                    type="text", 
                    text=f"✅ Navigated to: {current_url}\n📄 Title: {title}\n🛡️ Stealth mode active"
                )],
                isError=False
            )
            
        except asyncio.TimeoutError:
            error_msg = f"❌ Nav to {url} timed out (may occur on 1st run)"
            self.logger.warning(error_msg)
            return CallToolResult(
                content=[TextContent(type="text", text=error_msg)],
                isError=True
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error navigating to %s: %s", url, e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"PW error nav to {url}: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other navigation errors
            self.logger.error("Unexpected error navigating to %s: %s", url, e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"Error nav to {url}: {e}")],
                isError=True
            )
    
    async def _click(self, selector: str, button: str = "left") -> CallToolResult:
        """Click element with human-like movement"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized. Navigate to a page first.")],
                isError=True
            )
        
        self.logger.info("Clicking element: %s", selector)
        
        try:
            # Handle different selector types
            if selector.startswith("//"):
                # XPath selector
                element = self.page.locator(f"xpath={selector}")
            elif not any(char in selector for char in [".", "#", "[", ">"]):
                # Text content selector
                element = self.page.get_by_text(selector)
            else:
                # CSS selector
                element = self.page.locator(selector)
            
            # Wait for element and click with specified button
            await element.wait_for(state="visible")
            await element.click(button=button)
            
            return CallToolResult(
                content=[TextContent(type="text", text=f"🖱️ Clicked: {selector} (human-like)")],
                isError=False
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error clicking %s: %s", selector, e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err click {selector}: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other click errors
            self.logger.error("Unexpected err clicking %s: %s", selector, e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Click failed {selector}: {e}")],
                isError=True
            )
    
    async def _type(self, selector: str, text: str, delay: int = 100, clear: bool = False) -> CallToolResult:
        """Type text with human-like timing"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        self.logger.info("Typing into element: %s", selector)
        
        try:
            # Handle different selector types
            if selector.startswith("//"):
                element = self.page.locator(f"xpath={selector}")
            else:
                element = self.page.locator(selector)
            
            await element.wait_for(state="visible")
            
            if clear:
                await element.clear()
            
            # Type with human-like delay
            await element.type(text, delay=delay)
            
            return CallToolResult(
                content=[TextContent(type="text", text=f"⌨️ Typed '{text}' into {selector} (human-like timing)")]
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error typing into %s: %s", selector, e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW type err {selector}: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other type errors
            self.logger.error("Unexpected err typing to %s: %s", selector, e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Type err {selector}: {e}")],
                isError=True
            )
    
    async def _wait_for(self, selector: Optional[str] = None, text: Optional[str] = None, 
                       timeout: int = 30000, state: str = "visible") -> CallToolResult:
        """Wait for elements, text, or conditions"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            if text:
                element = self.page.get_by_text(text)
                await element.wait_for(state=state, timeout=timeout)
                return CallToolResult(
                    content=[TextContent(type="text", text=f"✅ Found text: '{text}'")]
                )
            if selector: # Changed from elif
                if selector.startswith("//"):
                    element = self.page.locator(f"xpath={selector}")
                else:
                    element = self.page.locator(selector)
                await element.wait_for(state=state, timeout=timeout)
                return CallToolResult(
                    content=[TextContent(type="text", text=f"✅ Element found: {selector}")]
                )
            # If neither text nor selector was provided (implicit from original else)
            if not text and not selector:
                return CallToolResult(
                    content=[TextContent(type="text", text="❌ Must specify either selector or text")],
                    isError=True
                )
        except PlaywrightError as e_playwright: # Typically a TimeoutError from Playwright
            self.logger.warning("PW wait op failed (sel/txt): %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW wait err: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other wait_for errors
            self.logger.error("Error in _wait_for: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Wait err: {e}")],
                isError=True
            )
    
    async def _get_content(
        self,
        selector: Optional[str] = None,
        attribute: Optional[str] = None,
        inner_html: bool = False
    ) -> CallToolResult:
        """Get page content or element text"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            if selector:
                if selector.startswith("//"):
                    element = self.page.locator(f"xpath={selector}")
                else:
                    element = self.page.locator(selector)
                
                if attribute:
                    content = await element.get_attribute(attribute)
                elif inner_html:
                    content = await element.inner_html()
                else:
                    content = await element.text_content()
            else:
                if inner_html:
                    content = await self.page.content()
                else:
                    content = await self.page.inner_text("body")
            
            return CallToolResult(
                content=[TextContent(type="text", text=content or "")],
                isError=False
            )
        except PlaywrightError as e_playwright:
            self.logger.error("PW error in _get_content (sel: %s): %s", selector, e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err get_content: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other get_content errors
            self.logger.error("Unexpected error in _get_content: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Error get_content: {e}")],
                isError=True
            )

    async def _screenshot(self, filename: Optional[str] = None, 
                         selector: Optional[str] = None, full_page: bool = False) -> CallToolResult:
        """Take screenshot with Camoufox"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            # Ensure output directory exists
            os.makedirs(self.config.browser.output_dir, exist_ok=True)
            
            if not filename:
                timestamp = int(time.time())
                filename = f"camoufox_screenshot_{timestamp}.png"
            
            filepath = os.path.join(self.config.browser.output_dir, filename)
            
            if selector:
                # Screenshot specific element
                if selector.startswith("//"):
                    element = self.page.locator(f"xpath={selector}")
                else:
                    element = self.page.locator(selector)
                await element.screenshot(path=filepath)
            else:
                # Screenshot full page or viewport
                await self.page.screenshot(path=filepath, full_page=full_page)
            
            # Read screenshot and return as base64
            with open(filepath, "rb") as f:
                screenshot_data = base64.b64encode(f.read()).decode()
            
            return CallToolResult(
                content=[
                    ImageContent(
                        type="image",
                        data=screenshot_data,
                        mimeType="image/png"
                    ),
                    TextContent(type="text", text=f"📸 Screenshot saved: {filepath}")
                ]
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error in _screenshot: %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err screenshot: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other screenshot errors
            self.logger.error("Unexpected error in _screenshot: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Err screenshot: {e}")],
                isError=True
            )
    
    async def _execute_js(self, code: str, main_world: bool = False) -> CallToolResult:
        """Execute JavaScript code"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            # Prefix with mw: for main world execution if enabled
            if main_world and self.config.browser.main_world_eval:
                code = f"mw:{code}"
            
            result = await self.page.evaluate(code)
            
            # Convert result to string for display
            if result is None:
                result_str = "undefined"
            elif isinstance(result, (dict, list)):
                result_str = json.dumps(result, indent=2)
            else:
                result_str = str(result)
            
            world_info = " (main world)" if main_world else " (isolated world)"
            
            return CallToolResult(
                content=[
                    TextContent(
                        type="text",
                        text=f"🔧 JavaScript executed{world_info}:\n```\n{result_str}\n```"
                    )
                ]
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error executing JS: %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err JS exec: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other JS execution errors
            self.logger.error("Unexpected err JS exec: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ JavaScript execution failed: {str(e)}")],
                isError=True
            )
    
    async def _set_geolocation(
        self, latitude: float, longitude: float, accuracy: float = 100
    ) -> CallToolResult:
        """Set browser geolocation"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            await self.page.set_geolocation({
                "latitude": latitude, "longitude": longitude, "accuracy": accuracy
            })
            
            return CallToolResult(
                content=[
                    TextContent(
                        type="text",
                        text=f"🌍 Geolocation set: {latitude}, {longitude} (±{accuracy}m)"
                    )
                ]
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error setting geolocation: %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err set_geo: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other set_geolocation errors
            self.logger.error("Unexpected err set_geo: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Failed to set geolocation: {str(e)}")],
                isError=True
            )
    
    async def _solve_captcha(self, captcha_type: str = "auto") -> CallToolResult:
        """Solve CAPTCHA automatically"""
        if not CAPTCHA_AVAILABLE:
            return CallToolResult(
                content=[
                    TextContent(
                        type="text",
                        text="❌ CAPTCHA solver not available. Install camoufox-captcha."
                    )
                ],
                isError=True
            )
        
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        self.logger.info("Solving CAPTCHA: %s", captcha_type)
        
        try:
            # Note: CamoufoxCaptcha integration would need to be adapted for async usage
            # This is a placeholder for the actual implementation
            result = f"🤖 CAPTCHA solver would attempt to solve {captcha_type} type CAPTCHA"
            
            return CallToolResult(
                content=[TextContent(type="text", text=result)]
            )
        except PlaywrightError as e_playwright:
            self.logger.error("Playwright error in _solve_captcha: %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err CAPTCHA: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other CAPTCHA errors
            self.logger.error("Unexpected error in _solve_captcha: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Err CAPTCHA: {e}")],
                isError=True
            )

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
                self.captcha_solver = None # Also reset captcha solver if it depends on browser
    
    async def _close(self) -> CallToolResult:
        """Close browser and clean up"""
        try:
            self.logger.info("Attempting to close browser resources via _close tool.")
            await self._close_browser_resources()
            self.logger.info("Browser resources should be closed.")
            return CallToolResult(
                content=[TextContent(type="text", text="🔒 Browser closed and resources cleaned up.")]
            )
        except Exception as e: # Catch any unexpected error from _close_browser_resources
            self.logger.error("Unexpected error during _close operation: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Error closing browser: {str(e)}")],
                isError=True
            )
    
    
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


def parse_args():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description="Camoufox MCP Server - Stealth Browser Automation")
    
    # Browser options
    browser_group = parser.add_argument_group("Browser Options")
    browser_group.add_argument("--headless", choices=["true", "false", "virtual"], default="true",
                               help="Headless mode: true, false, or virtual (uses Xvfb on Linux)")
    browser_group.add_argument("--humanize", type=float, metavar="SECONDS",
                               help="Enable human-like cursor movement (max duration in seconds)")
    browser_group.add_argument("--no-humanize", action="store_true",
                               help="Disable human-like cursor movement")
    
    # Fingerprinting options
    fingerprint_group = parser.add_argument_group("Fingerprinting & Stealth")
    fingerprint_group.add_argument("--os", choices=["windows", "macos", "linux"], 
                                   help="Target operating system for fingerprinting")
    fingerprint_group.add_argument(
        "--geoip", help="IP address for geolocation (or 'auto' for auto-detection)"
    )
    fingerprint_group.add_argument("--no-geoip", action="store_true", help="Disable GeoIP features")
    fingerprint_group.add_argument("--locale", help="Locale/language (e.g., 'en-US' or 'US')")
    fingerprint_group.add_argument("--fonts", nargs="+", help="Custom fonts to load")
    
    # Security & Privacy
    security_group = parser.add_argument_group("Security & Privacy")
    security_group.add_argument("--block-webrtc", action="store_true", default=True,
                                help="Block WebRTC to prevent IP leaks")
    security_group.add_argument("--no-block-webrtc", action="store_false", dest="block_webrtc")
    security_group.add_argument("--block-images", action="store_true",
                                help="Block image loading to save bandwidth")
    security_group.add_argument("--block-webgl", action="store_true",
                                help="Block WebGL (use with caution)")
    security_group.add_argument("--disable-coop", action="store_true",
                                help="Disable Cross-Origin-Opener-Policy (for CAPTCHA solving)")
    
    # Network options
    network_group = parser.add_argument_group("Network Options")
    network_group.add_argument("--proxy", help="Proxy server (format: http://user:pass@host:port)")
    network_group.add_argument("--user-agent", help="Custom user agent string")
    
    # Browser behavior
    behavior_group = parser.add_argument_group("Browser Behavior")
    behavior_group.add_argument("--window", help="Window size in pixels (format: WIDTHxHEIGHT)")
    behavior_group.add_argument("--enable-cache", action="store_true",
                                help="Enable page caching (allows back/forward navigation)")
    behavior_group.add_argument("--persistent", action="store_true",
                                help="Use persistent context (requires --user-data-dir)")
    behavior_group.add_argument("--user-data-dir", help="Path to user data directory")
    behavior_group.add_argument("--addons", nargs="+", help="Paths to Firefox addon directories")
    
    # CAPTCHA solving
    captcha_group = parser.add_argument_group("CAPTCHA Solving")
    captcha_group.add_argument("--captcha-solver", action="store_true",
                               help="Enable CAPTCHA solving capabilities")
    
    # Output options
    output_group = parser.add_argument_group("Output Options") 
    output_group.add_argument("--output-dir", default="/tmp/camoufox-mcp",
                              help="Directory for screenshots and files")
    
    # Server options  
    server_group = parser.add_argument_group("Server Options")
    server_group.add_argument("--port", type=int, help="Port for SSE transport (enables HTTP mode)")
    server_group.add_argument("--host", default="localhost", help="Host to bind server to")
    server_group.add_argument("--debug", action="store_true", help="Enable debug logging")
    
    return parser.parse_args()


def main():
    """Main entry point"""
    args = parse_args()

    # Setup logging early. Logs from MCP SDK and uvicorn will also use this.
    # For STDIO transport, disable logging to avoid interfering with JSON-RPC communication
    # unless explicitly running in debug mode with HTTP transport
    if args.port:
        # HTTP/SSE mode - normal logging is fine
        log_level = logging.DEBUG if args.debug else logging.INFO
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    else:
        # STDIO mode - always log to stderr to avoid stdout interference
        log_level = logging.DEBUG if args.debug else logging.WARNING
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S',
            stream=sys.stderr  # Explicitly use stderr for STDIO mode
        )
        
        # For STDIO mode, we need to be more aggressive about stdout protection
        # Store the original stdout fd for MCP communication
        os.environ['MCP_ORIGINAL_STDOUT_FD'] = str(sys.stdout.fileno())
    
    # Create logger and log startup
    logger = logging.getLogger(__name__)
    logger.info("Camoufox MCP Server starting...")
    
    # Build browser config
    browser_config = CamoufoxConfig()
    
    # Handle headless option
    if args.headless == "true":
        browser_config.headless = True
    elif args.headless == "false":
        browser_config.headless = False
    elif args.headless == "virtual":
        browser_config.headless = "virtual"
    
    # Handle humanize option
    if args.no_humanize:
        browser_config.humanize = False
    elif args.humanize:
        browser_config.humanize = args.humanize
    
    # Fingerprinting options
    if args.os:
        browser_config.os = args.os
    if args.geoip:
        if args.geoip.lower() == "auto":
            browser_config.geoip = True
        else:
            browser_config.geoip = args.geoip
    elif args.no_geoip:
        browser_config.geoip = False
    if args.locale:
        browser_config.locale = args.locale
    if args.fonts:
        browser_config.fonts = args.fonts
    
    # Security options
    browser_config.block_webrtc = args.block_webrtc
    browser_config.block_images = args.block_images
    browser_config.block_webgl = args.block_webgl
    browser_config.disable_coop = args.disable_coop
    
    # Network options
    if args.proxy:
        # Parse proxy string into Playwright format
        if "@" in args.proxy:
            # Format: http://user:pass@host:port
            protocol, rest = args.proxy.split("://", 1)
            auth, server = rest.split("@", 1)
            if ":" in auth:
                username, password = auth.split(":", 1)
                browser_config.proxy = {
                    "server": f"{protocol}://{server}",
                    "username": username,
                    "password": password
                }
            else:
                browser_config.proxy = {"server": args.proxy}
        else:
            # Format: http://host:port
            browser_config.proxy = {"server": args.proxy}
    
    if args.user_agent:
        browser_config.user_agent = args.user_agent
    
    # Browser behavior
    if args.window:
        try:
            width, height = map(int, args.window.split('x'))
            browser_config.window = (width, height)
        except ValueError as ve:
            raise ValueError(
                "Invalid window size format. Use WIDTHxHEIGHT (e.g., 1920x1080)"
            ) from ve
    
    browser_config.enable_cache = args.enable_cache
    browser_config.persistent_context = args.persistent
    if args.user_data_dir:
        browser_config.user_data_dir = args.user_data_dir
    if args.addons:
        browser_config.addons = args.addons
    
    # CAPTCHA and output
    browser_config.captcha_solver = args.captcha_solver
    browser_config.output_dir = args.output_dir
    
    # Build main config
    config = Config(
        browser=browser_config,
        server=ServerConfig(port=args.port, host=args.host),
        debug=args.debug
    )
    
    # Validate configuration
    if config.browser.persistent_context and not config.browser.user_data_dir:
        raise ValueError("--persistent requires --user-data-dir")
    
    # Create and run server
    server = CamoufoxMCPServer(config)
    
    if args.port:
        asyncio.run(server.run_sse())
    else:
        # Use FastMCP's async run method for stdio
        asyncio.run(server.run_stdio_async())


if __name__ == "__main__":
    main()