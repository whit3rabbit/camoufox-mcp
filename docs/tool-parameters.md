# Tool Parameters

All tools share the browser and navigation parameters below:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | The URL to navigate to |
| `os` | enum | random | Operating system to spoof: 'windows', 'macos', or 'linux' |
| `waitStrategy` | enum | 'domcontentloaded' | Wait strategy: 'domcontentloaded', 'load', or 'networkidle' |
| `timeout` | number | 60000 | Page load timeout in milliseconds (5000-300000) |
| `humanize` | boolean | true | Enable realistic cursor movements |
| `locale` | string | system default | Browser locale (e.g., 'en-US') |
| `viewport` | object | {width: 1920, height: 1080} | Browser viewport dimensions |
| `block_webrtc` | boolean | true | Block WebRTC entirely for enhanced privacy (triggers: "private", "stealth", "WebRTC leak") |
| `proxy` | string/object | none | HTTP(S) proxy configuration. Proxy servers are checked against the same URL policy as page requests |
| `enable_cache` | boolean | false | Cache pages and requests (uses more memory) |
| `firefox_user_prefs` | object | none | Custom Firefox user preferences. Rejected unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`; denylisted prefs are always rejected |
| `exclude_addons` | array | none | List of default addons to exclude. Rejected unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1` |
| `window` | array | random | Fixed window size [width, height] instead of random |
| `args` | array | none | Additional browser command-line arguments. Rejected unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`; denylisted args are always rejected |
| `block_images` | boolean | false | Block all images for faster loading (triggers: "fast", "quick", "no images", "text only") |
| `block_webgl` | boolean | false | Block WebGL to prevent fingerprinting (triggers: "maximum privacy", "block tracking") |
| `disable_coop` | boolean | false | Disable Cross-Origin-Opener-Policy for iframe interaction (triggers: "iframe", "embedded content") |
| `geoip` | boolean | true | Auto-detect geolocation based on IP address |
| `headless` | boolean | auto | Run in headless mode (auto-detects best mode if not set) |
| `includeConsole` | boolean | false | Include bounded page console diagnostics |
| `includeNetwork` | boolean | false | Include bounded network diagnostics |
| `stealthProfile` | enum | `normal` | Profile shortcut: `normal`, `privacy`, `human_assisted`, `fast`, or `debug`. Explicit options override profile defaults |
| `captchaPolicy` | enum | tool-specific | Challenge policy: `detect`, `pause`, `fail`, or `attempt` |

`browse` also accepts:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputMode` | enum | 'text' | Return 'text', 'html', or 'metadata' |
| `maxChars` | number | 30000 | Maximum text or HTML characters to return (1000-200000) |
| `selector` | string | none | CSS selector to limit extraction to one element |
| `screenshot` | boolean | false | Capture a screenshot of the page |
| `screenshotOptions` | object | none | Optional `{ fullPage, selector, type, quality }` screenshot settings |

`browse_snapshot` also accepts:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `maxChars` | number | 30000 | Maximum visible text and ARIA snapshot characters |
| `maxElements` | number | 100 | Maximum interactive elements to return |
| `selector` | string | none | CSS selector to limit snapshot extraction to one element |

`browse_sequence` also accepts:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `actions` | array | required | Up to 25 actions: `click`, `hover`, `fill`, `type`, `select`, `press`, `waitFor`, `scroll`, or env-gated `evaluate` |
| `outputMode` | enum | 'text' | Final content mode: 'text', 'html', or 'metadata' |
| `maxChars` | number | 30000 | Maximum final text, HTML, snapshot, or evaluate-result characters |
| `selector` | string | none | CSS selector to limit final content and snapshot extraction |
| `maxElements` | number | 100 | Maximum final snapshot elements to return |
| `screenshot` | boolean | false | Capture a screenshot after all actions finish |
| `screenshotOptions` | object | none | Optional `{ fullPage, selector, type, quality }` screenshot settings |

Click actions accept `clickMode`: `dom` is the default and uses DOM activation for CI/Xvfb stability, `pointer` uses Playwright pointer input, and `auto` tries pointer first then falls back to DOM activation.

Each sequence action has a bounded timeout. The server also rejects sequences whose cumulative action timeout budget exceeds `CAMOUFOX_MCP_SEQUENCE_TIMEOUT_MS`, and applies that value as an absolute deadline while actions run.

Focused extractor tools also accept:

| Tool | Extra parameters |
|------|------------------|
| `browse_links` | `selector`, `maxLinks` |
| `browse_forms` | `selector`, `maxForms`, `maxFields` |
| `browse_outline` | `selector`, `maxItems` |
| `browse_find` | `query`, `selector`, `maxMatches`, `contextChars` |
| `browse_screenshot` | `selector`, `fullPage`, `type`, `quality` |
| `browse_network_summary` | `maxFailures` |

Session tools:

| Tool | Purpose |
|------|---------|
| `browse_session_start` | Start an isolated in-memory browser session. No persistent profiles are used |
| `browse_session_navigate` | Navigate an existing session and return bounded content |
| `browse_session_action` | Run one bounded action in the current session |
| `browse_session_snapshot` | Read visible text, ARIA snapshot, and interactive metadata from the current session |
| `browse_session_resume` | Resume after human action, optionally waiting for a load state |
| `browse_session_close` | Close the session and release its browser slot |

Sessions are ephemeral and memory-only. By default, one active session is allowed, and it expires after 10 minutes of inactivity.

Challenge handling is operator-controlled. By default, `captchaPolicy: "pause"` returns `captchaDetected`, `requiresUserAction`, `challengeSignals`, and the `sessionId` so a user can complete the challenge manually and then call `browse_session_resume`. With `captchaPolicy: "attempt"`, responses also include best-effort challenge provider metadata, iframe and interactive-element hints, suggested strategy text, and a bounded screenshot. Set `CAPTCHA_AUTONOMOUS=true` to mark detected challenges as `challengeHandling: "llm_assisted"` and include `challengePlaybook` context for known providers so the LLM can infer the next normal browser actions from the page state. The server itself does not perform hidden CAPTCHA bypasses or call an external skill; it exposes bounded challenge context for the client/LLM.

Stealth profiles:

| Profile | Defaults |
|---------|----------|
| `normal` | Humanized cursor, GeoIP, WebRTC blocked |
| `privacy` | `normal` plus WebGL blocked |
| `human_assisted` | Visible browser, cache enabled, CAPTCHA pause policy |
| `fast` | Images blocked and humanization disabled |
| `debug` | Console and network diagnostics enabled |
