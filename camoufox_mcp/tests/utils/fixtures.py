"""
Shared fixtures and utilities for testing
"""

import tempfile
import os
from pathlib import Path
from typing import Dict, Any

from ...config import Config, CamoufoxConfig, ServerConfig
from ...server import CamoufoxMCPServer


def create_test_server(
    headless: bool = True,
    output_dir: str = None,
    captcha_solver: bool = False,
    debug: bool = True,
    **browser_kwargs
) -> CamoufoxMCPServer:
    """
    Create a test server instance with sensible defaults
    
    Args:
        headless: Run browser in headless mode
        output_dir: Directory for screenshots and files
        captcha_solver: Enable CAPTCHA solving
        debug: Enable debug mode
        **browser_kwargs: Additional browser configuration options
    
    Returns:
        Configured CamoufoxMCPServer instance
    """
    if output_dir is None:
        output_dir = tempfile.mkdtemp(prefix="camoufox-test-")
    
    browser_config = CamoufoxConfig(
        headless=headless,
        captcha_solver=captcha_solver,
        output_dir=output_dir,
        humanize=False,  # Disable for faster tests
        block_images=True,  # Faster loading
        geoip=False,  # Skip GeoIP for faster startup
        **browser_kwargs
    )
    
    config = Config(
        browser=browser_config,
        server=ServerConfig(port=None, host="localhost"),
        debug=debug
    )
    
    return CamoufoxMCPServer(config)


def create_test_html_file(content: str = None) -> str:
    """
    Create a temporary HTML file for testing
    
    Args:
        content: HTML content, defaults to a simple test page
    
    Returns:
        Path to the created HTML file
    """
    if content is None:
        content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Test Page</title>
        </head>
        <body>
            <h1>Test Page</h1>
            <button id="test-button">Click Me</button>
            <input id="test-input" type="text" placeholder="Type here">
            <div id="test-content">Test content for extraction</div>
            <script>
                document.getElementById('test-button').onclick = function() {
                    alert('Button clicked!');
                };
            </script>
        </body>
        </html>
        """
    
    with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as f:
        f.write(content)
        return f.name


def cleanup_test_file(filepath: str):
    """Clean up a test file"""
    try:
        os.unlink(filepath)
    except OSError:
        pass


def get_test_urls() -> Dict[str, str]:
    """Get URLs for testing different scenarios"""
    return {
        "simple": "data:text/html,<h1>Simple Test</h1>",
        "interactive": "data:text/html,<button onclick='alert(\"clicked\")'>Click</button>",
        "form": "data:text/html,<form><input name='test' placeholder='type here'></form>",
        "example": "https://example.com",
        "httpbin": "https://httpbin.org/html",  # For network testing
    }