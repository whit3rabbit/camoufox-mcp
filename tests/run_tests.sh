#!/bin/bash
# run_tests.sh - Working test runner for camoufox-mcp-server

set -e

echo "Building Docker image: camoufox-mcp-server:latest"

# Build with buildkit for better caching
DOCKER_BUILDKIT=1 docker build -t camoufox-mcp-server:latest .

echo "Running Python test client..."

# Python test with proper handling
python3 - << 'EOF'
import subprocess
import json
import sys
import time
import threading
from uuid import uuid4

class MCPDockerTester:
    def __init__(self):
        self.process = None
        self.stderr_lines = []
        self.stdout_lines = []
        
    def read_stderr(self):
        """Read stderr in separate thread"""
        while self.process and self.process.poll() is None:
            line = self.process.stderr.readline()
            if line:
                self.stderr_lines.append(line.strip())
                print(f"[Server STDERR]: {line.strip()}", file=sys.stderr)
                
    def read_stdout(self):
        """Read stdout in separate thread"""
        while self.process and self.process.poll() is None:
            line = self.process.stdout.readline()
            if line:
                self.stdout_lines.append(line.strip())
                
    def start_container(self):
        """Start the Docker container"""
        cmd = ['docker', 'run', '-i', '--rm', '--init', 'camoufox-mcp-server:latest']
        
        print(f"Starting container from image: camoufox-mcp-server:latest")
        self.process = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0
        )
        
        # Start reader threads
        stderr_thread = threading.Thread(target=self.read_stderr)
        stdout_thread = threading.Thread(target=self.read_stdout)
        stderr_thread.daemon = True
        stdout_thread.daemon = True
        stderr_thread.start()
        stdout_thread.start()
        
        # Wait for server to be ready
        print("Waiting for server to start...")
        start_time = time.time()
        while time.time() - start_time < 10:
            if any("running on stdio" in line.lower() for line in self.stderr_lines):
                print("Server is ready!")
                return True
            time.sleep(0.1)
            
        print("Warning: Server startup message not detected")
        return True
        
    def send_request(self, request):
        """Send a JSON-RPC request"""
        request_str = json.dumps(request)
        print(f"Sending request: {request_str}")
        self.process.stdin.write(request_str + '\n')
        self.process.stdin.flush()
        
    def wait_for_response(self, request_id, timeout=10):
        """Wait for a response with specific ID"""
        start_time = time.time()
        while time.time() - start_time < timeout:
            for line in self.stdout_lines:
                try:
                    response = json.loads(line)
                    if response.get('id') == request_id:
                        return response
                except:
                    continue
            time.sleep(0.1)
        return None
        
    def test_handshake(self):
        """Test the MCP handshake"""
        print("\n--- Running Test: Handshake ---")
        
        # Send initialize
        init_id = str(uuid4())
        self.send_request({
            "jsonrpc": "2.0",
            "id": init_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0.0"
                }
            }
        })
        
        # Wait for response
        response = self.wait_for_response(init_id)
        if response:
            print(f"✓ Received initialize response: {json.dumps(response, indent=2)}")
            
            # Send initialized notification
            self.send_request({
                "jsonrpc": "2.0",
                "method": "initialized",
                "params": {}
            })
            print("✓ Sent initialized notification")
            return True
        else:
            print("✗ No initialize response received")
            return False
            
    def test_browse(self):
        """Test the browse tool"""
        print("\n--- Running Test: Browse Tool ---")
        
        browse_id = str(uuid4())
        self.send_request({
            "jsonrpc": "2.0",
            "id": browse_id,
            "method": "tools/call",
            "params": {
                "name": "browse",
                "arguments": {
                    "url": "https://example.com"
                }
            }
        })
        
        # Browse might take longer
        response = self.wait_for_response(browse_id, timeout=30)
        if response:
            print("✓ Browse tool responded successfully")
            return True
        else:
            print("✗ Browse tool did not respond")
            return False
            
    def cleanup(self):
        """Clean up the container"""
        if self.process:
            print("\nTerminating container...")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                
    def run_tests(self):
        """Run all tests"""
        try:
            if not self.start_container():
                return False
                
            handshake_ok = self.test_handshake()
            
            if handshake_ok:
                self.test_browse()
                
            return handshake_ok
            
        except Exception as e:
            print(f"An error occurred: {e}")
            return False
        finally:
            self.cleanup()

# Run the tests
if __name__ == "__main__":
    tester = MCPDockerTester()
    success = tester.run_tests()
    sys.exit(0 if success else 1)
EOF