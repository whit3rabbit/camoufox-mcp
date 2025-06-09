"""Interaction tools for browser automation"""

import logging
from mcp.types import CallToolResult, TextContent
from playwright.async_api import Error as PlaywrightError


class InteractionTools:
    """Interaction-related browser automation tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def click(self, selector: str, button: str = "left") -> CallToolResult:
        """Click element with human-like movement"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized. Navigate to a page first.")],
                isError=True
            )
        
        self.logger.info("Clicking element: %s", selector)
        
        try:
            # Handle different selector types
            if selector.startswith("//"):
                # XPath selector
                element = self.server.page.locator(f"xpath={selector}")
            elif not any(char in selector for char in [".", "#", "[", ">"]):
                # Text content selector
                element = self.server.page.get_by_text(selector)
            else:
                # CSS selector
                element = self.server.page.locator(selector)
            
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
    
    async def type_text(self, selector: str, text: str, delay: int = 100, clear: bool = False) -> CallToolResult:
        """Type text with human-like timing"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        self.logger.info("Typing into element: %s", selector)
        
        try:
            # Handle different selector types
            if selector.startswith("//"):
                element = self.server.page.locator(f"xpath={selector}")
            else:
                element = self.server.page.locator(selector)
            
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