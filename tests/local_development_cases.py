from harness import MCPTestClient


class LocalDevelopmentCases:
    def _development_client(self, allowed_hosts):
        # Exercise the deployment setting without the test-only loopback bypass.
        return MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env={
                "NODE_ENV": "production",
                "CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST": "0",
                "CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS": allowed_hosts,
                "CAMOUFOX_MCP_NETWORK_SANDBOX": "0",
                "CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX": "0",
            },
        )

    def test_local_development_requires_explicit_hostname(self):
        print("--- Running Test: Local Development Requires Explicit Hostname ---")
        hostname = "host.docker.internal" if self.mode == "docker" else "localhost"
        client = self._development_client("")
        try:
            client.start_server()
            initialized = client.test_handshake()
            assert initialized["result"]["capabilities"]["extensions"]["camoufox-mcp"]["policy"]["allowedPrivateHosts"] == []
            url = client._example_url().replace("127.0.0.1", hostname)
            response = client._call_tool("browse_screenshot", {"url": url}, timeout=10)
            assert response and response.get("result", {}).get("isError"), response
            error = client.get_tool_text(response).lower()
            assert "not allowed" in error or "private, local, or reserved" in error, response
            status = client.get_tool_payload(client._run_status())
            assert status["networkSecurity"]["allowedPrivateHosts"] == [], status
        finally:
            client.stop_server()

    def test_local_development_allows_screenshot_session_and_resources(self):
        print("--- Running Test: Local Development Screenshot, Session, and Resources ---")
        hostname = "host.docker.internal" if self.mode == "docker" else "localhost"
        client = self._development_client(hostname)
        try:
            client.start_server()
            initialized = client.test_handshake()
            assert initialized["result"]["capabilities"]["extensions"]["camoufox-mcp"]["policy"]["allowedPrivateHosts"] == [hostname]
            url = client._example_url().replace("127.0.0.1", hostname)
            response = client._run_screenshot({"url": url, "geoip": False})
            assert any(item.get("type") == "image" for item in response["result"]["content"]), response
            status = client.get_tool_payload(client._run_status())
            assert status["networkSecurity"]["allowedPrivateHosts"] == [hostname], status

            websocket_url = client.fixture_server.websocket_url().replace("127.0.0.1", hostname)
            fixture_url = client._fixture_url(f"""
                <h1>Local development</h1>
                <p id="http">Loading resource</p>
                <p id="ws">Connecting socket</p>
                <script>
                  fetch('/example').then(response => response.text()).then(() => {{
                    document.querySelector('#http').textContent = 'Local HTTP resource loaded';
                    document.querySelector('#http').className = 'ready';
                  }});
                  const socket = new WebSocket('{websocket_url}');
                  socket.onopen = () => socket.send('ready');
                  socket.onmessage = () => {{
                    document.querySelector('#ws').textContent = 'Local WebSocket connected';
                    document.querySelector('#ws').className = 'ready';
                  }};
                </script>
            """).replace("127.0.0.1", hostname)
            started = client._run_tool("browse_session_start", {"geoip": False})
            session_id = client.get_tool_payload(started)["sessionId"]
            client._run_tool("browse_session_navigate", {"sessionId": session_id, "url": fixture_url})
            client._run_tool("browse_session_action", {
                "sessionId": session_id,
                "action": {"type": "waitFor", "selector": "#http.ready + #ws.ready", "timeout": 10000},
            })
            snapshot = client.get_tool_payload(client._run_tool("browse_session_snapshot", {"sessionId": session_id}))
            assert "Local HTTP resource loaded" in snapshot["text"], snapshot
            assert "Local WebSocket connected" in snapshot["text"], snapshot
            client._run_tool("browse_session_navigate", {"sessionId": session_id, "url": url})
            client._run_tool("browse_session_close", {"sessionId": session_id})
            assert client.fixture_server.websocket_handshakes == 1
            assert client.fixture_server.websocket_ready_messages == 1

            # A hostname exception must not grant access to the same IP through another name.
            unlisted_url = url.replace(hostname, "127.0.0.1")
            if self.mode == "docker":
                unlisted_url = "http://127.0.0.1:80/"
            denied = client._call_tool("browse", {"url": unlisted_url}, timeout=10)
            assert denied and denied.get("result", {}).get("isError"), denied
            assert "not allowed" in client.get_tool_text(denied).lower(), denied

            blocked_resource_url = client._fixture_url("""
                <h1>Unlisted resource</h1>
                <script>fetch('http://127.0.0.1:80/').catch(() => {});</script>
            """).replace("127.0.0.1", hostname)
            denied = client._call_tool("browse", {"url": blocked_resource_url, "geoip": False, "timeout": 10000}, timeout=45)
            assert denied and denied.get("result", {}).get("isError"), f"Unlisted resource denial missing: {denied}"
            assert "blocked unsafe browser request" in client.get_tool_text(denied).lower(), denied
        finally:
            client.stop_server()
