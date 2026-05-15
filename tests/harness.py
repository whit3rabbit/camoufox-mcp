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
    "CAMOUFOX_MCP_NETWORK_SANDBOX": "0",
    "CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX": "0",
    "CAPTCHA_AUTONOMOUS": "false",
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

    def _package_version(self):
        package_path = os.path.join(os.path.dirname(__file__), "..", "package.json")
        with open(package_path, encoding="utf-8") as package_file:
            return json.load(package_file)["version"]

    def _test_env(self, extra=None):
        env = dict(TEST_ENV)
        env.update(extra or {})
        return env

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
