"""
Unit tests for content tools
"""

import pytest
import tempfile
import os
from unittest.mock import AsyncMock, patch, mock_open
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.content import ContentTools


class TestContentTools:
    """Test ContentTools class"""
    
    @pytest.fixture
    def content_tools(self, server_with_mock_browser):
        """Create ContentTools instance with mocked server"""
        return ContentTools(server_with_mock_browser)
    
    @pytest.mark.asyncio
    async def test_get_content_full_page_text(self, content_tools, mock_page):
        """Test getting full page text content"""
        mock_page.inner_text.return_value = "Full page content"
        
        result = await content_tools.get_content()
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert result.content[0].text == "Full page content"
        mock_page.inner_text.assert_called_once_with("body")
    
    @pytest.mark.asyncio
    async def test_get_content_full_page_html(self, content_tools, mock_page):
        """Test getting full page HTML content"""
        mock_page.content.return_value = "<html><body>HTML content</body></html>"
        
        result = await content_tools.get_content(inner_html=True)
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert result.content[0].text == "<html><body>HTML content</body></html>"
        mock_page.content.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_content_element_text(self, content_tools, mock_page, mock_element):
        """Test getting element text content"""
        mock_page.locator.return_value = mock_element
        mock_element.text_content.return_value = "Element text"
        
        result = await content_tools.get_content(selector="#my-element")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert result.content[0].text == "Element text"
        mock_page.locator.assert_called_once_with("#my-element")
        mock_element.text_content.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_content_element_html(self, content_tools, mock_page, mock_element):
        """Test getting element HTML content"""
        mock_page.locator.return_value = mock_element
        mock_element.inner_html.return_value = "<span>Element HTML</span>"
        
        result = await content_tools.get_content(selector="#my-element", inner_html=True)
        
        assert result.content[0].text == "<span>Element HTML</span>"
        mock_element.inner_html.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_content_element_attribute(self, content_tools, mock_page, mock_element):
        """Test getting element attribute"""
        mock_page.locator.return_value = mock_element
        mock_element.get_attribute.return_value = "attribute-value"
        
        result = await content_tools.get_content(selector="#my-element", attribute="data-value")
        
        assert result.content[0].text == "attribute-value"
        mock_element.get_attribute.assert_called_once_with("data-value")
    
    @pytest.mark.asyncio
    async def test_get_content_xpath_selector(self, content_tools, mock_page, mock_element):
        """Test getting content with XPath selector"""
        mock_page.locator.return_value = mock_element
        mock_element.text_content.return_value = "XPath content"
        
        result = await content_tools.get_content(selector="//div[@class='test']")
        
        mock_page.locator.assert_called_once_with("xpath=//div[@class='test']")
    
    @pytest.mark.asyncio
    async def test_get_content_none_result(self, content_tools, mock_page, mock_element):
        """Test getting content when result is None"""
        mock_page.locator.return_value = mock_element
        mock_element.text_content.return_value = None
        
        result = await content_tools.get_content(selector="#empty")
        
        assert result.content[0].text == ""
    
    @pytest.mark.asyncio
    async def test_get_content_no_page(self, content_tools):
        """Test get_content when page is not initialized"""
        content_tools.server.page = None
        
        result = await content_tools.get_content()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_screenshot_full_page(self, content_tools, mock_page):
        """Test taking full page screenshot"""
        mock_screenshot_data = b"fake-png-data"
        
        with patch('os.makedirs'), \
             patch('builtins.open', mock_open(read_data=mock_screenshot_data)), \
             patch('base64.b64encode', return_value=b"ZmFrZS1wbmctZGF0YQ=="):
            
            result = await content_tools.screenshot()
            
            assert isinstance(result, CallToolResult)
            assert not result.isError
            assert len(result.content) == 2  # Image + text
            assert result.content[0].type == "image"
            assert result.content[0].mimeType == "image/png"
            assert "📸 Screenshot saved:" in result.content[1].text
            mock_page.screenshot.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_screenshot_with_filename(self, content_tools, mock_page):
        """Test taking screenshot with custom filename"""
        with patch('os.makedirs'), \
             patch('builtins.open', mock_open(read_data=b"fake-data")), \
             patch('base64.b64encode', return_value=b"ZmFrZS1kYXRh"):
            
            result = await content_tools.screenshot(filename="custom.png")
            
            mock_page.screenshot.assert_called_once()
            # Check that the custom filename is used in the path
            call_args = mock_page.screenshot.call_args
            assert "custom.png" in call_args.kwargs['path']
    
    @pytest.mark.asyncio
    async def test_screenshot_element(self, content_tools, mock_page, mock_element):
        """Test taking element screenshot"""
        mock_page.locator.return_value = mock_element
        
        with patch('os.makedirs'), \
             patch('builtins.open', mock_open(read_data=b"fake-data")), \
             patch('base64.b64encode', return_value=b"ZmFrZS1kYXRh"):
            
            result = await content_tools.screenshot(selector="#element")
            
            mock_page.locator.assert_called_once_with("#element")
            mock_element.screenshot.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_screenshot_xpath_element(self, content_tools, mock_page, mock_element):
        """Test taking screenshot of XPath element"""
        mock_page.locator.return_value = mock_element
        
        with patch('os.makedirs'), \
             patch('builtins.open', mock_open(read_data=b"fake-data")), \
             patch('base64.b64encode', return_value=b"ZmFrZS1kYXRh"):
            
            await content_tools.screenshot(selector="//div[@id='test']")
            
            mock_page.locator.assert_called_once_with("xpath=//div[@id='test']")
    
    @pytest.mark.asyncio
    async def test_screenshot_full_page_option(self, content_tools, mock_page):
        """Test taking full page screenshot with full_page=True"""
        with patch('os.makedirs'), \
             patch('builtins.open', mock_open(read_data=b"fake-data")), \
             patch('base64.b64encode', return_value=b"ZmFrZS1kYXRh"):
            
            await content_tools.screenshot(full_page=True)
            
            call_args = mock_page.screenshot.call_args
            assert call_args.kwargs['full_page'] is True
    
    @pytest.mark.asyncio
    async def test_screenshot_no_page(self, content_tools):
        """Test screenshot when page is not initialized"""
        content_tools.server.page = None
        
        result = await content_tools.screenshot()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_screenshot_playwright_error(self, content_tools, mock_page):
        """Test screenshot with Playwright error"""
        from playwright.async_api import Error as PlaywrightError
        mock_page.screenshot.side_effect = PlaywrightError("Screenshot failed")
        
        result = await content_tools.screenshot()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ PW err screenshot:" in result.content[0].text