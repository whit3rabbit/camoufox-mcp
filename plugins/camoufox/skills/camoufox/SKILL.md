---
name: camoufox
description: Browser automation with Camoufox MCP. Use when an agent needs to browse, inspect, screenshot, extract page structure, run bounded browser actions, manage short-lived browser sessions, or tune privacy and anti-detection options through the camoufox-mcp-server MCP server.
---

# Camoufox Browser Automation

Camoufox is a privacy-focused Firefox browser exposed through the `camoufox-mcp-server` TypeScript MCP server. Use it for browser work that benefits from realistic fingerprints, bounded extraction, screenshots, diagnostics, or short-lived interactive sessions.

This skill does not start the server by itself. Confirm that an MCP server named `camoufox` is available before using the tools. The installable plugin ships this safe default MCP config:

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"]
    }
  }
}
```

## Tool Names

Hosts expose MCP tool names differently. Use the host's listed Camoufox tools, usually with one of these naming forms:

- Claude/Hermes style: `mcp_camoufox_browse`
- OpenClaw bundle style: `camoufox__browse`
- Raw MCP tool name: `browse`

Core tools:

- `camoufox_status`: check server, browser, queue, session, policy, and network-security posture.
- `browse`: navigate once and return bounded text, HTML, metadata, diagnostics, and optional screenshot output.
- `browse_snapshot`: navigate once and return visible text, ARIA snapshot data, and interactive elements.
- `browse_sequence`: navigate once, run bounded CSS-selector actions, then return final state.
- `browse_links`, `browse_forms`, `browse_outline`, `browse_find`: low-context page extraction.
- `browse_screenshot`, `browse_console`, `browse_network_summary`: focused diagnostics.
- `browse_session_start`, `browse_session_navigate`, `browse_session_action`, `browse_session_snapshot`, `browse_session_resume`, `browse_session_close`: short-lived isolated browser sessions.

## First Check

Call `camoufox_status` before relying on advanced behavior.

Check these fields:

- `unsafeOptionsAllowed`: must be `true` before using `firefox_user_prefs`, `args`, or `exclude_addons`.
- `networkSecurity`: confirms the server's application-layer URL policy. Treat it as best-effort SSRF protection, not proof of network egress isolation.
- session limits and queue limits before starting multiple sessions.

Safe default: the bundled MCP config does not set `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS`. To use unsafe browser options, the operator must intentionally add:

```json
{
  "env": {
    "CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS": "1"
  }
}
```

Do not add that env var unless the user or local project config explicitly opts in.

## Common Calls

Metadata-only page check:

```json
{
  "url": "https://example.com",
  "outputMode": "metadata"
}
```

Visible text extraction:

```json
{
  "url": "https://example.com",
  "waitStrategy": "domcontentloaded",
  "maxChars": 12000
}
```

Screenshot:

```json
{
  "url": "https://example.com",
  "waitStrategy": "domcontentloaded",
  "screenshot": true
}
```

Inspect interactive elements:

```json
{
  "url": "https://example.com",
  "waitStrategy": "domcontentloaded",
  "maxElements": 80
}
```

Run a bounded sequence:

```json
{
  "url": "https://example.com",
  "waitStrategy": "domcontentloaded",
  "actions": [
    { "type": "click", "selector": "button[type=submit]" }
  ],
  "maxChars": 12000
}
```

## Stealth Profiles

Use `stealthProfile` as a shortcut, then override individual options only when needed.

| Profile | Use |
| --- | --- |
| `normal` | Default for most browsing. Humanized cursor, GeoIP, WebRTC blocked. |
| `privacy` | Adds WebGL blocking. More private, but can be more detectable on strict sites. |
| `human_assisted` | Visible browser and cache enabled, useful when a human may need to interact. |
| `fast` | Blocks images and disables humanization for speed. More detectable. |
| `debug` | Enables console and network diagnostics. |

## Hard-Site Tuning

This section is tuning guidance copied from prior integration work, not a fresh verification claim. Re-test with `camoufox_status` and a small browse call in your current environment before relying on it.

For Reddit and similarly strict sites:

- Prefer `stealthProfile: "normal"`.
- Prefer `os: "windows"` and `locale: "en-US"`.
- Prefer `waitStrategy: "domcontentloaded"` when sites keep network connections open or redirect after initial HTML.
- Avoid `stealthProfile: "privacy"` if WebGL blocking itself appears to trigger detection.
- If using `firefox_user_prefs`, first confirm `unsafeOptionsAllowed: true`.

Example opt-in tuning payload:

```json
{
  "url": "https://www.reddit.com/",
  "stealthProfile": "normal",
  "os": "windows",
  "locale": "en-US",
  "waitStrategy": "domcontentloaded",
  "timeout": 30000,
  "firefox_user_prefs": {
    "dom.ipc.enabled": false,
    "media.navigator.enabled": false,
    "privacy.resistFingerprinting": true,
    "network.http.altsvc.enabled": false,
    "dom.serviceWorkers.enabled": false,
    "dom.battery.enabled": false,
    "intl.accept_languages": "en-US,en;q=0.9"
  }
}
```

## CAPTCHA Handling

The server does not solve CAPTCHAs. It exposes bounded challenge context for the user or host agent.

- Use `captchaPolicy: "detect"` to identify challenge signals.
- Use `captchaPolicy: "pause"` for manual user action and then call `browse_session_resume`.
- Use `captchaPolicy: "attempt"` only to request provider metadata, iframe hints, suggested strategy text, and a bounded screenshot.
- `CAPTCHA_AUTONOMOUS=true` marks challenge handling as LLM-assisted and may include provider playbooks, but the server still does not perform hidden CAPTCHA bypasses.
- Use `disable_coop: true` only when iframe interaction requires it.

## Debugging

Read `references/json-rpc-debug.md` when the MCP host registration is not active or you need to test the server through raw JSON-RPC.

Common failures:

- Missing tools: the MCP server is not installed, not enabled, or the plugin was installed but not reloaded.
- Unsafe options rejected: `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` is not set, or a denied unsafe pref/arg was provided.
- Hanging navigation: try `waitStrategy: "domcontentloaded"` and a shorter `timeout`.
- Empty output: reduce scope with `selector`, use `browse_snapshot`, or check `browse_console` and `browse_network_summary`.
