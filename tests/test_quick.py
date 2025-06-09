#!/usr/bin/env python3
"""
Quick test script for Camoufox MCP Server
Run this to verify your server is working correctly.

Usage:
    python test_quick.py                    # Test local server
    python test_quick.py --docker          # Test Docker container
    python test_quick.py --docker --full   # Run full test suite
"""

import asyncio
import sys
import argparse
import json
import subprocess
import time
from pathlib import Path


class MCPClient:
    """Simple MCP client using subprocess for STDIO communication"""
    
    def __init__(self, command_args, debug=False):
        self.command_args = command_args
        self.process = None
        self.request_id = 0
        self.debug = debug
    
    async def __aenter__(self):
        """Start the subprocess"""
        print("🔄 Starting MCP server...")
        if self.debug:
            print(f"   Command: {' '.join(self.command_args)}")
        
        try:
            self.process = await asyncio.create_subprocess_exec(
                *self.command_args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Give the server a moment to start
            if "docker" in self.command_args[0]:
                print("   Waiting for Docker container to start...")
                await asyncio.sleep(3)
            else:
                await asyncio.sleep(1)
            
            # Check if process is still running
            if self.process.returncode is not None:
                stderr = await self.process.stderr.read()
                raise Exception(f"Server failed to start: {stderr.decode()}")
            
            print("   Server process started")
            
            # Initialize the connection
            print("   Initializing MCP connection...")
            await self._send_request("initialize", {
                "protocolVersion": "0.1.0",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0"
                }
            }, timeout=10)
            
            print("   ✅ Connection established")
            
        except asyncio.TimeoutError:
            raise Exception("Server initialization timed out. Is Docker running?")
        except Exception as e:
            raise Exception(f"Failed to start server: {e}")
        
        return self
    
    async def __aexit__(self, *args):
        """Close the subprocess"""
        if self.process:
            print("\n🔄 Closing server...")
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                print("   ⚠️  Force killing server")
                self.process.kill()
    
    async def _send_request(self, method, params=None, timeout=5):
        """Send JSON-RPC request and get response"""
        self.request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "id": self.request_id
        }
        if params:
            request["params"] = params
        
        # Send request
        request_str = json.dumps(request) + "\n"
        if self.debug:
            print(f"   → Sending: {request_str.strip()}")
        
        self.process.stdin.write(request_str.encode())
        await self.process.stdin.drain()
        
        # Read response with timeout
        try:
            response_line = await asyncio.wait_for(
                self.process.stdout.readline(),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            # Check stderr for errors
            stderr_data = await self.process.stderr.read()
            if stderr_data:
                print(f"   Server error output: {stderr_data.decode()}")
            raise Exception(f"Timeout waiting for response to {method}")
        
        if not response_line:
            raise Exception("No response from server")
        
        try:
            response = json.loads(response_line.decode())
            if self.debug:
                print(f"   ← Response: {json.dumps(response, indent=2)}")
        except json.JSONDecodeError as e:
            print(f"   Failed to parse response: {response_line.decode()}")
            raise e
        
        if "error" in response:
            raise Exception(f"Server error: {response['error']}")
        
        return response.get("result", {})
    
    async def ping(self):
        """Simple connectivity check"""
        # The initialize call in __aenter__ serves as our ping
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
        }, timeout=30)  # Longer timeout for tool execution
        return result.get("content", [])


class QuickTest:
    def __init__(self, use_docker=False, debug=False):
        self.use_docker = use_docker
        self.debug = debug
        self.client = self._create_client()
        self.passed = 0
        self.failed = 0
    
    def _create_client(self):
        """Create appropriate client based on mode"""
        # Ensure output directory exists
        output_dir = Path.cwd() / "test-output"
        output_dir.mkdir(exist_ok=True)
        
        if self.use_docker:
            return MCPClient([
                "docker", "run", "-i", "--rm",
                "-v", f"{output_dir}:/tmp/camoufox-mcp",
                "followthewhit3rabbit/camoufox-mcp:latest",
                "--headless=true"
            ], debug=self.debug)
        else:
            return MCPClient(["python3", "main.py", "--headless=true"], debug=self.debug)
    
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
                "browser_screenshot", "browser_get_content", "browser_close"
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
                self._pass(f"  Response: {str(result[0])[:50]}...")
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
                self._pass(f"  Page title: {str(result[0])}")
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
        print("=" * 50)
        print("🚀 Camoufox MCP Server - Quick Test")
        print(f"📍 Mode: {'Docker' if self.use_docker else 'Local'}")
        print("=" * 50)
        
        try:
            async with self.client:
                # Connection test is implicit in __aenter__
                await self.test_connection()
                
                # Run other tests
                await self.test_list_tools()
                await self.test_navigation()
                await self.test_screenshot()
                await self.test_javascript()
                await self.test_cleanup()
        except Exception as e:
            print(f"\n❌ Test suite failed: {e}")
            self.failed += 1
            return False
        
        return self.failed == 0
    
    async def run_full_tests(self):
        """Run extended test suite"""
        print("\n" + "=" * 50)
        print("🔬 Running Extended Tests")
        print("=" * 50)
        
        try:
            async with self.client:
                # Test humanized clicking
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
                            "text": "Camoufox MCP",
                            "delay": 100
                        }
                    )
                    self._pass("Humanized typing works")
                except Exception as e:
                    self._fail(f"Humanized interaction failed: {e}")
                
                # Test wait functionality
                print("\n⏱️ Testing wait functionality...")
                try:
                    await self.client.call_tool(
                        "browser_wait_for",
                        {"selector": "body", "timeout": 5000}
                    )
                    self._pass("Wait functionality works")
                except Exception as e:
                    self._fail(f"Wait failed: {e}")
                
                # Test content extraction
                print("\n📄 Testing content extraction...")
                try:
                    result = await self.client.call_tool(
                        "browser_get_content",
                        {}
                    )
                    if result and len(result) > 0:
                        content_length = len(str(result[0]))
                        self._pass(f"Content extracted ({content_length} chars)")
                    else:
                        self._fail("No content returned")
                except Exception as e:
                    self._fail(f"Content extraction failed: {e}")
                
                # Test geolocation
                print("\n🌍 Testing geolocation...")
                try:
                    await self.client.call_tool(
                        "browser_set_geolocation",
                        {"latitude": 40.7128, "longitude": -74.0060}
                    )
                    self._pass("Geolocation set successfully")
                except Exception as e:
                    self._fail(f"Geolocation failed: {e}")
        except Exception as e:
            print(f"\n❌ Extended tests failed: {e}")
            self.failed += 1
    
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
        print("\n" + "=" * 50)
        print("📊 Test Summary")
        print("=" * 50)
        print(f"  ✅ Passed: {self.passed}")
        print(f"  ❌ Failed: {self.failed}")
        if total > 0:
            print(f"  📈 Success Rate: {self.passed/total*100:.1f}%")
        
        if self.failed == 0:
            print("\n🎉 All tests passed! Your server is working correctly.")
        else:
            print("\n⚠️  Some tests failed. Check the logs above for details.")
            print("\n💡 Troubleshooting tips:")
            if self.use_docker:
                print("   - Make sure Docker is running: docker ps")
                print("   - Pull the latest image: docker pull followthewhit3rabbit/camoufox-mcp:latest")
                print("   - Check Docker logs: docker logs $(docker ps -lq)")
            else:
                print("   - Check Python dependencies: pip install -r requirements.txt")
                print("   - Try with --debug flag for more details")


async def main():
    parser = argparse.ArgumentParser(description="Quick test for Camoufox MCP Server")
    parser.add_argument("--docker", action="store_true", help="Test Docker container")
    parser.add_argument("--full", action="store_true", help="Run full test suite")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()
    
    # Create test instance
    tester = QuickTest(use_docker=args.docker, debug=args.debug)
    
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
        if args.debug:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
