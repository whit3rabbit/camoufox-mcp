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
        self.logger.info("[NAVIGATE] Starting navigation to: %s", url)
        try:
            # Wrap the entire browser interaction in the I/O redirector
            # to capture all output from Camoufox/Playwright setup.
            self.logger.debug("[NAVIGATE] Entering stdout redirector context")
            with self.server._redirect_stdout_to_stderr():
                # Ensure browser is ready. This is the single point of truth for browser state.
                self.logger.info("[NAVIGATE] Calling _ensure_browser()")
                await self.server._ensure_browser()
                self.logger.info("[NAVIGATE] Browser ensured successfully")

                if not self.server.page:
                    self.logger.error("[NAVIGATE] Browser page is None after _ensure_browser")
                    raise RuntimeError("Browser page could not be initialized.")

                self.logger.info("[NAVIGATE] Browser page ready, navigating to: %s", url)
                
                # For data: URLs, 'domcontentloaded' is more reliable.
                is_data_url = url.strip().startswith("data:")
                effective_wait_until = "domcontentloaded" if is_data_url else wait_until

                # Navigate with a generous timeout.
                # Increased timeout to handle slow networks and first-time browser setup
                self.logger.info("[NAVIGATE] Calling page.goto() with wait_until=%s, timeout=120s", effective_wait_until)
                await asyncio.wait_for(
                    self.server.page.goto(url, wait_until=effective_wait_until),
                    timeout=120.0  # Doubled timeout for reliability
                )
                self.logger.info("[NAVIGATE] page.goto() completed successfully")

                # Get page info with a short timeout
                try:
                    title = await asyncio.wait_for(self.server.page.title(), timeout=5.0)
                except asyncio.TimeoutError:
                    title = "Page title unavailable"
                
                current_url = self.server.page.url
                
                self.logger.info("[NAVIGATE] Successfully navigated to: %s", current_url)
                
                return CallToolResult(
                    content=[TextContent(
                        type="text", 
                        text=f"✅ Navigated to: {current_url}\n📄 Title: {title}\n🛡️ Stealth mode active"
                    )],
                    isError=False
                )
            
        except asyncio.TimeoutError as e:
            error_msg = f"❌ Navigation timeout to {url} after 120 seconds. This often happens on first run when downloading the browser. Please retry the operation."
            self.logger.warning(error_msg, exc_info=True)
            # Critical error: close browser resources to allow a fresh start on the next call.
            await self.server._close_browser_resources()
            return CallToolResult(
                content=[TextContent(type="text", text=error_msg)],
                isError=True
            )
        except PlaywrightError as e:
            error_msg = f"❌ Browser error navigating to {url}: {e}"
            self.logger.warning(error_msg, exc_info=True)
            # Critical error: close browser resources to allow a fresh start on the next call.
            await self.server._close_browser_resources()
            return CallToolResult(
                content=[TextContent(type="text", text=error_msg)],
                isError=True
            )
        except Exception as e:
            self.logger.error("Unexpected error navigating to %s: %s", url, e, exc_info=True)
            await self.server._close_browser_resources()
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Unexpected Error during navigation: {e}")],
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