"""
Integration tests for MCP protocol compliance
Tests the Camoufox MCP Server against the full MCP specification
"""

import pytest
import asyncio
import os
from pathlib import Path

pytestmark = pytest.mark.integration

from ..utils import MCPTestClient


class TestMCPProtocolCompliance:
    """Test MCP protocol compliance with real server instance"""
    
    @pytest.fixture
    def server_command(self):
        """Get the command to start the server"""
        project_root = Path(__file__).parent.parent.parent.parent
        main_py = project_root / "main.py"
        return ["python", str(main_py), "--headless=true", "--debug"]
    
    @pytest.fixture
    def docker_command(self):
        """Get the command to start the Docker server"""
        return [
            "docker", "run", "-i", "--rm",
            "followthewhit3rabbit/camoufox-mcp:latest",
            "--headless=true"
        ]
    
    @pytest.fixture
    def use_docker(self, request):
        """Check if tests should use Docker"""
        return hasattr(request.config.option, 'docker') and request.config.option.docker
    
    @pytest.fixture
    async def mcp_client(self, server_command, docker_command, use_docker):
        """Create an MCP client for testing"""
        command = docker_command if use_docker else server_command
        
        client = MCPTestClient(command, timeout=60.0, debug=True)
        async with client.session():
            yield client
    
    @pytest.mark.asyncio
    async def test_server_initialization(self, mcp_client):
        """Test MCP server initialization handshake"""
        response = await mcp_client.initialize()
        
        # Check response structure
        assert "result" in response
        result = response["result"]
        
        # Check protocol version
        assert result["protocolVersion"] == "2024-11-05"
        
        # Check server info
        assert "serverInfo" in result
        server_info = result["serverInfo"]
        assert server_info["name"] == "camoufox-mcp"
        assert "version" in server_info
        
        # Check capabilities
        assert "capabilities" in result
        capabilities = result["capabilities"]
        assert "tools" in capabilities
        assert "prompts" in capabilities
        assert "resources" in capabilities
    
    @pytest.mark.asyncio
    async def test_tools_list(self, mcp_client):
        """Test listing available tools"""
        await mcp_client.initialize()
        tools = await mcp_client.list_tools()
        
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
            assert expected_tool in tool_names, f"Tool {expected_tool} not found in {tool_names}"
        
        # Check tool structure
        for tool in tools:
            assert "name" in tool
            assert "description" in tool
            assert "inputSchema" in tool
            
            # Verify schema structure
            schema = tool["inputSchema"]
            assert "type" in schema
            assert schema["type"] == "object"
    
    @pytest.mark.asyncio
    async def test_get_server_version_tool(self, mcp_client):
        """Test the get_server_version tool"""
        await mcp_client.initialize()
        
        result = await mcp_client.call_tool("get_server_version")
        
        assert "content" in result
        assert len(result["content"]) == 1
        
        content = result["content"][0]
        assert content["type"] == "text"
        assert "text" in content
        
        # Version should be a non-empty string
        version = content["text"]
        assert isinstance(version, str)
        assert len(version) > 0
        # Basic version format check (x.y.z)
        assert "." in version
    
    @pytest.mark.asyncio
    async def test_browser_close_tool(self, mcp_client):
        """Test the browser_close tool"""
        await mcp_client.initialize()
        
        result = await mcp_client.call_tool("browser_close")
        
        assert "content" in result
        content = result["content"][0]
        assert content["type"] == "text"
        assert "🔒 Browser closed" in content["text"]
    
    @pytest.mark.asyncio 
    async def test_browser_navigate_tool(self, mcp_client):
        """Test the browser_navigate tool with a simple URL"""
        await mcp_client.initialize()
        
        # Test with a data URL for speed
        test_url = "data:text/html,<h1>Test Page</h1>"
        result = await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        assert "content" in result
        content = result["content"][0]
        assert content["type"] == "text"
        
        # Should indicate successful navigation
        text = content["text"]
        assert "✅ Navigated to:" in text
        assert "🛡️ Stealth mode active" in text
    
    @pytest.mark.asyncio
    async def test_browser_execute_js_tool(self, mcp_client):
        """Test the browser_execute_js tool"""
        await mcp_client.initialize()
        
        # First navigate to a page
        test_url = "data:text/html,<h1>JS Test</h1>"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Execute simple JavaScript
        result = await mcp_client.call_tool("browser_execute_js", {
            "code": "return 2 + 2"
        })
        
        assert "content" in result
        content = result["content"][0]
        assert content["type"] == "text"
        
        text = content["text"]
        assert "🔧 JavaScript executed" in text
        assert "4" in text  # Result of 2 + 2
    
    @pytest.mark.asyncio
    async def test_browser_get_content_tool(self, mcp_client):
        """Test the browser_get_content tool"""
        await mcp_client.initialize()
        
        # Navigate to a page with known content
        test_url = "data:text/html,<h1>Content Test</h1><p>Test paragraph</p>"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Get page content
        result = await mcp_client.call_tool("browser_get_content")
        
        assert "content" in result
        content = result["content"][0]
        assert content["type"] == "text"
        
        text = content["text"]
        assert "Content Test" in text
        assert "Test paragraph" in text
    
    @pytest.mark.asyncio
    async def test_browser_screenshot_tool(self, mcp_client):
        """Test the browser_screenshot tool"""
        await mcp_client.initialize()
        
        # Navigate to a simple page
        test_url = "data:text/html,<h1>Screenshot Test</h1>"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Take screenshot
        result = await mcp_client.call_tool("browser_screenshot")
        
        assert "content" in result
        assert len(result["content"]) == 2  # Image + text
        
        # Check image content
        image_content = result["content"][0]
        assert image_content["type"] == "image"
        assert image_content["mimeType"] == "image/png"
        assert "data" in image_content
        
        # Check text content
        text_content = result["content"][1]
        assert text_content["type"] == "text"
        assert "📸 Screenshot saved:" in text_content["text"]
    
    @pytest.mark.asyncio
    async def test_error_handling(self, mcp_client):
        """Test error handling for invalid tool calls"""
        await mcp_client.initialize()
        
        # Test unknown tool
        try:
            await mcp_client.call_tool("unknown_tool")
            assert False, "Should have raised an error"
        except RuntimeError as e:
            assert "Unknown tool" in str(e)
        
        # Test invalid parameters
        try:
            await mcp_client.call_tool("browser_navigate", {"invalid_param": "value"})
            assert False, "Should have raised an error"
        except Exception:
            pass  # Expected to fail
    
    @pytest.mark.asyncio
    async def test_tool_input_validation(self, mcp_client):
        """Test tool input schema validation"""
        await mcp_client.initialize()
        tools = await mcp_client.list_tools()
        
        # Find browser_navigate tool
        navigate_tool = None
        for tool in tools:
            if tool["name"] == "browser_navigate":
                navigate_tool = tool
                break
        
        assert navigate_tool is not None
        
        # Check required parameters
        schema = navigate_tool["inputSchema"]
        assert "required" in schema
        assert "url" in schema["required"]
        
        # Check properties
        assert "properties" in schema
        properties = schema["properties"]
        assert "url" in properties
        assert properties["url"]["type"] == "string"
    
    @pytest.mark.asyncio
    async def test_sequential_tool_calls(self, mcp_client):
        """Test making multiple sequential tool calls"""
        await mcp_client.initialize()
        
        # Navigate to a page
        result1 = await mcp_client.call_tool("browser_navigate", {
            "url": "data:text/html,<button id='btn'>Click Me</button>"
        })
        assert "✅ Navigated to:" in result1["content"][0]["text"]
        
        # Get content
        result2 = await mcp_client.call_tool("browser_get_content")
        assert "Click Me" in result2["content"][0]["text"]
        
        # Execute JavaScript
        result3 = await mcp_client.call_tool("browser_execute_js", {
            "code": "return document.title || 'No title'"
        })
        assert "🔧 JavaScript executed" in result3["content"][0]["text"]
        
        # Close browser
        result4 = await mcp_client.call_tool("browser_close")
        assert "🔒 Browser closed" in result4["content"][0]["text"]