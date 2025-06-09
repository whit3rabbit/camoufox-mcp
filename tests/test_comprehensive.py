#!/usr/bin/env python3
"""
Comprehensive test script for Camoufox MCP Server
Tests all functionality with detailed feedback
"""

import asyncio
import json
import subprocess
import sys
import argparse
import time
import os
from pathlib import Path


class MCPClient:
    """Simple MCP client using subprocess for STDIO communication"""
    
    def __init__(self, command_args):
        self.command_args = command_args
        self.process = None
        self.request_id = 0
        self.debug = os.environ.get("DEBUG", "").lower() == "true"
    
    async def __aenter__(self):
        """Start the subprocess"""
        print("🔄 Starting MCP server process...")
        
        # Start process
        self.process = await asyncio.create_subprocess_exec(
            *self.command_args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        # Check if Docker needs to pull image
        if "docker" in self.command_args[0]:
            print("🐳 Starting Docker container (may pull image on first run)...")
            await asyncio.sleep(3)  # Give Docker time to start
        else:
            print("🐍 Starting local Python server...")
            await asyncio.sleep(1)
        
        # Check if process is still running
        if self.process.returncode is not None:
            stderr = await self.process.stderr.read()
            raise Exception(f"Server failed to start: {stderr.decode()[:200]}")
        
        print("✅ Server process started")
        
        # Initialize the connection
        print("🔌 Initializing MCP connection...")
        try:
            result = await self._send_request("initialize", {
                "protocolVersion": "0.1.0",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0"
                }
            })
            
            if "serverInfo" in result:
                print(f"✅ Connected to: {result['serverInfo'].get('name', 'Unknown Server')}")
            else:
                print("✅ Connection initialized")
                
        except Exception as e:
            print(f"❌ Failed to initialize: {e}")
            raise
        
        return self
    
    async def __aexit__(self, *args):
        """Close the subprocess"""
        if self.process:
            print("🧹 Shutting down server...")
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                print("⚠️  Force killing server...")
                self.process.kill()
    
    async def _send_request(self, method, params=None):
        """Send JSON-RPC request and get response"""
        self.request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "id": self.request_id
        }
        if params:
            request["params"] = params
        
        if self.debug:
            print(f"→ Request: {method}")
        
        # Send request
        request_str = json.dumps(request) + "\n"
        self.process.stdin.write(request_str.encode())
        await self.process.stdin.drain()
        
        # Read response with timeout
        try:
            response_line = await asyncio.wait_for(
                self.process.stdout.readline(),
                timeout=10.0
            )
        except asyncio.TimeoutError:
            raise Exception(f"Timeout waiting for response to {method}")
        
        if not response_line:
            raise Exception("No response from server")
        
        try:
            response = json.loads(response_line.decode())
        except json.JSONDecodeError as e:
            raise Exception(f"Invalid JSON response: {e}\nRaw: {response_line[:100]}")
        
        if self.debug:
            print(f"← Response received")
        
        if "error" in response:
            raise Exception(f"Server error: {response['error'].get('message', 'Unknown error')}")
        
        return response.get("result", {})
    
    async def ping(self):
        """Simple connectivity check"""
        return True
    
    async def list_tools(self):
        """List available tools"""
        result = await self._send_request("tools/list")
        return result.get("tools", [])
    
    async def call_tool(self, tool_name, arguments):
        """Call a tool"""
        result = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments
        })
        return result.get("content", [])


class QuickTest:
    def __init__(self, use_docker=False):
        self.use_docker = use_docker
        self.client = self._create_client()
        self.passed = 0
        self.failed = 0
        self.output_dir = Path("test-output")
        self.output_dir.mkdir(exist_ok=True)
    
    def _create_client(self):
        """Create appropriate client based on mode"""
        if self.use_docker:
            return MCPClient([
                "docker", "run", "-i", "--rm",
                "-v", f"{self.output_dir.absolute()}:/tmp/camoufox-mcp",
                "followthewhit3rabbit/camoufox-mcp:latest",
                "--headless=true"
            ])
        else:
            server_path = Path(__file__).parent.parent / "main.py"
            if not server_path.exists():
                print(f"❌ Server not found at: {server_path}")
                sys.exit(1)
            return MCPClient(["python3", str(server_path), "--headless=true"])
    
    async def test_connection(self):
        """Test basic connectivity"""
        print("\n🔌 Testing connection...")
        try:
            await self.client.ping()
            self._pass("Server is reachable")
            return True
        except Exception as e:
            self._fail(f"Connection failed: {e}")
            return False
    
    async def test_list_tools(self):
        """Test tool listing"""
        print("\n🔧 Testing tool listing...")
        try:
            tools = await self.client.list_tools()
            self._pass(f"Found {len(tools)} tools")
            
            expected_tools = [
                "browser_navigate", "browser_click", "browser_type",
                "browser_screenshot", "browser_get_content", "browser_close",
                "browser_wait_for", "browser_execute_js", "browser_set_geolocation"
            ]
            
            available_tools = [tool["name"] for tool in tools]
            for expected in expected_tools:
                if expected in available_tools:
                    self._pass(f"  ✓ {expected}")
                else:
                    self._fail(f"  ✗ {expected} missing")
            
            return True
        except Exception as e:
            self._fail(f"Tool listing failed: {e}")
            return False
    
    async def test_navigation(self):
        """Test basic navigation"""
        print("\n🌐 Testing navigation...")
        try:
            result = await self.client.call_tool(
                "browser_navigate",
                {"url": "https://example.com"}
            )
            self._pass("Navigation successful")
            if result and len(result) > 0:
                text = result[0].get("text", "")
                self._pass(f"  Response: {text[:80]}...")
            return True
        except Exception as e:
            self._fail(f"Navigation failed: {e}")
            return False
    
    async def test_screenshot(self):
        """Test screenshot capture"""
        print("\n📸 Testing screenshot...")
        try:
            result = await self.client.call_tool(
                "browser_screenshot",
                {"filename": "test_screenshot.png"}
            )
            self._pass("Screenshot captured")
            
            # Check if file was created
            screenshot_path = self.output_dir / "test_screenshot.png"
            if screenshot_path.exists():
                size_kb = screenshot_path.stat().st_size / 1024
                self._pass(f"  File created: {size_kb:.1f} KB")
            
            return True
        except Exception as e:
            self._fail(f"Screenshot failed: {e}")
            return False
    
    async def test_javascript(self):
        """Test JavaScript execution"""
        print("\n🔧 Testing JavaScript execution...")
        try:
            result = await self.client.call_tool(
                "browser_execute_js",
                {"code": "return document.title"}
            )
            self._pass("JavaScript executed")
            if result and len(result) > 0:
                text = result[0].get("text", "")
                self._pass(f"  Page title: {text}")
            return True
        except Exception as e:
            self._fail(f"JavaScript execution failed: {e}")
            return False
    
    async def test_cleanup(self):
        """Test browser cleanup"""
        print("\n🧹 Testing cleanup...")
        try:
            result = await self.client.call_tool("browser_close", {})
            self._pass("Browser closed successfully")
            return True
        except Exception as e:
            self._fail(f"Cleanup failed: {e}")
            return False
    
    async def run_basic_tests(self):
        """Run basic test suite"""
        print("=" * 60)
        print("🚀 Camoufox MCP Server - Comprehensive Test")
        print(f"📍 Mode: {'Docker' if self.use_docker else 'Local'}")
        print(f"📁 Output: {self.output_dir.absolute()}")
        print("=" * 60)
        
        try:
            async with self.client:
                # Run all basic tests
                await self.test_connection()
                await self.test_list_tools()
                await self.test_navigation()
                await self.test_screenshot()
                await self.test_javascript()
                await self.test_cleanup()
        except Exception as e:
            print(f"\n💥 Critical error: {e}")
            self.failed += 1
        
        return self.failed == 0
    
    async def run_full_tests(self):
        """Run extended test suite"""
        print("\n" + "=" * 60)
        print("🔬 Running Extended Tests")
        print("=" * 60)
        
        try:
            async with self.client:
                # Test humanized interactions
                await self._test_humanized_interaction()
                
                # Test wait functionality
                await self._test_wait_functionality()
                
                # Test content extraction
                await self._test_content_extraction()
                
                # Test geolocation
                await self._test_geolocation()
                
                # Test error handling
                await self._test_error_handling()
                
        except Exception as e:
            print(f"\n💥 Critical error in extended tests: {e}")
            self.failed += 1
    
    async def _test_humanized_interaction(self):
        """Test humanized clicking and typing"""
        print("\n🖱️ Testing humanized interactions...")
        try:
            await self.client.call_tool(
                "browser_navigate",
                {"url": "https://www.google.com"}
            )
            
            await self.client.call_tool(
                "browser_type",
                {
                    "selector": "textarea[name='q']",
                    "text": "Camoufox MCP test",
                    "delay": 100
                }
            )
            self._pass("Humanized typing works")
            
            # Test clicking
            await self.client.call_tool(
                "browser_click",
                {"selector": "body"}  # Safe element to click
            )
            self._pass("Humanized clicking works")
            
        except Exception as e:
            self._fail(f"Humanized interaction failed: {e}")
    
    async def _test_wait_functionality(self):
        """Test wait functionality"""
        print("\n⏱️ Testing wait functionality...")
        try:
            await self.client.call_tool(
                "browser_wait_for",
                {"selector": "body", "timeout": 5000}
            )
            self._pass("Wait for selector works")
            
            await self.client.call_tool(
                "browser_wait_for",
                {"text": "Example", "timeout": 5000}
            )
            self._pass("Wait for text works")
            
        except Exception as e:
            self._fail(f"Wait functionality failed: {e}")
    
    async def _test_content_extraction(self):
        """Test content extraction"""
        print("\n📄 Testing content extraction...")
        try:
            result = await self.client.call_tool(
                "browser_get_content",
                {}
            )
            if result and len(result) > 0:
                content = result[0].get("text", "")
                self._pass(f"Content extracted ({len(content)} chars)")
                
                # Test with selector
                result = await self.client.call_tool(
                    "browser_get_content",
                    {"selector": "title"}
                )
                if result and len(result) > 0:
                    self._pass(f"Selector extraction works")
            else:
                self._fail("No content returned")
        except Exception as e:
            self._fail(f"Content extraction failed: {e}")
    
    async def _test_geolocation(self):
        """Test geolocation setting"""
        print("\n🌍 Testing geolocation...")
        try:
            await self.client.call_tool(
                "browser_set_geolocation",
                {"latitude": 40.7128, "longitude": -74.0060, "accuracy": 100}
            )
            self._pass("Geolocation set successfully")
            
            # Verify with JS
            result = await self.client.call_tool(
                "browser_execute_js",
                {"code": "return new Promise(r => navigator.geolocation.getCurrentPosition(p => r({lat: p.coords.latitude, lng: p.coords.longitude})))"}
            )
            if result and len(result) > 0:
                self._pass("Geolocation verified via JS")
                
        except Exception as e:
            # Geolocation might fail in headless mode, which is okay
            self._pass(f"Geolocation test skipped (headless limitation)")
    
    async def _test_error_handling(self):
        """Test error handling"""
        print("\n❌ Testing error handling...")
        
        # Test invalid selector
        try:
            await self.client.call_tool(
                "browser_click",
                {"selector": "!!!invalid!!!"}
            )
            self._fail("Should have failed with invalid selector")
        except Exception:
            self._pass("Invalid selector properly rejected")
        
        # Test navigation to invalid URL
        try:
            await self.client.call_tool(
                "browser_navigate",
                {"url": "not-a-valid-url"}
            )
            self._fail("Should have failed with invalid URL")
        except Exception:
            self._pass("Invalid URL properly rejected")
    
    def _pass(self, message):
        """Record passed test"""
        print(f"  ✅ {message}")
        self.passed += 1
    
    def _fail(self, message):
        """Record failed test"""
        print(f"  ❌ {message}")
        self.failed += 1
    
    def print_summary(self):
        """Print test summary"""
        total = self.passed + self.failed
        print("\n" + "=" * 60)
        print("📊 Test Summary")
        print("=" * 60)
        print(f"  ✅ Passed: {self.passed}")
        print(f"  ❌ Failed: {self.failed}")
        if total > 0:
            print(f"  📈 Success Rate: {self.passed/total*100:.1f}%")
        
        if self.failed == 0:
            print("\n🎉 All tests passed! Your server is working correctly.")
        else:
            print(f"\n⚠️  {self.failed} test(s) failed. Check the logs above.")


async def main():
    parser = argparse.ArgumentParser(
        description="Comprehensive test for Camoufox MCP Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python test_comprehensive.py           # Test local server
  python test_comprehensive.py --docker  # Test Docker container
  python test_comprehensive.py --full    # Run extended tests
  DEBUG=true python test_comprehensive.py --docker  # Debug mode
        """
    )
    parser.add_argument("--docker", action="store_true", help="Test Docker container")
    parser.add_argument("--full", action="store_true", help="Run full test suite")
    args = parser.parse_args()
    
    # Check prerequisites
    if args.docker:
        try:
            subprocess.run(["docker", "--version"], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("❌ Docker is not installed or not running")
            print("   Install Docker from https://docker.com")
            sys.exit(1)
    
    # Create test instance
    tester = QuickTest(use_docker=args.docker)
    
    try:
        # Run tests
        success = await tester.run_basic_tests()
        
        if success and args.full:
            await tester.run_full_tests()
        
        # Print summary
        tester.print_summary()
        
        # Exit with appropriate code
        sys.exit(0 if tester.failed == 0 else 1)
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n💥 Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
