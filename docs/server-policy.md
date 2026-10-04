# Server Policy

The server applies deny-by-default policy checks before and during browsing:

| Variable | Default | Description |
|----------|---------|-------------|
| `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` | unset | Set to `1` to allow `args`, `firefox_user_prefs`, and `exclude_addons` |
| `CAMOUFOX_MCP_ALLOW_EVALUATE` | unset | Set to `1` to allow `browse_sequence` evaluate actions. This is unsafe because page JavaScript can read page state |
| `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS` | unset | Comma-separated exact hostnames allowed to resolve to loopback, RFC1918, or IPv6 unique-local addresses for local development |
| `CAMOUFOX_MCP_BROWSER_COMPATIBILITY` | unset | Set to `1` during installation and startup to use beta.33 with page/iframe WebSocket routing and reduced stealth relative to upstream defaults |
| `CAMOUFOX_INSTALL_DIR` | OS browser cache | Use the same directory during installation and startup; compatibility otherwise uses a separate sibling cache |
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
| `CAMOUFOX_MCP_NO_SQLITE_SHIM` | unset | Set to `1` to load the native `better-sqlite3` module instead of the built-in `node:sqlite` shim (see [troubleshooting](troubleshooting.md)) |

By default, URL policy rejects non-HTTP(S) URLs, localhost, private IP ranges, link-local addresses, multicast addresses, reserved/special-purpose IPv4 and IPv6 ranges, and hosts that resolve to those addresses. The server checks the initial URL, proxy server URL, final navigation URL, intercepted browser requests, and intercepted page/iframe WebSocket requests. It does not make traffic anonymous unless you configure an allowed upstream proxy.

### Local development sites

Source builds from `main` support this setting. npm/npx installs gain it in the next tagged release.

To browse a local or private site, add its exact hostname to the MCP server's environment and restart the server. Examples include `localhost`, `laravel.test`, `app.local`, `app.internal`, corporate names, and custom DNS names that resolve to private addresses:

```bash
CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=localhost,laravel.test,app.internal node dist/index.js
```

For an MCP host configuration, set the same variable in the server's `env` object:

```json
{
  "CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS": "laravel.test,assets.laravel.test"
}
```

Configure each hostname in DNS or the hosts file used by both Node and the browser. Run these checks in the same container or VM as the MCP server. A container's `localhost` points to that container, so a host-side development server needs a reachable address and corresponding DNS or hosts entry.

For a hostname denied because it resolves to ordinary private or loopback addresses, the error includes the exact `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=<hostname>` setting. The suffix does not determine eligibility: custom DNS names receive the same guidance when their resolved addresses qualify. DNS lookup failures require a DNS or hosts fix first.

Entries match exact hostnames after case and trailing-dot normalization. Wildcards, URLs, ports, and IP literals are rejected. Allowlisting `laravel.test` does not allow `assets.laravel.test` or a direct `127.0.0.1` URL. Add each required hostname explicitly. Allowed hostnames may resolve to loopback, RFC1918 private IPv4, or IPv6 unique-local addresses; metadata, link-local, unspecified, multicast, and reserved addresses remain blocked. DNS failures remain errors.

The [AWS local-services range](https://docs.aws.amazon.com/vpc/latest/userguide/subnet-route-tables.html) `fd00:ec2::/32`, including the [IPv6 instance metadata endpoint](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html), also remains blocked.

The exception applies to navigation, intercepted resources and WebSockets, and proxy URLs. Any page loaded by the server can request an allowlisted host. Only configure hostnames you intend to make reachable by browser tools. After restarting, check `camoufox_status.networkSecurity.allowedPrivateHosts` or `initialize.result.capabilities.extensions["camoufox-mcp"].policy.allowedPrivateHosts` for the active list.

`CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS` is read from the server environment at startup. There is no per-call `browse` parameter, and `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1` does not enable private hosts. Allowlisting cannot resolve a denial for metadata, link-local, AWS local-services, or reserved addresses.

When unsafe browser options are sent without `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`, the server rejects the request and logs a warning naming the rejected option family. Denied unsafe prefs and args remain rejected even when unsafe options are enabled.

### Network sandbox posture

The server blocks localhost, private, link-local, reserved, and unsafe browser request URLs at the application layer, subject to the explicit hostname exceptions above. This is best-effort protection: dedicated-worker WebSockets evade frame-based routing in both browser modes, and browser networking and DNS resolution can still create TOCTOU risk. See [browser compatibility evidence](browser-compatibility.md#remaining-network-and-output-limits).

For untrusted browsing, run the server behind container, VM, or host firewall egress rules that deny private, loopback, link-local, metadata, multicast, and reserved ranges. Docker/container detection in `camoufox_status` is only an environment signal, not proof that egress filtering is enforced.

Set `CAMOUFOX_MCP_NETWORK_SANDBOX=1` only after configuring those controls. Set `CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX=1` to refuse startup unless the deployment explicitly declares sandboxing.

`camoufox_status.browserCompatibility` reports the selected mode, expected and installed versions, launcher, and world-isolation warning. Both supported modes currently report `worldIsolationEnabled: false`. See [browser compatibility](browser-compatibility.md) for setup and evidence.
