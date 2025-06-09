#!/usr/bin/env python3
"""
Simple MCP server test without dependencies
Tests the Camoufox MCP server using only standard library
"""

import json
import subprocess
import sys
import time
import os


def test_server(use_docker=False, debug=False):
    """Test the MCP server"""
    print("🚀 Testing Camoufox MCP Server", flush=True)
    print("=" * 50, flush=True)
    
    # Prepare command
    if use_docker:
        cmd = [
            "docker", "run", "-i", "--rm",
            "followthewhit3rabbit/camoufox-mcp:latest",
            "--headless=true"
        ]
        print("📍 Mode: Docker", flush=True)
        print("   Note: First run may take time to download the image", flush=True)
    else:
        cmd = ["python3", "main.py", "--headless=true"]
        print("📍 Mode: Local", flush=True)
    
    if debug:
        print(f"📋 Command: {' '.join(cmd)}", flush=True)
    print("=" * 50, flush=True)
    
    # Check Docker is running if using Docker mode
    if use_docker:
        print("\n🐳 Checking Docker...", flush=True)
        try:
            result = subprocess.run(["docker", "version"], capture_output=True, timeout=5)
            if result.returncode != 0:
                print("❌ Docker is not running. Please start Docker Desktop.", flush=True)
                return
            print("✅ Docker is running", flush=True)
        except (subprocess.TimeoutExpired, FileNotFoundError):
            print("❌ Docker command not found or not responding", flush=True)
            return
    
    try:
        # Use direct echo commands for testing
        print("\n🔄 Testing with direct commands...", flush=True)
        
        # Test 1: List tools
        print("\n1️⃣ Testing tool listing...", flush=True)
        test_cmd = f'echo \'{{"jsonrpc": "2.0", "method": "tools/list", "params": {{}}, "id": 1}}\' | {" ".join(cmd)}'
        
        if debug:
            print(f"   Command: {test_cmd}", flush=True)
        
        result = subprocess.run(
            test_cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0 and result.stdout:
            print("✅ Server responded to tools/list", flush=True)
            try:
                # Try to parse the JSON response
                lines = result.stdout.strip().split('\n')
                for line in lines:
                    if line.strip() and line.startswith('{'):
                        response = json.loads(line)
                        if "result" in response:
                            tools = response["result"].get("tools", [])
                            print(f"   Found {len(tools)} tools:", flush=True)
                            for tool in tools[:5]:
                                print(f"     - {tool.get('name', 'Unknown')}", flush=True)
                            break
            except json.JSONDecodeError:
                print("   Could not parse response, but server is running", flush=True)
                if debug:
                    print(f"   Raw output: {result.stdout[:200]}...", flush=True)
        else:
            print("❌ No response from server", flush=True)
            if result.stderr:
                print(f"   Error: {result.stderr}", flush=True)
        
        # Test 2: Initialize
        print("\n2️⃣ Testing initialization...", flush=True)
        init_cmd = f'echo \'{{"jsonrpc": "2.0", "method": "initialize", "params": {{"capabilities": {{}}}}, "id": 2}}\' | {" ".join(cmd)}'
        
        result = subprocess.run(
            init_cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0 and result.stdout:
            print("✅ Server initialized successfully", flush=True)
        else:
            print("❌ Initialization failed", flush=True)
        
        print("\n✅ Basic connectivity test completed!", flush=True)
        print("\n💡 Next steps:", flush=True)
        print("   - For interactive testing: npx @modelcontextprotocol/inspector docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest", flush=True)
        print("   - For comprehensive tests: python3 tests/test_quick.py --docker", flush=True)
        
    except subprocess.TimeoutExpired:
        print("\n❌ Command timed out. The Docker image might be downloading.", flush=True)
        print("   Try running: docker pull followthewhit3rabbit/camoufox-mcp:latest", flush=True)
    except KeyboardInterrupt:
        print("\n⚠️  Test interrupted by user", flush=True)
    except Exception as e:
        print(f"\n❌ Test failed with error: {e}", flush=True)
        if debug:
            import traceback
            traceback.print_exc()


if __name__ == "__main__":
    use_docker = "--docker" in sys.argv
    debug = "--debug" in sys.argv
    
    if "--help" in sys.argv or "-h" in sys.argv:
        print("Usage: python3 test_simple.py [--docker] [--debug]")
        print("  --docker  Test using Docker container")
        print("  --debug   Show debug output")
        sys.exit(0)
    
    test_server(use_docker, debug)
