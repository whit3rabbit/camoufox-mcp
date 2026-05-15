import json
import subprocess
import threading
import time

from harness import MCPTestClient, TEST_ENV

class SessionCases:
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

    def test_call_tool_session_close_bounds_active_operation(self):
        print("--- Running Test: Call Tool - Session Close Bounds Active Operation ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        closed = False
        try:
            navigate_id = self.send_request("tools/call", {
                "name": "browse_session_navigate",
                "arguments": {
                    "sessionId": session_id,
                    "url": self._url("/slow?seconds=30"),
                    "timeout": 60000,
                    "maxChars": 1000
                }
            })
            time.sleep(0.5)
            started = time.time()
            close_response = self._call_tool("browse_session_close", {"sessionId": session_id}, timeout=15)
            elapsed = time.time() - started
            assert close_response and not close_response.get("result", {}).get("isError"), close_response
            assert self.get_tool_payload(close_response)["closed"] is True
            assert elapsed < 15, f"Session close waited too long behind active operation: {elapsed:.2f}s"
            closed = True

            navigate_response = self.get_response(navigate_id, timeout=15)
            assert navigate_response and navigate_response.get("result", {}).get("isError"), navigate_response
        finally:
            if not closed:
                close_response = self._call_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
                assert close_response, close_response
        print("CallTool session close active operation bound test passed.")

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
            assert payload["challengeHandling"] == "manual", payload
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
            assert payload["challengeHandling"] == "manual", payload
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
            assert "challengePlaybook" not in payload, payload
            assert "autoSolve" not in payload, payload
            content = response.get("result", {}).get("content", [])
            assert len(content) == 2, response
            assert content[1].get("type") == "image", response
            assert content[1].get("mimeType") == "image/png", response
        finally:
            close_response = self._run_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert self.get_tool_payload(close_response)["closed"] is True
        print("CallTool session CAPTCHA attempt metadata test passed.")

    def test_call_tool_session_captcha_attempt_autonomous_strategy(self):
        print("--- Running Test: Call Tool - Session CAPTCHA Attempt Autonomous Strategy ---")
        autonomous_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env({"CAPTCHA_AUTONOMOUS": "true"})
        )
        try:
            autonomous_client.start_server()
            autonomous_client.test_handshake()
            start_response = autonomous_client._run_tool("browse_session_start", {}, timeout=90)
            session_id = autonomous_client.get_tool_payload(start_response)["sessionId"]
            try:
                captcha_src = autonomous_client._url("/recaptcha/api2/anchor")
                html = f"""<!doctype html>
<html>
<head><title>Just a moment</title></head>
<body>
  <h1>Verify you are human</h1>
  <iframe title="recaptcha challenge" src="{captcha_src}"></iframe>
</body>
</html>"""
                response = autonomous_client._run_tool("browse_session_navigate", {
                    "sessionId": session_id,
                    "url": autonomous_client._fixture_url(html),
                    "captchaPolicy": "attempt",
                    "maxChars": 1000
                }, timeout=90)
                payload = autonomous_client.get_tool_payload(response)
                assert payload["captchaDetected"] is True, payload
                assert payload["challengeHandling"] == "llm_assisted", payload
                assert "Autonomous challenge handling is enabled" in payload["message"], payload
                assert "challengeProvider" in payload["suggestedStrategy"], payload
                assert "bounded screenshot" in payload["suggestedStrategy"], payload
                assert "browse_session_action" not in payload["suggestedStrategy"], payload
                assert "clickMode" not in payload["suggestedStrategy"], payload
                assert payload["challengePlaybook"], payload
                assert "reCAPTCHA" in payload["challengePlaybook"], payload
                assert "captchaIframes" in payload["challengePlaybook"], payload
                assert "bounded screenshot" in payload["challengePlaybook"], payload
                assert "@.claude" not in payload["challengePlaybook"], payload
            finally:
                close_response = autonomous_client._run_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
                assert autonomous_client.get_tool_payload(close_response)["closed"] is True
        finally:
            autonomous_client.stop_server()
        print("CallTool session CAPTCHA autonomous strategy test passed.")

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
