import json
import subprocess
import threading
import time

from harness import MCPTestClient, TEST_ENV

class StatusSecurityCases:
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
        capabilities = init_response["result"]["capabilities"]
        camoufox_extension = capabilities.get("extensions", {}).get("camoufox-mcp")
        assert camoufox_extension, f"Initialize response missing camoufox-mcp extension: {capabilities}"
        assert camoufox_extension["policy"]["unsafeOptionsAllowed"] is False, camoufox_extension
        assert camoufox_extension["policy"]["evaluateAllowed"] is False, camoufox_extension
        assert camoufox_extension["policy"]["captchaAutonomous"] is False, camoufox_extension
        assert camoufox_extension["policy"]["defaultWaitStrategy"] == "domcontentloaded", camoufox_extension
        assert camoufox_extension["policy"]["defaultStealthProfile"] == "normal", camoufox_extension
        assert camoufox_extension["tools"]["browseSessionNavigateWaitStrategy"] is True, camoufox_extension
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
        assert wait_strategy.get("default") == "domcontentloaded"
        stealth_profile = tool_by_name["browse"]["inputSchema"]["properties"]["stealthProfile"]
        assert stealth_profile.get("default") == "normal"
        session_wait_strategy = tool_by_name["browse_session_navigate"]["inputSchema"]["properties"].get("waitStrategy")
        assert session_wait_strategy, "browse_session_navigate should expose waitStrategy"
        assert set(session_wait_strategy.get("enum", [])) == {"domcontentloaded", "load", "networkidle"}
        assert tool_by_name["browse"]["annotations"]["readOnlyHint"] is True
        assert tool_by_name["browse_sequence"]["annotations"]["readOnlyHint"] is False

        expected_output_properties = {
            "camoufox_status": {"version", "browser", "activeSessions", "evaluateAllowed", "captchaAutonomous", "networkSecurity"},
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
        assert set(click_mode_schema.get("enum", [])) == {"dom", "pointer", "auto"}
        assert click_mode_schema.get("default") == "dom"
        session_click_mode_schema = find_property_schema(tool_by_name["browse_session_action"]["inputSchema"], "clickMode")
        assert session_click_mode_schema, "browse_session_action click action should expose shared clickMode"
        assert set(session_click_mode_schema.get("enum", [])) == {"dom", "pointer", "auto"}
        assert session_click_mode_schema.get("default") == "dom"

        expected_captcha_policies = {"detect", "pause", "fail", "attempt"}
        for tool_name, tool in tool_by_name.items():
            captcha_schema = tool["inputSchema"].get("properties", {}).get("captchaPolicy")
            if captcha_schema:
                captcha_policies = set(captcha_schema.get("enum", []))
                assert captcha_policies == expected_captcha_policies, (
                    f"{tool_name} captchaPolicy enum mismatch: {captcha_schema}"
                )
                assert "solve" not in captcha_policies, f"{tool_name} uses attempt plus CAPTCHA_AUTONOMOUS, not a separate server solve policy"
        print("ListTools test passed.")


    def test_call_tool_status(self):
        print("--- Running Test: Call Tool - Status ---")
        response = self._run_status()
        text = self.get_tool_text(response)
        assert "\n" not in text, f"Expected minified JSON text content: {text}"
        payload = self.get_tool_payload(response)
        assert payload["browser"] == "camoufox"
        assert payload["version"] == self._package_version(), payload
        assert isinstance(payload["browserAvailable"], bool)
        assert payload["queuedRequests"] == 0
        assert payload["maxConcurrency"] >= 1
        assert payload["maxSessions"] >= 1
        assert payload["unsafeOptionsAllowed"] is False
        assert payload["evaluateAllowed"] is False
        assert payload["captchaAutonomous"] is False
        network_security = payload["networkSecurity"]
        assert network_security["ssrfPolicy"] == "app_layer_best_effort"
        assert network_security["sandboxMode"] in {"unknown", "declared", "docker", "strict-declared"}
        assert network_security["sandboxDeclared"] is False
        assert network_security["strictSandboxRequired"] is False
        if network_security["sandboxMode"] in {"unknown", "docker"}:
            assert "best effort" in network_security.get("warning", "").lower(), network_security
        assert response.get("result", {}).get("structuredContent", {}).get("browser") == "camoufox"
        print("CallTool status test passed.")

    def test_call_tool_status_reports_declared_network_sandbox(self):
        print("--- Running Test: Call Tool - Status Reports Declared Network Sandbox ---")
        sandbox_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env({"CAMOUFOX_MCP_NETWORK_SANDBOX": "1"})
        )
        try:
            sandbox_client.start_server()
            sandbox_client.test_handshake()
            response = sandbox_client._run_status()
            payload = sandbox_client.get_tool_payload(response)
            network_security = payload["networkSecurity"]
            assert network_security["sandboxMode"] == "declared", network_security
            assert network_security["sandboxDeclared"] is True
            assert network_security["strictSandboxRequired"] is False
            assert "warning" not in network_security, network_security
        finally:
            sandbox_client.stop_server()
        print("CallTool declared network sandbox status test passed.")

    def test_call_tool_status_reports_strict_declared_network_sandbox(self):
        print("--- Running Test: Call Tool - Status Reports Strict Declared Network Sandbox ---")
        sandbox_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env({
                "CAMOUFOX_MCP_NETWORK_SANDBOX": "1",
                "CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX": "1"
            })
        )
        try:
            sandbox_client.start_server()
            sandbox_client.test_handshake()
            response = sandbox_client._run_status()
            payload = sandbox_client.get_tool_payload(response)
            network_security = payload["networkSecurity"]
            assert network_security["sandboxMode"] == "strict-declared", network_security
            assert network_security["sandboxDeclared"] is True
            assert network_security["strictSandboxRequired"] is True
            assert "warning" not in network_security, network_security
        finally:
            sandbox_client.stop_server()
        print("CallTool strict declared network sandbox status test passed.")

    def test_call_tool_status_reports_autonomous_captcha_policy(self):
        print("--- Running Test: Call Tool - Status Reports Autonomous CAPTCHA Policy ---")
        autonomous_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env({"CAPTCHA_AUTONOMOUS": "true"})
        )
        try:
            autonomous_client.start_server()
            autonomous_client.test_handshake()
            response = autonomous_client._run_status()
            payload = autonomous_client.get_tool_payload(response)
            assert payload["captchaAutonomous"] is True, payload
        finally:
            autonomous_client.stop_server()
        print("CallTool autonomous CAPTCHA status test passed.")

    def test_server_requires_declared_network_sandbox_when_strict(self):
        print("--- Running Test: Server Requires Declared Network Sandbox When Strict ---")
        strict_client = MCPTestClient(
            mode=self.mode,
            image_name=self.image_name,
            docker_platform=self.docker_platform,
            env=self._test_env({"CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX": "1"})
        )
        try:
            try:
                strict_client.start_server()
            except RuntimeError:
                time.sleep(0.2)
                stderr_text = "\n".join(strict_client.stderr_lines)
                assert "requires CAMOUFOX_MCP_NETWORK_SANDBOX=1" in stderr_text, stderr_text
                print("Server strict network sandbox startup rejection test passed.")
                return
            raise AssertionError("Strict network sandbox mode started without CAMOUFOX_MCP_NETWORK_SANDBOX=1")
        finally:
            strict_client.stop_server()

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
        stderr_start = len(self.stderr_lines)
        response = self._call_tool("browse", {
            "url": self._example_url(),
            "firefox_user_prefs": {"privacy.resistFingerprinting": True}
        }, timeout=10)
        assert response and response.get("result", {}).get("isError"), f"Unsafe browser options were not rejected: {response}"
        assert "unsafe browser options" in self.get_tool_text(response).lower()
        new_stderr = "\n".join(self.stderr_lines[stderr_start:])
        assert "firefox_user_prefs requires CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1" in new_stderr, new_stderr
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
