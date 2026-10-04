---
name: camoufox
description: Browser automation with Camoufox MCP. Use when an agent needs to browse a URL, extract page text or structure, fill or submit forms, click through a page, screenshot, run diagnostics, drive a multi-step interactive browser session, or tune privacy and anti-detection options through the camoufox-mcp-server MCP server. Also use when a fetch or HTTP request gets blocked, returns a bot wall, needs a real browser fingerprint, or Camoufox URL policy blocks a private development hostname.
---

# Camoufox Browser Automation

Camoufox is a privacy-focused Firefox exposed through the `camoufox-mcp-server` MCP server. Reach for it when a plain HTTP fetch is not enough: JavaScript-rendered pages, bot walls, forms, multi-step flows, screenshots, or anything that benefits from a realistic browser fingerprint.

Every tool launches or reuses a real browser, so each call costs time and tokens. The whole skill is about getting the answer in the fewest, narrowest calls. Two habits do most of the work:

1. **Pick the narrowest tool for the question** (see Choosing a Tool). A page's link list, headings, or one text match is far cheaper than its full rendered text.
2. **Bound every call.** Set `maxChars`, `selector`, or `outputMode: "metadata"` so a giant page can't blow up your context.

This skill does not start the server. Confirm an MCP server named `camoufox` is available first. The installable plugin ships this config with unsafe browser options enabled so hard-site tuning can use `firefox_user_prefs`, `args`, and `exclude_addons`:

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"],
      "env": { "CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS": "1" }
    }
  }
}
```

Bare `npx -y camoufox-mcp-server@latest` remains safe by default unless the host config adds that env var.

On a fresh machine, install the Camoufox binary once. From a repository checkout, run `npm run fetch:camoufox`. Global installs of 2.6.0 expose `camoufox-mcp-fetch` and `camoufox-mcp-doctor`. After release 2.6.0 is published, npx installs can use `npx --yes --package camoufox-mcp-server@2.6.0 camoufox-mcp-fetch` (replace the last command with `camoufox-mcp-doctor` for diagnostics). Use the same environment as the MCP server. Avoid `camoufox-js fetch`: its updater can select a build that bypasses WebSocket interception. Status and launch preflight inspect the cache without downloading.

## Bring the Server Up (operator / local checkout)

`npx camoufox-mcp-server@latest` self-installs, but a local checkout or a first
run needs the browser binary fetched and a preflight before you trust it:

```bash
npm install --include=optional # repository builds require Node >=22.15
npm run build          # compile dist/
npm run fetch:camoufox # download the Camoufox browser binary
npm run doctor         # preflight: pins, cached binary, live browse smoke test
```

`npm run doctor` verifies Node, launcher/Playwright pins, and the selected cached browser, then drives a real `browse` when preflight passes. Run it when the server misbehaves; it prints the failed check and fix. The published default runtime supports Node >=22.0 without the optional launcher. Repository builds require Node >=22.15 and that launcher for TypeScript declarations. Then register the server with your host (see Host Setup Failures below for Hermes).

## Opt In to the Newer Browser

The default is beta.28 with `camoufox-js` 0.12.0 and direct `playwright-core` 1.59.0. Beta.33 compatibility uses optional `@camoufox/camoufox` 0.5.7-beta.4 and requires Node >=22.15. From a checkout:

```bash
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run fetch:camoufox
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run doctor
```

Set `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1` in the host's MCP server environment too. Compatibility uses a separate `camoufox-compatibility` sibling cache unless `CAMOUFOX_INSTALL_DIR` selects another directory. Use the same values for installation and startup.

This mode disables the newer browser's world isolation to restore page/iframe WebSocket interception. Websites can inspect automation JavaScript, so it reduces stealth relative to upstream defaults. Beta.28 also runs automation in the page world. Dedicated-worker WebSockets evade interception in both modes; untrusted browsing requires actual network egress controls. See the repository's [browser compatibility guide](https://github.com/whit3rabbit/camoufox-mcp/blob/main/docs/browser-compatibility.md) for evidence and remaining limits.

## Tool Names

Hosts expose MCP tool names differently. Use whatever the host lists; common forms:

- Hermes style: `mcp_camoufox_browse` (single underscore, `mcp_<server>_<tool>`; some setups show the double `mcp__camoufox__browse`)
- Claude Code style: `mcp__camoufox__browse`
- OpenClaw bundle style: `camoufox__browse`
- Raw MCP name: `browse`

This skill uses raw names (`browse`, `browse_find`, ...). Map them to your host's form.

In Hermes, `browser_navigate` is the built-in browser tool, not Camoufox. Use the `mcp_camoufox_*` tools after `hermes mcp test camoufox` succeeds.

## Choosing a Tool

Start from the question, not from `browse`. `browse` returns a wall of page text; the extractor tools return only the slice you asked for, which keeps your context small and the answer easy to read.

| You want | Use | Why |
| --- | --- | --- |
| Just confirm a page loads / get title + status | `browse` with `outputMode: "metadata"` | No body text at all |
| The page's readable text / article body | `browse` (default `text`), set `maxChars` | Bounded visible text |
| Raw HTML (only if you truly need markup) | `browse` with `outputMode: "html"` | Skip unless parsing markup |
| All links on the page | `browse_links` | Structured list, no body noise |
| Form fields and submit buttons | `browse_forms` | Names, types, controls only |
| Page structure / headings / sections | `browse_outline` | Headings + landmarks |
| Does the page contain "X"? Where? | `browse_find` with `query` | Bounded context around matches |
| What can I click/type? (interactive map) | `browse_snapshot` | Visible text + ARIA + elements |
| Navigate + a few actions, then read once | `browse_sequence` | One round trip, bounded actions |
| A screenshot | `browse_screenshot` (or `screenshot: true` on `browse`) | Image output |
| Console errors / failed requests | `browse_console`, `browse_network_summary` | Focused diagnostics |
| Multi-step flow with state between calls | session tools | Persistent page across calls |

Rules of thumb:

- Need one fact from a page? `browse_find` beats reading the whole thing.
- If the page you want has a predictable URL (`.../page/2/`, a category, a permalink), navigate straight to it. Reserve `browse_sequence` click-throughs for when the destination URL isn't knowable up front: search results, JS-built navigation, a control with no stable href. Clicking your way to a page you could have requested directly is slower and more fragile.
- Need to act, then read the result, in one shot? `browse_sequence`. Need to keep a logged-in / cookie-bearing page alive across several *unscripted* decisions? A session.
- `selector` scopes an extractor to **one** matching element (e.g. `selector: "main"`). Two failure modes follow: a selector that matches nothing returns empty (not an error), and a per-item selector on a list (e.g. `.quote .author`) returns only the *first* item. For a whole list, scope to the container or drop the selector. If a scoped call comes back empty or short, widen it rather than piling on more calls chasing the same wrong selector.
- Want exact or long text the page truncates visually (ellipsised titles, styled labels)? `browse_snapshot` reads element names from the ARIA tree, which keeps the full string where `browse` visible-text may cut it off.

## First Check

Call `camoufox_status` before relying on advanced behavior. It returns server, browser, queue, session, and policy state without launching a page.

Fields worth reading:

- `browserAvailable`: the selected binary and version were found; this does not prove a launch works. Confirm an actual `browse`.
- `browserCompatibility`: mode, expected/installed versions, launcher, and warning. Both supported modes report `worldIsolationEnabled: false`.
- `unsafeOptionsAllowed`: must be `true` before sending `firefox_user_prefs`, `args`, or `exclude_addons`.
- `evaluateAllowed`: must be `true` before using the `evaluate` action in a sequence/session.
- `maxConcurrency`, `maxQueue`, `maxSessions`, `sessionTtlMs`: capacity limits. Sessions auto-expire after `sessionTtlMs`; don't start more than `maxSessions`.
- `activeSessions`, `queuedRequests`: current load.
- `networkSecurity`: the server's application-layer URL policy. `ssrfPolicy: "app_layer_best_effort"` means best-effort SSRF filtering, not proof of network isolation. Check `warning` and `strictSandboxRequired`.
- `networkSecurity.allowedPrivateHosts`: exact hostnames allowed to resolve to loopback or private addresses. This is a server startup setting; an empty list keeps the default private-host block.

The active default wait strategy and stealth profile are advertised separately, during MCP `initialize`, at `result.capabilities.extensions["camoufox-mcp"].policy` (`defaultWaitStrategy`, `defaultStealthProfile`) — not in the `camoufox_status` body.

Packaged plugin default: the bundled config sets `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`. Bare server installs do not. Do not add `CAMOUFOX_MCP_ALLOW_EVALUATE` unless the user or project config explicitly opts in.

## Private development hosts

The default URL policy blocks local/private addresses, including DNS names that resolve to them. The opt-in works with any exact hostname, such as `localhost`, `laravel.test`, `app.local`, `dashboard.internal`, or `intranet.corp`; it is not restricted to a domain suffix.

Read the full MCP error when a URL or resource is blocked. For an eligible private hostname, the error includes a remedy such as `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=dashboard.internal` and a server restart instruction. The hint refers to the blocked resource's hostname, which may differ from the page hostname.

For the trusted private hosts required by the user's task:

1. Add their exact hostnames to the existing MCP server's `env` configuration, preserving current entries:

   ```json
   {
     "CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS": "localhost,laravel.test,dashboard.internal"
   }
   ```

2. Restart the MCP server through the host. Changing your shell environment does not update a running server. Use the host CLI or operator instructions when its configuration cannot be edited directly.
3. Confirm `camoufox_status.networkSecurity.allowedPrivateHosts` contains the requested hostname, then retry the original browser call. Restarted sessions require a new `sessionId`. If the status field is absent, use a server build containing this feature, currently available from repository `main`; older published packages can ignore the setting.

Names must resolve through DNS or hosts entries in the environment running Node and the browser, including a container or VM. Entries are comma-separated hostnames, with no wildcard, URL, port, or IP literal. Each private asset or redirect hostname needs its own entry. For a direct loopback or ordinary private-IP URL, configure a resolvable hostname and browse using that name.

This setting is not a tool argument. `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS`, Firefox preferences, and test-only localhost settings do not replace it. Metadata, link-local, multicast, unspecified, and reserved addresses remain blocked even for listed hosts; an error without an opt-in remedy may identify one of those addresses. Add only hosts required by the user's task.

Read [private-host JSON-RPC setup](references/json-rpc-debug.md#test-a-private-development-host) when debugging the startup environment or an error hint.

## Common Calls

Metadata only (does it load? title? status):

```json
{ "url": "https://example.com", "outputMode": "metadata" }
```

Bounded visible text:

```json
{ "url": "https://example.com", "maxChars": 12000 }
```

Find one thing on a page (cheap, targeted):

```json
{ "url": "https://example.com", "query": "pricing", "maxMatches": 3 }
```

Map what's interactive before acting:

```json
{ "url": "https://example.com", "maxElements": 80 }
```

Navigate, act, read once (no session needed):

```json
{
  "url": "https://example.com/login",
  "actions": [
    { "type": "fill", "selector": "#user", "value": "alice" },
    { "type": "fill", "selector": "#pass", "value": "secret" },
    { "type": "click", "selector": "button[type=submit]" },
    { "type": "waitFor", "loadState": "domcontentloaded" }
  ],
  "maxChars": 8000
}
```

Screenshot:

```json
{ "url": "https://example.com", "screenshot": true }
```

## Sequence Actions

`browse_sequence` (one round trip) and `browse_session_action` (one action in a live session) both take the same action objects. Available types: `click`, `hover`, `fill`, `type`, `select`, `press`, `waitFor`, `scroll`, `evaluate`.

Read `references/sequence-actions.md` for every field, `clickMode` (DOM vs pointer), `frame` (acting inside an iframe), and `waitFor` states. Two things to remember up front:

- Prefer `fill` for setting an input's value; use `type` only when you need real per-keystroke events (delays, key handlers).
- `evaluate` runs arbitrary JS and is disabled unless the operator sets `CAMOUFOX_MCP_ALLOW_EVALUATE=1` (check `evaluateAllowed` in status first).

## Interactive Sessions

Use a session when you need the *same* page (cookies, login, scroll position, JS state) across several decisions you can't script up front — e.g. log in, look at the result, then decide where to go next. For a fixed known sequence, `browse_sequence` is cheaper because it's a single call.

Sessions are short-lived and auto-expire after `sessionTtlMs`. Always close them when done so you don't hold a slot.

Lifecycle:

1. `browse_session_start` → returns a `sessionId`. Pass stealth/privacy options here; they apply for the session's life.
2. `browse_session_navigate` → go to a URL in that session.
3. `browse_session_action` → run one action (same action objects as sequences).
4. `browse_session_snapshot` → read current visible text + interactive elements without acting.
5. `browse_session_resume` → after a paused CAPTCHA or human step, wait for load state and re-read.
6. `browse_session_close` → free the slot.

Worked example — log in, then branch based on what you see:

```json
// 1. start
{}  // → { "sessionId": "abc123", ... }

// 2. navigate (browse_session_navigate)
{ "sessionId": "abc123", "url": "https://example.com/login" }

// 3. fill + submit (browse_session_action, one per call)
{ "sessionId": "abc123", "action": { "type": "fill", "selector": "#user", "value": "alice" } }
{ "sessionId": "abc123", "action": { "type": "fill", "selector": "#pass", "value": "secret" } }
{ "sessionId": "abc123", "action": { "type": "click", "selector": "button[type=submit]" } }

// 4. read state and decide (browse_session_snapshot)
{ "sessionId": "abc123", "maxElements": 60 }

// 5. close (browse_session_close)
{ "sessionId": "abc123" }
```

If a navigation or action returns a CAPTCHA pause, hand control to the user, then call `browse_session_resume` with the same `sessionId` once they've solved it.

## Stealth Profiles

Use `stealthProfile` as a shortcut, then override individual options only when needed.

| Profile | Use |
| --- | --- |
| `normal` | Default for most browsing. Humanized cursor, GeoIP, WebRTC blocked. |
| `privacy` | Adds WebGL blocking. More private, but can be more detectable on strict sites. |
| `human_assisted` | Visible browser and cache enabled, for when a human may need to interact. |
| `fast` | Blocks images and disables humanization for speed. More detectable. |
| `debug` | Enables console and network diagnostics. |

## Hard-Site Tuning

This is carried-over tuning guidance, not a fresh verification claim. Re-test with `camoufox_status` and a small `browse` call in your environment before relying on it.

For Reddit and similarly strict sites:

- Prefer `stealthProfile: "normal"` and `os: "windows"`.
- Leave `locale` unset unless the user or operator explicitly asks for locale testing. If you set it, match the approved target locale and align `intl.accept_languages` to the same locale family.
- Keep the default `waitStrategy: "domcontentloaded"`; it's safer for sites that hold connections open or redirect after the first HTML.
- Avoid `stealthProfile: "privacy"` if WebGL blocking itself seems to trigger detection.
- `firefox_user_prefs` requires `unsafeOptionsAllowed: true`. Some prefs (e.g. `dom.serviceWorkers.enabled`) are denied even then; remove any pref the server rejects.

Opt-in tuning payload:

```json
{
  "url": "https://www.reddit.com/",
  "stealthProfile": "normal",
  "os": "windows",
  "timeout": 30000,
  "firefox_user_prefs": {
    "media.navigator.enabled": false,
    "privacy.resistFingerprinting": true,
    "network.http.altsvc.enabled": false,
    "dom.battery.enabled": false
  }
}
```

If locale testing is explicitly approved, add matching values such as:

```json
{
  "locale": "<approved-locale>",
  "firefox_user_prefs": {
    "intl.accept_languages": "<approved-locale>,<base-language>;q=0.9"
  }
}
```

## CAPTCHA Handling

The server does not solve CAPTCHAs. It surfaces bounded challenge context for the user or host agent. Set `captchaPolicy`:

- `detect`: report challenge signals only.
- `pause`: return state for manual action, then call `browse_session_resume`.
- `fail`: return an error when a challenge is detected.
- `attempt`: return enhanced metadata (provider, iframe hints, suggested strategy, bounded screenshot). Still no hidden bypass.

`CAPTCHA_AUTONOMOUS=true` marks handling as LLM-assisted and may add provider playbooks, but the server still performs no covert bypass. Use `disable_coop: true` only when iframe interaction needs it.

## Debugging

Read `references/json-rpc-debug.md` when the host hasn't registered the server or you need to test it through raw JSON-RPC.

## Host Setup Failures

Native module errors such as `better-sqlite3` compiled for the wrong Node.js version (`NODE_MODULE_VERSION` mismatch) come from this server's own dependency tree: `camoufox-js` pulls in `better-sqlite3`, whose native binary is tied to the Node version that ran the install. On Node 22.15+ the server (2.1.6+) avoids the native module entirely by using the built-in `node:sqlite`, so first make sure the gateway launches an up-to-date server version. If the error persists on an older Node, remember that `npx` keeps its own dependency copy under `~/.npm/_npx/<hash>/node_modules` — rebuilding another checkout does not fix it; clear the npx cache (`rm -rf ~/.npm/_npx`) using the same Node version the gateway spawns, then restart the gateway because the old MCP process keeps the old native module loaded. On a local checkout, `npm run doctor` surfaces most launch-blocking problems before a `browse` fails.

If the host blocks direct config edits, do not patch protected files. Use the host CLI or tell the operator exactly what to add. For Hermes, this verified command registers Camoufox with unsafe browser options enabled:

```bash
printf "Y\n" | hermes mcp add camoufox --command npx --env CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 --args -y camoufox-mcp-server@latest
```

> **Hermes TTY Gotcha:** `hermes mcp add` interactively prompts `"Enable all 17 tools? [Y/n/select]"`. On a non-TTY (piped/scripted inputs), the default response is `"n"` (canceled). Pipe `Y\n` as shown above to automatically enable the tools.

Hermes `--env` values are `KEY=VALUE`. `--args` must be the last option and receives plain argv tokens, not a JSON array string. To verify the saved MCP server entry, run `hermes mcp list`; the entry should look like this:

```yaml
mcp_servers:
  camoufox:
    command: npx
    args:
      - -y
      - camoufox-mcp-server@latest
    enabled: true
    env:
      CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS: "1"
```

For local development, use `command: node` and a one-item `args` list containing the absolute `dist/index.js` path. Then run `hermes mcp list`, `hermes mcp test camoufox`, restart the gateway from a separate terminal, and confirm with `mcp_camoufox_camoufox_status.unsafeOptionsAllowed`.

If Hermes reports an ambiguous `camoufox` skill, keep only one installed Camoufox skill path or load the categorized path explicitly.

Common failures:

- **Missing tools**: server not installed/enabled, or plugin installed but not reloaded.
- **Private/local host rejected**: read the MCP error's `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS` remedy and follow [private development hosts](#private-development-hosts). Add exact required hostnames to server `env`, restart, and verify status before retrying.
- **Unsafe option rejected**: `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` not set, or a denied pref/arg was sent. The server logs which option family it rejected.
- **`evaluate` rejected**: `CAMOUFOX_MCP_ALLOW_EVALUATE` not set (`evaluateAllowed: false`).
- **Hanging navigation**: a call overrode `waitStrategy` to `load`/`networkidle`; revert to `domcontentloaded` and try a shorter `timeout`.
- **Empty output**: narrow with `selector`, switch to `browse_snapshot`, or check `browse_console` and `browse_network_summary`.
- **Browser won't launch / `Library not loaded: @rpath/libmozglue.dylib`**: a corrupt or mismatched cache. Run the pinned installer with the same compatibility flag and `CAMOUFOX_INSTALL_DIR` as the host; it replaces mismatched builds. If metadata matches but libraries are corrupt, stop the server, move aside the exact cache directory reported by doctor, and refetch.
- **`Error: ENOSPC: no space left on device` during fetch**: Download and storage requirements vary by platform and build. Allow space for the archive, extracted browser, and supporting assets in the install and OS temporary filesystems. Inspect installer scratch directories and confirm each is abandoned and unused by a live installer before removing that exact directory. Then retry the pinned fetch.
- **Juggler errors after a dependency change**: this package pins `playwright-core` directly at 1.59.0 across install paths. Keep that pin with the selected browser/launcher versions; `npm run doctor` flags drift.
