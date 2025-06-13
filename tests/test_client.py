import json
import subprocess
import threading
import time
import uuid
import argparse

class MCPTestClient:
    def __init__(self, mode='docker', image_name="camoufox-mcp-server:latest"):
        self.mode = mode
        self.image_name = image_name
        self.process = None
        self.stdout_thread = None
        self.stderr_thread = None
        self.responses = {}

    def start_server(self):
        if self.mode == 'docker':
            print(f"Starting container from image: {self.image_name}")
            command = ["docker", "run", "-i", "--rm", self.image_name]
        else:
            print("Starting server locally...")
            command = ["node", "dist/index.js"]

        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        self.stdout_thread = threading.Thread(target=self._read_output)
        self.stdout_thread.daemon = True
        self.stdout_thread.start()

        self.stderr_thread = threading.Thread(target=self._read_errors)
        self.stderr_thread.daemon = True
        self.stderr_thread.start()
        time.sleep(5)  # Give the server time to start

    def _read_output(self):
        for line in self.process.stdout:
            try:
                response = json.loads(line)
                request_id = response.get("id")
                if request_id:
                    self.responses[request_id] = response
            except json.JSONDecodeError:
                print(f"[Server STDOUT]: {line.strip()}")

    def _read_errors(self):
        for line in self.process.stderr:
            print(f"[Server STDERR]: {line.strip()}")

    def send_request(self, method, params):
        request_id = str(uuid.uuid4())
        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params
        }
        print(f"Sending request: {json.dumps(request)}")
        self.process.stdin.write(json.dumps(request) + "\n")
        self.process.stdin.flush()
        return request_id

    def send_notification(self, method, params):
        notification = {
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        }
        print(f"Sending notification: {json.dumps(notification)}")
        self.process.stdin.write(json.dumps(notification) + "\n")
        self.process.stdin.flush()

    def get_response(self, request_id, timeout=30):
        start_time = time.time()
        while time.time() - start_time < timeout:
            if request_id in self.responses:
                return self.responses.pop(request_id)
            time.sleep(0.1)
        return None

    def stop_server(self):
        if self.process:
            self.process.terminate()
            self.process.wait()
        print("Server stopped.")

    def test_handshake(self):
        print("--- Running Test: Handshake ---")
        # 1. Client sends InitializeRequest
        init_id = self.send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        })
        init_response = self.get_response(init_id)
        assert init_response and "result" in init_response, "Handshake failed at InitializeRequest"
        print("InitializeRequest successful.")

        # 2. Client sends InitializedNotification (no ID)
        self.send_notification("initialized", {})
        print("InitializedNotification sent.")
        time.sleep(1) # Allow server to process notification
        print("Handshake complete!")

    def test_list_tools(self):
        print("--- Running Test: List Tools ---")
        request_id = self.send_request("tools/list", {})
        response = self.get_response(request_id)
        assert response and response.get("result", {}).get("tools")
        tools = response["result"]["tools"]
        assert len(tools) == 1
        assert tools[0]["name"] == "browse"
        print("ListTools test passed.")

    def test_call_tool_browse_success(self):
        print("--- Running Test: Call Tool - Browse Success (No Window Param) ---")
        params = {
            "name": "browse",
            "arguments": {"url": "https://www.example.com"}
        }
        request_id = self.send_request("tools/call", params)
        response = self.get_response(request_id, timeout=60)
        assert response and not response.get("result", {}).get("isError"), f"Browse (no window) failed: {response.get('error')}"
        content = response.get("result", {}).get("content", [])
        assert content and "example" in content[0]["text"].lower()
        print("CallTool browse success (no window) test passed.")

    def test_call_tool_browse_empty_window(self):
        print("--- Running Test: Call Tool - Browse Empty Window [] ---")
        params = {
            "name": "browse",
            "arguments": {
                "url": "https://www.example.com",
                "window": []
            }
        }
        request_id = self.send_request("tools/call", params)
        response = self.get_response(request_id, timeout=60)
        assert response and not response.get("result", {}).get("isError"), f"Browse with empty window failed: {response.get('error')}"
        content = response.get("result", {}).get("content", [])
        assert content and "example" in content[0]["text"].lower()
        print("CallTool browse with empty window test passed.")

    def test_call_tool_browse_valid_window(self):
        print("--- Running Test: Call Tool - Browse Valid Window [800, 600] ---")
        params = {
            "name": "browse",
            "arguments": {
                "url": "https://www.example.com",
                "window": [800, 600]
            }
        }
        request_id = self.send_request("tools/call", params)
        response = self.get_response(request_id, timeout=60)
        assert response and not response.get("result", {}).get("isError"), f"Browse with valid window failed: {response.get('error')}"
        content = response.get("result", {}).get("content", [])
        assert content and "example" in content[0]["text"].lower()
        print("CallTool browse with valid window test passed.")

    def test_call_tool_browse_comprehensive_empty_args(self):
        print("--- Running Test: Call Tool - Browse Comprehensive Empty/Default Args ---")
        params = {
            "name": "browse",
            "arguments": {
                "url": "https://www.example.com",
                "viewport": {},
                "firefox_user_prefs": {},
                "exclude_addons": [],
                "window": [],
                "args": []
            }
        }
        request_id = self.send_request("tools/call", params)
        response = self.get_response(request_id, timeout=60)
        assert response and not response.get("result", {}).get("isError"), f"Browse with comprehensive empty args failed: {response.get('error')}"
        content = response.get("result", {}).get("content", [])
        assert content and "example" in content[0]["text"].lower()
        print("CallTool browse with comprehensive empty args test passed.")

    def test_call_tool_browse_valid_window(self): # This is the original test, renamed for clarity in my thought process, but will be replaced by the new one above.
        print("--- Running Test: Call Tool - Browse Valid Window [800, 600] ---")
        params = {
            "name": "browse",
            "arguments": {
                "url": "https://www.example.com",
                "window": [800, 600]
            }
        }
        request_id = self.send_request("tools/call", params)
        response = self.get_response(request_id, timeout=60)
        assert response and not response.get("result", {}).get("isError"), f"Browse with valid window failed: {response.get('error')}"
        content = response.get("result", {}).get("content", [])
        assert content and "example" in content[0]["text"].lower()
        print("CallTool browse with valid window test passed.")

    def test_call_tool_browse_success(self): # This is the original test, renamed for clarity in my thought process, but will be replaced by the new one above.
        print("--- Running Test: Call Tool - Browse Success ---")
        params = {
            "name": "browse",
            "arguments": {"url": "https://www.example.com"}
        }
        request_id = self.send_request("tools/call", params)
        response = self.get_response(request_id, timeout=60)
        assert response and not response.get("result", {}).get("isError")
        content = response.get("result", {}).get("content", [])
        assert content and "example" in content[0]["text"].lower()
        print("CallTool browse success test passed.")

    def run_tests(self):
        try:
            self.start_server()
            self.test_handshake()
            self.test_list_tools()
            self.test_call_tool_browse_success() # Original success test (no window param)
            self.test_call_tool_browse_empty_window()
            self.test_call_tool_browse_valid_window()
            self.test_call_tool_browse_comprehensive_empty_args()
            print("\nAll tests passed!")
        except Exception as e:
            print(f"\nAn error occurred: {e}")
        finally:
            self.stop_server()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', type=str, default='docker', choices=['docker', 'local'], help='Test mode: docker or local')
    args = parser.parse_args()

    client = MCPTestClient(mode=args.mode)
    client.run_tests()
