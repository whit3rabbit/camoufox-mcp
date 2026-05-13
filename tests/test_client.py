import json
import base64
import os
import subprocess
import threading
import time
import urllib.parse
import uuid
import argparse

class MCPTestClient:
    def __init__(self, mode='docker', image_name="camoufox-mcp-server:latest", docker_platform=None, env=None):
        self.mode = mode
        self.image_name = image_name
        self.docker_platform = docker_platform
        self.env = env or {}
        self.process = None
        self.stdout_thread = None
        self.stderr_thread = None
        self.responses = {}
        self.stderr_lines = []

    def start_server(self):
        if self.mode == 'docker':
            print(f"Starting container from image: {self.image_name}")
            command = ["docker", "run", "-i", "--rm", "--init"]
            for key, value in self.env.items():
                command.extend(["-e", f"{key}={value}"])
            if self.docker_platform:
                command.extend(["--platform", self.docker_platform])
            command.append(self.image_name)
        else:
            print("Starting server locally...")
            command = ["node", "dist/index.js"]

        process_env = None
        if self.mode != 'docker':
            process_env = os.environ.copy()
            process_env.update(self.env)

        self.process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=process_env
        )

        self.stdout_thread = threading.Thread(target=self._read_output)
        self.stdout_thread.daemon = True
        self.stdout_thread.start()

        self.stderr_thread = threading.Thread(target=self._read_errors)
        self.stderr_thread.daemon = True
        self.stderr_thread.start()
        self._wait_for_server()

    def _wait_for_server(self, timeout=15):
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.process.poll() is not None:
                raise RuntimeError(f"Server exited early with code {self.process.returncode}")
            if any("running on stdio" in line.lower() for line in self.stderr_lines):
                return
            time.sleep(0.1)
        print("Warning: server startup message was not detected before tests started.")

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
            stripped = line.strip()
            self.stderr_lines.append(stripped)
            print(f"[Server STDERR]: {stripped}")

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

    def _call_tool(self, method, params, timeout=30):
        request_id = self.send_request("tools/call", {
            "name": method,
            "arguments": params
        })
        return self.get_response(request_id, timeout=timeout)

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

    def get_tool_text(self, response):
        content = response.get("result", {}).get("content", [])
        assert content and content[0].get("type") == "text", f"Expected text content: {response}"
        return content[0]["text"]

    def get_tool_payload(self, response):
        return json.loads(self.get_tool_text(response))

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
        tool_by_name = {tool["name"]: tool for tool in tools}
        assert set(tool_by_name) == {"browse", "browse_snapshot", "browse_sequence"}

        def assert_no_array_form_items(schema, path="$"):
            if isinstance(schema, dict):
                items = schema.get("items")
                assert not isinstance(items, list), f"Array-form JSON schema items at {path}.items"
                for key, value in schema.items():
                    assert_no_array_form_items(value, f"{path}.{key}")
            elif isinstance(schema, list):
                for index, value in enumerate(schema):
                    assert_no_array_form_items(value, f"{path}[{index}]")

        for tool in tools:
            input_schema = tool["inputSchema"]
            assert_no_array_form_items(input_schema, f"{tool['name']}.inputSchema")
            window_items = input_schema["properties"]["window"]["items"]
            assert isinstance(window_items, dict), f"{tool['name']} window.items must be an object"

        wait_strategy = tool_by_name["browse"]["inputSchema"]["properties"]["waitStrategy"]
        assert wait_strategy.get("default") == "load"
        print("ListTools test passed.")

    def _run_tool(self, name, arguments, timeout=60):
        response = self._call_tool(name, arguments, timeout=timeout)
        assert response and not response.get("result", {}).get("isError"), f"{name} call failed: {response}"
        return response

    def _run_browse(self, arguments, timeout=60):
        return self._run_tool("browse", arguments, timeout=timeout)

    def _run_snapshot(self, arguments, timeout=60):
        return self._run_tool("browse_snapshot", arguments, timeout=timeout)

    def _run_sequence(self, arguments, timeout=60):
        return self._run_tool("browse_sequence", arguments, timeout=timeout)

    def _fixture_url(self, html):
        encoded = base64.b64encode(html.encode("utf-8")).decode("ascii")
        return f"https://httpbin.org/base64/{urllib.parse.quote(encoded, safe='')}"

    def test_call_tool_browse_rejects_localhost(self):
        print("--- Running Test: Call Tool - Reject Localhost URL ---")
        response = self._call_tool("browse", {"url": "http://127.0.0.1:80"}, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Localhost URL was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool localhost rejection test passed.")

    def test_call_tool_browse_rejects_localhost_redirect(self):
        print("--- Running Test: Call Tool - Reject Redirect To Localhost ---")
        response = self._call_tool("browse", {
            "url": "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A80"
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Localhost redirect was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool localhost redirect rejection test passed.")

    def test_call_tool_browse_rejects_unsafe_options(self):
        print("--- Running Test: Call Tool - Reject Unsafe Browser Options ---")
        response = self._call_tool("browse", {
            "url": "https://www.example.com",
            "args": ["--remote-debugging-port=0"]
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Unsafe browser options were not rejected: {response}"
        assert "unsafe browser options" in self.get_tool_text(response).lower()
        print("CallTool unsafe browser options rejection test passed.")

    def test_call_tool_browse_rejects_excluded_addons(self):
        print("--- Running Test: Call Tool - Reject Excluded Addons ---")
        response = self._call_tool("browse", {
            "url": "https://www.example.com",
            "exclude_addons": ["ublock_origin"]
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Excluded addons were not rejected: {response}"
        assert "unsafe browser options" in self.get_tool_text(response).lower()
        print("CallTool excluded addons rejection test passed.")

    def test_call_tool_browse_rejects_private_proxy_string(self):
        print("--- Running Test: Call Tool - Reject Private Proxy String ---")
        response = self._call_tool("browse", {
            "url": "https://www.example.com",
            "proxy": "http://127.0.0.1:8080"
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Private proxy string was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool private proxy string rejection test passed.")

    def test_call_tool_browse_rejects_private_proxy_object(self):
        print("--- Running Test: Call Tool - Reject Private Proxy Object ---")
        response = self._call_tool("browse", {
            "url": "https://www.example.com",
            "proxy": {"server": "http://169.254.169.254:80"}
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Private proxy object was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool private proxy object rejection test passed.")

    def test_call_tool_browse_rejects_ipv6_loopback(self):
        print("--- Running Test: Call Tool - Reject IPv6 Loopback URL ---")
        response = self._call_tool("browse", {"url": "http://[::1]/"}, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"IPv6 loopback URL was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool IPv6 loopback rejection test passed.")

    def test_call_tool_browse_rejects_ipv4_mapped_loopback(self):
        print("--- Running Test: Call Tool - Reject IPv4-Mapped Loopback URL ---")
        response = self._call_tool("browse", {"url": "http://[::ffff:127.0.0.1]/"}, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"IPv4-mapped loopback URL was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool IPv4-mapped loopback rejection test passed.")

    def test_call_tool_browse_rejects_unusual_private_ip_forms(self):
        print("--- Running Test: Call Tool - Reject Unusual Private IP Forms ---")
        urls = [
            "http://2130706433/",
            "http://0177.0.0.1/",
            "http://0x7f.0.0.1/",
            "http://[::]/",
            "http://[fc00::1]/",
            "http://[fe80::1]/",
            "http://[2001:db8::1]/"
        ]
        for url in urls:
            response = self._call_tool("browse", {"url": url}, timeout=10)
            assert response and response.get("result", {}).get("isError"), f"Unusual private URL was not rejected: {url}: {response}"
            assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool unusual private IP form rejection test passed.")

    def test_call_tool_browse_rejects_special_ipv4_ranges(self):
        print("--- Running Test: Call Tool - Reject Special IPv4 Ranges ---")
        addresses = [
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1"
        ]
        for address in addresses:
            response = self._call_tool("browse", {"url": f"http://{address}/"}, timeout=10)
            assert response and response.get("result", {}).get("isError"), f"Special IPv4 URL was not rejected: {address}: {response}"
            assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool special IPv4 range rejection test passed.")

    def test_call_tool_browse_success(self):
        print("--- Running Test: Call Tool - Browse Success (No Window Param) ---")
        response = self._run_browse({"url": "https://www.example.com"})
        payload = self.get_tool_payload(response)
        assert payload["outputMode"] == "text"
        assert payload["status"] == 200
        assert "example domain" in payload["text"].lower()
        print("CallTool browse success (no window) test passed.")

    def test_call_tool_browse_metadata(self):
        print("--- Running Test: Call Tool - Browse Metadata Output ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "outputMode": "metadata"
        })
        payload = self.get_tool_payload(response)
        assert payload["outputMode"] == "metadata"
        assert payload["status"] == 200
        assert "text" not in payload
        assert "html" not in payload
        print("CallTool metadata output test passed.")

    def test_call_tool_browse_selector_text(self):
        print("--- Running Test: Call Tool - Browse Selector Text ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "selector": "h1",
            "maxChars": 1000
        })
        payload = self.get_tool_payload(response)
        assert payload["selector"] == "h1"
        assert payload["selectorFound"] is True
        assert payload["text"].strip() == "Example Domain"
        assert payload["truncated"] is False
        print("CallTool selector text test passed.")

    def test_call_tool_browse_network_diagnostics(self):
        print("--- Running Test: Call Tool - Browse Network Diagnostics ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "outputMode": "metadata",
            "includeNetwork": True
        })
        payload = self.get_tool_payload(response)
        diagnostics = payload.get("diagnostics", {})
        assert diagnostics.get("network"), f"Expected network diagnostics: {payload}"
        assert diagnostics["network"][0]["url"].startswith("https://")
        print("CallTool network diagnostics test passed.")

    def test_call_tool_browse_selector_jpeg_screenshot(self):
        print("--- Running Test: Call Tool - Browse Selector JPEG Screenshot ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "selector": "h1",
            "screenshot": True,
            "screenshotOptions": {
                "selector": "h1",
                "type": "jpeg",
                "quality": 60
            }
        })
        payload = self.get_tool_payload(response)
        screenshot = payload.get("screenshot", {})
        assert screenshot.get("included") is True, f"Expected included screenshot: {payload}"
        assert screenshot.get("type") == "jpeg"
        assert screenshot.get("selectorFound") is True
        content = response.get("result", {}).get("content", [])
        assert len(content) == 2
        assert content[1].get("mimeType") == "image/jpeg"
        print("CallTool selector JPEG screenshot test passed.")

    def test_call_tool_browse_missing_selector(self):
        print("--- Running Test: Call Tool - Browse Missing Selector ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "selector": ".does-not-exist",
            "maxChars": 1000
        })
        payload = self.get_tool_payload(response)
        assert payload["selectorFound"] is False
        assert payload["text"] == ""
        assert payload["truncated"] is False
        print("CallTool missing selector test passed.")

    def test_call_tool_snapshot_success(self):
        print("--- Running Test: Call Tool - Browse Snapshot Success ---")
        response = self._run_snapshot({
            "url": "https://www.example.com",
            "maxChars": 2000,
            "maxElements": 20
        })
        payload = self.get_tool_payload(response)
        assert payload["selectorFound"] is True
        assert "example domain" in payload["text"].lower()
        assert "ariaSnapshot" in payload, f"Expected ARIA snapshot: {payload}"
        assert payload["elements"], f"Expected snapshot elements: {payload}"
        assert any(element.get("role") == "link" for element in payload["elements"])
        print("CallTool snapshot success test passed.")

    def test_call_tool_sequence_click_link(self):
        print("--- Running Test: Call Tool - Browse Sequence Click Link ---")
        html = """<!doctype html>
<html>
<body>
  <a href="#" onclick="document.getElementById('result').textContent = 'clicked'; return false;">Click target</a>
  <p id="result">waiting</p>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "click", "selector": "a[href]"}
            ],
            "maxChars": 2000,
            "includeNetwork": True
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["actions"][0]["status"] == "ok"
        assert "clicked" in payload["text"], f"Expected click side effect: {payload}"
        assert payload["status"] and payload["status"] < 400
        assert payload.get("diagnostics", {}).get("network")
        print("CallTool sequence click link test passed.")

    def test_call_tool_sequence_form_actions(self):
        print("--- Running Test: Call Tool - Browse Sequence Form Actions ---")
        html = """<!doctype html>
<html>
<body>
  <label>Name <input id="name-field" aria-label="Name"></label>
  <label>Notes <textarea id="notes-field" aria-label="Notes"></textarea></label>
  <label>Choice <select id="choice-field" aria-label="Choice"><option value="alpha">Alpha</option><option value="beta">Beta</option></select></label>
  <p id="summary">empty</p>
  <script>
    const nameField = document.getElementById('name-field');
    const notesField = document.getElementById('notes-field');
    const choiceField = document.getElementById('choice-field');
    const summary = document.getElementById('summary');
    function update() {
      summary.textContent = `name ${nameField.value} notes ${notesField.value} choice ${choiceField.value}`;
    }
    nameField.addEventListener('input', update);
    notesField.addEventListener('input', update);
    choiceField.addEventListener('change', update);
  </script>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "fill", "selector": "#name-field", "value": "Alice"},
                {"type": "type", "selector": "#notes-field", "text": "hello"},
                {"type": "select", "selector": "#choice-field", "value": "beta"},
                {"type": "waitFor", "selector": "#summary"}
            ],
            "maxChars": 2000,
            "maxElements": 20
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert len(payload["actions"]) == 4
        assert all(action["status"] == "ok" for action in payload["actions"])
        assert "name Alice notes hello choice beta" in payload["text"]
        assert payload["snapshot"]["elements"], f"Expected final snapshot elements: {payload}"
        print("CallTool sequence form actions test passed.")

    def test_call_tool_sequence_rejects_private_redirect(self):
        print("--- Running Test: Call Tool - Browse Sequence Reject Private Redirect ---")
        response = self._call_tool("browse_sequence", {
            "url": "https://httpbin.org/redirect-to?url=http%3A%2F%2F127.0.0.1%3A80",
            "actions": []
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Private sequence redirect was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool sequence private redirect rejection test passed.")

    def test_call_tool_sequence_rejects_evaluate_by_default(self):
        print("--- Running Test: Call Tool - Browse Sequence Reject Evaluate By Default ---")
        response = self._call_tool("browse_sequence", {
            "url": "https://www.example.com",
            "actions": [
                {"type": "evaluate", "expression": "document.title"}
            ]
        }, timeout=60)
        assert response and response.get("result", {}).get("isError"), f"Evaluate action was not rejected: {response}"
        assert "evaluate action is disabled" in self.get_tool_text(response).lower()
        print("CallTool sequence evaluate rejection test passed.")

    def test_call_tool_browse_truncates_huge_text(self):
        print("--- Running Test: Call Tool - Truncate Huge Text ---")
        response = self._run_browse({
            "url": self._fixture_url("<!doctype html><body><script>document.body.textContent = 'x'.repeat(300000);</script></body>"),
            "maxChars": 1000
        }, timeout=60)
        payload = self.get_tool_payload(response)
        assert payload["truncated"] is True
        assert len(payload["text"]) == 1000
        print("CallTool huge text truncation test passed.")

    def test_call_tool_browse_truncates_huge_html(self):
        print("--- Running Test: Call Tool - Truncate Huge HTML ---")
        response = self._run_browse({
            "url": self._fixture_url("<!doctype html><body><script>for (let i = 0; i < 20000; i += 1) { const span = document.createElement('span'); span.textContent = 'abcdef'; document.body.appendChild(span); }</script></body>"),
            "outputMode": "html",
            "maxChars": 1000
        }, timeout=60)
        payload = self.get_tool_payload(response)
        assert payload["truncated"] is True
        assert len(payload["html"]) == 1000
        print("CallTool huge HTML truncation test passed.")

    def test_call_tool_browse_rejects_private_subresources(self):
        print("--- Running Test: Call Tool - Reject Private Subresources ---")
        html = """<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="https://10.0.0.1/blocked.css">
  <script src="https://10.0.0.1/blocked.js"></script>
</head>
<body>
  <iframe src="https://10.0.0.1/frame"></iframe>
  <img src="https://10.0.0.1/image.png">
  <p>private subresource fixture</p>
</body>
</html>"""
        response = self._call_tool("browse", {
            "url": self._fixture_url(html),
            "timeout": 10000
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Private subresource was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool private subresource rejection test passed.")

    def test_call_tool_browse_rejects_private_websocket(self):
        print("--- Running Test: Call Tool - Reject Private WebSocket ---")
        html = """<!doctype html>
<html>
<body>
  <script>
    window.addEventListener('load', () => {
      new WebSocket('wss://127.0.0.1:1/socket');
    });
  </script>
  <p>private websocket fixture</p>
</body>
</html>"""
        response = self._call_tool("browse", {
            "url": self._fixture_url(html),
            "timeout": 10000
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Private WebSocket was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool private WebSocket rejection test passed.")

    def test_call_tool_browse_rejects_delayed_private_navigation(self):
        print("--- Running Test: Call Tool - Reject Delayed Private Navigation ---")
        html = """<!doctype html>
<html>
<body onload="window.location.href = 'http://127.0.0.1:1/delayed';">
  <p>delayed private navigation fixture</p>
</body>
</html>"""
        response = self._call_tool("browse", {
            "url": self._fixture_url(html),
            "timeout": 10000
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Delayed private navigation was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool delayed private navigation rejection test passed.")

    def test_call_tool_browse_rejects_denylisted_unsafe_options_when_allowed(self):
        print("--- Running Test: Call Tool - Reject Denylisted Unsafe Options With Env Opt-In ---")
        unsafe_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env={"CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS": "1"}
        )
        try:
            unsafe_client.start_server()
            unsafe_client.test_handshake()
            response = unsafe_client._call_tool("browse", {
                "url": "https://www.example.com",
                "args": ["--remote-debugging-port", "0"]
            }, timeout=10)
            assert response and response.get("result", {}).get("isError"), f"Denylisted unsafe option was not rejected: {response}"
            assert "denied by server policy" in unsafe_client.get_tool_text(response).lower()
        finally:
            unsafe_client.stop_server()
        print("CallTool denylisted unsafe option rejection with env opt-in test passed.")

    def test_call_tool_browse_empty_window(self):
        print("--- Running Test: Call Tool - Browse Empty Window [] ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "window": []
        })
        payload = self.get_tool_payload(response)
        assert "example domain" in payload["text"].lower()
        print("CallTool browse with empty window test passed.")

    def test_call_tool_browse_valid_window(self):
        print("--- Running Test: Call Tool - Browse Valid Window [800, 600] ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "window": [800, 600]
        })
        payload = self.get_tool_payload(response)
        assert "example domain" in payload["text"].lower()
        print("CallTool browse with valid window test passed.")

    def test_call_tool_browse_comprehensive_empty_args(self):
        print("--- Running Test: Call Tool - Browse Comprehensive Empty/Default Args ---")
        response = self._run_browse({
            "url": "https://www.example.com",
            "viewport": {},
            "firefox_user_prefs": {},
            "exclude_addons": [],
            "window": [],
            "args": []
        })
        payload = self.get_tool_payload(response)
        assert "example domain" in payload["text"].lower()
        print("CallTool browse with comprehensive empty args test passed.")

    def run_tests(self):
        try:
            self.start_server()
            self.test_handshake()
            self.test_list_tools()
            self.test_call_tool_browse_rejects_localhost()
            self.test_call_tool_browse_rejects_localhost_redirect()
            self.test_call_tool_browse_rejects_unsafe_options()
            self.test_call_tool_browse_rejects_excluded_addons()
            self.test_call_tool_browse_rejects_private_proxy_string()
            self.test_call_tool_browse_rejects_private_proxy_object()
            self.test_call_tool_browse_rejects_ipv6_loopback()
            self.test_call_tool_browse_rejects_ipv4_mapped_loopback()
            self.test_call_tool_browse_rejects_unusual_private_ip_forms()
            self.test_call_tool_browse_rejects_special_ipv4_ranges()
            self.test_call_tool_browse_success()
            self.test_call_tool_browse_metadata()
            self.test_call_tool_browse_selector_text()
            self.test_call_tool_browse_network_diagnostics()
            self.test_call_tool_browse_selector_jpeg_screenshot()
            self.test_call_tool_browse_missing_selector()
            self.test_call_tool_snapshot_success()
            self.test_call_tool_sequence_click_link()
            self.test_call_tool_sequence_form_actions()
            self.test_call_tool_sequence_rejects_private_redirect()
            self.test_call_tool_sequence_rejects_evaluate_by_default()
            self.test_call_tool_browse_truncates_huge_text()
            self.test_call_tool_browse_truncates_huge_html()
            self.test_call_tool_browse_rejects_private_subresources()
            self.test_call_tool_browse_rejects_private_websocket()
            self.test_call_tool_browse_rejects_delayed_private_navigation()
            self.test_call_tool_browse_empty_window()
            self.test_call_tool_browse_valid_window()
            self.test_call_tool_browse_comprehensive_empty_args()
            self.test_call_tool_browse_rejects_denylisted_unsafe_options_when_allowed()
            print("\nAll tests passed!")
            return True
        except Exception as e:
            print(f"\nAn error occurred: {e}")
            return False
        finally:
            self.stop_server()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', type=str, default='docker', choices=['docker', 'local'], help='Test mode: docker or local')
    parser.add_argument('--image-name', type=str, default='camoufox-mcp-server:latest', help='Docker image name for docker mode')
    parser.add_argument('--docker-platform', type=str, help='Docker platform to pass to docker run')
    args = parser.parse_args()

    client = MCPTestClient(mode=args.mode, image_name=args.image_name, docker_platform=args.docker_platform)
    ok = client.run_tests()
    raise SystemExit(0 if ok else 1)
