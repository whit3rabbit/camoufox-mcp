#!/usr/bin/env python3
"""
Tests for Camoufox MCP Server
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from mcp.types import CallToolResult, ListToolsResult, Tool, TextContent
from camoufox_mcp_server import CamoufoxMCPServer, Config, CamoufoxConfig


@pytest.fixture
def config():
    """Create a test configuration"""
    return Config(
        browser=CamoufoxConfig(
            headless=True,
            captcha_solver=False,
            output_dir="/tmp/test-camoufox"
        ),
        debug=True
    )


@pytest.fixture
def server(config):
    """Create a test server instance"""
    return CamoufoxMCPServer(config)


class TestCamoufoxMCPServer:
    """Test cases for CamoufoxMCPServer"""
    
    def test_server_initialization(self, server):
        """Test server initializes correctly"""
        assert server.config.browser.headless is True
        assert server.config.debug is True
        assert server.browser is None
        assert server.page is None
        assert server.captcha_solver is None
    
    @pytest.mark.asyncio
    async def test_list_tools_basic(self, server):
        """Test listing basic tools"""
        # Call the list_tools method directly
        list_tools_result = await server.list_tools()
        tools_result = list_tools_result.tools
        
        # Should have basic tools
        expected_tools = [
            "browser_navigate",
            "browser_click", 
            "browser_type",
            "browser_wait_for", # Was missing in original expected_tools
            "browser_get_content",
            "browser_screenshot",
            "browser_execute_js", # Was missing
            "browser_set_geolocation", # Was missing
            "browser_close"
        ]
        
        tool_names = [tool.name for tool in tools_result]
        
        for expected_tool in expected_tools:
            assert expected_tool in tool_names
        
        # Check that captcha tool is not present by default
        assert "browser_solve_captcha" not in tool_names
    
    @patch('camoufox_mcp_server.CAPTCHA_AVAILABLE', True)
    @pytest.mark.asyncio
    async def test_list_tools_with_captcha(self):
        """Test listing tools with CAPTCHA solver enabled"""
        config_with_captcha = Config(
            browser=CamoufoxConfig(captcha_solver=True),
            debug=True
        )
        server_with_captcha = CamoufoxMCPServer(config_with_captcha)
        
        assert server_with_captcha.config.browser.captcha_solver is True # Ensure config is initially true
        
        # Call the list_tools method directly
        list_tools_result = await server_with_captcha.list_tools()
        tools_result = list_tools_result.tools
        tool_names = [tool.name for tool in tools_result]
        
        assert "browser_solve_captcha" in tool_names
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_ensure_browser(self, mock_camoufox_class, server):
        """Test browser initialization with new API"""
        # Mock AsyncCamoufox instance and context manager
        mock_browser = Mock()
        mock_context = Mock()
        mock_browser.__aenter__ = AsyncMock(return_value=mock_context)
        mock_camoufox_class.return_value = mock_browser
        
        await server._ensure_browser()
        
        # Verify browser was created with correct options
        mock_camoufox_class.assert_called_once()
        call_kwargs = mock_camoufox_class.call_args[1]
        assert call_kwargs['headless'] is True
        assert call_kwargs['humanize'] is True
        assert call_kwargs['geoip'] is True
        assert call_kwargs['block_webrtc'] is True
        assert call_kwargs['main_world_eval'] is True
        
        assert server.browser == mock_browser
        assert server.browser_context == mock_context
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_navigate(self, mock_camoufox_class, server):
        """Test navigation with new async API"""
        # Setup mocks
        mock_browser = Mock()
        mock_context = Mock()
        mock_page = Mock()
        
        mock_browser.__aenter__ = AsyncMock(return_value=mock_context)
        mock_context.new_page = AsyncMock(return_value=mock_page)
        mock_page.goto = AsyncMock()
        mock_page.title = AsyncMock(return_value="Test Page")
        mock_page.url = "https://example.com"
        
        mock_camoufox_class.return_value = mock_browser
        
        # Test navigation
        result = await server._navigate("https://example.com", "load")
        
        # Verify page creation and navigation
        mock_context.new_page.assert_called_once()
        mock_page.goto.assert_called_once_with("https://example.com", wait_until="load")
        
        # Check result
        assert len(result.content) == 1
        assert "✅ Navigated to: https://example.com" in result.content[0].text
        assert "📄 Title: Test Page" in result.content[0].text
        assert "🛡️ Stealth mode active" in result.content[0].text
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio 
    async def test_click_with_selector_types(self, mock_camoufox_class, server):
        """Test click with different selector types"""
        # Setup mocks
        mock_page = Mock()
        mock_element = Mock()
        mock_element.wait_for = AsyncMock()
        mock_element.click = AsyncMock()
        mock_page.locator.return_value = mock_element
        mock_page.get_by_text.return_value = mock_element
        
        server.page = mock_page
        
        # Test CSS selector
        result = await server._click("button.test", "left")
        mock_page.locator.assert_called_with("button.test")
        mock_element.click.assert_called_with(button="left")
        assert "🖱️ Clicked element: button.test" in result.content[0].text
        
        # Test XPath selector
        await server._click("//button[@class='test']", "right")
        mock_page.locator.assert_called_with("xpath=//button[@class='test']")
        
        # Test text selector
        await server._click("Click me", "left")
        mock_page.get_by_text.assert_called_with("Click me")
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_type_with_options(self, mock_camoufox_class, server):
        """Test typing with human-like timing"""
        # Setup mocks
        mock_page = Mock()
        mock_element = Mock()
        mock_element.wait_for = AsyncMock()
        mock_element.clear = AsyncMock()
        mock_element.type = AsyncMock()
        mock_page.locator.return_value = mock_element
        
        server.page = mock_page
        
        # Test typing with clear and custom delay
        result = await server._type("input.test", "hello world", delay=200, clear=True)
        
        # Verify element was found, cleared, and typed into
        mock_page.locator.assert_called_with("input.test")
        mock_element.wait_for.assert_called_with(state="visible")
        mock_element.clear.assert_called_once()
        mock_element.type.assert_called_with("hello world", delay=200)
        
        # Check result
        assert "⌨️ Typed 'hello world' into input.test" in result.content[0].text
        assert "human-like timing" in result.content[0].text
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_wait_for_functionality(self, mock_camoufox_class, server):
        """Test wait for elements and text"""
        # Setup mocks
        mock_page = Mock()
        mock_element = Mock()
        mock_element.wait_for = AsyncMock()
        mock_page.locator.return_value = mock_element
        mock_page.get_by_text.return_value = mock_element
        
        server.page = mock_page
        
        # Test waiting for text
        result = await server._wait_for(text="Loading complete", timeout=5000, state="visible")
        mock_page.get_by_text.assert_called_with("Loading complete")
        mock_element.wait_for.assert_called_with(state="visible", timeout=5000)
        assert "✅ Found text: 'Loading complete'" in result.content[0].text
        
        # Test waiting for selector
        result = await server._wait_for(selector=".content", timeout=10000, state="attached")
        mock_page.locator.assert_called_with(".content")
        mock_element.wait_for.assert_called_with(state="attached", timeout=10000)
        assert "✅ Element found: .content" in result.content[0].text
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_execute_js_main_world(self, mock_camoufox_class, server):
        """Test JavaScript execution in main world"""
        # Setup mocks
        mock_page = Mock()
        mock_page.evaluate = AsyncMock(return_value={"result": "success"})
        
        server.page = mock_page
        server.config.browser.main_world_eval = True
        
        # Test main world execution
        result = await server._execute_js("document.title", main_world=True)
        
        # Verify code was prefixed for main world
        mock_page.evaluate.assert_called_with("mw:document.title")
        assert "🔧 JavaScript executed (main world)" in result.content[0].text
        
        # Test isolated world execution
        result = await server._execute_js("document.title", main_world=False)
        mock_page.evaluate.assert_called_with("document.title")
        assert "🔧 JavaScript executed (isolated world)" in result.content[0].text
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_geolocation_setting(self, mock_camoufox_class, server):
        """Test geolocation setting"""
        # Setup mocks
        mock_page = Mock()
        mock_page.set_geolocation = AsyncMock()
        
        server.page = mock_page
        
        # Test geolocation setting
        result = await server._set_geolocation(40.7128, -74.0060, 50)
        
        mock_page.set_geolocation.assert_called_once_with({
            "latitude": 40.7128,
            "longitude": -74.0060,
            "accuracy": 50
        })
        
        assert "🌍 Geolocation set: 40.7128, -74.006 (±50m)" in result.content[0].text
    
    @patch('camoufox_mcp_server.AsyncCamoufox')
    @pytest.mark.asyncio
    async def test_close_cleanup(self, mock_camoufox_class, server):
        """Test proper cleanup on close"""
        # Setup mocks
        mock_browser = Mock()
        mock_page = Mock()
        mock_page.close = AsyncMock()
        mock_browser.__aexit__ = AsyncMock()
        
        server.browser = mock_browser
        server.page = mock_page
        
        # Test close
        result = await server._close()
        
        # Verify cleanup
        mock_page.close.assert_called_once()
        mock_browser.__aexit__.assert_called_once_with(None, None, None)
        
        # Verify state was reset
        assert server.browser is None
        assert server.page is None
        assert server.browser_context is None
        
        # Check result
        assert "🔒 Browser closed and resources cleaned up" in result.content[0].text


class TestConfiguration:
    """Test configuration parsing and validation"""
    
    def test_default_config(self):
        """Test default configuration values"""
        config = Config()
        
        assert config.browser.headless is True
        assert config.browser.geoip is True
        assert config.browser.humanize is True
        assert config.browser.block_webrtc is True
        assert config.browser.captcha_solver is False
        assert config.browser.output_dir == "/tmp/camoufox-mcp"
        assert config.server.host == "localhost"
        assert config.server.port is None
        assert config.debug is False
    
    def test_custom_config(self):
        """Test custom configuration"""
        config = Config(
            browser=CamoufoxConfig(
                headless=False,
                captcha_solver=True,
                proxy={"server": "http://proxy:8080"},  # Corrected proxy format
                user_agent="Custom Agent",
                window=(1920, 1080)  # Corrected to use 'window' tuple
            ),
            debug=True
        )
        
        assert config.browser.headless is False
        assert config.browser.captcha_solver is True
        assert config.browser.proxy == {"server": "http://proxy:8080"}
        assert config.browser.user_agent == "Custom Agent"
        assert config.browser.window == (1920, 1080)
        assert config.debug is True


if __name__ == "__main__":
    pytest.main([__file__])