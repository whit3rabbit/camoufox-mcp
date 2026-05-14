# Camoufox MCP Server 🦊

An MCP (Model Context Protocol) server that provides browser automation capabilities using [Camoufox](https://github.com/daijro/camoufox) - a privacy-focused Firefox fork with advanced anti-detection features.

## Quick Install

Use the published npm package unless you are developing this repository locally.

### Claude Code CLI

```bash
claude mcp add camoufox -- npx -y camoufox-mcp-server@latest
```

For a shared project-scoped Claude Code config:

```bash
claude mcp add --scope project camoufox -- npx -y camoufox-mcp-server@latest
```

Verify with `/mcp` inside Claude Code.

### Codex CLI

```bash
codex mcp add camoufox -- npx -y camoufox-mcp-server@latest
```

Codex stores MCP servers in `~/.codex/config.toml` by default. Verify with `/mcp` inside Codex.

### opencode

Add this to `opencode.json` in your project or to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "camoufox": {
      "type": "local",
      "command": ["npx", "-y", "camoufox-mcp-server@latest"],
      "enabled": true
    }
  }
}
```

Verify with:

```bash
opencode mcp list
```

### Pi Coding Agent

Install the MCP adapter, then add Camoufox to `.mcp.json` or `~/.config/mcp/mcp.json`:

```bash
pi install npm:pi-mcp-adapter
```

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

## Try Camoufox

Once configured, ask your assistant for browser work in plain language:

```text
Use Camoufox to browse https://example.com and return metadata only.
```

```text
Use Camoufox to inspect the interactive elements on https://example.com.
```

```text
Use Camoufox to open https://example.com, take a screenshot, and summarize the visible page.
```

```text
Use Camoufox to browse https://developer.mozilla.org with images blocked and WebRTC blocked.
```

## Features

- 🛡️ **Advanced Anti-Detection**: Rotating OS fingerprints, realistic cursor movements, and browser fingerprint spoofing
- 🔧 **Enhanced Parameters**: Configurable wait strategies, timeouts, viewport dimensions, and more
- 🌐 **Cross-Platform**: Works on Windows, macOS, and Linux (including Docker)
- 📸 **Screenshot Support**: Capture bounded page screenshots alongside page content
- 🚀 **Easy Integration**: Compatible with Claude Desktop, VS Code, Cursor, Windsurf, and more

## Requirements

- Node.js 22 or higher
- Python 3.x (for running tests)

## Configuration for AI Assistants

<details>
<summary>Claude Code (CLI)</summary>

Use the Quick Install command above for the published server. Use `--scope project` when you want Claude Code to create or update a shared `.mcp.json` in the current repository.

```bash
npm install
npm run build
claude mcp add --scope project camoufox-dev -- node dist/index.js
```

Then run `/mcp` in Claude Code and enable `camoufox-dev` if prompted. Claude Code stores project-scoped MCP servers in `.mcp.json`; private local and user scopes are stored elsewhere.

Reference: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).
</details>

<details>
<summary>Claude Desktop</summary>

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Using npx (Recommended)
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

#### Using Docker
```json
{
  "mcpServers": {
    "camoufox": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "followthewhit3rabbit/camoufox-mcp:latest"]
    }
  }
}
```

#### Using Global Installation
```json
{
  "mcpServers": {
    "camoufox": {
      "command": "camoufox-mcp-server"
    }
  }
}
```
</details>

<details>
<summary>Codex CLI and IDE Extension</summary>

Use the Quick Install command above for the published server. Codex does not use `.mcp.json`. It stores MCP servers in `config.toml`, normally `~/.codex/config.toml`, and can also use a project-scoped `.codex/config.toml` in trusted projects.

For local development, add a project or user Codex config entry with an explicit `cwd`:

```toml
[mcp_servers.camoufox-dev]
command = "node"
args = ["dist/index.js"]
cwd = "/absolute/path/to/camoufox-mcp"
```

Run `npm install` and `npm run build` before starting Codex. In the Codex TUI, use `/mcp` to confirm the server is active.

Reference: [Codex MCP docs](https://developers.openai.com/codex/mcp).
</details>

<details>
<summary>opencode</summary>

Use the Quick Install config above for the published server. For local development from this checkout, put this in a project `opencode.json` and run `node dist/index.js` after building:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "camoufox-dev": {
      "type": "local",
      "command": ["node", "dist/index.js"],
      "enabled": true
    }
  }
}
```

If you put the development server in global opencode config, use an absolute path instead of `dist/index.js`.

Reference: [opencode MCP docs](https://opencode.ai/docs/mcp-servers/).
</details>

<details>
<summary>Pi Coding Agent</summary>

Use the Quick Install steps above to install `pi-mcp-adapter` and configure Camoufox in `.mcp.json` or `~/.config/mcp/mcp.json`.

Reference: [Pi MCP Adapter docs](https://pi.dev/packages/pi-mcp-adapter).
</details>

<details>
<summary>VS Code (with Continue extension)</summary>

Add to your `.continue/config.json`:

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
</details>

<details>
<summary>Cursor</summary>

Add to your Cursor settings (Preferences → Features → MCP):

```json
{
  "mcp": {
    "servers": {
      "camoufox": {
        "command": "npx",
        "args": ["-y", "camoufox-mcp-server@latest"]
      }
    }
  }
}
```
</details>

<details>
<summary>Windsurf</summary>

Add to your Windsurf configuration file at `~/.windsurf/mcp.json`:

```json
{
  "servers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"]
    }
  }
}
```
</details>

<details>
<summary>Cline (VS Code Extension)</summary>

Add to VS Code settings.json:

```json
{
  "cline.mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"]
    }
  }
}
```
</details>

## Installation

### Quick Start with npx

The easiest way to use Camoufox MCP Server is with npx (no installation required):

```bash
npx -y camoufox-mcp-server@latest
```

### Docker Installation

Run the server using Docker:

```bash
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest
```

### NPM Installation

Install globally:

```bash
npm install -g camoufox-mcp-server@latest
```

Or add to your project:

```bash
npm install camoufox-mcp-server@latest
```

## Usage

Once configured, the Camoufox MCP server provides bounded browser tools that your AI assistant can use to navigate websites, inspect page structure, extract low-context page data, capture screenshots, inspect diagnostics, and run short-lived isolated sessions.

Available tools:
- `camoufox_status`: return server, browser, queue, session, and policy status.
- `browse`: navigate once and return bounded text, HTML, metadata, diagnostics, and optional screenshot output.
- `browse_snapshot`: navigate once and return bounded visible text, ARIA snapshot data, and interactive element metadata.
- `browse_sequence`: navigate once, run up to 25 CSS-selector actions, then return final content, snapshot data, diagnostics, and optional screenshot output.
- `browse_links`: navigate once and return navigable links only.
- `browse_forms`: navigate once and return form fields and submit controls.
- `browse_outline`: navigate once and return headings, description, and landmarks.
- `browse_find`: navigate once, search visible text, and return bounded context matches.
- `browse_screenshot`: navigate once and capture a bounded screenshot as a first-class tool.
- `browse_console`: navigate once and return bounded console diagnostics.
- `browse_network_summary`: navigate once and return bounded network counts and failures.
- `browse_session_start`, `browse_session_navigate`, `browse_session_action`, `browse_session_snapshot`, `browse_session_resume`, `browse_session_close`: manage short-lived isolated browser sessions.

### Natural Language Triggers

The AI assistant can use the browser tools when you use phrases like:

**Basic Browsing:**
- "**Search** for information about..."
- "**Visit** this website: ..."
- "**Check** what's on ..."
- "**Navigate** to ..."
- "**Fetch** content from ..."
- "**Browse** to ..."
- "**Go to** the website ..."
- "**Open** this page: ..."
- "**Look at** this URL: ..."
- "**Scrape** data from ..."

**Privacy & Stealth:**
- "Visit **privately**..."
- "Browse in **stealth mode**..."
- "Browse **through a proxy**..."
- "**Block tracking** while visiting..."

**Screenshots:**
- "**Take a screenshot** of..."
- "**Capture an image** of..."
- "**Show me visually** what ... looks like"
- "I want to **see how** ... appears"

**Performance:**
- "**Quick browse** to..."
- "**Fast loading** of..."
- "Browse **without images**..."
- "**Lightweight browsing** to..."
- "**Text-only** content from..."

### Basic Usage Examples

```
Can you check what's on example.com?
```

```
Search for information on the latest tech news from techcrunch.com
```

```
Visit github.com and tell me what's trending
```

The AI will usually use `browse` to retrieve visible text by default. Raw HTML is available with `outputMode: "html"`, and page structure is available through `browse_snapshot`.

For lower-context workflows, prefer `browse_links`, `browse_forms`, `browse_outline`, or `browse_find` over raw HTML. Use session tools for login flows, multi-step forms, carts, dashboards, and human-in-the-loop challenge handling.

### Advanced Usage

```
Please visit example.com using a Windows browser with a 1920x1080 viewport and wait for all resources to load. Take a screenshot too.
```

### More Conversational Examples

```
I need to research the current stock price of Apple. Can you go to finance.yahoo.com and search for AAPL?
```

```
Check if the restaurant's website has their menu online. Visit bistro-example.com and look for their menu section.
```

```
I'm looking for job postings in tech. Can you browse to linkedin.com/jobs and see what's available?
```

```
Navigate to the documentation site for React and find information about hooks.
```

The AI can use advanced parameters like:
- `os`: Spoof operating system (windows, macos, linux)
- `waitStrategy`: How to wait for page load (domcontentloaded, load, networkidle)
- `timeout`: Maximum time to wait (5-300 seconds)
- `outputMode`: Return visible text, raw HTML, or metadata only
- `maxChars`: Cap returned text or HTML
- `selector`: Limit extraction to one CSS selector
- `viewport`: Custom browser dimensions
- `screenshot`: Capture a screenshot
- `screenshotOptions`: Capture full-page, selector-only, PNG, or JPEG screenshots
- `includeConsole`: Return bounded console diagnostics
- `includeNetwork`: Return bounded network diagnostics
- `humanize`: Enable realistic mouse movements
- `locale`: Set browser locale (e.g., 'en-US', 'fr-FR')
- `block_webrtc`: Block WebRTC for privacy
- `proxy`: Use a proxy server for requests
- `enable_cache`: Enable browser caching
- `window`: Set fixed window size

### Example with Privacy Options

```
Browse example.com with WebRTC blocked and through an HTTP proxy server proxy.example.com:8080
```

### Example with Custom Preferences

```
Visit example.com with a fixed 1280x720 window size and custom Firefox preferences to disable JavaScript
```

### Example with Performance Optimization

```
Browse news.example.com with images blocked for faster loading and a 10 second timeout
```

### Privacy & Stealth Examples

```
Browse example.com with WebRTC blocked and fingerprint protection enabled
```

```
Visit sensitive-site.com through an HTTP proxy
```

```
Browse privately to banking-site.com with WebRTC blocked and fingerprint protection
```

```
Access geo-blocked content via proxy server proxy.example.com:8080
```

### Screenshot Examples

```
Take a screenshot of the homepage at example.com
```

```
Capture an image of how the login page looks on mobile-site.com
```

```
Show me visually what the product page looks like on store.example.com
```

### Snapshot Examples

```
Inspect the interactive elements on example.com
```

```
Get a page snapshot for the login form at app-example.com
```

### Interaction Sequence Examples

```
Open example.com and click the main link, then tell me where it ends up
```

```
Open a search page, fill the search input, submit it, and summarize the results
```

### Performance & Speed Examples

```
Quick browse to news-site.com without loading images for faster access
```

```
Lightweight browsing to documentation-site.com, text content only
```

```
Fast loading of search results from search-engine.com, no images needed
```

### Advanced Privacy Combinations

```
Visit example.com with WebRTC blocked, WebGL blocked, images blocked, and geoip detection disabled
```

```
Browse through HTTP proxy proxy.example.com:8080 with username 'user' and password 'pass' to access restricted content
```

### Cross-Origin & Embedded Content

```
Browse iframe-test.example.com with Cross-Origin-Opener-Policy disabled when embedded content requires it
```

```
Inspect embedded content on complex-site.com
```

## Tool Parameters

All tools share the browser and navigation parameters below:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | The URL to navigate to |
| `os` | enum | random | Operating system to spoof: 'windows', 'macos', or 'linux' |
| `waitStrategy` | enum | 'load' | Wait strategy: 'domcontentloaded', 'load', or 'networkidle' |
| `timeout` | number | 60000 | Page load timeout in milliseconds (5000-300000) |
| `humanize` | boolean | true | Enable realistic cursor movements |
| `locale` | string | system default | Browser locale (e.g., 'en-US') |
| `viewport` | object | {width: 1920, height: 1080} | Browser viewport dimensions |
| `block_webrtc` | boolean | true | Block WebRTC entirely for enhanced privacy (triggers: "private", "stealth", "WebRTC leak") |
| `proxy` | string/object | none | HTTP(S) proxy configuration. Proxy servers are checked against the same URL policy as page requests |
| `enable_cache` | boolean | false | Cache pages and requests (uses more memory) |
| `firefox_user_prefs` | object | none | Custom Firefox user preferences. Disabled unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1` |
| `exclude_addons` | array | none | List of default addons to exclude. Disabled unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1` |
| `window` | array | random | Fixed window size [width, height] instead of random |
| `args` | array | none | Additional browser command-line arguments. Disabled unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1` |
| `block_images` | boolean | false | Block all images for faster loading (triggers: "fast", "quick", "no images", "text only") |
| `block_webgl` | boolean | false | Block WebGL to prevent fingerprinting (triggers: "maximum privacy", "block tracking") |
| `disable_coop` | boolean | false | Disable Cross-Origin-Opener-Policy for iframe interaction (triggers: "iframe", "embedded content") |
| `geoip` | boolean | true | Auto-detect geolocation based on IP address |
| `headless` | boolean | auto | Run in headless mode (auto-detects best mode if not set) |
| `includeConsole` | boolean | false | Include bounded page console diagnostics |
| `includeNetwork` | boolean | false | Include bounded network diagnostics |
| `stealthProfile` | enum | `normal` | Profile shortcut: `normal`, `privacy`, `human_assisted`, `fast`, or `debug`. Explicit options override profile defaults |
| `captchaPolicy` | enum | tool-specific | Safe challenge policy: `detect`, `pause`, `fail`, or `attempt` |

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

Challenge handling is detection-only. If `captchaPolicy` is `pause`, session tools return `captchaDetected`, `requiresUserAction`, `challengeSignals`, and the `sessionId` so a user can complete the challenge manually and then call `browse_session_resume`. If `captchaPolicy` is `attempt`, the response also includes best-effort challenge provider metadata, iframe and interactive-element hints, suggested manual strategy text, and a bounded screenshot. The server does not solve or bypass CAPTCHA or bot checks.

Stealth profiles:

| Profile | Defaults |
|---------|----------|
| `normal` | Humanized cursor, GeoIP, WebRTC blocked |
| `privacy` | `normal` plus WebGL blocked |
| `human_assisted` | Visible browser, cache enabled, CAPTCHA pause policy |
| `fast` | Images blocked and humanization disabled |
| `debug` | Console and network diagnostics enabled |

## Server Policy

The server applies deny-by-default policy checks before and during browsing:

| Variable | Default | Description |
|----------|---------|-------------|
| `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` | unset | Set to `1` to allow `args`, `firefox_user_prefs`, and `exclude_addons` |
| `CAMOUFOX_MCP_ALLOW_EVALUATE` | unset | Set to `1` to allow `browse_sequence` evaluate actions. This is unsafe because page JavaScript can read page state |
| `CAMOUFOX_MCP_MAX_CONCURRENCY` | `1` | Maximum simultaneous browse requests, clamped to 1-8 |
| `CAMOUFOX_MCP_MAX_SESSIONS` | `1` | Maximum active browser sessions, clamped to 1-4 |
| `CAMOUFOX_MCP_SESSION_TTL_MS` | `600000` | Session inactivity TTL, clamped to 300000-900000 |
| `CAMOUFOX_MCP_MAX_QUEUE` | `8` | Maximum queued browse requests, clamped to 0-100 |
| `CAMOUFOX_MCP_QUEUE_TIMEOUT_MS` | `30000` | Maximum time a request can wait for a browse slot, clamped to 1000-300000 |
| `CAMOUFOX_MCP_LAUNCH_TIMEOUT_MS` | `30000` | Maximum time browser launch can take, clamped to 1000-300000 |
| `CAMOUFOX_MCP_MAX_SCREENSHOT_BYTES` | `5242880` | Maximum screenshot payload size, clamped to 1 KiB-20 MiB |
| `CAMOUFOX_MCP_MAX_SCREENSHOT_WIDTH` | `1920` | Maximum screenshot viewport/window, selector, or full-page width, clamped to 320-3840 |
| `CAMOUFOX_MCP_MAX_SCREENSHOT_HEIGHT` | `1080` | Maximum screenshot viewport/window, selector, or full-page height, clamped to 240-2160 |
| `CAMOUFOX_MCP_MAX_DIAGNOSTIC_ENTRIES` | `100` | Maximum console or network diagnostic entries, clamped to 1-1000 |
| `CAMOUFOX_MCP_MAX_DIAGNOSTIC_TEXT_CHARS` | `2000` | Maximum diagnostic text characters per entry, clamped to 100-20000 |

URL policy rejects non-HTTP(S) URLs, localhost, private IP ranges, link-local addresses, multicast addresses, reserved/special-purpose IPv4 and IPv6 ranges, and hosts that resolve to those addresses. The server checks the initial URL, proxy server URL, final navigation URL, intercepted browser requests, and WebSocket requests. It does not make traffic anonymous unless you configure an allowed upstream proxy.

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/whit3rabbit/camoufox-mcp.git
cd camoufox-mcp

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run deterministic policy tests
npm run test:unit

# Run locally
npm start
```

### Testing as a Development MCP Server

Build before starting an MCP client:

```bash
npm install
npm run build
```

This repository does not include `.mcp.json` by default. To test with Claude Code from this checkout, create a project-scoped development server:

```bash
claude mcp add --scope project camoufox-dev -- node dist/index.js
```

Then open Claude Code from the repository root and check `/mcp` for `camoufox-dev`.

Use a public test URL because the server intentionally rejects localhost, private IPs, link-local addresses, and reserved ranges:

```text
Use the camoufox-dev MCP server to browse https://example.com in metadata mode.
```

If Camoufox has not been downloaded yet, run:

```bash
npm run fetch:camoufox
```

### Running Tests

```bash
# Run test suite
npm test

# Run with local server
python3 tests/test_client.py --mode local
```

### Docker Build

```bash
# Build the AMD64 image used by releases
docker buildx build --platform linux/amd64 -t camoufox-mcp .
```

## Troubleshooting

### Common Issues

1. **"Camoufox browser not found"**
   - Run `npm run fetch:camoufox` or `npx camoufox-js fetch` to download the browser
   - For Docker, the browser is pre-installed

2. **"Cannot find module"**
   - Ensure you've run `npm install` or are using npx
   - For global install: `npm install -g camoufox-mcp-server@latest`

3. **"MCP server not responding"**
   - Check that the server is properly configured in your AI assistant
   - Verify the command path is correct
   - Check logs for error messages

### Debug Mode

To see detailed logs, run the server directly:

```bash
node dist/index.js
```

## Privacy & Security

Camoufox MCP Server uses the Camoufox browser, which includes:
- Fingerprint spoofing to prevent tracking
- Built-in uBlock Origin for ad blocking
- WebGL and WebRTC spoofing
- Canvas fingerprint protection
- Timezone and locale spoofing

Server-side URL policy is intended to keep the browser tool from being used as a local-network probe. It validates initial URLs, redirects, final URLs, subresource requests, and WebSocket targets against private, local, link-local, multicast, and reserved address space.

This protection is still best-effort unless the deployment also enforces network egress controls. For locked-down deployments, pair the MCP server with a container, VM, or host firewall that denies egress to RFC1918 ranges, loopback, link-local addresses, cloud metadata IPs such as `169.254.169.254`, multicast, and reserved networks.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Acknowledgments

- [Camoufox](https://github.com/daijro/camoufox) - The privacy-focused browser engine
- [Model Context Protocol](https://modelcontextprotocol.io) - The MCP specification
- [Anthropic](https://anthropic.com) - For creating the MCP standard

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/whit3rabbit/camoufox-mcp/issues) page.
