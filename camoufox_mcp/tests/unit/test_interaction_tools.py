"""
Unit tests for interaction tools
"""

import pytest
from unittest.mock import AsyncMock
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.interaction import InteractionTools


class TestInteractionTools:
    """Test InteractionTools class"""
    
    @pytest.fixture
    def interaction_tools(self, server_with_mock_browser):
        """Create InteractionTools instance with mocked server"""
        return InteractionTools(server_with_mock_browser)
    
    @pytest.mark.asyncio
    async def test_click_css_selector(self, interaction_tools, mock_page, mock_element):
        """Test clicking with CSS selector"""
        mock_page.locator.return_value = mock_element
        
        result = await interaction_tools.click("#my-button")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "🖱️ Clicked: #my-button (human-like)" in result.content[0].text
        mock_page.locator.assert_called_once_with("#my-button")
        mock_element.wait_for.assert_called_once_with(state="visible")
        mock_element.click.assert_called_once_with(button="left")
    
    @pytest.mark.asyncio
    async def test_click_xpath_selector(self, interaction_tools, mock_page, mock_element):
        """Test clicking with XPath selector"""
        mock_page.locator.return_value = mock_element
        
        result = await interaction_tools.click("//button[@id='test']")
        
        mock_page.locator.assert_called_once_with("xpath=//button[@id='test']")
        mock_element.click.assert_called_once_with(button="left")
    
    @pytest.mark.asyncio
    async def test_click_text_selector(self, interaction_tools, mock_page, mock_element):
        """Test clicking with text content selector"""
        mock_page.get_by_text.return_value = mock_element
        
        result = await interaction_tools.click("Click Me")
        
        mock_page.get_by_text.assert_called_once_with("Click Me")
        mock_element.click.assert_called_once_with(button="left")
    
    @pytest.mark.asyncio
    async def test_click_different_buttons(self, interaction_tools, mock_page, mock_element):
        """Test clicking with different mouse buttons"""
        mock_page.locator.return_value = mock_element
        
        # Test right click
        await interaction_tools.click("#button", "right")
        mock_element.click.assert_called_with(button="right")
        
        # Test middle click
        await interaction_tools.click("#button", "middle")
        mock_element.click.assert_called_with(button="middle")
    
    @pytest.mark.asyncio
    async def test_click_no_page(self, interaction_tools):
        """Test click when page is not initialized"""
        interaction_tools.server.page = None
        
        result = await interaction_tools.click("#button")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_click_playwright_error(self, interaction_tools, mock_page, mock_element):
        """Test click with Playwright error"""
        from playwright.async_api import Error as PlaywrightError
        mock_page.locator.return_value = mock_element
        mock_element.click.side_effect = PlaywrightError("Element not found")
        
        result = await interaction_tools.click("#missing")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ PW err click #missing:" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_type_text_basic(self, interaction_tools, mock_page, mock_element):
        """Test basic text typing"""
        mock_page.locator.return_value = mock_element
        
        result = await interaction_tools.type_text("#input", "Hello World")
        
        assert isinstance(result, CallToolResult)
        assert not result.isError
        assert "⌨️ Typed 'Hello World' into #input" in result.content[0].text
        mock_page.locator.assert_called_once_with("#input")
        mock_element.wait_for.assert_called_once_with(state="visible")
        mock_element.type.assert_called_once_with("Hello World", delay=100)
    
    @pytest.mark.asyncio
    async def test_type_text_xpath(self, interaction_tools, mock_page, mock_element):
        """Test typing with XPath selector"""
        mock_page.locator.return_value = mock_element
        
        await interaction_tools.type_text("//input[@name='test']", "text")
        
        mock_page.locator.assert_called_once_with("xpath=//input[@name='test']")
    
    @pytest.mark.asyncio
    async def test_type_text_with_clear(self, interaction_tools, mock_page, mock_element):
        """Test typing with clear option"""
        mock_page.locator.return_value = mock_element
        
        result = await interaction_tools.type_text("#input", "New Text", clear=True)
        
        mock_element.clear.assert_called_once()
        mock_element.type.assert_called_once_with("New Text", delay=100)
    
    @pytest.mark.asyncio
    async def test_type_text_custom_delay(self, interaction_tools, mock_page, mock_element):
        """Test typing with custom delay"""
        mock_page.locator.return_value = mock_element
        
        await interaction_tools.type_text("#input", "Slow", delay=200)
        
        mock_element.type.assert_called_once_with("Slow", delay=200)
    
    @pytest.mark.asyncio
    async def test_type_text_no_page(self, interaction_tools):
        """Test typing when page is not initialized"""
        interaction_tools.server.page = None
        
        result = await interaction_tools.type_text("#input", "text")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_type_text_playwright_error(self, interaction_tools, mock_page, mock_element):
        """Test typing with Playwright error"""
        from playwright.async_api import Error as PlaywrightError
        mock_page.locator.return_value = mock_element
        mock_element.type.side_effect = PlaywrightError("Input not writable")
        
        result = await interaction_tools.type_text("#readonly", "text")
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ PW type err #readonly:" in result.content[0].text