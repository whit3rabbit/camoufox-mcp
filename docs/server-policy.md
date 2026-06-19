# Server Policy

The server applies deny-by-default policy checks before and during browsing:

| Variable | Default | Description |
|----------|---------|-------------|
| `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` | unset | Set to `1` to allow `args`, `firefox_user_prefs`, and `exclude_addons` |
| `CAMOUFOX_MCP_ALLOW_EVALUATE` | unset | Set to `1` to allow `browse_sequence` evaluate actions. This is unsafe because page JavaScript can read page state |
| `CAPTCHA_AUTONOMOUS` | unset | Set to `true` to mark challenge responses as LLM-assisted and return provider-specific `challengePlaybook` context when known |
| `CAMOUFOX_MCP_NETWORK_SANDBOX` | unset | Set to `1` only after configuring container, VM, or firewall egress controls |
| `CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX` | unset | Set to `1` to refuse startup unless `CAMOUFOX_MCP_NETWORK_SANDBOX=1` is also set |
| `CAMOUFOX_MCP_MAX_CONCURRENCY` | `1` | Maximum simultaneous browse requests, clamped to 1-8 |
| `CAMOUFOX_MCP_MAX_SESSIONS` | `1` | Maximum active browser sessions, clamped to 1-4 |
| `CAMOUFOX_MCP_SESSION_TTL_MS` | `600000` | Session inactivity TTL, clamped to 300000-900000 |
| `CAMOUFOX_MCP_MAX_QUEUE` | `8` | Maximum queued browse requests, clamped to 0-100 |
| `CAMOUFOX_MCP_QUEUE_TIMEOUT_MS` | `30000` | Maximum time a request can wait for a browse slot, clamped to 1000-300000 |
| `CAMOUFOX_MCP_LAUNCH_TIMEOUT_MS` | `30000` | Maximum time browser launch can take, clamped to 1000-300000 |
| `CAMOUFOX_MCP_SEQUENCE_TIMEOUT_MS` | `120000` | Maximum cumulative `browse_sequence` action timeout budget and runtime, clamped to 1000-300000 |
| `CAMOUFOX_MCP_MAX_SCREENSHOT_BYTES` | `5242880` | Maximum screenshot payload size, clamped to 1 KiB-20 MiB |
| `CAMOUFOX_MCP_MAX_SCREENSHOT_WIDTH` | `1920` | Maximum screenshot viewport/window, selector, or full-page width, clamped to 320-3840 |
| `CAMOUFOX_MCP_MAX_SCREENSHOT_HEIGHT` | `1080` | Maximum screenshot viewport/window, selector, or full-page height, clamped to 240-2160 |
| `CAMOUFOX_MCP_MAX_DIAGNOSTIC_ENTRIES` | `100` | Maximum console or network diagnostic entries, clamped to 1-1000 |
| `CAMOUFOX_MCP_MAX_DIAGNOSTIC_TEXT_CHARS` | `2000` | Maximum diagnostic text characters per entry, clamped to 100-20000 |

URL policy rejects non-HTTP(S) URLs, localhost, private IP ranges, link-local addresses, multicast addresses, reserved/special-purpose IPv4 and IPv6 ranges, and hosts that resolve to those addresses. The server checks the initial URL, proxy server URL, final navigation URL, intercepted browser requests, and WebSocket requests. It does not make traffic anonymous unless you configure an allowed upstream proxy.

When unsafe browser options are sent without `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`, the server rejects the request and logs a warning naming the rejected option family. Denied unsafe prefs and args remain rejected even when unsafe options are enabled.

### Network sandbox posture

The server blocks localhost, private, link-local, reserved, and unsafe browser request URLs at the application layer. This is best-effort protection because browser networking and DNS resolution can still create TOCTOU risk.

For untrusted browsing, run the server behind container, VM, or host firewall egress rules that deny private, loopback, link-local, metadata, multicast, and reserved ranges. Docker/container detection in `camoufox_status` is only an environment signal, not proof that egress filtering is enforced.

Set `CAMOUFOX_MCP_NETWORK_SANDBOX=1` only after configuring those controls. Set `CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX=1` to refuse startup unless the deployment explicitly declares sandboxing.
