#!/usr/bin/env python3
"""
Unit tests for Camoufox MCP Server components

This module contains unit tests for individual tools and components
of the MCP server, testing them in isolation with mocked dependencies.

Usage:
    python -m pytest tests/test_unit.py
    python tests/test_unit.py
"""

import asyncio
import sys
import json
import pytest
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from pathlib import Path
from typing import Dict, Any, List

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

try:
    from camoufox_mcp_server import CamoufoxMCPServer, Config, CamoufoxConfig, ServerConfig
except ImportError as e:
    print(f"Error importing server module: {e}")
    print("Make sure camoufox_mcp_server.py is in the parent directory")
    sys.exit(1)


class TestCamoufoxMCPServer:
    """Unit tests for the main server class"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.config = Config(
            camoufox=CamoufoxConfig(headless=True),
            server=ServerConfig()
        )
        self.server = CamoufoxMCPServer(self.config)
    
    def test_server_initialization(self):
        """Test server initialization"""
        assert self.server.config == self.config
        assert self.server.browser is None
        assert self.server.page is None
        assert hasattr(self.server, 'tools')
    
    def test_config_validation(self):
        """Test configuration validation"""
        # Test valid config
        valid_config = Config(
            camoufox=CamoufoxConfig(headless=True),
            server=ServerConfig()
        )
        server = CamoufoxMCPServer(valid_config)
        assert server.config.camoufox.headless is True
        
        # Test config with different headless modes
        for headless_mode in [True, False, 'virtual']:
            config = Config(
                camoufox=CamoufoxConfig(headless=headless_mode),
                server=ServerConfig()
            )
            server = CamoufoxMCPServer(config)
            assert server.config.camoufox.headless == headless_mode
    
    @pytest.mark.asyncio
    async def test_browser_lifecycle_mock(self):
        """Test browser lifecycle with mocked dependencies"""
        with patch('camoufox_mcp_server.AsyncCamoufox') as mock_camoufox:
            # Mock browser and page
            mock_browser = AsyncMock()
            mock_page = AsyncMock()
            mock_browser.new_page.return_value = mock_page
            mock_camoufox.return_value.__aenter__.return_value = mock_browser
            
            # Test browser creation
            await self.server._ensure_browser()
            assert self.server.browser is not None
            assert self.server.page is not None
            
            # Test browser cleanup
            await self.server._cleanup_browser()
            mock_browser.close.assert_called_once()
    
    def test_tool_registration(self):
        """Test that all required tools are registered"""
        expected_tools = [
            'browser_navigate', 'browser_click', 'browser_type',
            'browser_wait_for', 'browser_get_content', 'browser_screenshot',
            'browser_execute_js', 'browser_set_geolocation', 'browser_close'
        ]
        
        registered_tools = list(self.server.tools.keys())
        
        for tool in expected_tools:
            assert tool in registered_tools, f"Tool {tool} not registered"
    
    def test_tool_metadata(self):
        """Test tool metadata and schemas"""
        tools = self.server.tools
        
        for tool_name, tool_func in tools.items():
            # Check that tool has proper attributes
            assert hasattr(tool_func, '_mcp_tool'), f"Tool {tool_name} missing MCP metadata"
            
            # Get tool metadata
            tool_info = tool_func._mcp_tool
            assert 'name' in tool_info
            assert 'description' in tool_info
            assert tool_info['name'] == tool_name


class TestBrowserTools:
    """Unit tests for individual browser tools"""
    
    def setup_method(self):
        """Set up test fixtures with mocked browser"""
        self.config = Config(
            camoufox=CamoufoxConfig(headless=True),
            server=ServerConfig()
        )
        self.server = CamoufoxMCPServer(self.config)
        
        # Mock browser and page
        self.mock_browser = AsyncMock()
        self.mock_page = AsyncMock()
        self.server.browser = self.mock_browser
        self.server.page = self.mock_page
    
    @pytest.mark.asyncio
    async def test_browser_navigate(self):
        """Test browser navigation tool"""
        self.mock_page.goto.return_value = None
        
        result = await self.server.browser_navigate(url="https://example.com")
        
        self.mock_page.goto.assert_called_once_with("https://example.com", wait_until="load")
        assert len(result) > 0
        assert "navigated" in str(result[0]).lower()
    
    @pytest.mark.asyncio
    async def test_browser_navigate_with_timeout(self):
        """Test navigation with custom timeout"""
        self.mock_page.goto.return_value = None
        
        result = await self.server.browser_navigate(
            url="https://example.com",
            timeout=10000
        )
        
        self.mock_page.goto.assert_called_once_with(
            "https://example.com", 
            wait_until="load", 
            timeout=10000
        )
        assert len(result) > 0
    
    @pytest.mark.asyncio
    async def test_browser_click(self):
        """Test clicking elements"""
        self.mock_page.click.return_value = None
        
        result = await self.server.browser_click(selector="#button")
        
        self.mock_page.click.assert_called_once_with("#button")
        assert len(result) > 0
        assert "clicked" in str(result[0]).lower()
    
    @pytest.mark.asyncio
    async def test_browser_type(self):
        """Test typing in elements"""
        self.mock_page.type.return_value = None
        
        result = await self.server.browser_type(
            selector="input[name='username']",
            text="testuser"
        )
        
        self.mock_page.type.assert_called_once_with(
            "input[name='username']", 
            "testuser"
        )
        assert len(result) > 0
    
    @pytest.mark.asyncio
    async def test_browser_type_with_delay(self):
        """Test typing with custom delay"""
        self.mock_page.type.return_value = None
        
        result = await self.server.browser_type(
            selector="input[name='username']",
            text="testuser",
            delay=100
        )
        
        self.mock_page.type.assert_called_once_with(
            "input[name='username']", 
            "testuser", 
            delay=100
        )
        assert len(result) > 0
    
    @pytest.mark.asyncio
    async def test_browser_wait_for(self):
        """Test waiting for elements"""
        mock_element = AsyncMock()
        self.mock_page.wait_for_selector.return_value = mock_element
        
        result = await self.server.browser_wait_for(
            selector=".loading",
            timeout=5000
        )
        
        self.mock_page.wait_for_selector.assert_called_once_with(
            ".loading", 
            timeout=5000
        )
        assert len(result) > 0
    
    @pytest.mark.asyncio
    async def test_browser_get_content(self):
        """Test content extraction"""
        self.mock_page.content.return_value = "<html><body>Test content</body></html>"
        
        result = await self.server.browser_get_content()
        
        self.mock_page.content.assert_called_once()
        assert len(result) > 0
        assert "Test content" in str(result[0])
    
    @pytest.mark.asyncio
    async def test_browser_screenshot(self):
        """Test screenshot capture"""
        mock_screenshot_data = b"fake_image_data"
        self.mock_page.screenshot.return_value = mock_screenshot_data
        
        with patch('base64.b64encode') as mock_b64encode:
            mock_b64encode.return_value = b"ZmFrZV9pbWFnZV9kYXRh"  # base64 of "fake_image_data"
            
            result = await self.server.browser_screenshot(filename="test.png")
            
            self.mock_page.screenshot.assert_called_once_with(
                path="/tmp/camoufox-mcp/test.png", 
                full_page=True
            )
            assert len(result) > 0
    
    @pytest.mark.asyncio
    async def test_browser_execute_js(self):
        """Test JavaScript execution"""
        self.mock_page.evaluate.return_value = "Test Result"
        
        result = await self.server.browser_execute_js(
            code="return document.title"
        )
        
        self.mock_page.evaluate.assert_called_once_with("return document.title")
        assert len(result) > 0
        assert "Test Result" in str(result[0])
    
    @pytest.mark.asyncio
    async def test_browser_set_geolocation(self):
        """Test geolocation setting"""
        mock_context = AsyncMock()
        self.mock_page.context = mock_context
        
        result = await self.server.browser_set_geolocation(
            latitude=40.7128,
            longitude=-74.0060
        )
        
        mock_context.set_geolocation.assert_called_once_with({
            "latitude": 40.7128,
            "longitude": -74.0060
        })
        assert len(result) > 0
    
    @pytest.mark.asyncio
    async def test_browser_close(self):
        """Test browser cleanup"""
        with patch.object(self.server, '_cleanup_browser') as mock_cleanup:
            result = await self.server.browser_close()
            
            mock_cleanup.assert_called_once()
            assert len(result) > 0
            assert "closed" in str(result[0]).lower()


class TestErrorHandling:
    """Unit tests for error handling scenarios"""
    
    def setup_method(self):
        """Set up test fixtures"""
        self.config = Config(
            camoufox=CamoufoxConfig(headless=True),
            server=ServerConfig()
        )
        self.server = CamoufoxMCPServer(self.config)
        
        # Mock browser and page
        self.mock_browser = AsyncMock()
        self.mock_page = AsyncMock()
        self.server.browser = self.mock_browser
        self.server.page = self.mock_page
    
    @pytest.mark.asyncio
    async def test_navigation_error_handling(self):
        """Test error handling in navigation"""
        from playwright.async_api import Error as PlaywrightError
        
        # Mock navigation failure
        self.mock_page.goto.side_effect = PlaywrightError("Navigation failed")
        
        with pytest.raises(Exception) as exc_info:
            await self.server.browser_navigate(url="https://invalid-url")
        
        assert "Navigation failed" in str(exc_info.value)
    
    @pytest.mark.asyncio
    async def test_click_error_handling(self):
        """Test error handling in clicking"""
        from playwright.async_api import TimeoutError as PlaywrightTimeoutError
        
        # Mock click timeout
        self.mock_page.click.side_effect = PlaywrightTimeoutError("Element not found")
        
        with pytest.raises(Exception) as exc_info:
            await self.server.browser_click(selector="#nonexistent")
        
        assert "Element not found" in str(exc_info.value)
    
    @pytest.mark.asyncio
    async def test_javascript_error_handling(self):
        """Test error handling in JavaScript execution"""
        from playwright.async_api import Error as PlaywrightError
        
        # Mock JavaScript error
        self.mock_page.evaluate.side_effect = PlaywrightError("JavaScript error")
        
        with pytest.raises(Exception) as exc_info:
            await self.server.browser_execute_js(code="invalid javascript")
        
        assert "JavaScript error" in str(exc_info.value)
    
    @pytest.mark.asyncio
    async def test_browser_not_initialized(self):
        """Test error handling when browser is not initialized"""
        # Reset browser to None
        self.server.browser = None
        self.server.page = None
        
        with patch.object(self.server, '_ensure_browser') as mock_ensure:
            mock_ensure.side_effect = Exception("Browser initialization failed")
            
            with pytest.raises(Exception) as exc_info:
                await self.server.browser_navigate(url="https://example.com")
            
            assert "Browser initialization failed" in str(exc_info.value)


class TestConfigurationOptions:
    """Unit tests for configuration handling"""
    
    def test_headless_modes(self):
        """Test different headless mode configurations"""
        # Test boolean headless modes
        for headless in [True, False]:
            config = Config(
                camoufox=CamoufoxConfig(headless=headless),
                server=ServerConfig()
            )
            server = CamoufoxMCPServer(config)
            assert server.config.camoufox.headless == headless
        
        # Test string headless mode
        config = Config(
            camoufox=CamoufoxConfig(headless='virtual'),
            server=ServerConfig()
        )
        server = CamoufoxMCPServer(config)
        assert server.config.camoufox.headless == 'virtual'
    
    def test_browser_options(self):
        """Test browser configuration options"""
        config = Config(
            camoufox=CamoufoxConfig(
                headless=True,
                humanize=True,
                geoip=True,
                block_webrtc=True,
                disable_coop=True
            ),
            server=ServerConfig()
        )
        server = CamoufoxMCPServer(config)
        
        assert server.config.camoufox.humanize is True
        assert server.config.camoufox.geoip is True
        assert server.config.camoufox.block_webrtc is True
        assert server.config.camoufox.disable_coop is True
    
    def test_proxy_configuration(self):
        """Test proxy configuration"""
        proxy_config = {
            "server": "proxy.example.com:8080",
            "username": "user",
            "password": "pass"
        }
        
        config = Config(
            camoufox=CamoufoxConfig(
                headless=True,
                proxy=proxy_config
            ),
            server=ServerConfig()
        )
        server = CamoufoxMCPServer(config)
        
        assert server.config.camoufox.proxy == proxy_config


def run_unit_tests():
    """Run all unit tests"""
    print("=" * 60)
    print("🧪 Camoufox MCP Server - Unit Tests")
    print("=" * 60)
    
    # Import pytest and run tests
    try:
        import pytest
        
        # Run tests with pytest
        exit_code = pytest.main([
            __file__,
            "-v",
            "--tb=short",
            "--no-header"
        ])
        
        return exit_code == 0
        
    except ImportError:
        print("⚠️ pytest not available, running basic tests...")
        
        # Run basic tests without pytest
        try:
            # Test server initialization
            config = Config(
                camoufox=CamoufoxConfig(headless=True),
                server=ServerConfig()
            )
            server = CamoufoxMCPServer(config)
            print("✅ Server initialization test passed")
            
            # Test tool registration
            expected_tools = [
                'browser_navigate', 'browser_click', 'browser_type',
                'browser_wait_for', 'browser_get_content', 'browser_screenshot',
                'browser_execute_js', 'browser_set_geolocation', 'browser_close'
            ]
            
            registered_tools = list(server.tools.keys())
            for tool in expected_tools:
                if tool in registered_tools:
                    print(f"✅ Tool {tool} registered")
                else:
                    print(f"❌ Tool {tool} missing")
                    return False
            
            print("\n🎉 Basic unit tests passed!")
            return True
            
        except Exception as e:
            print(f"❌ Unit tests failed: {e}")
            return False


if __name__ == "__main__":
    success = run_unit_tests()
    sys.exit(0 if success else 1)
