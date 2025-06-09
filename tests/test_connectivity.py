#!/usr/bin/env python3
"""
Connectivity tests for Camoufox MCP Server

This module provides simple connectivity tests that verify the server
can start and respond to basic commands without requiring full browser
automation functionality.

Usage:
    python tests/test_connectivity.py
    python tests/test_connectivity.py --docker
    python tests/test_connectivity.py --docker --debug
"""

import subprocess
import sys
import json
import time
from pathlib import Path


class ConnectivityTester:
    """Simple connectivity test suite for MCP server"""
    
    def __init__(self, use_docker: bool = False, debug: bool = False):
        self.use_docker = use_docker
        self.debug = debug
        self.results = {
            "passed": 0,
            "failed": 0,
            "errors": []
        }
    
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
    
    def test_docker_availability(self) -> bool:
        """Test if Docker is available and working"""
        if not self.use_docker:
            return True
        
        print("\n🐳 Testing Docker availability...")
        
        try:
            result = subprocess.run(
                ["docker", "--version"], 
                check=True, 
                capture_output=True, 
                text=True,
                timeout=5
            )
            self._record_result("Docker installation", True, "Available")
            
            if self.debug:
                print(f"   Docker version: {result.stdout.strip()}")
            
            return True
            
        except subprocess.CalledProcessError as e:
            self._record_result("Docker installation", False, "Not working")
            return False
        except FileNotFoundError:
            self._record_result("Docker installation", False, "Not installed")
            return False
        except subprocess.TimeoutExpired:
            self._record_result("Docker installation", False, "Timeout")
            return False
    
    def test_server_executable(self) -> bool:
        """Test if server executable responds to --help"""
        print("\n🔧 Testing server executable...")
        
        if self.use_docker:
            cmd = [
                "docker", "run", "--rm",
                "followthewhit3rabbit/camoufox-mcp:latest",
                "--help"
            ]
        else:
            cmd = ["python3", "camoufox_mcp_server.py", "--help"]
        
        try:
            if self.debug:
                print(f"   Running: {' '.join(cmd)}")
            
            result = subprocess.run(
                cmd, 
                capture_output=True, 
                text=True, 
                timeout=15
            )
            
            if result.returncode == 0:
                self._record_result("Server executable", True, "Responds to --help")
                
                if self.debug and result.stdout:
                    print(f"   Help output: {result.stdout[:200]}...")
                
                return True
            else:
                self._record_result(
                    "Server executable", 
                    False, 
                    f"Exit code {result.returncode}"
                )
                if result.stderr and self.debug:
                    print(f"   Error: {result.stderr[:200]}")
                return False
                
        except subprocess.TimeoutExpired:
            self._record_result("Server executable", False, "Timeout")
            return False
        except Exception as e:
            self._record_result("Server executable", False, str(e))
            return False
    
    def test_json_rpc_communication(self) -> bool:
        """Test basic JSON-RPC communication"""
        print("\n💬 Testing JSON-RPC communication...")
        
        if self.use_docker:
            cmd = [
                "docker", "run", "-i", "--rm",
                "followthewhit3rabbit/camoufox-mcp:latest",
                "--headless=true"
            ]
        else:
            cmd = ["python3", "camoufox_mcp_server.py", "--headless=true"]
        
        try:
            if self.debug:
                print(f"   Starting server: {' '.join(cmd)}")
            
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # Send initialize request
            request = {
                "jsonrpc": "2.0",
                "method": "initialize",
                "params": {
                    "protocolVersion": "0.1.0",
                    "capabilities": {},
                    "clientInfo": {
                        "name": "connectivity-test",
                        "version": "1.0"
                    }
                },
                "id": 1
            }
            
            request_str = json.dumps(request) + "\n"
            
            if self.debug:
                print(f"   Sending: {request_str.strip()}")
            
            try:
                # Give server time to start, especially Docker
                timeout = 20 if self.use_docker else 10
                stdout, stderr = process.communicate(input=request_str, timeout=timeout)
                
                if stdout:
                    self._record_result("JSON-RPC response", True, "Got response")
                    
                    # Try to parse response
                    for line in stdout.split('\n'):
                        line = line.strip()
                        if line and line.startswith('{'):
                            try:
                                response = json.loads(line)
                                if self.debug:
                                    print(f"   Response: {json.dumps(response, indent=2)}")
                                
                                # Check for successful initialization
                                if "result" in response:
                                    self._record_result(
                                        "MCP initialization", 
                                        True, 
                                        "Server initialized"
                                    )
                                elif "error" in response:
                                    self._record_result(
                                        "MCP initialization", 
                                        False, 
                                        f"Error: {response['error']}"
                                    )
                                break
                            except json.JSONDecodeError:
                                if self.debug:
                                    print(f"   Raw line: {line[:100]}...")
                    
                    return True
                else:
                    self._record_result("JSON-RPC response", False, "No response")
                    if stderr and self.debug:
                        print(f"   Stderr: {stderr[:300]}...")
                    return False
                    
            except subprocess.TimeoutExpired:
                self._record_result("JSON-RPC response", False, "Timeout")
                process.kill()
                return False
                
        except Exception as e:
            self._record_result("JSON-RPC communication", False, str(e))
            return False
    
    def test_tools_list(self) -> bool:
        """Test that server can list tools"""
        print("\n🔧 Testing tools listing...")
        
        if self.use_docker:
            cmd = [
                "docker", "run", "-i", "--rm",
                "followthewhit3rabbit/camoufox-mcp:latest",
                "--headless=true"
            ]
        else:
            cmd = ["python3", "camoufox_mcp_server.py", "--headless=true"]
        
        try:
            process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            # Send initialize request first
            init_request = {
                "jsonrpc": "2.0",
                "method": "initialize",
                "params": {
                    "protocolVersion": "0.1.0",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1.0"}
                },
                "id": 1
            }
            
            # Send tools/list request
            tools_request = {
                "jsonrpc": "2.0",
                "method": "tools/list",
                "params": {},
                "id": 2
            }
            
            requests = (
                json.dumps(init_request) + "\n" +
                json.dumps(tools_request) + "\n"
            )
            
            if self.debug:
                print(f"   Sending requests...")
            
            try:
                timeout = 25 if self.use_docker else 15
                stdout, stderr = process.communicate(input=requests, timeout=timeout)
                
                if stdout:
                    # Look for tools/list response
                    for line in stdout.split('\n'):
                        line = line.strip()
                        if line and line.startswith('{'):
                            try:
                                response = json.loads(line)
                                if response.get("id") == 2:  # tools/list response
                                    if "result" in response:
                                        tools = response["result"].get("tools", [])
                                        tool_count = len(tools)
                                        self._record_result(
                                            "Tools listing", 
                                            tool_count > 0, 
                                            f"Found {tool_count} tools"
                                        )
                                        
                                        if self.debug and tools:
                                            tool_names = [t.get("name", "unknown") for t in tools[:5]]
                                            print(f"   Tools: {', '.join(tool_names)}...")
                                        
                                        return tool_count > 0
                                    else:
                                        self._record_result(
                                            "Tools listing", 
                                            False, 
                                            f"Error: {response.get('error', 'Unknown')}"
                                        )
                                        return False
                            except json.JSONDecodeError:
                                continue
                    
                    self._record_result("Tools listing", False, "No tools response found")
                    return False
                else:
                    self._record_result("Tools listing", False, "No response")
                    return False
                    
            except subprocess.TimeoutExpired:
                self._record_result("Tools listing", False, "Timeout")
                process.kill()
                return False
                
        except Exception as e:
            self._record_result("Tools listing", False, str(e))
            return False
    
    def run_all_tests(self) -> bool:
        """Run complete connectivity test suite"""
        print("=" * 60)
        print("🔌 Camoufox MCP Server - Connectivity Tests")
        print(f"📍 Mode: {'Docker' if self.use_docker else 'Local'}")
        print("=" * 60)
        
        success = True
        
        # Run tests in sequence
        if not self.test_docker_availability():
            success = False
            if self.use_docker:
                return False  # Can't continue without Docker
        
        if not self.test_server_executable():
            success = False
        
        if not self.test_json_rpc_communication():
            success = False
        
        if not self.test_tools_list():
            success = False
        
        return success
    
    def print_summary(self):
        """Print test summary with recommendations"""
        total = self.results["passed"] + self.results["failed"]
        
        print("\n" + "=" * 60)
        print("📊 Connectivity Test Summary")
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
            print("\n🎉 All connectivity tests passed!")
            print("   Your server can be reached and responds correctly.")
            print("\n🚀 Next steps:")
            print("   • Run integration tests: python tests/test_integration.py")
            print("   • Use MCP Inspector for interactive testing")
        else:
            print("\n⚠️ Some connectivity tests failed.")
            self._print_troubleshooting_tips()
    
    def _print_troubleshooting_tips(self):
        """Print troubleshooting advice"""
        print("\n💡 Troubleshooting Tips:")
        if self.use_docker:
            print("   • Ensure Docker is running: docker ps")
            print("   • Pull latest image: docker pull followthewhit3rabbit/camoufox-mcp:latest")
            print("   • Check Docker daemon status")
        else:
            print("   • Install dependencies: pip install -r requirements.txt")
            print("   • Check Python version (3.8+ required)")
            print("   • Verify camoufox_mcp_server.py exists in current directory")
        print("   • Run with --debug for detailed output")
        print("   • Check network connectivity")


def main():
    """Main function for connectivity testing"""
    use_docker = "--docker" in sys.argv
    debug = "--debug" in sys.argv
    
    tester = ConnectivityTester(use_docker=use_docker, debug=debug)
    
    try:
        success = tester.run_all_tests()
        tester.print_summary()
        sys.exit(0 if success else 1)
    
    except KeyboardInterrupt:
        print("\n\n⚠️ Tests interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n💥 Unexpected error: {e}")
        if debug:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

