import time

from harness import MCPTestClient


class HardeningCases:
    def test_call_tool_browse_rejects_webrtc_reenable_by_default(self):
        print("--- Running Test: Call Tool - Reject WebRTC Re-Enable By Default ---")
        # WebRTC connects to servers the page names over transports the request
        # guard never sees, so turning it back on needs the unsafe-options opt-in.
        response = self._call_tool("browse", {"url": self._example_url(), "block_webrtc": False}, timeout=30)
        assert response and response.get("result", {}).get("isError"), f"block_webrtc:false was not rejected: {response}"
        error = self.get_tool_text(response)
        assert "block_webrtc: false is disabled by server policy" in error, response
        assert "CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1" in error, response
        print("CallTool WebRTC re-enable rejection test passed.")

    def test_call_tool_captcha_detection_ignores_csrf_and_provider_mentions(self):
        print("--- Running Test: Call Tool - CAPTCHA Detection Ignores CSRF Fields ---")
        # An ordinary login form: CSRF fields and a mention of a CDN are not a
        # challenge. These used to match on "token" and on "cloudflare".
        login_html = """<!doctype html>
<html>
<head><title>Sign in</title></head>
<body>
  <form method="post">
    <input type="hidden" name="csrf_token" value="abc">
    <input type="hidden" name="authenticity_token" id="challenge_nonce" value="def">
    <label>Email <input name="email"></label>
  </form>
  <p data-note="turnstile">Assets are served from the cloudflare CDN.</p>
  <a href="https://cdnjs.cloudflare.com/">cdn</a>
</body>
</html>"""
        response = self._run_browse({"url": self._fixture_url(login_html), "captchaPolicy": "detect"}, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["captchaDetected"] is False, f"Login form was flagged as a challenge: {payload}"

        # A real challenge response field is still detected.
        challenge_html = """<!doctype html>
<html>
<body>
  <form><textarea name="g-recaptcha-response"></textarea></form>
  <div class="cf-turnstile"></div>
</body>
</html>"""
        response = self._run_browse({"url": self._fixture_url(challenge_html), "captchaPolicy": "detect"}, timeout=90)
        payload = self.get_tool_payload(response)
        assert payload["captchaDetected"] is True, payload
        assert "input:challenge" in payload["challengeSignals"], payload
        assert "markup:challenge-provider" in payload["challengeSignals"], payload
        print("CallTool CAPTCHA false-positive test passed.")

    def test_call_tool_forms_grouped_field_selectors_are_unique(self):
        print("--- Running Test: Call Tool - Forms Grouped Field Selectors ---")
        html = """<!doctype html>
<html>
<body>
  <form id="first">
    <label><input type="radio" name="plan" value="basic"> Basic</label>
    <label><input type="radio" name="plan" value="pro"> Pro</label>
    <label><input type="checkbox" name="topics" value="news"> News</label>
    <label><input type="checkbox" name="topics" value="offers"> Offers</label>
    <label>Email <input name="email"></label>
  </form>
  <form id="second">
    <label>Email <input name="email"></label>
  </form>
</body>
</html>"""
        response = self._run_forms({"url": self._fixture_url(html)}, timeout=90)
        payload = self.get_tool_payload(response)
        selectors = [field["selector"] for form in payload["forms"] for field in form["fields"]]
        assert len(selectors) == 6, payload
        # Every option of a radio or checkbox group, and same-named fields in
        # different forms, must be individually addressable.
        assert len(set(selectors)) == len(selectors), f"Duplicate field selectors: {selectors}"
        assert 'input[name="plan"][value="pro"]' in selectors, selectors

        # The selector must drive an action against the element it names.
        sequence = self._run_sequence({
            "url": self._fixture_url(html),
            "actions": [{"type": "click", "selector": 'input[name="plan"][value="pro"]'}],
            "maxChars": 1000,
        }, timeout=90)
        assert self.get_tool_payload(sequence)["actions"][0]["status"] == "ok", sequence
        print("CallTool grouped field selector test passed.")

    def test_call_tool_session_recovers_after_blocked_subresource(self):
        print("--- Running Test: Call Tool - Session Recovers After Blocked Subresource ---")
        start_response = self._run_tool("browse_session_start", {}, timeout=90)
        session_id = self.get_tool_payload(start_response)["sessionId"]
        try:
            html = """<!doctype html>
<html>
<body>
  <p>page with one private image</p>
  <img src="http://10.0.0.1/blocked.png" alt="">
</body>
</html>"""
            navigate = self._call_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._fixture_url(html),
                "maxChars": 1000,
            }, timeout=90)
            assert navigate and navigate.get("result", {}).get("isError"), f"Blocked subresource was not reported: {navigate}"
            assert "blocked unsafe browser request" in self.get_tool_text(navigate).lower(), navigate

            # The request was aborted before it was sent and has been reported.
            # The session stays usable: it used to fail every later call.
            snapshot = self._call_tool("browse_session_snapshot", {"sessionId": session_id, "maxChars": 1000}, timeout=60)
            assert snapshot and not snapshot.get("result", {}).get("isError"), f"Session stayed blocked after reporting: {snapshot}"
            assert "page with one private image" in self.get_tool_payload(snapshot)["text"], snapshot

            clean = self._call_tool("browse_session_navigate", {
                "sessionId": session_id,
                "url": self._example_url(),
                "maxChars": 1000,
            }, timeout=90)
            assert clean and not clean.get("result", {}).get("isError"), f"Session could not navigate after a block: {clean}"
        finally:
            close_response = self._call_tool("browse_session_close", {"sessionId": session_id}, timeout=30)
            assert close_response, close_response
        print("CallTool session block recovery test passed.")

    def test_call_tool_cancelled_request_frees_browse_slot(self):
        print("--- Running Test: Call Tool - Cancelled Request Frees Browse Slot ---")
        # One browse slot by default. The slow page would hold it for a minute;
        # the queue timeout is 30 seconds, so the second browse can only succeed
        # if cancelling the first one actually released the slot.
        slow_id = self.send_request("tools/call", {
            "name": "browse",
            "arguments": {"url": self._url("/slow?seconds=60"), "timeout": 90000},
        })
        time.sleep(6)
        self.send_notification("notifications/cancelled", {"requestId": slow_id, "reason": "test cancellation"})

        started = time.time()
        response = self._call_tool("browse", {"url": self._example_url()}, timeout=40)
        elapsed = time.time() - started
        assert response and not response.get("result", {}).get("isError"), f"Slot was not released after cancellation: {response}"
        assert elapsed < 25, f"Second browse waited {elapsed:.1f}s; the cancelled browse kept the slot"
        print("CallTool cancellation test passed.")

    def test_server_exits_when_client_disconnects_with_open_session(self):
        print("--- Running Test: Server Exits When Client Disconnects ---")
        client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env(),
        )
        try:
            client.start_server()
            client.test_handshake()
            client._run_tool("browse_session_start", {}, timeout=90)
            # An open session keeps a browser alive. Closing the pipe, with no
            # signal, must still shut the server and its browser down.
            client.process.stdin.close()
            try:
                client.process.wait(timeout=25)
            except Exception:
                raise AssertionError("Server kept running after its stdin closed with a session open")
        finally:
            if client.process and client.process.poll() is None:
                client.process.kill()
            client.process = None
            client.fixture_server.stop()
        print("Server disconnect shutdown test passed.")
