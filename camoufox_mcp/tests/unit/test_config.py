"""
Unit tests for configuration classes
"""

import pytest

pytestmark = pytest.mark.unit
from camoufox_mcp.config import Config, CamoufoxConfig, ServerConfig


class TestCamoufoxConfig:
    """Test CamoufoxConfig dataclass"""
    
    def test_default_values(self):
        """Test default configuration values"""
        config = CamoufoxConfig()
        
        assert config.headless is True
        assert config.humanize is True
        assert config.block_webrtc is True
        assert config.block_images is False
        assert config.output_dir == "/tmp/camoufox-mcp"
        assert config.captcha_solver is False
    
    def test_custom_values(self):
        """Test custom configuration values"""
        config = CamoufoxConfig(
            headless=False,
            humanize=0.5,
            block_images=True,
            output_dir="/custom/path",
            captcha_solver=True
        )
        
        assert config.headless is False
        assert config.humanize == 0.5
        assert config.block_images is True
        assert config.output_dir == "/custom/path"
        assert config.captcha_solver is True
    
    def test_proxy_configuration(self):
        """Test proxy configuration"""
        proxy_config = {
            "server": "http://proxy.example.com:8080",
            "username": "user",
            "password": "pass"
        }
        
        config = CamoufoxConfig(proxy=proxy_config)
        assert config.proxy == proxy_config
    
    def test_window_size(self):
        """Test window size configuration"""
        config = CamoufoxConfig(window=(1920, 1080))
        assert config.window == (1920, 1080)


class TestServerConfig:
    """Test ServerConfig dataclass"""
    
    def test_default_values(self):
        """Test default server configuration"""
        config = ServerConfig()
        
        assert config.port is None
        assert config.host == "localhost"
    
    def test_custom_values(self):
        """Test custom server configuration"""
        config = ServerConfig(port=8080, host="0.0.0.0")
        
        assert config.port == 8080
        assert config.host == "0.0.0.0"


class TestConfig:
    """Test main Config dataclass"""
    
    def test_default_values(self):
        """Test default main configuration"""
        config = Config()
        
        assert isinstance(config.browser, CamoufoxConfig)
        assert isinstance(config.server, ServerConfig)
        assert config.debug is False
    
    def test_custom_configurations(self):
        """Test custom configurations"""
        browser_config = CamoufoxConfig(headless=False)
        server_config = ServerConfig(port=9000)
        
        config = Config(
            browser=browser_config,
            server=server_config,
            debug=True
        )
        
        assert config.browser == browser_config
        assert config.server == server_config
        assert config.debug is True
    
    def test_nested_configuration_access(self):
        """Test accessing nested configuration values"""
        config = Config()
        config.browser.headless = False
        config.server.port = 8080
        
        assert config.browser.headless is False
        assert config.server.port == 8080