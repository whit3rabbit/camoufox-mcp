# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based MCP (Model Context Protocol) server that provides browser automation capabilities using Camoufox (a privacy-focused Firefox fork). The server exposes browser tools with bounded output and extensive privacy controls:
- `camoufox_status`: return server, browser, queue, session, policy, and network-security posture status.
- `browse`: navigate once and return bounded text, HTML, metadata, diagnostics, and optional screenshot output.
- `browse_snapshot`: navigate once and return bounded visible text, ARIA snapshot data, and interactive element metadata.
- `browse_sequence`: navigate once, run a bounded CSS-selector action sequence, then return final content, snapshot data, diagnostics, and optional screenshot output.
- `browse_links`, `browse_forms`, `browse_outline`, `browse_find`: low-context page extraction tools.
- `browse_screenshot`, `browse_console`, `browse_network_summary`: focused screenshot and diagnostics tools.
- `browse_session_*`: short-lived isolated browser sessions with challenge pause/resume, best-effort `attempt` metadata, and optional LLM-assisted provider playbooks when `CAPTCHA_AUTONOMOUS=true`.

## Commands

### Development

Repository builds require Node >=22.15 and the optional launcher installed with `npm install --include=optional` for its TypeScript declarations. The published default runtime supports Node >=22.0 without that launcher.

- `npm run build` - Clean and compile TypeScript to dist/
- `npm run dev` - Watch mode for TypeScript compilation
- `npm start` - Run the compiled server
- `npm run lint` - Run ESLint checks via package script (or `npx eslint src/`)
- `npm run fetch:camoufox` - Download/fetch the Camoufox browser binaries
- `npm run doctor` - Run preflight sanity/diagnostic checks on Node, playwright-core, and cached browser versions
- Public package commands: `camoufox-mcp-fetch` and `camoufox-mcp-doctor`. Global installs of 2.6.0 expose them directly. After 2.6.0 is published, use `npx --yes --package camoufox-mcp-server@2.6.0 <command>` for npx installs. Preserve the server's compatibility flag and install-directory environment for both commands.
- `npm test` - Build and run Python test client locally (shortcut for `npm run test:local`)
- `npm run test:unit` - Build and run deterministic policy, sequence, snapshot, browser, and SQLite unit tests
- `npm run test:local` - Build and run Python test client locally against the local server
- `npm run test:camoufox` - Fetch the browser binary and run the local client tests
- `npm run test:all` - Comprehensive quality pipeline: lint, audit, unit tests, fetch, and client tests

### Docker
- Docker images are published by the GitHub Actions workflow for `linux/amd64`
- Local image build: `docker buildx build --platform linux/amd64 -t camoufox-mcp .`
- The browser fetch accepts an optional BuildKit `github_token` secret for GitHub API authentication. It is mounted only for that instruction; never pass it through Dockerfile `ARG` or `ENV` instructions or into browser runtime configuration.
- `npm run test:docker` (or `./tests/run_tests.sh`) - Run tests using Docker container
- `./tests/run_tests_local.sh` - Run tests against local server

### Testing Individual Components
- Run Python test client directly: `python tests/test_client.py` (supports --mode docker|local)
- Test server in Docker: `docker run --rm followthewhit3rabbit/camoufox-mcp`
- `camoufox_status` is a cheap liveness check but does not launch a browser; `browserAvailable: true` does not guarantee a `browse` will launch. Confirm an actual `browse` works before trusting the browser.
- Smoke-test the server without an MCP host via raw JSON-RPC against `node dist/index.js` (see `plugins/camoufox/skills/camoufox/references/json-rpc-debug.md`): send `initialize`, then a `browse` `tools/call`.

### ClawHub Package Publishing
Tagged releases publish the OpenClaw bundle automatically. Use the manual clean-staging procedure below only for an explicitly requested recovery or republication.

- ClawHub package: [@whit3rabbit/camoufox-mcp](https://clawhub.ai/packages/%40whit3rabbit%2Fcamoufox-mcp). OpenClaw install spec: `clawhub:@whit3rabbit/camoufox-mcp`.
- CI publishes NPM, Docker, ClawHub, and GitHub releases from `v*` tags. Do not run `npm publish` locally or duplicate the ClawHub publish after a successful tagged workflow.
- Keep `plugins/camoufox/openclaw.plugin.json`, `plugins/camoufox/package.json`, `.codex-plugin/plugin.json`, and `.claude-plugin/plugin.json` versions aligned with the repo release version.
- Do not publish directly from `plugins/camoufox/` if it contains generated `reports/`, `skills/camoufox/evals/`, or `skills/camoufox-workspace/`. Build a clean staging directory and publish that instead.
- Validate before publishing. `clawhub package validate` writes `reports/` into the source folder, so validate first, then rebuild the clean staging directory for the final dry-run and publish.

```bash
clawhub package validate plugins/camoufox --json

version="$(node -p 'require("./package.json").version')"
stage="$(mktemp -d /private/tmp/camoufox-clawhub-final.XXXXXX)"
mkdir -p "$stage/.codex-plugin" "$stage/.claude-plugin" "$stage/skills/camoufox/agents" "$stage/skills/camoufox/references"
cp plugins/camoufox/.codex-plugin/plugin.json "$stage/.codex-plugin/plugin.json"
cp plugins/camoufox/.claude-plugin/plugin.json "$stage/.claude-plugin/plugin.json"
cp plugins/camoufox/.mcp.json "$stage/.mcp.json"
cp plugins/camoufox/openclaw.plugin.json "$stage/openclaw.plugin.json"
cp plugins/camoufox/package.json "$stage/package.json"
cp plugins/camoufox/skills/camoufox/SKILL.md "$stage/skills/camoufox/SKILL.md"
cp plugins/camoufox/skills/camoufox/agents/openai.yaml "$stage/skills/camoufox/agents/openai.yaml"
cp plugins/camoufox/skills/camoufox/references/json-rpc-debug.md "$stage/skills/camoufox/references/json-rpc-debug.md"
cp plugins/camoufox/skills/camoufox/references/sequence-actions.md "$stage/skills/camoufox/references/sequence-actions.md"

clawhub package publish "$stage" \
  --family bundle-plugin \
  --name @whit3rabbit/camoufox-mcp \
  --display-name "Camoufox MCP" \
  --owner whit3rabbit \
  --version "$version" \
  --source-repo whit3rabbit/camoufox-mcp \
  --source-commit "$(git rev-parse HEAD)" \
  --source-ref "v$version" \
  --source-path plugins/camoufox \
  --dry-run
```

For an authorized manual recovery, publish by rerunning the same `clawhub package publish` command without `--dry-run`. Success criteria: dry-run lists only the runtime bundle files, publish returns a `releaseId`, and `clawhub package inspect @whit3rabbit/camoufox-mcp --json` reports the new `latestVersion`. Package validation alone does not confirm installation into a target OpenClaw checkout.

## Dependency & Browser Pinning

- Default triple (prior 64/64 local browser-suite cases, macOS arm64; focused installer/policy checks also passed): `camoufox-js` 0.12.0 + `playwright-core` 1.59.0 + browser binary 152.0.4-beta.28. Run `npm run doctor` to verify the selected build and a real `browse`. This build predates world isolation and already runs automation in the page world. It is the default pin, not the newest upstream release. Use the matching CI run for evidence after subsequent fixes.
- Opt-in compatibility mode (prior 64/64 local browser-suite cases, macOS arm64; focused installer/policy checks also passed): `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1` selects 156.0.1-beta.33 and the official `@camoufox/camoufox` 0.5.7-beta.4 launcher with its default fingerprint model. Node >=22.15 and the optional launcher are required. Keep its exact pin in `optionalDependencies` so published default installs preserve Node >=22.0 support. Use `npm install --include=optional` on a compatible Node version before enabling the mode. `disableWorldIsolation: true` restores page/iframe WebSocket interception but exposes automation JavaScript to websites. Dedicated-worker WebSockets evade routing in both modes. Keep it opt-in; see [browser compatibility](docs/browser-compatibility.md) for sources, setup, and validation status. Set the same environment for `fetch:camoufox`, doctor, and the MCP server.
- `browser-builds.json` is the shared source for browser versions, launcher versions, and archive SHA-256 digests. When changing a browser pin, update all six official platform digests. Runtime preflight rejects a build that differs from the selected mode before launch. Installer and doctor read the same manifest.
- **`playwright-core` MUST be a direct pinned dependency, not just an `overrides` entry.** npm `overrides` only bind the root project, so they do NOT pin `playwright-core` when this package is installed as a dependency (`npx camoufox-mcp-server@latest`, global install, or as someone else's dep). Without a direct pin, `camoufox-js`'s peer `playwright-core: *` floats and can break the Camoufox Juggler. Keep both: the direct `dependencies` pin holds every install path; the `overrides` entry dedupes the transitive copy.
- Keep Playwright 1.59.0 until a newer version passes the full suite in the selected mode. Earlier probes found 1.60.0 broke the delayed private-navigation guard (`TypeError: Cannot read properties of undefined (reading 'url')`) and 1.61.0 sent an `isMobile` viewport option rejected by the 150 browser build. Those results do not establish compatibility with later browser builds. Re-run screenshot, navigation, and WebSocket guards before changing either pin.
- Browser history: 135.0.1-beta.24 was the last FF135 stable. The 152.0.4-alpha builds fetched by `camoufox-js` 0.11.0/0.11.1 broke screenshots (`Page.screenshot`: `win is undefined`, daijro/camoufox#659). Beta.26 fixed that regression; the beta.28 default has prior full-suite evidence including every screenshot case.
- Use `npm run fetch:camoufox`, which installs an exact tagged asset and verifies its SHA-256 before extraction. `camoufox-js fetch` previously selected beta.31 from the `font-bundle-v1` build-input release. That build failed private-WebSocket rejection on Playwright 1.59.0 and 1.63.0. Newer isolated builds still require the compatibility workaround; upstream issue #775 remains open.
- Status and launch checks must only inspect the cache. Upstream `launchPath()` can trigger a download for a missing cache and write to MCP stdout; use `probeBrowserBinary()` instead. The pinned installer checks both metadata and executable completeness before skipping an install.
- Never overlay browser builds. The pinned installer clears the selected cache before replacing it. Compatibility mode defaults to a separate `camoufox-compatibility` sibling cache; `CAMOUFOX_INSTALL_DIR` overrides it. Preserve the default cache when testing candidate releases.

## Release & Versioning

Releases are tag-driven. `.github/workflows/ci.yml` runs a four-job Ubuntu 24.04 matrix: Node 22/24 with default/compatibility browser modes. Each job checks release versions, installs optional dependencies, and runs lint, audit, unit tests, pinned fetch, and the browser client suite in separate steps. The read-only job token is available only to the fetch step for upstream GitHub API requests. Pull requests also build and test the `linux/amd64` Docker image. Local checks and configured coverage do not establish a successful GitHub Actions run.

Pushing a `v*` tag additionally publishes to NPM (Trusted Publishing / OIDC), builds and pushes Docker images (Docker Hub + GHCR), publishes the ClawHub bundle, and creates a GitHub Release after the publication jobs succeed.

The version string lives in seven files and **must stay in sync** (the test suite asserts `camoufox_status.version` == `package.json` version, and `SERVER_VERSION` feeds that response):
- `package.json` (`version`)
- `src/config.ts` (`SERVER_VERSION`)
- `.claude-plugin/marketplace.json` (top-level `version`)
- `plugins/camoufox/.claude-plugin/plugin.json` (`version`)
- `plugins/camoufox/.codex-plugin/plugin.json` (`version`)
- `plugins/camoufox/package.json` (`version` — the `@whit3rabbit/camoufox-mcp` OpenClaw bundle)
- `plugins/camoufox/openclaw.plugin.json` (`version`)

Release steps:
1. Bump all seven version strings and both root `package-lock.json` version records to the new version. Run `node tests/check_release_versions.mjs`.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `## [x.y.z] - YYYY-MM-DD` heading; leave a fresh empty `[Unreleased]`.
3. Run `npm run test:all` (or at least `npm run build` + `npm run test:unit`) and commit.
4. Tag `vX.Y.Z` and push the tag when release publication is authorized. CI handles NPM, Docker, ClawHub, and the GitHub Release; the release body links `CHANGELOG.md`.

SemVer: new tools/params or additive capabilities → minor; behavior changes to defaults are called out in the changelog `Changed` section.

## Architecture

### Core Server (`src/index.ts`)
The main MCP server implementation:
- Uses stdio transport for communication
- Implements one-shot, focused extraction, diagnostics, screenshot, and ephemeral session tools with comprehensive parameter sets
- Automatically detects environment (Docker/Linux vs local) for headless mode selection
- Handles graceful shutdown on SIGINT/SIGTERM
- Returns JSON payloads with visible text by default, optional raw HTML or metadata-only output, and optional screenshot capture
- Enhanced error handling with detailed debugging information

### Browser Integration
- Uses `camoufox-js` for browser automation
- Supports OS spoofing (Windows 11, macOS, Linux) with automatic rotation
- Implements configurable headless modes:
  - Standard headless for local development
  - Virtual display (Xvfb) for Linux/Docker environments
  - User-configurable headless option
- Enhanced privacy controls:
  - WebRTC blocking
  - Image blocking for faster loading
  - WebGL blocking (anti-fingerprinting)
  - Cross-Origin-Opener-Policy control
  - Proxy support with authentication
  - Custom Firefox preferences
  - Addon exclusion control

### Docker Architecture
Multi-stage build process:
1. Builder stage: Compiles TypeScript and fetches Camoufox browser
2. Runtime stage: Debian Bookworm slim image with Node.js and required dependencies
3. Uses Xvfb for headless operation in containers
4. The release workflow publishes `linux/amd64` images

## Browse Tool Parameters

The `browse` tool supports extensive configuration options:

### Core Parameters
- `url` (required): Target URL to navigate to. Must be a fully qualified http or https URL.
- `waitStrategy`: Page load strategy (`domcontentloaded`, `load`, `networkidle`). Defaults to `domcontentloaded`.
- `timeout`: Page load timeout in milliseconds (5,000 to 300,000 ms, default: 60,000 ms).
- `outputMode`: Response content mode (`text`, `html`, `metadata`). Defaults to `text`.
- `maxChars`: Maximum text or HTML characters to return (1,000 to 200,000, default: 30,000).
- `selector`: Optional CSS selector to limit extraction to one matching element.
- `screenshot`: Capture PNG screenshot after loading (default: false).
- `screenshotOptions`: Optional object with screenshot configuration (`fullPage`, `selector`, `type`, `quality`).

### Privacy & Anti-Detection
- `os`: OS spoofing (`windows`, `macos`, `linux`) - auto-rotates if not specified.
- `humanize`: Enable realistic cursor movements and human-like behavior (default: true).
- `geoip`: Auto-detect geolocation based on IP address (default: true).
- `block_webrtc`: Block WebRTC entirely for privacy (default: true).
- `block_images`: Block all images for faster loading (default: false).
- `block_webgl`: Block WebGL to prevent fingerprinting (default: false).
- `disable_coop`: Disable Cross-Origin-Opener-Policy for iframe/embedded content (default: false).
- `stealthProfile`: Shortcut configuration profile (`normal`, `privacy`, `human_assisted`, `fast`, `debug`). Explicit options override profile defaults.
- `captchaPolicy`: CAPTCHA policy posture (`detect`, `pause`, `fail`, `attempt`).

### Browser Configuration
- `locale`: Browser locale setting (e.g., `en-US`).
- `viewport`: Custom viewport dimensions object (`{width, height}`).
- `headless`: Headless mode control (default: auto, runs virtual display `Xvfb` on Linux/Docker environments).
- `proxy`: Proxy configuration (string or object with auth). Checked against target URL policy.
- `enable_cache`: Enable browser caching (uses more memory but improves speed when revisiting pages).
- `firefox_user_prefs`: Custom Firefox preferences object (rejected unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`).
- `exclude_addons`: List of default addons to exclude (rejected unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`).
- `window`: Fixed window size array `[width, height]`.
- `args`: Additional browser command-line arguments (rejected unless `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`).

## Other Specialized Browser Tools

- `browse_snapshot`: Navigate once and return visible text, ARIA snapshot, and interactive elements.
  - Extra parameters: `maxChars`, `maxElements`, `selector`.
- `browse_sequence`: Navigate once, run a sequence of action steps (up to 25), and return final state.
  - Actions include: `click` (supports `clickMode: "dom" | "pointer" | "auto"`), `hover`, `fill`, `type`, `select`, `press`, `waitFor`, `scroll`, and environment-gated `evaluate`.
  - Cumulative action timeout budget is capped at `CAMOUFOX_MCP_SEQUENCE_TIMEOUT_MS`.
- `browse_links`: Return only visible navigable links.
  - Extra parameters: `selector`, `maxLinks`.
- `browse_forms`: Return form fields and submit controls.
  - Extra parameters: `selector`, `maxForms`, `maxFields`.
- `browse_outline`: Return page headings and landmarks.
  - Extra parameters: `selector`, `maxItems`.
- `browse_find`: Search visible text and return matches.
  - Extra parameters: `query`, `selector`, `maxMatches`, `contextChars`.
- `browse_screenshot`: Dedicated screenshot tool.
  - Extra parameters: `selector`, `fullPage`, `type`, `quality`.
- `browse_console`: Navigate once and return console logs.
- `browse_network_summary`: Navigate once and return network request diagnostics.
  - Extra parameters: `maxFailures`.

## Stateful Session Tools

Start and manipulate isolated, short-lived browser sessions. Sessions are ephemeral, memory-only, and by default one active session is allowed per client (up to `CAMOUFOX_MCP_MAX_SESSIONS`), expiring after 10 minutes of inactivity.
- `browse_session_start`: Start an isolated session and return a `sessionId`.
- `browse_session_navigate`: Navigate an existing session.
- `browse_session_action`: Run one action in an existing session.
- `browse_session_snapshot`: Read the current visible text, ARIA snapshot, and interactive metadata.
- `browse_session_resume`: Resume a paused session (e.g., after human solver finishes manual CAPTCHA).
- `browse_session_close`: Close the session and release its browser slot.

## Key Implementation Details

- The server validates tool calls using comprehensive Zod schemas
- Initial URLs, final navigation URLs, and browser requests are rejected if they target localhost, private, link-local, or reserved IP space
- Session slots are reserved before launch so concurrent starts cannot exceed `CAMOUFOX_MCP_MAX_SESSIONS`
- Session reads/actions must surface delayed blocked requests before returning page state
- Snapshot reads allow up to three extraction attempts within 10 seconds and fail if navigation continues. Preserve the document-identity check for reloads at the same URL, and never replay actions during extraction retries.
- Click actions support `clickMode`: `dom` is the default CI/Xvfb-stable DOM activation path, `pointer` uses Playwright pointer input, and `auto` tries pointer first before DOM fallback.
- `camoufox_status.networkSecurity` reports application-layer best-effort SSRF policy and conservative network sandbox posture. Dedicated-worker WebSockets evade the frame-based routing guard in both browser modes. Untrusted browsing requires actual VM, firewall, filtering proxy, or controlled container egress rules. Docker/container detection is not proof of egress filtering.
- CAPTCHA handling is manual by default. `captchaPolicy: "attempt"` returns challenge metadata, interactive elements, a bounded screenshot, and a suggested strategy. When `CAPTCHA_AUTONOMOUS=true` is set, responses use `challengeHandling: "llm_assisted"` and include provider-specific `challengePlaybook` context when known. The server never solves CAPTCHAs itself or invokes an external skill.
- Browser instances are created per request (not persisted)
- Error handling includes detailed error messages for debugging
- Process lifecycle is managed with proper cleanup on exit
- Cross-platform support with architecture-specific browser fetching
- Screenshot capture returns base64-encoded PNG data
- Enhanced logging with colored output for better debugging
