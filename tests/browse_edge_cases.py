import json
import subprocess
import threading
import time

from harness import MCPTestClient, TEST_ENV


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
