"""
Unit tests for browser management tools
"""

import pytest
from unittest.mock import AsyncMock
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.browser_mgmt import BrowserManagementTools


class TestBrowserManagementTools:
    """Test BrowserManagementTools class"""
    
    @pytest.fixture
    def mgmt_tools(self, server_with_mock_browser):
        """Create BrowserManagementTools instance with mocked server"""
        return BrowserManagementTools(server_with_mock_browser)
    
    @pytest.mark.asyncio
    async def test_close_browser_success(self, mgmt_tools):
        """Test successful browser closure"""
        # Mock the _close_browser_resources method
        mgmt_tools.server._close_browser_resources = AsyncMock()
        
        result = await mgmt_tools.close_browser()
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "🔒 Browser closed and resources cleaned up." in result.content[0].text
        mgmt_tools.server._close_browser_resources.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_close_browser_error(self, mgmt_tools):
        """Test browser closure with error"""
        # Mock the _close_browser_resources method to raise an error
        mgmt_tools.server._close_browser_resources = AsyncMock(
            side_effect=RuntimeError("Cleanup failed")
        )
        
        result = await mgmt_tools.close_browser()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Error closing browser:" in result.content[0].text
        assert "Cleanup failed" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_close_browser_unexpected_error(self, mgmt_tools):
        """Test browser closure with unexpected error"""
        mgmt_tools.server._close_browser_resources = AsyncMock(
            side_effect=Exception("Unexpected error")
        )
        
        result = await mgmt_tools.close_browser()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Error closing browser: Unexpected error" in result.content[0].text
    
    def test_get_server_version(self, mgmt_tools):
        """Test getting server version"""
        result = mgmt_tools.get_server_version()
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        # Should return the version from the package
        assert len(result.content) == 1
        version_text = result.content[0].text
        # Version should be a string with format like "1.9.3"
        assert isinstance(version_text, str)
        assert len(version_text) > 0
    
    def test_get_server_version_content_type(self, mgmt_tools):
        """Test server version result content type"""
        result = mgmt_tools.get_server_version()
        
        # Should be a TextContent
        assert result.content[0].type == "text"
    
    @pytest.mark.asyncio
    async def test_close_browser_logs_properly(self, mgmt_tools, caplog):
        """Test that browser closure logs appropriately"""
        mgmt_tools.server._close_browser_resources = AsyncMock()
        
        with caplog.at_level("INFO"):
            await mgmt_tools.close_browser()
        
        # Check that appropriate log messages were created
        log_messages = [record.message for record in caplog.records]
        assert any("Attempting to close browser resources" in msg for msg in log_messages)
        assert any("Browser resources should be closed" in msg for msg in log_messages)
    
    @pytest.mark.asyncio
    async def test_close_browser_cleanup_called_once(self, mgmt_tools):
        """Test that cleanup is only called once"""
        cleanup_mock = AsyncMock()
        mgmt_tools.server._close_browser_resources = cleanup_mock
        
        await mgmt_tools.close_browser()
        
        cleanup_mock.assert_called_once()
        
        # Call again to ensure it's called each time
        await mgmt_tools.close_browser()
        
        assert cleanup_mock.call_count == 2
    
    def test_get_server_version_logging(self, mgmt_tools, caplog):
        """Test that version retrieval logs appropriately"""
        with caplog.at_level("INFO"):
            result = mgmt_tools.get_server_version()
        
        # Check that version is logged
        log_messages = [record.message for record in caplog.records]
        version = result.content[0].text
        assert any(f"Reporting server version: {version}" in msg for msg in log_messages)