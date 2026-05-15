import sys
sys.dont_write_bytecode = True

import json
import os
import subprocess
import threading
import time
import urllib.parse
import uuid
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


TEST_ENV = {
    "NODE_ENV": "test",
    "CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST": "1",
}


class FixtureServer:
    def __init__(self, mode):
        self.mode = mode
        self.fixtures = {}
        self.httpd = None
        self.thread = None
        self.base_url = None

    def start(self):
        if self.httpd:
            return

        fixtures = self.fixtures

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                parsed = urllib.parse.urlparse(self.path)
                if parsed.path == "/example":
                    self._send_html("""<!doctype html>
<html>
<head><title>Example Domain</title></head>
<body>
  <h1>Example Domain</h1>
  <p>This domain is for use in illustrative examples in documents.</p>
  <p><a href="/more">More information</a></p>
</body>
</html>""")
                    return

                if parsed.path == "/redirect-to":
                    target = urllib.parse.parse_qs(parsed.query).get("url", [""])[0]
                    self.send_response(302)
                    self.send_header("Location", target)
                    self.end_headers()
                    return

                if parsed.path == "/slow":
                    seconds = float(urllib.parse.parse_qs(parsed.query).get("seconds", ["6"])[0])
                    time.sleep(seconds)
                    self._send_html("<!doctype html><html><body>slow fixture</body></html>")
                    return

                if parsed.path.startswith("/recaptcha/"):
                    self._send_html("<!doctype html><html><body>captcha frame</body></html>")
                    return

                if parsed.path.startswith("/fixture/"):
                    fixture_id = parsed.path.rsplit("/", 1)[-1]
                    html = fixtures.get(fixture_id)
                    if html is None:
                        self.send_error(404)
                        return
                    self._send_html(html)
                    return

                self.send_error(404)

            def _send_html(self, html):
                body = html.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, fmt, *args):
                return

        self.httpd = ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        port = self.httpd.server_address[1]
        browser_host = "host.docker.internal" if self.mode == "docker" else "127.0.0.1"
        self.base_url = f"http://{browser_host}:{port}"
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        if not self.httpd:
            return
        self.httpd.shutdown()
        self.httpd.server_close()
        if self.thread:
            self.thread.join(timeout=5)
        self.httpd = None
        self.thread = None
        self.base_url = None

    def url(self, path):
        self.start()
        return f"{self.base_url}{path}"

    def fixture_url(self, html):
        self.start()
        fixture_id = str(uuid.uuid4())
        self.fixtures[fixture_id] = html
        return f"{self.base_url}/fixture/{fixture_id}"

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
        self.fixture_server = FixtureServer(mode)

    def start_server(self):
        self.fixture_server.start()
        server_env = dict(self.env)
        if server_env.get("CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST") == "1" and "CAMOUFOX_MCP_TEST_ALLOWED_LOCALHOST_PORTS" not in server_env:
            parsed_fixture_url = urllib.parse.urlparse(self.fixture_server.base_url)
            server_env["CAMOUFOX_MCP_TEST_ALLOWED_LOCALHOST_PORTS"] = str(parsed_fixture_url.port)

        if self.mode == 'docker':
            print(f"Starting container from image: {self.image_name}")
            command = [
                "docker",
                "run",
                "-i",
                "--rm",
                "--init",
                "--add-host",
                "host.docker.internal:host-gateway",
            ]
            for key, value in server_env.items():
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
            process_env.update(server_env)

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
            self.process = None
        self.fixture_server.stop()
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
        expected_tools = {
            "camoufox_status",
            "browse",
            "browse_snapshot",
            "browse_sequence",
            "browse_links",
            "browse_forms",
            "browse_outline",
            "browse_find",
            "browse_screenshot",
            "browse_console",
            "browse_network_summary",
            "browse_session_start",
            "browse_session_navigate",
            "browse_session_action",
            "browse_session_snapshot",
            "browse_session_resume",
            "browse_session_close",
        }
        assert set(tool_by_name) == expected_tools

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
            window_schema = input_schema.get("properties", {}).get("window")
            if window_schema:
                window_items = window_schema["items"]
                assert isinstance(window_items, dict), f"{tool['name']} window.items must be an object"
            assert "annotations" in tool, f"{tool['name']} should expose annotations"
            assert "outputSchema" in tool, f"{tool['name']} should expose output schema"

        wait_strategy = tool_by_name["browse"]["inputSchema"]["properties"]["waitStrategy"]
        assert wait_strategy.get("default") == "load"
        assert tool_by_name["browse"]["annotations"]["readOnlyHint"] is True
        assert tool_by_name["browse_sequence"]["annotations"]["readOnlyHint"] is False

        expected_output_properties = {
            "camoufox_status": {"version", "browser", "activeSessions", "evaluateAllowed"},
            "browse_links": {"url", "selectorFound", "links", "maxLinks"},
            "browse_forms": {"url", "selectorFound", "forms", "maxForms", "maxFields"},
            "browse_outline": {"url", "selectorFound", "headings", "landmarks"},
            "browse_find": {"url", "query", "matches", "contextChars"},
            "browse_network_summary": {"url", "requests", "statusCounts", "topFailures"},
        }
        for tool_name, properties in expected_output_properties.items():
            output_properties = tool_by_name[tool_name]["outputSchema"].get("properties", {})
            missing = properties - set(output_properties)
            assert not missing, f"{tool_name} output schema missing properties: {missing}"

        def find_property_schema(schema, property_name):
            if isinstance(schema, dict):
                properties = schema.get("properties")
                if isinstance(properties, dict) and property_name in properties:
                    return properties[property_name]
                for value in schema.values():
                    found = find_property_schema(value, property_name)
                    if found:
                        return found
            elif isinstance(schema, list):
                for value in schema:
                    found = find_property_schema(value, property_name)
                    if found:
                        return found
            return None

        click_mode_schema = find_property_schema(tool_by_name["browse_sequence"]["inputSchema"], "clickMode")
        assert click_mode_schema, "browse_sequence click action should expose clickMode"
        assert set(click_mode_schema.get("enum", [])) == {"dom", "pointer"}
        assert click_mode_schema.get("default") == "dom"

        expected_captcha_policies = {"detect", "pause", "fail", "attempt"}
        for tool_name, tool in tool_by_name.items():
            captcha_schema = tool["inputSchema"].get("properties", {}).get("captchaPolicy")
            if captcha_schema:
                captcha_policies = set(captcha_schema.get("enum", []))
                assert captcha_policies == expected_captcha_policies, (
                    f"{tool_name} captchaPolicy enum mismatch: {captcha_schema}"
                )
                assert "solve" not in captcha_policies, f"{tool_name} must not expose solve policy"
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

    def _run_status(self, timeout=10):
        return self._run_tool("camoufox_status", {}, timeout=timeout)

    def _run_links(self, arguments, timeout=60):
        return self._run_tool("browse_links", arguments, timeout=timeout)

    def _run_forms(self, arguments, timeout=60):
        return self._run_tool("browse_forms", arguments, timeout=timeout)

    def _run_outline(self, arguments, timeout=60):
        return self._run_tool("browse_outline", arguments, timeout=timeout)

    def _run_find(self, arguments, timeout=60):
        return self._run_tool("browse_find", arguments, timeout=timeout)

    def _run_screenshot(self, arguments, timeout=60):
        return self._run_tool("browse_screenshot", arguments, timeout=timeout)

    def _run_console(self, arguments, timeout=60):
        return self._run_tool("browse_console", arguments, timeout=timeout)

    def _run_network_summary(self, arguments, timeout=60):
        return self._run_tool("browse_network_summary", arguments, timeout=timeout)

    def _url(self, path):
        return self.fixture_server.url(path)

    def _example_url(self):
        return self._url("/example")

    def _fixture_url(self, html):
        return self.fixture_server.fixture_url(html)

    def _test_env(self, extra=None):
        env = dict(TEST_ENV)
        env.update(extra or {})
        return env

    def test_call_tool_status(self):
        print("--- Running Test: Call Tool - Status ---")
        response = self._run_status()
        text = self.get_tool_text(response)
        assert "\n" not in text, f"Expected minified JSON text content: {text}"
        payload = self.get_tool_payload(response)
        assert payload["browser"] == "camoufox"
        assert payload["version"]
        assert isinstance(payload["browserAvailable"], bool)
        assert payload["queuedRequests"] == 0
        assert payload["maxConcurrency"] >= 1
        assert payload["maxSessions"] >= 1
        assert payload["unsafeOptionsAllowed"] is False
        assert payload["evaluateAllowed"] is False
        assert response.get("result", {}).get("structuredContent", {}).get("browser") == "camoufox"
        print("CallTool status test passed.")

    def test_call_tool_browse_rejects_localhost(self):
        print("--- Running Test: Call Tool - Reject Localhost URL ---")
        strict_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env={}
        )
        try:
            strict_client.start_server()
            strict_client.test_handshake()
            response = strict_client._call_tool("browse", {"url": "http://127.0.0.1:80"}, timeout=10)
            assert response and response.get("result", {}).get("isError"), f"Localhost URL was not rejected: {response}"
            assert "not allowed" in strict_client.get_tool_text(response).lower()
        finally:
            strict_client.stop_server()
        print("CallTool localhost rejection test passed.")

    def test_call_tool_browse_rejects_localhost_redirect(self):
        print("--- Running Test: Call Tool - Reject Redirect To Localhost ---")
        response = self._call_tool("browse", {
            "url": self._url("/redirect-to?url=http%3A%2F%2F127.0.0.1%3A80")
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Localhost redirect was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool localhost redirect rejection test passed.")

    def test_call_tool_browse_rejects_unsafe_options(self):
        print("--- Running Test: Call Tool - Reject Unsafe Browser Options ---")
        response = self._call_tool("browse", {
            "url": self._example_url(),
            "args": ["--remote-debugging-port=0"]
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Unsafe browser options were not rejected: {response}"
        assert "unsafe browser options" in self.get_tool_text(response).lower()
        print("CallTool unsafe browser options rejection test passed.")

    def test_call_tool_browse_rejects_excluded_addons(self):
        print("--- Running Test: Call Tool - Reject Excluded Addons ---")
        response = self._call_tool("browse", {
            "url": self._example_url(),
            "exclude_addons": ["ublock_origin"]
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Excluded addons were not rejected: {response}"
        assert "unsafe browser options" in self.get_tool_text(response).lower()
        print("CallTool excluded addons rejection test passed.")

    def test_call_tool_browse_rejects_private_proxy_string(self):
        print("--- Running Test: Call Tool - Reject Private Proxy String ---")
        response = self._call_tool("browse", {
            "url": self._example_url(),
            "proxy": "http://127.0.0.1:8080"
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Private proxy string was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool private proxy string rejection test passed.")

    def test_call_tool_browse_rejects_private_proxy_object(self):
        print("--- Running Test: Call Tool - Reject Private Proxy Object ---")
        response = self._call_tool("browse", {
            "url": self._example_url(),
            "proxy": {"server": "http://169.254.169.254:80"}
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Private proxy object was not rejected: {response}"
        assert "not allowed" in self.get_tool_text(response).lower()
        print("CallTool private proxy object rejection test passed.")

    def test_call_tool_browse_rejects_ipv6_loopback(self):
        print("--- Running Test: Call Tool - Reject IPv6 Loopback URL ---")
        strict_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env={}
        )
        try:
            strict_client.start_server()
            strict_client.test_handshake()
            response = strict_client._call_tool("browse", {"url": "http://[::1]/"}, timeout=10)
            assert response and response.get("result", {}).get("isError"), f"IPv6 loopback URL was not rejected: {response}"
            assert "not allowed" in strict_client.get_tool_text(response).lower()
        finally:
            strict_client.stop_server()
        print("CallTool IPv6 loopback rejection test passed.")

    def test_call_tool_browse_rejects_ipv4_mapped_loopback(self):
        print("--- Running Test: Call Tool - Reject IPv4-Mapped Loopback URL ---")
        strict_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env={}
        )
        try:
            strict_client.start_server()
            strict_client.test_handshake()
            response = strict_client._call_tool("browse", {"url": "http://[::ffff:127.0.0.1]/"}, timeout=10)
            assert response and response.get("result", {}).get("isError"), f"IPv4-mapped loopback URL was not rejected: {response}"
            assert "not allowed" in strict_client.get_tool_text(response).lower()
        finally:
            strict_client.stop_server()
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
            "http://[64:ff9b::1]/",
            "http://[100::1]/",
            "http://[2001::1]/",
            "http://[2001:2::1]/",
            "http://[2001:db8::1]/",
            "http://[2002::1]/"
        ]
        strict_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env={}
        )
        try:
            strict_client.start_server()
            strict_client.test_handshake()
            for url in urls:
                response = strict_client._call_tool("browse", {"url": url}, timeout=10)
                assert response and response.get("result", {}).get("isError"), f"Unusual private URL was not rejected: {url}: {response}"
                assert "not allowed" in strict_client.get_tool_text(response).lower()
        finally:
            strict_client.stop_server()
        print("CallTool unusual private IP form rejection test passed.")

    def test_call_tool_browse_rejects_special_ipv4_ranges(self):
        print("--- Running Test: Call Tool - Reject Special IPv4 Ranges ---")
        addresses = [
            "10.0.0.1",
            "172.16.0.1",
            "192.168.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "192.0.0.1",
            "192.0.2.1",
            "192.88.99.1",
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
        response = self._run_browse({"url": self._example_url()})
        payload = self.get_tool_payload(response)
        assert payload["outputMode"] == "text"
        assert payload["status"] == 200
        assert "example domain" in payload["text"].lower()
        print("CallTool browse success (no window) test passed.")

    def test_call_tool_browse_metadata(self):
        print("--- Running Test: Call Tool - Browse Metadata Output ---")
        response = self._run_browse({
            "url": self._example_url(),
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
            "url": self._example_url(),
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
            "url": self._example_url(),
            "outputMode": "metadata",
            "includeNetwork": True
        })
        payload = self.get_tool_payload(response)
        diagnostics = payload.get("diagnostics", {})
        assert diagnostics.get("network"), f"Expected network diagnostics: {payload}"
        assert diagnostics["network"][0]["url"].startswith("http://")
        print("CallTool network diagnostics test passed.")

    def test_call_tool_browse_selector_jpeg_screenshot(self):
        print("--- Running Test: Call Tool - Browse Selector JPEG Screenshot ---")
        html = """<!doctype html>
<html>
<body>
  <h1 style="display:inline-block;width:320px;height:80px;margin:0">Screenshot target</h1>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
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

    def test_call_tool_focused_extractors(self):
        print("--- Running Test: Call Tool - Focused Extractors ---")
        html = """<!doctype html>
<html>
<head><title>Extractor Fixture</title><meta name="description" content="Focused extractor page"></head>
<body>
  <nav><a href="/pricing">Pricing</a><a href="https://example.org/docs">Docs</a></nav>
  <main>
    <h1>Docs</h1>
    <h2>Install</h2>
    <p>Install the package with npm before running the browser.</p>
    <form id="login-form">
      <label>Email <input name="email" type="email" required placeholder="you@example.com"></label>
      <label>Role <select name="role"><option value="admin">Admin</option><option value="user">User</option></select></label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>"""
        url = self._fixture_url(html)

        links = self.get_tool_payload(self._run_links({"url": url, "maxLinks": 10}, timeout=90))
        assert any(link["text"] == "Pricing" for link in links["links"]), f"Expected Pricing link: {links}"
        assert links["selectorFound"] is True

        forms = self.get_tool_payload(self._run_forms({"url": url, "maxForms": 5, "maxFields": 10}, timeout=90))
        assert forms["forms"], f"Expected forms: {forms}"
        field_names = {field.get("name") for form in forms["forms"] for field in form["fields"]}
        assert "email" in field_names
        assert "role" in field_names
        assert forms["forms"][0]["submit"]["text"] == "Sign in"

        outline = self.get_tool_payload(self._run_outline({"url": url, "maxItems": 10}, timeout=90))
        assert outline["description"] == "Focused extractor page"
        assert any(heading["text"] == "Install" and heading["level"] == 2 for heading in outline["headings"])
        assert "nav" in outline["landmarks"] or "navigation" in outline["landmarks"]

        found = self.get_tool_payload(self._run_find({
            "url": url,
            "query": "npm",
            "maxMatches": 3,
            "contextChars": 80
        }, timeout=90))
        assert found["matches"], f"Expected find matches: {found}"
        assert "npm" in found["matches"][0]["text"].lower()
        print("CallTool focused extractors test passed.")

    def test_call_tool_screenshot_tool(self):
        print("--- Running Test: Call Tool - Screenshot Tool ---")
        html = """<!doctype html>
<html>
<body>
  <h1 style="display:inline-block;width:320px;height:80px;margin:0">Screenshot target</h1>
</body>
</html>"""
        response = self._run_screenshot({
            "url": self._fixture_url(html),
            "selector": "h1",
            "type": "jpeg",
            "quality": 70
        })
        payload = self.get_tool_payload(response)
        assert payload["screenshot"]["included"] is True, f"Expected screenshot: {payload}"
        assert payload["screenshot"]["selectorFound"] is True
        content = response.get("result", {}).get("content", [])
        assert len(content) == 2
        assert content[1].get("mimeType") == "image/jpeg"
        print("CallTool screenshot tool test passed.")

    def test_call_tool_console_and_network_summary(self):
        print("--- Running Test: Call Tool - Console And Network Summary ---")
        html = """<!doctype html>
<html>
<body>
  <script>console.log('diagnostic fixture message');</script>
  <p>diagnostics</p>
</body>
</html>"""
        console_payload = self.get_tool_payload(self._run_console({"url": self._fixture_url(html)}, timeout=90))
        assert any("diagnostic fixture message" in entry["text"] for entry in console_payload["console"]), console_payload

        network_payload = self.get_tool_payload(self._run_network_summary({
            "url": self._example_url(),
            "maxFailures": 5
        }, timeout=90))
        assert network_payload["requests"] >= 1, f"Expected network requests: {network_payload}"
        assert "200" in network_payload["statusCounts"], f"Expected status count: {network_payload}"
        print("CallTool console and network summary test passed.")

    def test_call_tool_browse_rejects_oversize_fullpage_screenshot(self):
        print("--- Running Test: Call Tool - Reject Oversize Full-Page Screenshot ---")
        html = """<!doctype html>
<html>
<body style="margin:0">
  <main style="height:3000px;width:100%;background:#eee">tall page</main>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "screenshot": True,
            "screenshotOptions": {
                "fullPage": True
            },
            "maxChars": 1000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        screenshot = payload.get("screenshot", {})
        assert screenshot.get("included") is False, f"Expected omitted screenshot: {payload}"
        assert "dimension policy" in screenshot.get("error", ""), f"Expected dimension policy error: {payload}"
        assert len(response.get("result", {}).get("content", [])) == 1
        print("CallTool oversize full-page screenshot rejection test passed.")

    def test_call_tool_browse_rejects_oversize_selector_screenshot(self):
        print("--- Running Test: Call Tool - Reject Oversize Selector Screenshot ---")
        html = """<!doctype html>
<html>
<body style="margin:0">
  <div id="large" style="width:2200px;height:1200px;background:#ddd">large target</div>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "screenshot": True,
            "screenshotOptions": {
                "selector": "#large"
            },
            "maxChars": 1000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        screenshot = payload.get("screenshot", {})
        assert screenshot.get("included") is False, f"Expected omitted screenshot: {payload}"
        assert screenshot.get("selectorFound") is True
        assert "dimension policy" in screenshot.get("error", ""), f"Expected dimension policy error: {payload}"
        print("CallTool oversize selector screenshot rejection test passed.")

    def test_call_tool_browse_missing_selector(self):
        print("--- Running Test: Call Tool - Browse Missing Selector ---")
        response = self._run_browse({
            "url": self._example_url(),
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
            "url": self._example_url(),
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

    def test_call_tool_snapshot_does_not_truncate_only_hidden_candidates(self):
        print("--- Running Test: Call Tool - Snapshot Hidden Candidates Not Truncated ---")
        hidden = "".join("<button style='display:none'>Hidden</button>" for _ in range(10))
        html = f"""<!doctype html>
<html>
<body>
  <button id="visible">Visible</button>
  {hidden}
</body>
</html>"""
        response = self._run_snapshot({
            "url": self._fixture_url(html),
            "maxChars": 1000,
            "maxElements": 5
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert len(payload["elements"]) == 1, f"Expected one visible element: {payload}"
        assert payload["elementsTruncated"] is False, f"Hidden candidates should not imply truncation: {payload}"
        print("CallTool snapshot hidden candidates truncation test passed.")

    def test_call_tool_browse_separates_adjacent_inline_text(self):
        print("--- Running Test: Call Tool - Browse Separates Adjacent Inline Text ---")
        html = """<!doctype html>
<html>
<body><span>Hello</span><span>World</span></body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "maxChars": 1000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["text"].strip() == "Hello World", f"Expected separated inline text: {payload}"
        print("CallTool adjacent inline text spacing test passed.")

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

    def test_call_tool_session_flow_and_max_sessions(self):
        print("--- Running Test: Call Tool - Session Flow And Max Sessions ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            second_response = self._call_tool("browse_session_start", {}, timeout=10)
            assert second_response and second_response.get("result", {}).get("isError"), second_response
            assert "too many active sessions" in self.get_tool_text(second_response).lower()

            html = """<!doctype html>
<html>
<body>
  <button id="inc" onclick="document.getElementById('result').textContent = 'count 1';">Increment</button>
  <p id="result">count 0</p>
</body>
</html>"""
            navigate = self._run_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._fixture_url(html),
                "maxChars": 1000
            }, timeout=90)
            navigate_payload = self.get_tool_payload(navigate)
            assert navigate_payload["sessionId"] == session_id
            assert "count 0" in navigate_payload["text"]

            action = self._run_tool("browse_session_action", {
                "sessionId": session_id,
                "action": {"type": "click", "selector": "#inc"},
                "maxChars": 1000,
                "maxElements": 20
            }, timeout=90)
            action_payload = self.get_tool_payload(action)
            assert action_payload["action"]["status"] == "ok"
            assert "count 1" in action_payload["snapshot"]["text"]

            snapshot = self._run_tool("browse_session_snapshot", {
                "sessionId": session_id,
                "maxChars": 1000,
                "maxElements": 20
            }, timeout=90)
            snapshot_payload = self.get_tool_payload(snapshot)
            assert "count 1" in snapshot_payload["text"]
        finally:
            close_response = self._run_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert self.get_tool_payload(close_response)["closed"] is True
        print("CallTool session flow and max sessions test passed.")

    def test_call_tool_session_serializes_overlapping_operations(self):
        print("--- Running Test: Call Tool - Session Serializes Overlapping Operations ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            html = """<!doctype html>
<html>
<body>
  <p>waiting</p>
  <script>
    setTimeout(() => {
      const ready = document.createElement('p');
      ready.id = 'ready';
      ready.textContent = 'ready from queued action';
      document.body.appendChild(ready);
    }, 1200);
  </script>
</body>
</html>"""
            navigate = self._run_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._fixture_url(html),
                "maxChars": 1000
            }, timeout=90)
            assert "waiting" in self.get_tool_payload(navigate)["text"]

            action_id = self.send_request("tools/call", {
                "name": "browse_session_action",
                "arguments": {
                    "sessionId": session_id,
                    "action": {"type": "waitFor", "selector": "#ready", "timeout": 5000},
                    "maxChars": 1000,
                    "maxElements": 20
                }
            })
            snapshot_id = self.send_request("tools/call", {
                "name": "browse_session_snapshot",
                "arguments": {
                    "sessionId": session_id,
                    "maxChars": 1000,
                    "maxElements": 20
                }
            })
            action_response = self.get_response(action_id, timeout=90)
            snapshot_response = self.get_response(snapshot_id, timeout=90)
            assert action_response and not action_response.get("result", {}).get("isError"), action_response
            assert snapshot_response and not snapshot_response.get("result", {}).get("isError"), snapshot_response
            snapshot_payload = self.get_tool_payload(snapshot_response)
            assert "ready from queued action" in snapshot_payload["text"], snapshot_payload
        finally:
            close_response = self._call_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert close_response, close_response
        print("CallTool session operation serialization test passed.")

    def test_call_tool_session_navigation_error_redacts_url(self):
        print("--- Running Test: Call Tool - Session Navigation Error Redacts URL ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            secret_url = self._url("/slow?seconds=6&token=session-secret")
            response = self._call_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": secret_url,
                "timeout": 5000,
                "maxChars": 1000
            }, timeout=15)
            assert response and response.get("result", {}).get("isError"), response
            error_text = self.get_tool_text(response)
            assert "session-secret" not in error_text, error_text
            assert "token=" not in error_text, error_text
        finally:
            close_response = self._call_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert close_response, close_response
        print("CallTool session navigation error redaction test passed.")

    def test_call_tool_session_captcha_detection(self):
        print("--- Running Test: Call Tool - Session CAPTCHA Detection ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            captcha_src = self._url("/recaptcha/api2/anchor")
            html = f"""<!doctype html>
<html>
<head><title>Just a moment</title></head>
<body>
  <h1>Verify you are human</h1>
  <iframe title="recaptcha challenge" src="{captcha_src}"></iframe>
</body>
</html>"""
            response = self._run_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._fixture_url(html),
                "captchaPolicy": "pause",
                "maxChars": 1000
            }, timeout=90)
            payload = self.get_tool_payload(response)
            assert payload["captchaDetected"] is True, payload
            assert payload["requiresUserAction"] is True, payload
            assert payload["challengeSignals"], payload
        finally:
            close_response = self._run_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert self.get_tool_payload(close_response)["closed"] is True
        print("CallTool session CAPTCHA detection test passed.")

    def test_call_tool_session_captcha_attempt(self):
        print("--- Running Test: Call Tool - Session CAPTCHA Attempt Metadata ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            captcha_src = self._url("/recaptcha/api2/anchor?k=site-secret&token=super-secret#fragment")
            html = f"""<!doctype html>
<html>
<head><title>Just a moment</title></head>
<body>
  <h1>Verify you are human</h1>
  <iframe title="recaptcha challenge" src="{captcha_src}"></iframe>
</body>
</html>"""
            response = self._run_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._fixture_url(html),
                "captchaPolicy": "attempt",
                "maxChars": 1000
            }, timeout=90)
            payload = self.get_tool_payload(response)
            assert payload["captchaDetected"] is True, payload
            assert payload["requiresUserAction"] is True, payload
            assert payload["challengeProvider"] == "recaptcha", payload
            assert payload["captchaIframes"], payload
            iframe_src = payload["captchaIframes"][0]["src"]
            assert len(iframe_src) <= 500, payload
            assert "site-secret" not in iframe_src, payload
            assert "super-secret" not in iframe_src, payload
            assert "fragment" not in iframe_src, payload
            assert "?..." in iframe_src, payload
            assert payload["suggestedStrategy"], payload
            assert "autoSolve" not in payload, payload
            content = response.get("result", {}).get("content", [])
            assert len(content) == 2, response
            assert content[1].get("type") == "image", response
            assert content[1].get("mimeType") == "image/png", response
        finally:
            close_response = self._run_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert self.get_tool_payload(close_response)["closed"] is True
        print("CallTool session CAPTCHA attempt metadata test passed.")

    def test_call_tool_session_start_enforces_concurrent_max_sessions(self):
        print("--- Running Test: Call Tool - Concurrent Session Max Enforcement ---")
        session_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env({
                "CAMOUFOX_MCP_MAX_CONCURRENCY": "2",
                "CAMOUFOX_MCP_MAX_SESSIONS": "1"
            })
        )
        sessions = []
        try:
            session_client.start_server()
            session_client.test_handshake()
            request_ids = [
                session_client.send_request("tools/call", {
                    "name": "browse_session_start",
                    "arguments": {}
                }),
                session_client.send_request("tools/call", {
                    "name": "browse_session_start",
                    "arguments": {}
                })
            ]
            responses = [session_client.get_response(request_id, timeout=90) for request_id in request_ids]
            assert all(responses), responses
            errors = [response for response in responses if response.get("result", {}).get("isError")]
            successes = [response for response in responses if not response.get("result", {}).get("isError")]
            assert len(successes) == 1, responses
            assert len(errors) == 1, responses
            assert "too many active sessions" in session_client.get_tool_text(errors[0]).lower(), errors[0]
            sessions = [session_client.get_tool_payload(response)["sessionId"] for response in successes]
        finally:
            for session_id in sessions:
                close_response = session_client._call_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
                assert close_response and not close_response.get("result", {}).get("isError"), close_response
            session_client.stop_server()
        print("CallTool concurrent session max enforcement test passed.")

    def test_call_tool_session_rejects_delayed_private_request(self):
        print("--- Running Test: Call Tool - Session Reject Delayed Private Request ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            html = """<!doctype html>
<html>
<body>
  <p>safe first</p>
  <script>
    setTimeout(() => {
      const img = new Image();
      img.src = 'https://10.0.0.1/session-late.png';
      document.body.appendChild(img);
    }, 3000);
  </script>
</body>
</html>"""
            navigate = self._call_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._fixture_url(html),
                "maxChars": 1000
            }, timeout=90)
            assert navigate, navigate
            if navigate.get("result", {}).get("isError"):
                assert "not allowed" in self.get_tool_text(navigate).lower() or "blocked unsafe" in self.get_tool_text(navigate).lower()
            else:
                assert "safe first" in self.get_tool_payload(navigate)["text"]
                time.sleep(3.5)
                snapshot = self._call_tool("browse_session_snapshot", {
                    "sessionId": session_id,
                    "maxChars": 1000
                }, timeout=30)
                assert snapshot and snapshot.get("result", {}).get("isError"), snapshot
                snapshot_error = self.get_tool_text(snapshot).lower()
                assert "not allowed" in snapshot_error or "blocked unsafe" in snapshot_error, snapshot
        finally:
            close_response = self._call_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert close_response, close_response
        print("CallTool session delayed private request rejection test passed.")

    def test_call_tool_sequence_scrolls_selector_element(self):
        print("--- Running Test: Call Tool - Browse Sequence Scroll Selector Element ---")
        html = """<!doctype html>
<html>
<body>
  <div id="box" style="height:50px;width:200px;overflow:auto;border:1px solid black"
       onscroll="document.getElementById('result').textContent = 'scrollTop ' + this.scrollTop;">
    <div style="height:500px">scroll content</div>
  </div>
  <p id="result">scrollTop 0</p>
</body>
</html>"""
        response = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [
                {"type": "scroll", "selector": "#box", "deltaY": 180}
            ],
            "maxChars": 2000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["actions"][0]["status"] == "ok"
        assert "scrollTop 0" not in payload["text"], f"Expected selected element to scroll: {payload}"
        assert "scrollTop " in payload["text"], f"Expected scroll result text: {payload}"
        print("CallTool sequence selector scroll test passed.")

    def test_call_tool_sequence_rejects_private_redirect(self):
        print("--- Running Test: Call Tool - Browse Sequence Reject Private Redirect ---")
        response = self._call_tool("browse_sequence", {
            "url": self._url("/redirect-to?url=http%3A%2F%2F127.0.0.1%3A80"),
            "actions": []
        }, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"Private sequence redirect was not rejected: {response}"
        assert "blocked unsafe browser request" in self.get_tool_text(response).lower()
        print("CallTool sequence private redirect rejection test passed.")

    def test_call_tool_sequence_rejects_evaluate_by_default(self):
        print("--- Running Test: Call Tool - Browse Sequence Reject Evaluate By Default ---")
        response = self._call_tool("browse_sequence", {
            "url": self._example_url(),
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

    def test_call_tool_browse_truncates_many_text_nodes(self):
        print("--- Running Test: Call Tool - Truncate Many Text Nodes ---")
        html = """<!doctype html>
<html>
<body>
  <script>
    for (let i = 0; i < 51000; i += 1) {
      const span = document.createElement('span');
      span.textContent = 'x';
      document.body.appendChild(span);
    }
  </script>
</body>
</html>"""
        response = self._run_browse({
            "url": self._fixture_url(html),
            "maxChars": 200000
        }, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["truncated"] is True, f"Expected node cap truncation: {payload}"
        assert len(payload["text"]) < 200000
        print("CallTool many text nodes truncation test passed.")

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
    new WebSocket('wss://127.0.0.1:1/socket');
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
            env=self._test_env({"CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS": "1"})
        )
        try:
            unsafe_client.start_server()
            unsafe_client.test_handshake()
            response = unsafe_client._call_tool("browse", {
                "url": unsafe_client._example_url(),
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
            "url": self._example_url(),
            "window": []
        })
        payload = self.get_tool_payload(response)
        assert "example domain" in payload["text"].lower()
        print("CallTool browse with empty window test passed.")

    def test_call_tool_browse_valid_window(self):
        print("--- Running Test: Call Tool - Browse Valid Window [800, 600] ---")
        response = self._run_browse({
            "url": self._example_url(),
            "window": [800, 600]
        })
        payload = self.get_tool_payload(response)
        assert "example domain" in payload["text"].lower()
        print("CallTool browse with valid window test passed.")

    def test_call_tool_browse_comprehensive_empty_args(self):
        print("--- Running Test: Call Tool - Browse Comprehensive Empty/Default Args ---")
        response = self._run_browse({
            "url": self._example_url(),
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
            self.test_call_tool_status()
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
            self.test_call_tool_focused_extractors()
            self.test_call_tool_screenshot_tool()
            self.test_call_tool_console_and_network_summary()
            self.test_call_tool_browse_rejects_oversize_fullpage_screenshot()
            self.test_call_tool_browse_rejects_oversize_selector_screenshot()
            self.test_call_tool_browse_missing_selector()
            self.test_call_tool_snapshot_success()
            self.test_call_tool_snapshot_does_not_truncate_only_hidden_candidates()
            self.test_call_tool_browse_separates_adjacent_inline_text()
            self.test_call_tool_sequence_click_link()
            self.test_call_tool_sequence_form_actions()
            self.test_call_tool_session_flow_and_max_sessions()
            self.test_call_tool_session_serializes_overlapping_operations()
            self.test_call_tool_session_navigation_error_redacts_url()
            self.test_call_tool_session_captcha_detection()
            self.test_call_tool_session_captcha_attempt()
            self.test_call_tool_session_start_enforces_concurrent_max_sessions()
            self.test_call_tool_session_rejects_delayed_private_request()
            self.test_call_tool_sequence_scrolls_selector_element()
            self.test_call_tool_sequence_rejects_private_redirect()
            self.test_call_tool_sequence_rejects_evaluate_by_default()
            self.test_call_tool_browse_truncates_huge_text()
            self.test_call_tool_browse_truncates_many_text_nodes()
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

    client = MCPTestClient(mode=args.mode, image_name=args.image_name, docker_platform=args.docker_platform, env=TEST_ENV)
    ok = client.run_tests()
    raise SystemExit(0 if ok else 1)
