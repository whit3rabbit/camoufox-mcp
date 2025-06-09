"""
Unit tests for navigation tools
"""

import pytest
from unittest.mock import AsyncMock, patch
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.navigation import NavigationTools


class TestNavigationTools:
    """Test NavigationTools class"""
    
    @pytest.fixture
    def navigation_tools(self, server_with_mock_browser):
        """Create NavigationTools instance with mocked server"""
        return NavigationTools(server_with_mock_browser)
    
    @pytest.mark.asyncio
    async def test_navigate_success(self, navigation_tools, mock_page):
        """Test successful navigation"""
        mock_page.title.return_value = "Test Page"
        mock_page.url = "https://example.com"
        
        result = await navigation_tools.navigate("https://example.com")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "✅ Navigated to: https://example.com" in result.content[0].text
        assert "📄 Title: Test Page" in result.content[0].text
        mock_page.goto.assert_called_once_with("https://example.com", wait_until="load")
    
    @pytest.mark.asyncio
    async def test_navigate_with_wait_until(self, navigation_tools, mock_page):
        """Test navigation with custom wait condition"""
        await navigation_tools.navigate("https://example.com", "networkidle")
        
        mock_page.goto.assert_called_once_with("https://example.com", wait_until="networkidle")
    
    @pytest.mark.asyncio
    async def test_navigate_timeout_error(self, navigation_tools, mock_page):
        """Test navigation timeout handling"""
        import asyncio
        mock_page.goto.side_effect = asyncio.TimeoutError()
        
        result = await navigation_tools.navigate("https://slow-site.com")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Nav to https://slow-site.com timed out" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_navigate_playwright_error(self, navigation_tools, mock_page):
        """Test navigation with Playwright error"""
        from playwright.async_api import Error as PlaywrightError
        mock_page.goto.side_effect = PlaywrightError("Network error")
        
        result = await navigation_tools.navigate("https://bad-site.com")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "PW error nav to https://bad-site.com" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_wait_for_text_success(self, navigation_tools, mock_page):
        """Test successful text waiting"""
        mock_element = AsyncMock()
        mock_page.get_by_text.return_value = mock_element
        
        result = await navigation_tools.wait_for(text="Welcome")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "✅ Found text: 'Welcome'" in result.content[0].text
        mock_page.get_by_text.assert_called_once_with("Welcome")
        mock_element.wait_for.assert_called_once_with(state="visible", timeout=30000)
    
    @pytest.mark.asyncio
    async def test_wait_for_selector_success(self, navigation_tools, mock_page):
        """Test successful selector waiting"""
        mock_element = AsyncMock()
        mock_page.locator.return_value = mock_element
        
        result = await navigation_tools.wait_for(selector="#my-element")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "✅ Element found: #my-element" in result.content[0].text
        mock_page.locator.assert_called_once_with("#my-element")
        mock_element.wait_for.assert_called_once_with(state="visible", timeout=30000)
    
    @pytest.mark.asyncio
    async def test_wait_for_xpath_selector(self, navigation_tools, mock_page):
        """Test XPath selector handling"""
        mock_element = AsyncMock()
        mock_page.locator.return_value = mock_element
        
        result = await navigation_tools.wait_for(selector="//div[@class='test']")
        
        mock_page.locator.assert_called_once_with("xpath=//div[@class='test']")
    
    @pytest.mark.asyncio
    async def test_wait_for_custom_timeout_and_state(self, navigation_tools, mock_page):
        """Test custom timeout and state"""
        mock_element = AsyncMock()
        mock_page.locator.return_value = mock_element
        
        await navigation_tools.wait_for(
            selector="#test", 
            timeout=5000, 
            state="hidden"
        )
        
        mock_element.wait_for.assert_called_once_with(state="hidden", timeout=5000)
    
    @pytest.mark.asyncio
    async def test_wait_for_no_parameters(self, navigation_tools):
        """Test wait_for with no parameters"""
        result = await navigation_tools.wait_for()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Must specify either selector or text" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_wait_for_timeout_error(self, navigation_tools, mock_page):
        """Test wait_for timeout handling"""
        from playwright.async_api import Error as PlaywrightError
        mock_element = AsyncMock()
        mock_element.wait_for.side_effect = PlaywrightError("Timeout")
        mock_page.locator.return_value = mock_element
        
        result = await navigation_tools.wait_for(selector="#missing")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ PW wait err:" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_server_not_initialized(self, navigation_tools):
        """Test behavior when server page is not initialized"""
        navigation_tools.server.page = None
        
        result = await navigation_tools.wait_for(selector="#test")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text