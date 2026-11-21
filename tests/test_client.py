import sys
sys.dont_write_bytecode = True

import argparse

from browse_cases import BrowseCases
from browse_edge_cases import BrowseEdgeCases
from hardening_cases import HardeningCases
from harness import MCPTestClient, TEST_ENV
from local_development_cases import LocalDevelopmentCases
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
    "test_local_development_requires_explicit_hostname",
    "test_local_development_allows_screenshot_session_and_resources",
    "test_call_tool_browse_success",
    "test_call_tool_browse_metadata",
    "test_call_tool_browse_selector_text",
    "test_call_tool_browse_network_diagnostics",
    "test_call_tool_browse_selector_jpeg_screenshot",
    "test_call_tool_focused_extractors",
    "test_call_tool_links_only_visible_with_accessible_labels",
    "test_call_tool_forms_omit_password_values",
    "test_call_tool_screenshot_tool",
    "test_call_tool_console_and_network_summary",
    "test_call_tool_browse_fullpage_screenshot_limits",
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
    "test_call_tool_sequence_failure_reports_private_host_policy",
    "test_call_tool_session_flow_and_max_sessions",
    "test_call_tool_session_tracks_action_navigation_response",
    "test_call_tool_session_serializes_overlapping_operations",
    "test_call_tool_session_navigation_error_redacts_url",
    "test_call_tool_session_close_bounds_active_operation",
    "test_call_tool_session_captcha_detection",
    "test_call_tool_session_captcha_attempt",
    "test_call_tool_session_captcha_attempt_autonomous_strategy",
    "test_call_tool_session_start_enforces_concurrent_max_sessions",
    "test_call_tool_session_rejects_delayed_private_request",
    "test_call_tool_session_action_failure_reports_private_host_policy",
    "test_call_tool_sequence_scrolls_selector_element",
    "test_call_tool_sequence_rejects_private_redirect",
    "test_call_tool_sequence_rejects_evaluate_by_default",
    "test_call_tool_browse_truncates_huge_text",
    "test_call_tool_browse_truncates_many_text_nodes",
    "test_call_tool_browse_truncates_huge_html",
    "test_call_tool_browse_rejects_private_subresources",
    "test_call_tool_browse_rejects_private_websocket",
    "test_call_tool_browse_forwards_allowed_websocket",
    "test_call_tool_browse_blocks_private_websocket_before_connection",
    "test_call_tool_browse_blocks_iframe_private_websocket_before_connection",
    "test_call_tool_browse_rejects_delayed_private_navigation",
    "test_call_tool_browse_empty_window",
    "test_call_tool_browse_valid_window",
    "test_call_tool_browse_comprehensive_empty_args",
    "test_call_tool_browse_rejects_denylisted_unsafe_options_when_allowed",
    "test_call_tool_browse_rejects_webrtc_reenable_by_default",
    "test_call_tool_captcha_detection_ignores_csrf_and_provider_mentions",
    "test_call_tool_forms_grouped_field_selectors_are_unique",
    "test_call_tool_session_recovers_after_blocked_subresource",
    "test_call_tool_cancelled_request_frees_browse_slot",
    "test_server_exits_when_client_disconnects_with_open_session",
]

class CamoufoxMCPTestClient(StatusSecurityCases, LocalDevelopmentCases, BrowseCases, BrowseEdgeCases, SequenceCases, SessionCases, HardeningCases, MCPTestClient):
    def run_tests(self, selected=None, keep_going=False):
        test_names = TEST_ORDER
        if selected:
            unknown = [name for name in selected if name not in TEST_ORDER]
            if unknown:
                print(f"\nUnknown test names: {', '.join(unknown)}")
                return False
            # The handshake initializes the shared server, so it always runs first.
            test_names = ["test_handshake"] + [name for name in TEST_ORDER if name in selected and name != "test_handshake"]

        failures = []
        try:
            self.start_server()
            for test_name in test_names:
                try:
                    getattr(self, test_name)()
                except Exception as e:
                    print(f"\nAn error occurred in {test_name}: {e}")
                    failures.append(test_name)
                    if not keep_going or test_name == "test_handshake":
                        break
                    # A failed case may leave the shared server mid-operation.
                    self.stop_server()
                    self.start_server()
                    self.test_handshake()
        except Exception as e:
            print(f"\nAn error occurred: {e}")
            failures.append("<harness>")
        finally:
            self.stop_server()

        if MCPTestClient.stdout_violations:
            print(f"\nServer wrote {len(MCPTestClient.stdout_violations)} non-JSON-RPC line(s) to stdout:")
            for line in MCPTestClient.stdout_violations[:10]:
                print(f"  {line}")
            failures.append("<stdout protocol violation>")

        if failures:
            print(f"\n{len(failures)} failure(s) out of {len(test_names)} case(s): {', '.join(failures)}")
            return False
        print(f"\nAll tests passed! ({len(test_names)} cases)")
        return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', type=str, default='docker', choices=['docker', 'local'], help='Test mode: docker or local')
    parser.add_argument('--image-name', type=str, default='camoufox-mcp-server:latest', help='Docker image name for docker mode')
    parser.add_argument('--docker-platform', type=str, help='Docker platform to pass to docker run')
    parser.add_argument('--tests', type=str, help='Comma-separated test names to run (the handshake always runs first)')
    parser.add_argument('--keep-going', action='store_true', help='Continue after a failing case and report every failure at the end')
    parser.add_argument('--no-geoip', action='store_true', help='Send geoip:false on browser launches that do not set it, for environments that cannot fetch the GeoIP database. GeoIP-enabled launches are then untested.')
    args = parser.parse_args()

    MCPTestClient.disable_geoip = args.no_geoip
    selected = [name.strip() for name in args.tests.split(",") if name.strip()] if args.tests else None
    client = CamoufoxMCPTestClient(mode=args.mode, image_name=args.image_name, docker_platform=args.docker_platform, env=TEST_ENV)
    ok = client.run_tests(selected=selected, keep_going=args.keep_going)
    raise SystemExit(0 if ok else 1)
