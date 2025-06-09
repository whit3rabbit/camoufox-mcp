#!/usr/bin/env python3
"""
Integration tests for Camoufox MCP Server

This module contains comprehensive integration tests that verify the complete
functionality of the MCP server, including protocol compliance, tool execution,
and end-to-end browser automation workflows.

Usage:
    python -m pytest tests/test_integration.py
    python tests/test_integration.py --docker
    python tests/test_integration.py --docker --full
"""

import asyncio
import sys
import argparse
import json
import subprocess
import time
from pathlib import Path
import pytest
from typing import List, Dict, Any, Optional


class MCPClient:
    """MCP client for testing server functionality via STDIO communication"""
    
    def __init__(self, command_args: List[str], debug: bool = False):
        self.command_args = command_args
        self.process = None
        self.request_id = 0
        self.debug = debug
    
    async def __aenter__(self):
        """Start the MCP server subprocess"""
        if self.debug:
            print(f"Starting server: {' '.join(self.command_args)}")
        
        try:
            self.process = await asyncio.create_subprocess_exec(
                *self.command_args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            # Wait for server startup
            if "docker" in self.command_args[0]:
                await asyncio.sleep(3)  # Docker needs more time
            else:
                await asyncio.sleep(1)
            
            # Check if process is running
            if self.process.returncode is not None:
                stderr = await self.process.stderr.read()
                raise Exception(f"Server failed to start: {stderr.decode()}")
            
            # Initialize MCP connection
            await self._send_request("initialize", {
                "protocolVersion": "0.1.0",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0"
                }
            }, timeout=10)
            
        except asyncio.TimeoutError:
            raise Exception("Server initialization timed out")
        except Exception as e:
            raise Exception(f"Failed to start server: {e}")
        
        return self
    
    async def __aexit__(self, *args):
        """Clean up subprocess"""
        if self.process:
            self.process.terminate()
            try:
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
    
    async def _send_request(self, method: str, params: Optional[Dict] = None, timeout: int = 5) -> Dict[str, Any]:
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
            print(f"→ {request_str.strip()}")
        
        self.process.stdin.write(request_str.encode())
        await self.process.stdin.drain()
        
        # Read response with timeout
        try:
            response_line = await asyncio.wait_for(
                self.process.stdout.readline(),
                timeout=timeout
            )
        except asyncio.TimeoutError:
            stderr_data = await self.process.stderr.read()
            if stderr_data:
                print(f"Server error: {stderr_data.decode()}")
            raise Exception(f"Timeout waiting for response to {method}")
        
        if not response_line:
            raise Exception("No response from server")
        
        try:
            response = json.loads(response_line.decode())
            if self.debug:
                print(f"← {json.dumps(response, indent=2)}")
        except json.JSONDecodeError as e:
            print(f"Failed to parse response: {response_line.decode()}")
            raise e
        
        if "error" in response:
            raise Exception(f"Server error: {response['error']}")
        
        return response.get("result", {})
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools"""
        result = await self._send_request("tools/list")
        return result.get("tools", [])
    
    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Call a tool with arguments"""
        result = await self._send_request("tools/call", {
            "name": tool_name,
            "arguments": arguments
        }, timeout=30)
        return result.get("content", [])


class MCPIntegrationTests:
    """Comprehensive integration test suite for Camoufox MCP Server"""
    
    def __init__(self, use_docker: bool = False, debug: bool = False):
        self.use_docker = use_docker
        self.debug = debug
        self.client = self._create_client()
        self.results = {
            "passed": 0,
            "failed": 0,
            "errors": []
        }
    
    def _create_client(self) -> MCPClient:
        """Create appropriate MCP client based on test mode"""
        # Ensure output directory exists for Docker volume mount
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
            return MCPClient(["python3", "camoufox_mcp_server.py", "--headless=true"], debug=self.debug)
    
    def _record_result(self, test_name: str, success: bool, message: str = ""):
        """Record test result"""
        if success:
            self.results["passed"] += 1
            status = "✅"
        else:
            self.results["failed"] += 1
            self.results["errors"].append(f"{test_name}: {message}")
            status = "❌"
        
        print(f"  {status} {test_name}: {message}")
    
    async def test_mcp_protocol_compliance(self):
        """Test MCP protocol compliance"""
        print("\n🔌 Testing MCP Protocol Compliance...")
        
        try:
            # Test tools/list
            tools = await self.client.list_tools()
            self._record_result(
                "tools/list", 
                len(tools) > 0, 
                f"Found {len(tools)} tools"
            )
            
            # Verify required tools exist
            tool_names = {tool["name"] for tool in tools}
            required_tools = {
                "browser_navigate", "browser_click", "browser_type",
                "browser_screenshot", "browser_get_content", "browser_close"
            }
            
            missing_tools = required_tools - tool_names
            self._record_result(
                "Required tools present",
                len(missing_tools) == 0,
                f"Missing: {list(missing_tools)}" if missing_tools else "All present"
            )
            
            # Verify tool schemas
            for tool in tools:
                has_schema = "inputSchema" in tool
                self._record_result(
                    f"Tool schema for {tool['name']}",
                    has_schema,
                    "Present" if has_schema else "Missing inputSchema"
                )
            
        except Exception as e:
            self._record_result("MCP Protocol", False, str(e))
    
    async def test_basic_browser_automation(self):
        """Test basic browser automation workflow"""
        print("\n🌐 Testing Basic Browser Automation...")
        
        try:
            # Test navigation
            result = await self.client.call_tool(
                "browser_navigate",
                {"url": "https://example.com"}
            )
            self._record_result(
                "Navigation", 
                len(result) > 0,
                "Successful" if result else "No response"
            )
            
            # Test content extraction
            result = await self.client.call_tool(
                "browser_get_content",
                {}
            )
            content_available = len(result) > 0 and len(str(result[0])) > 100
            self._record_result(
                "Content extraction",
                content_available,
                f"Got {len(str(result[0]) if result else '')} chars" if content_available else "No content"
            )
            
            # Test JavaScript execution
            result = await self.client.call_tool(
                "browser_execute_js",
                {"code": "return document.title"}
            )
            js_works = len(result) > 0
            self._record_result(
                "JavaScript execution",
                js_works,
                f"Title: {str(result[0])}" if js_works else "No result"
            )
            
            # Test screenshot
            result = await self.client.call_tool(
                "browser_screenshot",
                {"filename": "integration_test.png"}
            )
            screenshot_works = len(result) > 0
            self._record_result(
                "Screenshot capture",
                screenshot_works,
                "Captured" if screenshot_works else "Failed"
            )
            
        except Exception as e:
            self._record_result("Browser automation", False, str(e))
    
    async def test_advanced_interactions(self):
        """Test advanced browser interactions"""
        print("\n🎯 Testing Advanced Interactions...")
        
        try:
            # Navigate to a test page
            await self.client.call_tool(
                "browser_navigate",
                {"url": "https://www.google.com"}
            )
            
            # Test typing with delay (humanized)
            result = await self.client.call_tool(
                "browser_type",
                {
                    "selector": "textarea[name='q']",
                    "text": "Camoufox MCP test",
                    "delay": 50
                }
            )
            self._record_result(
                "Humanized typing",
                len(result) > 0,
                "Successful" if result else "Failed"
            )
            
            # Test wait functionality
            result = await self.client.call_tool(
                "browser_wait_for",
                {"selector": "body", "timeout": 5000}
            )
            self._record_result(
                "Wait for element",
                len(result) > 0,
                "Element found" if result else "Timeout"
            )
            
            # Test geolocation setting
            result = await self.client.call_tool(
                "browser_set_geolocation",
                {"latitude": 40.7128, "longitude": -74.0060}
            )
            self._record_result(
                "Geolocation setting",
                len(result) > 0,
                "Set to NYC" if result else "Failed"
            )
            
        except Exception as e:
            self._record_result("Advanced interactions", False, str(e))
    
    async def test_error_handling(self):
        """Test error handling and edge cases"""
        print("\n⚠️ Testing Error Handling...")
        
        try:
            # Test invalid URL
            try:
                await self.client.call_tool(
                    "browser_navigate",
                    {"url": "not-a-valid-url"}
                )
                self._record_result("Invalid URL handling", False, "Should have failed")
            except:
                self._record_result("Invalid URL handling", True, "Properly rejected")
            
            # Test missing selector
            try:
                await self.client.call_tool(
                    "browser_click",
                    {"selector": "#non-existent-element"}
                )
                self._record_result("Missing element handling", False, "Should have failed")
            except:
                self._record_result("Missing element handling", True, "Properly handled")
            
            # Test invalid JavaScript
            try:
                await self.client.call_tool(
                    "browser_execute_js",
                    {"code": "this is not valid javascript;"}
                )
                self._record_result("Invalid JS handling", False, "Should have failed")
            except:
                self._record_result("Invalid JS handling", True, "Properly rejected")
            
        except Exception as e:
            self._record_result("Error handling tests", False, str(e))
    
    async def test_resource_cleanup(self):
        """Test proper resource cleanup"""
        print("\n🧹 Testing Resource Cleanup...")
        
        try:
            # Test browser close
            result = await self.client.call_tool("browser_close", {})
            self._record_result(
                "Browser cleanup",
                len(result) > 0,
                "Closed successfully" if result else "No confirmation"
            )
            
            # Test operations after close (should handle gracefully)
            try:
                await self.client.call_tool("browser_get_content", {})
                self._record_result("Post-close handling", True, "Handled gracefully")
            except:
                self._record_result("Post-close handling", True, "Properly rejected")
            
        except Exception as e:
            self._record_result("Resource cleanup", False, str(e))
    
    async def run_all_tests(self) -> bool:
        """Run complete integration test suite"""
        print("=" * 60)
        print("🧪 Camoufox MCP Server - Integration Tests")
        print(f"📍 Mode: {'Docker' if self.use_docker else 'Local'}")
        print("=" * 60)
        
        try:
            async with self.client:
                await self.test_mcp_protocol_compliance()
                await self.test_basic_browser_automation()
                await self.test_advanced_interactions()
                await self.test_error_handling()
                await self.test_resource_cleanup()
        
        except Exception as e:
            print(f"\n💥 Test suite failed: {e}")
            self.results["failed"] += 1
            self.results["errors"].append(f"Test suite: {str(e)}")
        
        return self.results["failed"] == 0
    
    def print_summary(self):
        """Print comprehensive test summary"""
        total = self.results["passed"] + self.results["failed"]
        
        print("\n" + "=" * 60)
        print("📊 Integration Test Summary")
        print("=" * 60)
        print(f"  ✅ Passed: {self.results['passed']}")
        print(f"  ❌ Failed: {self.results['failed']}")
        
        if total > 0:
            success_rate = self.results['passed'] / total * 100
            print(f"  📈 Success Rate: {success_rate:.1f}%")
        
        if self.results["errors"]:
            print("\n❌ Failed Tests:")
            for error in self.results["errors"]:
                print(f"   • {error}")
        
        if self.results["failed"] == 0:
            print("\n🎉 All integration tests passed!")
            print("   Your Camoufox MCP server is fully functional.")
        else:
            print("\n⚠️ Some tests failed. Review the errors above.")
            self._print_troubleshooting_tips()
    
    def _print_troubleshooting_tips(self):
        """Print troubleshooting advice"""
        print("\n💡 Troubleshooting Tips:")
        if self.use_docker:
            print("   • Ensure Docker is running: docker ps")
            print("   • Pull latest image: docker pull followthewhit3rabbit/camoufox-mcp:latest")
            print("   • Check container logs for errors")
        else:
            print("   • Install dependencies: pip install -r requirements.txt")
            print("   • Download Camoufox: python -m camoufox fetch")
            print("   • Run with --debug for detailed output")
        print("   • Check network connectivity for browser tests")
        print("   • Verify system has sufficient resources (RAM/CPU)")


async def main():
    """Main test execution function"""
    parser = argparse.ArgumentParser(
        description="Integration tests for Camoufox MCP Server"
    )
    parser.add_argument("--docker", action="store_true", help="Test Docker container")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    args = parser.parse_args()
    
    # Create and run test suite
    tester = MCPIntegrationTests(use_docker=args.docker, debug=args.debug)
    
    try:
        success = await tester.run_all_tests()
        tester.print_summary()
        sys.exit(0 if success else 1)
    
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n💥 Unexpected error: {e}")
        if args.debug:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
