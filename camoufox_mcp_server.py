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
from typing import Any, Dict, List, Optional, Union
import argparse
from dataclasses import dataclass, field
from pathlib import Path

from mcp.server.fastmcp import FastMCP
from mcp.server.stdio import stdio_server
import uvicorn
from mcp.types import (
    CallToolResult,
    ListToolsResult,
    Tool,
    TextContent,
    ImageContent,
)

# Camoufox imports
from camoufox.async_api import AsyncCamoufox
from camoufox.sync_api import Camoufox
try:
    from camoufox_captcha import CamoufoxCaptcha
    CAPTCHA_AVAILABLE = True
except ImportError:
    CAPTCHA_AVAILABLE = False
    CamoufoxCaptcha = None


@dataclass
class CamoufoxConfig:
    """Configuration for Camoufox browser"""
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
    """Server configuration"""
    port: Optional[int] = None
    host: str = "localhost"


@dataclass
class Config:
    """Main configuration"""
    browser: CamoufoxConfig = field(default_factory=CamoufoxConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    debug: bool = False


class CamoufoxMCPServer(FastMCP):
    """Main Camoufox MCP Server class, inheriting from FastMCP"""
    
    def __init__(self, config: Config):
        super().__init__("camoufox-mcp") # Initialize FastMCP base
        self.config = config
        # self.server is no longer needed, 'self' is the server instance.
        self.browser: Optional[AsyncCamoufox] = None
        self.browser_context = None
        self.page = None
        self.captcha_solver: Optional[CamoufoxCaptcha] = None
        
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
    
    async def list_tools(self) -> ListToolsResult:
        """List available tools (overrides FastMCP.list_tools)"""
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
        return ListToolsResult(tools=tools)

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> CallToolResult:
        """Handle tool calls (overrides FastMCP.call_tool)"""
        try:
            if name == "browser_navigate":
                return await self._navigate(arguments["url"], arguments.get("wait_until", "load"))
            elif name == "browser_click":
                return await self._click(arguments["selector"], arguments.get("button", "left"))
            elif name == "browser_type":
                return await self._type(
                    arguments["selector"], 
                    arguments["text"],
                    arguments.get("delay", 100),
                    arguments.get("clear", False)
                )
            elif name == "browser_wait_for":
                return await self._wait_for(
                    arguments.get("selector"),
                    arguments.get("text"), 
                    arguments.get("timeout", 30000),
                    arguments.get("state", "visible")
                )
            elif name == "browser_get_content":
                return await self._get_content(
                    arguments.get("selector"),
                    arguments.get("attribute"),
                    arguments.get("inner_html", False)
                )
            elif name == "browser_screenshot":
                return await self._screenshot(
                    arguments.get("filename"),
                    arguments.get("selector"),
                    arguments.get("full_page", False)
                )
            elif name == "browser_execute_js":
                return await self._execute_js(
                    arguments["code"],
                    arguments.get("main_world", False)
                )
            elif name == "browser_set_geolocation":
                return await self._set_geolocation(
                    arguments["latitude"],
                    arguments["longitude"],
                    arguments.get("accuracy", 100)
                )
            elif name == "browser_close":
                return await self._close()
            elif name == "browser_solve_captcha":
                if not (self.config.browser.captcha_solver and CAPTCHA_AVAILABLE):
                    return CallToolResult(
                        content=[TextContent(type="text", text="CAPTCHA solver not available or not enabled.")],
                        isError=True
                    )
                return await self._solve_captcha(
                    arguments.get("captcha_type", "auto"),
                    arguments.get("timeout", 60)
                )
            else:
                return CallToolResult(
                    content=[TextContent(type="text", text=f"Unknown tool: {name}")],
                    isError=True
                )
        except Exception as e:
            self.logger.error(f"Error in tool {name}: {e}")
            # Ensure browser is closed on error if it was started and not a close command error
            if self.browser_context and name != "browser_close":
                 await self._close_browser_resources() # Ensure this method exists and handles cleanup
            return CallToolResult(
                content=[TextContent(type="text", text=f"Error: {str(e)}")],
                isError=True
            )
    
    async def _ensure_browser(self):
        """Ensure browser is running"""
        if self.browser_context is None:
            self.logger.info("Starting Camoufox browser...")
            
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
            }
            
            # Add optional parameters
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
            self.browser_context = await self.browser.__aenter__()
            
            # Initialize captcha solver if enabled
            if self.config.browser.captcha_solver and CAPTCHA_AVAILABLE:
                # Note: CamoufoxCaptcha might need sync browser, will handle this
                pass
    
    async def _navigate(self, url: str, wait_until: str = "load") -> CallToolResult:
        """Navigate to URL with stealth capabilities"""
        await self._ensure_browser()
        
        self.logger.info(f"Navigating to: {url}")
        
        # Create new page if needed
        if self.page is None:
            self.page = await self.browser_context.new_page()
        
        # Navigate with specified wait condition
        await self.page.goto(url, wait_until=wait_until)
        
        title = await self.page.title()
        current_url = self.page.url
        
        return CallToolResult(
            content=[TextContent(
                type="text", 
                text=f"✅ Navigated to: {current_url}\n📄 Title: {title}\n🛡️ Stealth mode active"
            )]
        )
    
    async def _click(self, selector: str, button: str = "left") -> CallToolResult:
        """Click element with human-like movement"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized. Navigate to a page first.")],
                isError=True
            )
        
        self.logger.info(f"Clicking element: {selector}")
        
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
                content=[TextContent(type="text", text=f"🖱️ Clicked element: {selector} (with human-like movement)")]
            )
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Failed to click {selector}: {str(e)}")],
                isError=True
            )
    
    async def _type(self, selector: str, text: str, delay: int = 100, clear: bool = False) -> CallToolResult:
        """Type text with human-like timing"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        self.logger.info(f"Typing into element: {selector}")
        
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
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Failed to type into {selector}: {str(e)}")],
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
            elif selector:
                if selector.startswith("//"):
                    element = self.page.locator(f"xpath={selector}")
                else:
                    element = self.page.locator(selector)
                await element.wait_for(state=state, timeout=timeout)
                return CallToolResult(
                    content=[TextContent(type="text", text=f"✅ Element found: {selector}")]
                )
            else:
                return CallToolResult(
                    content=[TextContent(type="text", text="❌ Must specify either selector or text")],
                    isError=True
                )
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Wait timeout: {str(e)}")],
                isError=True
            )
    
    async def _get_content(self, selector: Optional[str] = None, 
                          attribute: Optional[str] = None, inner_html: bool = False) -> CallToolResult:
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
                content=[TextContent(type="text", text=content or "")]
            )
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Failed to get content: {str(e)}")],
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
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Screenshot failed: {str(e)}")],
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
                content=[TextContent(type="text", text=f"🔧 JavaScript executed{world_info}:\n```\n{result_str}\n```")]
            )
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ JavaScript execution failed: {str(e)}")],
                isError=True
            )
    
    async def _set_geolocation(self, latitude: float, longitude: float, accuracy: float = 100) -> CallToolResult:
        """Set browser geolocation"""
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            await self.page.set_geolocation({"latitude": latitude, "longitude": longitude, "accuracy": accuracy})
            
            return CallToolResult(
                content=[TextContent(type="text", text=f"🌍 Geolocation set: {latitude}, {longitude} (±{accuracy}m)")]
            )
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Failed to set geolocation: {str(e)}")],
                isError=True
            )
    
    async def _solve_captcha(self, captcha_type: str = "auto", timeout: int = 60) -> CallToolResult:
        """Solve CAPTCHA automatically"""
        if not CAPTCHA_AVAILABLE:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ CAPTCHA solver not available. Install camoufox-captcha.")],
                isError=True
            )
        
        if not self.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        self.logger.info(f"Solving CAPTCHA: {captcha_type}")
        
        try:
            # Note: CamoufoxCaptcha integration would need to be adapted for async usage
            # This is a placeholder for the actual implementation
            result = f"🤖 CAPTCHA solver would attempt to solve {captcha_type} type CAPTCHA"
            
            return CallToolResult(
                content=[TextContent(type="text", text=result)]
            )
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ CAPTCHA solving failed: {str(e)}")],
                isError=True
            )

    async def _close_browser_resources(self):
        """Internal method to actually close browser resources without returning CallToolResult."""
        if self.page:
            try:
                await self.page.close()
                self.logger.debug("Page closed.")
            except Exception as e:
                self.logger.error(f"Error closing page: {e}")
            finally:
                self.page = None
                
        if self.browser:
            try:
                # __aexit__ is the correct way to close AsyncCamoufox context manager
                await self.browser.__aexit__(None, None, None) 
                self.logger.info("Camoufox browser context closed.")
            except Exception as e:
                self.logger.error(f"Error closing browser context: {e}")
            finally:
                self.browser = None
                self.browser_context = None
                self.captcha_solver = None # Also reset captcha solver if it depends on browser
    
    async def _close(self) -> CallToolResult:
        """Close browser and clean up"""
        try:
            if self.page:
                await self.page.close()
                self.page = None
                
            if self.browser:
                await self.browser.__aexit__(None, None, None)
                self.browser = None
                self.browser_context = None
                self.captcha_solver = None
            
            return CallToolResult(
                content=[TextContent(type="text", text="🔒 Browser closed and resources cleaned up")]
            )
            
        except Exception as e:
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Error closing browser: {str(e)}")],
                isError=True
            )
    
    async def run_stdio(self):
        """Run server with stdio transport"""
        self.logger.info("Starting server with STDIO transport")
        # stdio_server might still work with FastMCP if it adheres to the same server interface
        # or FastMCP might have its own way to handle stdio.
        await stdio_server(self, logger=self.logger) # Changed self.server to self
    
    async def run_sse(self):
        """Run server with SSE transport using uvicorn"""
        # 'self' is now the FastMCP ASGI app
        # uvicorn.run is synchronous. Since main() calls asyncio.run(server.run_sse()),
        # and run_sse itself is an async def containing a sync call, this might lead to issues
        # if asyncio.run is expecting run_sse to be fully async. 
        # However, uvicorn.run() will block, which is the desired behavior for running the server.
        # If run_sse were awaited by another async function, uvicorn.Server(...).serve() would be more appropriate.
        self.logger.info(f"Starting HTTP server on {self.config.server.host}:{self.config.server.port}")
        uvicorn.run(
            self, # Changed self.server to self
            host=self.config.server.host,
            port=self.config.server.port,
            log_level=logging.getLevelName(self.logger.getEffectiveLevel()).lower(),
            # access_log=False # Can be useful to reduce verbosity
        )


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
    fingerprint_group.add_argument("--geoip", help="IP address for geolocation (or 'auto' for auto-detection)")
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
    log_level = logging.DEBUG if args.debug else logging.INFO
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    # Example of getting a logger in main, though server will get its own.
    # logger = logging.getLogger(__name__) 
    # logger.info("Camoufox MCP Server starting...")
    
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
        except ValueError:
            raise ValueError("Invalid window size format. Use WIDTHxHEIGHT (e.g., 1920x1080)")
    
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
        asyncio.run(server.run_stdio())


if __name__ == "__main__":
    main()