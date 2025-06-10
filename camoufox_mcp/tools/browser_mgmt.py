"""Browser management tools"""

import logging
from mcp.types import CallToolResult, TextContent
from playwright.async_api import Error as PlaywrightError


class BrowserManagementTools:
    """Browser management and utility tools"""
    
    def __init__(self, server):
        self.server = server
        self.logger = logging.getLogger(f"{__name__}.{self.__class__.__name__}")
    
    async def close_browser(self) -> CallToolResult:
        """Close browser and clean up"""
        try:
            self.logger.info("Attempting to close browser resources via close tool.")
            await self.server._close_browser_resources()
            self.logger.info("Browser resources should be closed.")
            return CallToolResult(
                content=[TextContent(type="text", text="🔒 Browser closed and resources cleaned up.")]
            )
        except Exception as e: # Catch any unexpected error from _close_browser_resources
            self.logger.error("Unexpected error during close operation: %s", e)
            return CallToolResult(
                content=[TextContent(type="text", text=f"❌ Error closing browser: {str(e)}")],
                isError=True
            )
    
    def get_server_version(self) -> CallToolResult:
        """Get the current version of the Camoufox MCP server implementation"""
        from .. import __version__
        self.logger.info("Reporting server version: %s", __version__)
        return CallToolResult(content=[TextContent(type="text", text=__version__)])