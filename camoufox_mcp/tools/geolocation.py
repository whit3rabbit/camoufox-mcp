"""Geolocation tools for browser automation"""

import logging
from mcp.types import CallToolResult, TextContent
from playwright.async_api import Error as PlaywrightError


class GeolocationTools:
    """Geolocation-related browser automation tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def set_geolocation(
        self, latitude: float, longitude: float, accuracy: float = 100
    ) -> CallToolResult:
        """Set browser geolocation"""
        if not self.server.page:
            return CallToolResult(
                content=[TextContent(type="text", text="❌ Browser not initialized")],
                isError=True
            )
        
        try:
            await self.server.page.set_geolocation({
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