"""
Docker integration tests for Camoufox MCP Server
Tests the server running in Docker containers
"""

import pytest
import pytest_asyncio
import asyncio
import subprocess
from pathlib import Path

pytestmark = [pytest.mark.integration, pytest.mark.docker]

from ..utils import MCPTestClient


class TestDockerIntegration:
    """Test Docker integration functionality"""
    
    @pytest.fixture
    def docker_command(self):
        """Get the command to start the Docker server"""
        return [
            "docker", "run", "-i", "--rm",
            "followthewhit3rabbit/camoufox-mcp:latest",
            "--headless=true"
        ]
    
    @pytest.fixture
    def check_docker_available(self):
        """Check if Docker is available and running"""
        try:
            result = subprocess.run(
                ["docker", "--version"],
                capture_output=True,
                timeout=5
            )
            if result.returncode != 0:
                pytest.skip("Docker not available")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pytest.skip("Docker not available")
    
    @pytest_asyncio.fixture
    async def docker_client(self, docker_command, check_docker_available):
        """Create an MCP client for Docker testing"""
        client = MCPTestClient(docker_command, timeout=120.0, debug=True)
        async with client.session():
            yield client
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_initialization(self, docker_client):
        """Test Docker container initialization"""
        response = await docker_client.initialize()
        
        # Check basic response structure
        assert "result" in response
        result = response["result"]
        
        # Check server info
        assert "serverInfo" in result
        server_info = result["serverInfo"]
        assert server_info["name"] == "camoufox-mcp"
        assert "version" in server_info
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_tools_available(self, docker_client):
        """Test that all tools are available in Docker"""
        await docker_client.initialize()
        tools = await docker_client.list_tools()
        
        # Should have all expected tools
        tool_names = [tool["name"] for tool in tools]
        expected_tools = [
            "browser_navigate",
            "browser_click", 
            "browser_type",
            "browser_wait_for",
            "browser_get_content",
            "browser_screenshot",
            "browser_execute_js",
            "browser_set_geolocation",
            "browser_close",
            "get_server_version"
        ]
        
        for expected_tool in expected_tools:
            assert expected_tool in tool_names
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_browser_automation(self, docker_client):
        """Test basic browser automation in Docker"""
        await docker_client.initialize()
        
        # Test navigation
        result = await docker_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1>Docker Test</h1>"
        })
        assert "✅ Navigated to:" in result["content"][0]["text"]
        
        # Test content extraction
        content_result = await docker_client.call_tool("browser_get_content")
        assert "Docker Test" in content_result["content"][0]["text"]
        
        # Test JavaScript execution
        js_result = await docker_client.call_tool("browser_execute_js", {
            "code": "return 'Docker JS works'"
        })
        assert "Docker JS works" in js_result["content"][0]["text"]
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_screenshot(self, docker_client):
        """Test screenshot functionality in Docker"""
        await docker_client.initialize()
        
        # Navigate to a test page
        await docker_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1 style='color: red;'>Screenshot Test</h1>"
        })
        
        # Take screenshot
        result = await docker_client.call_tool("browser_screenshot")
        
        assert len(result["content"]) == 2
        
        # Check image content
        image_content = result["content"][0]
        assert image_content["type"] == "image"
        assert image_content["mimeType"] == "image/png"
        assert len(image_content["data"]) > 0
        
        # Check text content
        text_content = result["content"][1]
        assert "📸 Screenshot saved:" in text_content["text"]
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_environment_variables(self, docker_client):
        """Test that Docker environment is properly configured"""
        await docker_client.initialize()
        
        # Navigate to test page
        await docker_client.call_tool("browser_navigate", {
            "url": "data:text/html,<script>window.dockerTest = true;</script>"
        })
        
        # Check that JavaScript can access browser APIs
        result = await docker_client.call_tool("browser_execute_js", {
            "code": "return typeof navigator !== 'undefined'"
        })
        assert "True" in result["content"][0]["text"]
        
        # Check display environment
        result = await docker_client.call_tool("browser_execute_js", {
            "code": "return screen.width > 0 && screen.height > 0"
        })
        assert "True" in result["content"][0]["text"]
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_headless_mode(self, docker_client):
        """Test that Docker runs in headless mode"""
        await docker_client.initialize()
        
        # Navigate and take screenshot (should work in headless mode)
        await docker_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1>Headless Test</h1>"
        })
        
        result = await docker_client.call_tool("browser_screenshot")
        
        # Should successfully capture screenshot even in headless mode
        assert len(result["content"]) == 2
        assert result["content"][0]["type"] == "image"
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_multiple_operations(self, docker_client):
        """Test multiple sequential operations in Docker"""
        await docker_client.initialize()
        
        # Complex workflow test
        html_content = """
        <html>
        <body>
            <input id="input" type="text" placeholder="Type here">
            <button id="button" onclick="document.getElementById('result').innerText = document.getElementById('input').value">
                Submit
            </button>
            <div id="result">No input</div>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        
        # Navigate
        await docker_client.call_tool("browser_navigate", {"url": test_url})
        
        # Type text
        await docker_client.call_tool("browser_type", {
            "selector": "#input",
            "text": "Docker test input"
        })
        
        # Click button
        await docker_client.call_tool("browser_click", {"selector": "#button"})
        
        # Wait for result
        await docker_client.call_tool("browser_wait_for", {"selector": "#result"})
        
        # Get result
        result = await docker_client.call_tool("browser_get_content", {"selector": "#result"})
        assert "Docker test input" in result["content"][0]["text"]
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_error_handling(self, docker_client):
        """Test error handling in Docker environment"""
        await docker_client.initialize()
        
        # Test navigation to invalid URL
        try:
            await docker_client.call_tool("browser_navigate", {"url": "invalid://url"})
        except Exception:
            pass  # Expected to fail
        
        # Test clicking non-existent element
        await docker_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1>Error Test</h1>"
        })
        
        result = await docker_client.call_tool("browser_click", {"selector": "#nonexistent"})
        # Should handle error gracefully
        assert "content" in result
    
    @pytest.mark.docker
    @pytest.mark.asyncio
    async def test_docker_resource_cleanup(self, docker_client):
        """Test resource cleanup in Docker"""
        await docker_client.initialize()
        
        # Perform several operations
        await docker_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1>Cleanup Test</h1>"
        })
        
        await docker_client.call_tool("browser_screenshot")
        
        await docker_client.call_tool("browser_execute_js", {
            "code": "return 'cleanup test'"
        })
        
        # Close browser
        result = await docker_client.call_tool("browser_close")
        assert "🔒 Browser closed" in result["content"][0]["text"]