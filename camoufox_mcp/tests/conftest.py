"""
Pytest configuration and shared fixtures for Camoufox MCP Server tests
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock
from typing import AsyncGenerator

from ..config import Config, CamoufoxConfig, ServerConfig
from ..server import CamoufoxMCPServer


# Removed session-scoped event_loop fixture to avoid conflicts with pytest-asyncio
# pytest-asyncio handles event loop creation automatically


@pytest.fixture
def test_config():
    """Create a test configuration for unit tests"""
    return Config(
        browser=CamoufoxConfig(
            headless=True,
            captcha_solver=False,
            output_dir="/tmp/test-camoufox-mcp",
            humanize=False,  # Disable for faster tests
            block_images=True,  # Faster loading
        ),
        server=ServerConfig(
            port=None,  # STDIO mode for tests
            host="localhost"
        ),
        debug=True
    )


@pytest.fixture
def mock_browser():
    """Create a mock browser instance for unit tests"""
    browser = AsyncMock()
    browser.new_page = AsyncMock()
    browser.__aenter__ = AsyncMock(return_value=browser)
    browser.__aexit__ = AsyncMock(return_value=None)
    return browser


@pytest.fixture
def mock_page():
    """Create a mock page instance for unit tests"""
    page = AsyncMock()
    page.goto = AsyncMock()
    page.click = AsyncMock()
    page.type = AsyncMock()
    page.locator = Mock()  # Playwright's Page.locator() is synchronous
    page.get_by_text = Mock()  # Playwright's Page.get_by_text() is synchronous
    page.screenshot = AsyncMock()
    page.evaluate = AsyncMock()
    page.set_geolocation = AsyncMock()
    page.close = AsyncMock()
    page.title = AsyncMock(return_value="Test Page")
    page.url = "https://example.com"
    page.content = AsyncMock(return_value="<html><body>Test content</body></html>")
    page.inner_text = AsyncMock(return_value="Test content")
    return page


@pytest.fixture
def mock_element():
    """Create a mock element instance for unit tests"""
    element = AsyncMock()
    element.wait_for = AsyncMock()
    element.click = AsyncMock()
    element.type = AsyncMock()
    element.clear = AsyncMock()
    element.text_content = AsyncMock(return_value="Test text")
    element.inner_html = AsyncMock(return_value="<span>Test</span>")
    element.get_attribute = AsyncMock(return_value="test-value")
    element.screenshot = AsyncMock()
    return element


@pytest.fixture
def server(test_config):
    """Create a test server instance"""
    return CamoufoxMCPServer(test_config)


@pytest.fixture
def server_with_mock_browser(server, mock_browser, mock_page):
    """Create a server with mocked browser dependencies"""
    # Mock the browser creation
    server.browser = mock_browser
    server.browser_context = mock_browser
    server.page = mock_page
    server._browser_starting = False
    
    # Mock the ensure_browser method to avoid actual browser startup
    async def mock_ensure_browser():
        if server.browser_context is None:
            server.browser_context = mock_browser
            server.page = mock_page
    
    server._ensure_browser = mock_ensure_browser
    return server


@pytest.fixture
def integration_config():
    """Create a configuration for integration tests with real browser"""
    return Config(
        browser=CamoufoxConfig(
            headless=True,
            captcha_solver=False,
            output_dir="/tmp/test-camoufox-mcp-integration",
            humanize=0.1,  # Minimal humanization for faster tests
            block_images=True,  # Faster loading
            geoip=False,  # Skip GeoIP for faster startup
            browser_timeout=120.0,  # Increased timeout for browser startup
            context_timeout=60.0,  # Increased timeout for context creation
        ),
        server=ServerConfig(
            port=None,  # STDIO mode
            host="localhost"
        ),
        debug=True
    )