"""Content tools for browser automation"""

import base64
import logging
import os
import time
from typing import Optional
from mcp.types import CallToolResult, TextContent, ImageContent
from playwright.async_api import Error as PlaywrightError


class ContentTools:
    """Content-related browser automation tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def get_content(
        self,
        selector: Optional[str] = None,
        attribute: Optional[str] = None,
        inner_html: bool = False
    ) -> CallToolResult:
        """Get page content or element text"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            if selector:
                if selector.startswith("//"):
                    element = self.server.page.locator(f"xpath={selector}")
                else:
                    element = self.server.page.locator(selector)
                
                if attribute:
                    content = await element.get_attribute(attribute)
                elif inner_html:
                    content = await element.inner_html()
                else:
                    content = await element.text_content()
            else:
                if inner_html:
                    content = await self.server.page.content()
                else:
                    content = await self.server.page.inner_text("body")
            
            return CallToolResult(
                content=[TextContent(type="text", text=content or "")],
                isError=False
            )
        except PlaywrightError as e_playwright:
            self.logger.error("PW error in get_content (sel: %s): %s", selector, e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err get_content: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other get_content errors
            self.logger.error("Unexpected error in get_content: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Error get_content: {e}")],
                isError=True
            )

    async def screenshot(self, filename: Optional[str] = None, 
                        selector: Optional[str] = None, full_page: bool = False) -> CallToolResult:
        """Take screenshot with Camoufox"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            # Ensure output directory exists
            os.makedirs(self.server.config.browser.output_dir, exist_ok=True)
            
            if not filename:
                timestamp = int(time.time())
                filename = f"camoufox_screenshot_{timestamp}.png"
            
            filepath = os.path.join(self.server.config.browser.output_dir, filename)
            
            if selector:
                # Screenshot specific element
                if selector.startswith("//"):
                    element = self.server.page.locator(f"xpath={selector}")
                else:
                    element = self.server.page.locator(selector)
                await element.screenshot(path=filepath)
            else:
                # Screenshot full page or viewport
                await self.server.page.screenshot(path=filepath, full_page=full_page)
            
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
            self.logger.error("Playwright error in screenshot: %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err screenshot: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other screenshot errors
            self.logger.error("Unexpected error in screenshot: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Err screenshot: {e}")],
                isError=True
            )