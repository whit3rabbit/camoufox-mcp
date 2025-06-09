"""CAPTCHA solving tools for browser automation"""

import logging
from mcp.types import CallToolResult, TextContent
from playwright.async_api import Error as PlaywrightError

# CAPTCHA solver import
try:
    from camoufox_captcha import CamoufoxCaptcha
    CAPTCHA_AVAILABLE = True
except ImportError:
    CAPTCHA_AVAILABLE = False
    CamoufoxCaptcha = None


class CaptchaTools:
    """CAPTCHA solving tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    @property
    def is_available(self) -> bool:
        """Check if CAPTCHA solving is available"""
        return CAPTCHA_AVAILABLE and self.server.config.browser.captcha_solver
    
    async def solve_captcha(self, captcha_type: str = "auto") -> CallToolResult:
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
        
        if not self.server.page:
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
            self.logger.error("Playwright error in solve_captcha: %s", e_playwright)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ PW err CAPTCHA: {e_playwright}")],
                isError=True
            )
        except Exception as e: # Catch-all for other CAPTCHA errors
            self.logger.error("Unexpected error in solve_captcha: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Err CAPTCHA: {e}")],
                isError=True
            )