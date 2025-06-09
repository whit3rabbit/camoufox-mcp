"""JavaScript execution tools for browser automation"""

import json
import logging
from mcp.types import CallToolResult, TextContent
from playwright.async_api import Error as PlaywrightError


class JavaScriptTools:
    """JavaScript execution tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def execute_js(self, code: str, main_world: bool = False) -> CallToolResult:
        """Execute JavaScript code"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            # Prefix with mw: for main world execution if enabled
            if main_world and self.server.config.browser.main_world_eval:
                code = f"mw:{code}"
            
            result = await self.server.page.evaluate(code)
            
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