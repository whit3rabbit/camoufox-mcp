import json
import subprocess
import threading
import time

from harness import MCPTestClient, PrivateWebSocketListener, TEST_ENV


class BrowseEdgeCases:
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

    def test_call_tool_browse_forwards_allowed_websocket(self):
        print("--- Running Test: Call Tool - Forward Allowed WebSocket ---")
        socket_url = self.fixture_server.websocket_url()
        initial_handshakes = self.fixture_server.websocket_handshakes
        initial_ready_messages = self.fixture_server.websocket_ready_messages
        html = f"""<!doctype html>
<html>
<body>
  <p id="socket-result">websocket pending</p>
  <script>
    const socket = new WebSocket({json.dumps(socket_url)});
    socket.onopen = () => {{ socket.send('ready'); }};
    socket.onmessage = (event) => {{ document.getElementById('socket-result').textContent = event.data; }};
    socket.onerror = () => {{ document.getElementById('socket-result').textContent = 'websocket error'; }};
  </script>
</body>
</html>"""
        response = self._call_tool("browse_sequence", {
            "url": self._fixture_url(html),
            "timeout": 10000,
            "maxChars": 1000,
            "actions": [{
                "type": "waitFor",
                "selector": '#socket-result:text-is("websocket fixture connected")',
                "state": "visible",
                "timeout": 5000
            }]
        }, timeout=30)
        handshakes = self.fixture_server.websocket_handshakes - initial_handshakes
        ready_messages = self.fixture_server.websocket_ready_messages - initial_ready_messages
        assert response and not response.get("result", {}).get("isError"), f"WebSocket forwarding failed (handshakes={handshakes}, readyMessages={ready_messages}): {response}"
        payload = self.get_tool_payload(response)
        assert "websocket fixture connected" in payload["text"], f"handshakes={handshakes}: {payload}"
        assert handshakes == 1, f"Expected one WebSocket handshake, got {handshakes}"
        assert ready_messages == 1, f"Expected one WebSocket client acknowledgement, got {ready_messages}"
        print("CallTool allowed WebSocket forwarding test passed.")

    def _assert_private_websocket_never_connects(self, in_iframe):
        with PrivateWebSocketListener(self.mode) as listener:
            script = f"<script>new WebSocket({json.dumps(listener.url)});</script>"
            socket_page = f"<!doctype html><html><body>{script}<p>private socket</p></body></html>"
            if in_iframe:
                frame_url = self._fixture_url(socket_page)
                html = f'<!doctype html><html><body><iframe src="{frame_url}"></iframe></body></html>'
            else:
                html = socket_page
            response = self._call_tool("browse", {
                "url": self._fixture_url(html),
                "waitStrategy": "load",
                "timeout": 10000
            }, timeout=30)
            assert response and response.get("result", {}).get("isError"), response
            assert "blocked unsafe browser request" in self.get_tool_text(response).lower(), response
            assert not listener.connected.wait(0.25), f"Forbidden WebSocket connected: {listener.received!r}"
            assert listener.received == b"", f"Forbidden WebSocket sent handshake bytes: {listener.received!r}"

    def test_call_tool_browse_blocks_private_websocket_before_connection(self):
        print("--- Running Test: Call Tool - Block Private WebSocket Before Connection ---")
        self._assert_private_websocket_never_connects(in_iframe=False)
        print("CallTool private WebSocket connection prevention test passed.")

    def test_call_tool_browse_blocks_iframe_private_websocket_before_connection(self):
        print("--- Running Test: Call Tool - Block Iframe Private WebSocket Before Connection ---")
        self._assert_private_websocket_never_connects(in_iframe=True)
        print("CallTool iframe private WebSocket connection prevention test passed.")

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
