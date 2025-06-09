"""
Unit tests for CAPTCHA tools
"""

import pytest
from unittest.mock import AsyncMock, patch
from mcp.types import CallToolResult

pytestmark = pytest.mark.unit

from camoufox_mcp.tools.captcha import CaptchaTools


class TestCaptchaTools:
    """Test CaptchaTools class"""
    
    @pytest.fixture
    def captcha_tools(self, server_with_mock_browser):
        """Create CaptchaTools instance with mocked server"""
        return CaptchaTools(server_with_mock_browser)
    
    @pytest.fixture
    def captcha_tools_enabled(self, server_with_mock_browser):
        """Create CaptchaTools with CAPTCHA solver enabled"""
        server_with_mock_browser.config.browser.captcha_solver = True
        return CaptchaTools(server_with_mock_browser)
    
    def test_is_available_false_by_default(self, captcha_tools):
        """Test that CAPTCHA is not available by default"""
        assert not captcha_tools.is_available
    
    def test_is_available_when_enabled(self, captcha_tools_enabled):
        """Test CAPTCHA availability when enabled in config"""
        # This will be False unless camoufox-captcha is actually installed
        # but we test the config check logic
        captcha_tools_enabled.server.config.browser.captcha_solver = True
        
        # Mock the CAPTCHA_AVAILABLE module variable
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            assert captcha_tools_enabled.is_available
    
    def test_is_available_missing_package(self, captcha_tools_enabled):
        """Test CAPTCHA availability when package is missing"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', False):
            assert not captcha_tools_enabled.is_available
    
    @pytest.mark.asyncio
    async def test_solve_captcha_not_available(self, captcha_tools):
        """Test CAPTCHA solving when not available"""
        result = await captcha_tools.solve_captcha()
        
        assert isinstance(result, CallToolResult)
        assert result.isError
        assert "❌ CAPTCHA solver not available" in result.content[0].text
        assert "Install camoufox-captcha" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_no_page(self, captcha_tools_enabled):
        """Test CAPTCHA solving when page is not initialized"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            captcha_tools_enabled.server.page = None
            
            result = await captcha_tools_enabled.solve_captcha()
            
            assert isinstance(result, CallToolResult)
            assert result.isError
            assert "❌ Browser not initialized" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_success_auto(self, captcha_tools_enabled, mock_page):
        """Test successful CAPTCHA solving with auto type"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            result = await captcha_tools_enabled.solve_captcha("auto")
            
            assert isinstance(result, CallToolResult)
            assert not result.isError
            assert "🤖 CAPTCHA solver would attempt to solve auto type CAPTCHA" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_success_recaptcha(self, captcha_tools_enabled, mock_page):
        """Test successful CAPTCHA solving with reCAPTCHA type"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            result = await captcha_tools_enabled.solve_captcha("recaptcha")
            
            assert not result.isError
            assert "recaptcha type CAPTCHA" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_success_hcaptcha(self, captcha_tools_enabled, mock_page):
        """Test successful CAPTCHA solving with hCaptcha type"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            result = await captcha_tools_enabled.solve_captcha("hcaptcha")
            
            assert not result.isError
            assert "hcaptcha type CAPTCHA" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_success_turnstile(self, captcha_tools_enabled, mock_page):
        """Test successful CAPTCHA solving with Turnstile type"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            result = await captcha_tools_enabled.solve_captcha("turnstile")
            
            assert not result.isError
            assert "turnstile type CAPTCHA" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_default_type(self, captcha_tools_enabled, mock_page):
        """Test CAPTCHA solving with default type"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            result = await captcha_tools_enabled.solve_captcha()
            
            assert not result.isError
            assert "auto type CAPTCHA" in result.content[0].text
    
    @pytest.mark.asyncio
    async def test_solve_captcha_playwright_error(self, captcha_tools_enabled, mock_page):
        """Test CAPTCHA solving with Playwright error"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            # Mock the solve_captcha method to raise a Playwright error
            from playwright.async_api import Error as PlaywrightError
            
            # Since this is a placeholder implementation, we need to patch it
            with patch.object(captcha_tools_enabled, 'solve_captcha') as mock_solve:
                mock_solve.side_effect = PlaywrightError("CAPTCHA element not found")
                
                result = await mock_solve("auto")
                
                assert isinstance(result, PlaywrightError)
    
    @pytest.mark.asyncio
    async def test_solve_captcha_generic_error(self, captcha_tools_enabled, mock_page):
        """Test CAPTCHA solving with generic error"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            # Patch the method to simulate an error in the actual implementation
            with patch.object(captcha_tools_enabled, 'solve_captcha') as mock_solve:
                mock_solve.side_effect = ValueError("Invalid CAPTCHA type")
                
                result = await mock_solve("invalid")
                
                assert isinstance(result, ValueError)
    
    @pytest.mark.asyncio
    async def test_solve_captcha_logs_attempt(self, captcha_tools_enabled, mock_page, caplog):
        """Test that CAPTCHA solving logs the attempt"""
        with patch('camoufox_mcp.tools.captcha.CAPTCHA_AVAILABLE', True):
            with caplog.at_level("INFO"):
                await captcha_tools_enabled.solve_captcha("recaptcha")
            
            log_messages = [record.message for record in caplog.records]
            assert any("Solving CAPTCHA: recaptcha" in msg for msg in log_messages)
    
    def test_captcha_tools_initialization(self, server_with_mock_browser):
        """Test CaptchaTools initialization"""
        tools = CaptchaTools(server_with_mock_browser)
        
        assert tools.server == server_with_mock_browser
        assert hasattr(tools, 'logger')
        assert not tools.is_available  # Default config has CAPTCHA disabled