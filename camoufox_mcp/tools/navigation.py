"""Navigation tools for browser automation"""

import asyncio
import logging
from typing import Optional
from mcp.types import CallToolResult, TextContent
from playwright.async_api import Error as PlaywrightError


class NavigationTools:
    """Navigation-related browser automation tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def navigate(self, url: str, wait_until: str = "load") -> CallToolResult:
        """Navigate to URL with stealth capabilities"""
        try:
            # Ensure browser is ready
            await self.server._ensure_browser()
            
            self.logger.info("Navigating to: %s", url)
            
            # Create new page if needed with shorter timeout
            if self.server.page is None:
                with self.server._redirect_stdout_to_stderr():
                    self.server.page = await asyncio.wait_for(
                        self.server.browser_context.new_page(),
                        timeout=15.0
                    )
            
            # Navigate with specified wait condition and reasonable timeout
            with self.server._redirect_stdout_to_stderr():
                await asyncio.wait_for(
                    self.server.page.goto(url, wait_until=wait_until),
                    timeout=20.0  # Reduced timeout to prevent session timeouts
                )
            
            # Get page info with timeout
            try:
                title = await asyncio.wait_for(self.server.page.title(), timeout=3.0)
            except asyncio.TimeoutError:
                title = "Page title unavailable"
            
            current_url = self.server.page.url
            
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
    
    async def wait_for(self, selector: Optional[str] = None, text: Optional[str] = None, 
                      timeout: int = 30000, state: str = "visible") -> CallToolResult:
        """Wait for elements, text, or conditions"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            if text:
                element = self.server.page.get_by_text(text)
                await element.wait_for(state=state, timeout=timeout)
                return CallToolResult(
                    content=[TextContent(type="text", text=f"✅ Found text: '{text}'")]
                )
            if selector: # Changed from elif
                if selector.startswith("//"):
                    element = self.server.page.locator(f"xpath={selector}")
                else:
                    element = self.server.page.locator(selector)
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
            self.logger.error("Error in wait_for: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Wait err: {e}")],
                isError=True
            )