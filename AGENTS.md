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
- `npm run build` - Clean and compile TypeScript to dist/
- `npm run dev` - Watch mode for TypeScript compilation
- `npm start` - Run the compiled server
- `npm run lint` - Run ESLint checks via package script (or `npx eslint src/`)
- `npm run fetch:camoufox` - Download/fetch the Camoufox browser binaries
- `npm run doctor` - Run preflight sanity/diagnostic checks on Node, playwright-core, and cached browser versions
- `npm test` - Build and run Python test client locally (shortcut for `npm run test:local`)
- `npm run test:unit` - Build and run deterministic policy/sequence/preflight unit tests
- `npm run test:local` - Build and run Python test client locally against the local server
- `npm run test:camoufox` - Fetch the browser binary and run the local client tests
- `npm run test:all` - Comprehensive quality pipeline: lint, audit, unit tests, fetch, and client tests

### Docker
- Docker images are published by the GitHub Actions workflow for `linux/amd64`
- Local image build: `docker buildx build --platform linux/amd64 -t camoufox-mcp .`
- `npm run test:docker` (or `./tests/run_tests.sh`) - Run tests using Docker container
- `./tests/run_tests_local.sh` - Run tests against local server

### Testing Individual Components
- Run Python test client directly: `python tests/test_client.py` (supports --mode docker|local)
- Test server in Docker: `docker run --rm followthewhit3rabbit/camoufox-mcp`
- `camoufox_status` is a cheap liveness check but does not launch a browser; `browserAvailable: true` does not guarantee a `browse` will launch. Confirm an actual `browse` works before trusting the browser.
- Smoke-test the server without an MCP host via raw JSON-RPC against `node dist/index.js` (see `plugins/camoufox/skills/camoufox/references/json-rpc-debug.md`): send `initialize`, then a `browse` `tools/call`.

### ClawHub Package Publishing
Use this when `plugins/camoufox/skills/camoufox/` or bundled plugin metadata changes and the OpenClaw package needs a new release.

- ClawHub package: [@whit3rabbit/camoufox-mcp](https://clawhub.ai/packages/%40whit3rabbit%2Fcamoufox-mcp). OpenClaw install spec: `clawhub:@whit3rabbit/camoufox-mcp`.
- NPM, Docker, and GitHub releases are published by CI from `v*` tags. Do not run `npm publish` locally. Bump versions, commit, tag `v<version>`, push `main` and the tag, wait for CI to publish npm, then publish the matching ClawHub package.
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

Publish by rerunning the same `clawhub package publish` command without `--dry-run`. Success criteria: dry-run lists only the runtime bundle files, publish returns a `releaseId`, and `clawhub package inspect @whit3rabbit/camoufox-mcp --json` reports the new `latestVersion`.

## Dependency & Browser Pinning
- Verified-good triple (full local suite, macOS arm64): `camoufox-js` 0.12.0 + `playwright-core` 1.59.0 + browser binary 152.0.4-beta.28. Run `npm run doctor` to confirm it end-to-end (it drives a real `browse`).
- **`playwright-core` MUST be a direct pinned dependency, not just an `overrides` entry.** npm `overrides` only bind the root project, so they do NOT pin `playwright-core` when this package is installed as a dependency (`npx camoufox-mcp-server@latest`, global install, or as someone else's dep). In those paths `camoufox-js`'s peer `playwright-core: *` floats to the newest release, which is incompatible with the Camoufox Juggler — this shipped a broken server to npx users until `playwright-core` was added to `dependencies`. Keep both: the direct `dependencies` pin holds every install path; the `overrides` entry dedupes the transitive copy. Do not loosen either.
- `playwright-core` ceiling: 1.59.0 is the newest that passes the full suite. 1.60.0 breaks the "delayed private navigation" **security guard** (`TypeError: Cannot read properties of undefined (reading 'url')` from a changed Playwright response-event payload). 1.61.0 sends `isMobile` in `Browser.setDefaultViewport`, which the Camoufox Juggler rejects (`... isMobile ... not described in this scheme`) — confirmed still rejected by the 150 build too. `isMobile` is unsupported in Firefox and has no replacement; the fix is matching pw to the Camoufox build, not a new option (see daijro/camoufox#612). Do not bump pw without re-running the full suite.
- Browser build history: 135.0.1-beta.24 was the last FF135 stable. The 152.0.4-alpha builds (fetched by `camoufox-js` 0.11.0/0.11.1) broke all screenshots (`Protocol error (Page.screenshot): can't access property "document", win is undefined`, daijro/camoufox#659) and were not adopted. Upstream fixed the screenshot regression in 152.0.4-beta.26 and marked 152.0.4-beta.27+ the new latest stable channel (FF135 declared too old for modern anti-bot systems). 152.0.4-beta.28 + `camoufox-js` 0.12.0 + `playwright-core` 1.59.0 passes the full local suite, including every screenshot case. The pw ceiling was NOT re-tested against the 152 build (`isMobile` rejection was last confirmed on the 150 build); the 1.59.0 pin stands until someone re-runs the full suite on a newer pw.
- **`camoufox-js fetch` is poisoned (since 2026-09-24): do not use it.** Its updater installs the first non-prerelease GitHub release with a matching asset, and the `font-bundle-v1` build-input release (daijro/camoufox, 2026-09-24) carries full browser zips labeled `152.0.4-beta.31` — "Build input, not a browser download. Nothing here is meant to be installed" per its own notes, and there is no beta.31 release tag. beta.31 breaks `context.routeWebSocket()` interception behind the private-WebSocket SSRF guard: the "Reject Private WebSocket" suite case fails deterministically (3/3) on playwright-core 1.59.0 AND 1.63.0, so it must not be adopted. `npm run fetch:camoufox` therefore runs `scripts/fetch-browser.mjs`, which skips the release listing and installs the pinned release asset directly (bump its constants together with doctor `EXPECTED` and this section). Docker builds and CI use the same script via the `fetch:camoufox` npm script.
- If you change the pinned triple, also update the `EXPECTED` const in `scripts/doctor.mjs` (it mirrors this section).
- Always wipe the cache before changing binary versions (overlaying a new build onto an old bundle corrupts it, e.g. `Library not loaded: @rpath/libmozglue.dylib`). Reset:
  - macOS: `rm -rf ~/Library/Caches/camoufox && npm run fetch:camoufox`
  - Linux/Docker: `rm -rf ~/.cache/camoufox && npm run fetch:camoufox`

## Release & Versioning

Releases are tag-driven. `.github/workflows/ci.yml` runs tests on every push/PR; pushing a `v*` tag additionally publishes to NPM (Trusted Publishing / OIDC), builds and pushes Docker images (Docker Hub + GHCR), and creates a GitHub Release.

The version string lives in seven files and **must stay in sync** (the test suite asserts `camoufox_status.version` == `package.json` version, and `SERVER_VERSION` feeds that response):
- `package.json` (`version`)
- `src/config.ts` (`SERVER_VERSION`)
- `.claude-plugin/marketplace.json` (top-level `version`)
- `plugins/camoufox/.claude-plugin/plugin.json` (`version`)
- `plugins/camoufox/.codex-plugin/plugin.json` (`version`)
- `plugins/camoufox/package.json` (`version` — the `@whit3rabbit/camoufox-mcp` OpenClaw bundle)
- `plugins/camoufox/openclaw.plugin.json` (`version`)

Release steps:
1. Bump all seven version strings to the new version.
2. Move the `[Unreleased]` entries in `CHANGELOG.md` under a new `## [x.y.z] - YYYY-MM-DD` heading; leave a fresh empty `[Unreleased]`.
3. Run `npm run test:all` (or at least `npm run build` + `npm run test:unit`) and commit.
4. Tag `vX.Y.Z` and push the tag. CI handles NPM, Docker, and the GitHub Release; the release body links `CHANGELOG.md`.

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
- Click actions support `clickMode`: `dom` is the default CI/Xvfb-stable DOM activation path, `pointer` uses Playwright pointer input, and `auto` tries pointer first before DOM fallback.
- `camoufox_status.networkSecurity` reports application-layer best-effort SSRF policy and conservative network sandbox posture. Docker/container detection is not proof of egress filtering.
- CAPTCHA handling is manual by default. `captchaPolicy: "attempt"` returns challenge metadata, interactive elements, a bounded screenshot, and a suggested strategy. When `CAPTCHA_AUTONOMOUS=true` is set, responses use `challengeHandling: "llm_assisted"` and include provider-specific `challengePlaybook` context when known. The server never solves CAPTCHAs itself or invokes an external skill.
- Browser instances are created per request (not persisted)
- Error handling includes detailed error messages for debugging
- Process lifecycle is managed with proper cleanup on exit
- Cross-platform support with architecture-specific browser fetching
- Screenshot capture returns base64-encoded PNG data
- Enhanced logging with colored output for better debugging
