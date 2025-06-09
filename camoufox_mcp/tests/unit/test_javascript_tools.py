"""
Unit tests for JavaScript tools
"""

import pytest
from unittest.mock import AsyncMock
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.javascript import JavaScriptTools


class TestJavaScriptTools:
    """Test JavaScriptTools class"""
    
    @pytest.fixture
    def js_tools(self, server_with_mock_browser):
        """Create JavaScriptTools instance with mocked server"""
        return JavaScriptTools(server_with_mock_browser)
    
    @pytest.mark.asyncio
    async def test_execute_js_simple_return(self, js_tools, mock_page):
        """Test executing JavaScript with simple return value"""
        mock_page.evaluate.return_value = "Hello World"
        
        result = await js_tools.execute_js("return 'Hello World'")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "🔧 JavaScript executed (isolated world):" in result.content[0].text
        assert "Hello World" in result.content[0].text
        mock_page.evaluate.assert_called_once_with("return 'Hello World'")
    
    @pytest.mark.asyncio
    async def test_execute_js_undefined_return(self, js_tools, mock_page):
        """Test executing JavaScript with undefined return"""
        mock_page.evaluate.return_value = None
        
        result = await js_tools.execute_js("console.log('test')")
        
        assert "undefined" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_execute_js_object_return(self, js_tools, mock_page):
        """Test executing JavaScript with object return"""
        mock_page.evaluate.return_value = {"name": "test", "value": 42}
        
        result = await js_tools.execute_js("return {name: 'test', value: 42}")
        
        # Should be formatted as JSON
        content = result.content[0].text
        assert '"name": "test"' in content
        assert '"value": 42' in content
    
    @pytest.mark.asyncio
    async def test_execute_js_array_return(self, js_tools, mock_page):
        """Test executing JavaScript with array return"""
        mock_page.evaluate.return_value = [1, 2, 3]
        
        result = await js_tools.execute_js("return [1, 2, 3]")
        
        content = result.content[0].text
        assert "[" in content and "]" in content
        assert "1" in content and "2" in content and "3" in content
    
    @pytest.mark.asyncio
    async def test_execute_js_number_return(self, js_tools, mock_page):
        """Test executing JavaScript with number return"""
        mock_page.evaluate.return_value = 42
        
        result = await js_tools.execute_js("return 6 * 7")
        
        assert "42" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_execute_js_boolean_return(self, js_tools, mock_page):
        """Test executing JavaScript with boolean return"""
        mock_page.evaluate.return_value = True
        
        result = await js_tools.execute_js("return true")
        
        assert "True" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_execute_js_main_world(self, js_tools, mock_page):
        """Test executing JavaScript in main world"""
        js_tools.server.config.browser.main_world_eval = True
        mock_page.evaluate.return_value = "main world result"
        
        result = await js_tools.execute_js("document.title", main_world=True)
        
        assert "🔧 JavaScript executed (main world):" in result.content[0].text
        # Should be prefixed with "mw:"
        mock_page.evaluate.assert_called_once_with("mw:document.title")
    
    @pytest.mark.asyncio
    async def test_execute_js_main_world_disabled(self, js_tools, mock_page):
        """Test main world execution when disabled in config"""
        js_tools.server.config.browser.main_world_eval = False
        mock_page.evaluate.return_value = "isolated result"
        
        result = await js_tools.execute_js("document.title", main_world=True)
        
        # Should still indicate main world but not prefix with "mw:"
        assert "🔧 JavaScript executed (main world):" in result.content[0].text
        mock_page.evaluate.assert_called_once_with("document.title")
    
    @pytest.mark.asyncio
    async def test_execute_js_isolated_world_default(self, js_tools, mock_page):
        """Test executing JavaScript in isolated world (default)"""
        mock_page.evaluate.return_value = "isolated result"
        
        result = await js_tools.execute_js("return 'test'")
        
        assert "🔧 JavaScript executed (isolated world):" in result.content[0].text
        # Should not be prefixed with "mw:"
        mock_page.evaluate.assert_called_once_with("return 'test'")
    
    @pytest.mark.asyncio
    async def test_execute_js_no_page(self, js_tools):
        """Test JavaScript execution when page is not initialized"""
        js_tools.server.page = None
        
        result = await js_tools.execute_js("return 'test'")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_execute_js_playwright_error(self, js_tools, mock_page):
        """Test JavaScript execution with Playwright error"""
        from playwright.async_api import Error as PlaywrightError
        mock_page.evaluate.side_effect = PlaywrightError("JavaScript error")
        
        result = await js_tools.execute_js("invalid.syntax")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ PW err JS exec:" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_execute_js_generic_error(self, js_tools, mock_page):
        """Test JavaScript execution with generic error"""
        mock_page.evaluate.side_effect = ValueError("Generic error")
        
        result = await js_tools.execute_js("return 'test'")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ JavaScript execution failed:" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_execute_js_complex_code(self, js_tools, mock_page):
        """Test executing complex JavaScript code"""
        complex_js = """
        const result = [];
        for (let i = 0; i < 5; i++) {
            result.push(i * 2);
        }
        return result;
        """
        mock_page.evaluate.return_value = [0, 2, 4, 6, 8]
        
        result = await js_tools.execute_js(complex_js)
        
        assert not result.isError
        mock_page.evaluate.assert_called_once_with(complex_js)