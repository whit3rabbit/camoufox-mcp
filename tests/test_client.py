import sys
sys.dont_write_bytecode = True

import argparse

from browse_cases import BrowseCases
from browse_edge_cases import BrowseEdgeCases
from harness import MCPTestClient, TEST_ENV
from sequence_cases import SequenceCases
from session_cases import SessionCases
from status_security_cases import StatusSecurityCases

TEST_ORDER = [
    "test_handshake",
    "test_list_tools",
    "test_call_tool_status",
    "test_call_tool_status_reports_declared_network_sandbox",
    "test_call_tool_status_reports_strict_declared_network_sandbox",
    "test_call_tool_status_reports_autonomous_captcha_policy",
    "test_server_requires_declared_network_sandbox_when_strict",
    "test_call_tool_browse_rejects_localhost",
    "test_call_tool_browse_rejects_localhost_redirect",
    "test_call_tool_browse_rejects_unsafe_options",
    "test_call_tool_browse_rejects_excluded_addons",
    "test_call_tool_browse_rejects_private_proxy_string",
    "test_call_tool_browse_rejects_private_proxy_object",
    "test_call_tool_browse_rejects_ipv6_loopback",
    "test_call_tool_browse_rejects_ipv4_mapped_loopback",
    "test_call_tool_browse_rejects_unusual_private_ip_forms",
    "test_call_tool_browse_rejects_special_ipv4_ranges",
    "test_call_tool_browse_success",
    "test_call_tool_browse_metadata",
    "test_call_tool_browse_selector_text",
    "test_call_tool_browse_network_diagnostics",
    "test_call_tool_browse_selector_jpeg_screenshot",
    "test_call_tool_focused_extractors",
    "test_call_tool_screenshot_tool",
    "test_call_tool_console_and_network_summary",
    "test_call_tool_browse_rejects_oversize_fullpage_screenshot",
    "test_call_tool_browse_rejects_oversize_selector_screenshot",
    "test_call_tool_browse_missing_selector",
    "test_call_tool_snapshot_success",
    "test_call_tool_snapshot_does_not_truncate_only_hidden_candidates",
    "test_call_tool_browse_separates_adjacent_inline_text",
    "test_call_tool_sequence_click_link",
    "test_call_tool_sequence_click_auto_pointer_path",
    "test_call_tool_sequence_click_auto_falls_back_to_dom",
    "test_call_tool_sequence_form_actions",
    "test_call_tool_sequence_rejects_timeout_budget",
    "test_call_tool_session_flow_and_max_sessions",
    "test_call_tool_session_serializes_overlapping_operations",
    "test_call_tool_session_navigation_error_redacts_url",
    "test_call_tool_session_close_bounds_active_operation",
    "test_call_tool_session_captcha_detection",
    "test_call_tool_session_captcha_attempt",
    "test_call_tool_session_captcha_attempt_autonomous_strategy",
    "test_call_tool_session_start_enforces_concurrent_max_sessions",
    "test_call_tool_session_rejects_delayed_private_request",
    "test_call_tool_sequence_scrolls_selector_element",
    "test_call_tool_sequence_rejects_private_redirect",
    "test_call_tool_sequence_rejects_evaluate_by_default",
    "test_call_tool_browse_truncates_huge_text",
    "test_call_tool_browse_truncates_many_text_nodes",
    "test_call_tool_browse_truncates_huge_html",
    "test_call_tool_browse_rejects_private_subresources",
    "test_call_tool_browse_rejects_private_websocket",
    "test_call_tool_browse_rejects_delayed_private_navigation",
    "test_call_tool_browse_empty_window",
    "test_call_tool_browse_valid_window",
    "test_call_tool_browse_comprehensive_empty_args",
    "test_call_tool_browse_rejects_denylisted_unsafe_options_when_allowed",
]

class CamoufoxMCPTestClient(StatusSecurityCases, BrowseCases, BrowseEdgeCases, SequenceCases, SessionCases, MCPTestClient):
    def run_tests(self):
        try:
            self.start_server()
            for test_name in TEST_ORDER:
                getattr(self, test_name)()
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

    client = CamoufoxMCPTestClient(mode=args.mode, image_name=args.image_name, docker_platform=args.docker_platform, env=TEST_ENV)
    ok = client.run_tests()
    raise SystemExit(0 if ok else 1)
