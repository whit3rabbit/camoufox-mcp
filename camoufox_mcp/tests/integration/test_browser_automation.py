"""
Integration tests for browser automation functionality
Tests real browser interactions with Camoufox
"""

import pytest
import pytest_asyncio
import asyncio
from pathlib import Path

pytestmark = pytest.mark.integration

from ..utils import MCPTestClient, create_test_html_file, cleanup_test_file


class TestBrowserAutomation:
    """Test browser automation functionality with real browser"""
    
    @pytest.fixture
    def server_command(self):
        """Get the command to start the server"""
        project_root = Path(__file__).parent.parent.parent.parent
        main_py = project_root / "main.py"
        return ["python", str(main_py), "--headless=true", "--debug"]
    
    @pytest_asyncio.fixture
    async def mcp_client(self, server_command):
        """Create an MCP client for testing"""
        # Increased timeout to handle first-time browser downloads
        client = MCPTestClient(server_command, timeout=180.0, debug=True)
        async with client.session():
            await client.initialize()
            yield client
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(180)  # 3 minute timeout to prevent hanging
    async def test_simple_navigation(self, mcp_client):
        """Test simple page navigation"""
        test_url = "data:text/html,<h1>Simple Test</h1>"
        
        result = await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        assert "✅ Navigated to:" in result["content"][0]["text"]
        assert "🛡️ Stealth mode active" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_navigation_wait_conditions(self, mcp_client):
        """Test navigation with different wait conditions"""
        test_url = "data:text/html,<h1>Wait Test</h1>"
        
        # Test different wait conditions
        for wait_until in ["load", "domcontentloaded", "networkidle"]:
            result = await mcp_client.call_tool("browser_navigate", {
                "url": test_url,
                "wait_until": wait_until
            })
            assert "✅ Navigated to:" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_click_interactions(self, mcp_client):
        """Test clicking on page elements"""
        html_content = """
        <html>
        <body>
            <button id="test-btn">Click Me</button>
            <button class="class-btn">Class Button</button>
            <button>Text Button</button>
            <div id="result">Not clicked</div>
            <script>
                document.getElementById('test-btn').onclick = function() {
                    document.getElementById('result').innerText = 'ID clicked';
                };
                document.querySelector('.class-btn').onclick = function() {
                    document.getElementById('result').innerText = 'Class clicked';
                };
                document.querySelector('button:last-of-type').onclick = function() {
                    document.getElementById('result').innerText = 'Text clicked';
                };
            </script>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Test ID selector click
        result = await mcp_client.call_tool("browser_click", {"selector": "#test-btn"})
        assert "🖱️ Clicked: #test-btn" in result["content"][0]["text"]
        
        # Verify the click worked
        content_result = await mcp_client.call_tool("browser_get_content", {"selector": "#result"})
        assert "ID clicked" in content_result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_text_input(self, mcp_client):
        """Test typing text into form elements"""
        html_content = """
        <html>
        <body>
            <input id="text-input" type="text" placeholder="Type here">
            <textarea id="textarea">Initial text</textarea>
            <input id="number-input" type="number" value="0">
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Test typing in text input
        result = await mcp_client.call_tool("browser_type", {
            "selector": "#text-input",
            "text": "Hello World"
        })
        assert "⌨️ Typed 'Hello World'" in result["content"][0]["text"]
        
        # Test clearing and typing in textarea
        result = await mcp_client.call_tool("browser_type", {
            "selector": "#textarea",
            "text": "New content",
            "clear": True
        })
        assert "⌨️ Typed 'New content'" in result["content"][0]["text"]
        
        # Verify the text was entered
        content_result = await mcp_client.call_tool("browser_get_content", {"selector": "#textarea"})
        assert "New content" in content_result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_wait_for_elements(self, mcp_client):
        """Test waiting for elements to appear"""
        html_content = """
        <html>
        <body>
            <div id="initial">Initial content</div>
            <script>
                setTimeout(function() {
                    var div = document.createElement('div');
                    div.id = 'delayed';
                    div.innerText = 'Delayed content';
                    document.body.appendChild(div);
                }, 1000);
            </script>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Wait for initially present element
        result = await mcp_client.call_tool("browser_wait_for", {"selector": "#initial"})
        assert "✅ Element found: #initial" in result["content"][0]["text"]
        
        # Wait for delayed element
        result = await mcp_client.call_tool("browser_wait_for", {
            "selector": "#delayed",
            "timeout": 5000
        })
        assert "✅ Element found: #delayed" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_content_extraction(self, mcp_client):
        """Test extracting various types of content"""
        html_content = """
        <html>
        <head><title>Test Page Title</title></head>
        <body>
            <h1>Main Heading</h1>
            <p class="intro">Introduction paragraph</p>
            <div id="data" data-value="test-attribute">Content with attribute</div>
            <ul>
                <li>Item 1</li>
                <li>Item 2</li>
            </ul>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Get full page content
        result = await mcp_client.call_tool("browser_get_content")
        content = result["content"][0]["text"]
        assert "Main Heading" in content
        assert "Introduction paragraph" in content
        assert "Item 1" in content
        
        # Get specific element content
        result = await mcp_client.call_tool("browser_get_content", {"selector": "h1"})
        assert "Main Heading" in result["content"][0]["text"]
        
        # Get element attribute
        result = await mcp_client.call_tool("browser_get_content", {
            "selector": "#data",
            "attribute": "data-value"
        })
        assert "test-attribute" in result["content"][0]["text"]
        
        # Get HTML content
        result = await mcp_client.call_tool("browser_get_content", {
            "selector": ".intro",
            "inner_html": True
        })
        assert "Introduction paragraph" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_javascript_execution(self, mcp_client):
        """Test JavaScript execution capabilities"""
        html_content = """
        <html>
        <body>
            <div id="target">Original</div>
            <script>
                window.testVar = 'Hello from page';
                function testFunction() {
                    return 'Function result';
                }
            </script>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Test simple expression
        result = await mcp_client.call_tool("browser_execute_js", {"code": "return 5 * 8"})
        assert "40" in result["content"][0]["text"]
        
        # Test accessing page variables
        result = await mcp_client.call_tool("browser_execute_js", {"code": "return window.testVar"})
        assert "Hello from page" in result["content"][0]["text"]
        
        # Test calling page functions
        result = await mcp_client.call_tool("browser_execute_js", {"code": "return testFunction()"})
        assert "Function result" in result["content"][0]["text"]
        
        # Test DOM manipulation (isolated world)
        result = await mcp_client.call_tool("browser_execute_js", {
            "code": "return document.getElementById('target').innerText"
        })
        assert "Original" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_geolocation_setting(self, mcp_client):
        """Test setting browser geolocation"""
        test_url = "data:text/html,<h1>Geo Test</h1>"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Set geolocation
        result = await mcp_client.call_tool("browser_set_geolocation", {
            "latitude": 37.7749,
            "longitude": -122.4194,
            "accuracy": 100
        })
        
        assert "🌍 Geolocation set: 37.7749, -122.4194" in result["content"][0]["text"]
        assert "±100m" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_screenshot_functionality(self, mcp_client):
        """Test screenshot capture"""
        html_content = """
        <html>
        <body style="background: lightblue;">
            <h1 style="color: red;">Screenshot Test</h1>
            <div style="width: 100px; height: 100px; background: green;"></div>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Take full page screenshot
        result = await mcp_client.call_tool("browser_screenshot")
        
        assert len(result["content"]) == 2
        
        # Check image content
        image_content = result["content"][0]
        assert image_content["type"] == "image"
        assert image_content["mimeType"] == "image/png"
        assert len(image_content["data"]) > 0  # Should have base64 data
        
        # Check text content
        text_content = result["content"][1]
        assert "📸 Screenshot saved:" in text_content["text"]
    
    @pytest.mark.asyncio
    async def test_xpath_selectors(self, mcp_client):
        """Test XPath selector support"""
        html_content = """
        <html>
        <body>
            <div class="container">
                <p class="paragraph">First paragraph</p>
                <p class="paragraph">Second paragraph</p>
            </div>
        </body>
        </html>
        """
        
        test_url = f"data:text/html,{html_content}"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Test XPath selector for content extraction
        result = await mcp_client.call_tool("browser_get_content", {
            "selector": "//p[@class='paragraph'][2]"
        })
        assert "Second paragraph" in result["content"][0]["text"]
        
        # Test XPath selector for waiting
        result = await mcp_client.call_tool("browser_wait_for", {
            "selector": "//div[@class='container']"
        })
        assert "✅ Element found:" in result["content"][0]["text"]
    
    @pytest.mark.asyncio
    async def test_error_scenarios(self, mcp_client):
        """Test various error scenarios"""
        test_url = "data:text/html,<h1>Error Test</h1>"
        await mcp_client.call_tool("browser_navigate", {"url": test_url})
        
        # Test clicking non-existent element
        result = await mcp_client.call_tool("browser_click", {"selector": "#nonexistent"})
        # Should handle error gracefully
        assert "content" in result
        
        # Test waiting for non-existent element with short timeout
        result = await mcp_client.call_tool("browser_wait_for", {
            "selector": "#missing",
            "timeout": 1000  # 1 second
        })
        # Should timeout gracefully
        assert "content" in result
    
    @pytest.mark.asyncio
    async def test_browser_lifecycle(self, mcp_client):
        """Test complete browser lifecycle"""
        # Navigate to initial page
        result1 = await mcp_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1>Page 1</h1>"
        })
        assert "✅ Navigated to:" in result1["content"][0]["text"]
        
        # Navigate to second page
        result2 = await mcp_client.call_tool("browser_navigate", {
            "url": "data:text/html,<h1>Page 2</h1>"
        })
        assert "✅ Navigated to:" in result2["content"][0]["text"]
        
        # Verify we're on the second page
        content_result = await mcp_client.call_tool("browser_get_content")
        assert "Page 2" in content_result["content"][0]["text"]
        
        # Close browser
        close_result = await mcp_client.call_tool("browser_close")
        assert "🔒 Browser closed" in close_result["content"][0]["text"]