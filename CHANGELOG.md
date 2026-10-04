# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS` allows exact development hostnames such as `laravel.test` to resolve to loopback or private addresses. Default restrictions remain enabled, and metadata, link-local, and reserved addresses stay blocked. Status and initialization report the configured hostnames. Fixes #33.

### Fixed

- Private-host DNS denial errors provide the exact environment setting for eligible development, corporate, and custom names. Metadata, link-local, AWS local-services, and reserved DNS results do not suggest an allowlist exception.
- Navigation retries once when the network response used the requested URL but the committed document gained duplicate path separators. One-shot tools and sessions share the check, preserve legitimate redirects, and keep the retry within the navigation timeout. Regression tests simulate the reported drift; the original intermittent engine fault has not been reproduced. Fixes #28.

## [2.6.0] - 2026-10-03

### Added

- Public `camoufox-mcp-fetch` and `camoufox-mcp-doctor` commands work with global and npx package installs, including hoisted dependencies.
- Opt-in Camoufox 156.0.1-beta.33 support through `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1`, using the official `@camoufox/camoufox` 0.5.7-beta.4 launcher and fingerprint model. Requires Node.js 22.15 or higher. The default beta.28 browser and Playwright 1.59.0 pin remain unchanged.
- Browser compatibility documentation and status fields report the selected build, launcher, and isolation posture. Compatibility mode disables world isolation to restore page/iframe WebSocket interception, exposing automation bindings to websites.
- Shared browser manifest pins tagged downloads and SHA-256 digests for all six supported platform assets in each mode. Compatibility installs use a separate cache unless `CAMOUFOX_INSTALL_DIR` is set.
- CI covers Node 22 and 24 in default and compatibility modes on Ubuntu 24.04, checks release-version alignment, and runs the built Docker image's browser suite on pull requests.

### Fixed

- Browser status and launch preflight inspect the cache without triggering upstream downloads or writing installer output to MCP stdout. Mismatched browser builds fail before launch, including session starts.
- The pinned installer repairs missing executables despite existing version metadata. Doctor respects `CAMOUFOX_INSTALL_DIR` and skips browser launch when preflight fails.
- Status removes expired sessions before reporting their count.
- Sessions track main-frame navigation responses after clicks and reloads, so later snapshots use the current response metadata.
- Snapshot extraction handles document changes, including reloads at the same URL, with up to three extraction attempts within 10 seconds. Continued navigation returns an error instead of mixing documents, without replaying actions. Response metadata follows committed documents after `DOMContentLoaded` in one-shot calls and sessions.
- Link extraction returns visible links and uses accessibility labels when visible text is empty. Form extraction omits password field values.
- Doctor and the pinned installer are shipped in the npm package and Docker runtime image.
- The official compatibility launcher is optional, preserving the default package's Node.js 22.0 requirement under strict npm engine checks. Compatibility mode requires Node.js 22.15 or higher and the optional launcher.
- Unsafe Firefox preference checks reject options that change world isolation or proxy policy, and check service-worker preference names regardless of case.
- Compatibility installation repairs a missing IPv6 geolocation database, and launch checks the database for the actual exit-address family before the launcher can download implicitly.
- The installer validates addon and geolocation assets after download, including failures swallowed by upstream download helpers.
- CI authenticates upstream GitHub asset API requests only during fetch. Docker builds use an optional BuildKit secret mount, keeping the token out of image layers and browser runtime configuration.

### Known limitations

- Dedicated-worker WebSockets evade Playwright's frame-based routing in both beta.28 default and beta.33 compatibility mode. Untrusted browsing requires network egress controls; application checks alone do not provide a private-network sandbox.
- Focused extractors have count and per-field limits but no shared response byte budget.

## [2.5.1] - 2026-10-01

### Fixed
- Security: refreshed all vulnerable transitive dependencies via `npm audit fix` (adm-zip 0.6.1, brace-expansion, browserslist, fast-uri, hono, ip-address 10.7.2, qs, @humanfs/node) and bumped the `js-yaml` override from the exact `4.3.1` pin to `4.3.2` (GHSA-2883-xcg3-v3hh) — the exact pin had been blocking the patched release, which is also why the September Dependabot PRs failed. `npm audit` is back to 0 vulnerabilities.

### Changed
- `npm run fetch:camoufox` now runs `scripts/fetch-browser.mjs`, which downloads the browser binary pinned to the verified release asset (152.0.4-beta.28) instead of whatever upstream's updater resolves. Since 2026-09-24, `camoufox-js fetch` installs an unreleased 152.0.4-beta.31 browser from daijro/camoufox's `font-bundle-v1` build-input release (its own notes say "Nothing here is meant to be installed"), and that build silently breaks `context.routeWebSocket()` interception — the "Reject Private WebSocket" SSRF-guard test fails deterministically on playwright-core 1.59.0 and 1.63.0, while beta.28 passes. The missing-binary error message now points at the pinned script and warns against `npx camoufox-js fetch`.

## [2.5.0] - 2026-08-07

### Added
- Real MCP output schemas for `browse`, `browse_snapshot`, `browse_sequence`, `browse_screenshot`, `browse_console`, and all six `browse_session_*` tools. Previously these advertised an empty passthrough output schema while the focused extractors (links/forms/outline/find/network_summary) declared real ones; clients can now introspect the structured result shape of every tool.

### Changed
- Upgraded the pinned browser triple to `camoufox-js` 0.12.0 + Camoufox browser 152.0.4-beta.28 (`playwright-core` stays 1.59.0). Upstream fixed the FF152 screenshot regression in 152.0.4-beta.26 (daijro/camoufox#659) and now marks the 152.0.4-beta.27+ channel as latest stable; the FF135 build is considered too old for modern anti-bot systems. Full local suite passes on the new triple, including all screenshot cases. Wipe the browser cache before updating (see AGENTS.md "Dependency & Browser Pinning").
- Default `CAMOUFOX_MCP_SEQUENCE_TIMEOUT_MS` raised from 120000 to 250000 so a maximum-length sequence (25 actions at the 10s default per-action timeout) fits the budget; previously any sequence with 13+ default-timeout actions was rejected.
- `browse_find` now returns every occurrence of the query within a single text node instead of only the first, so repeated matches inside one paragraph are no longer collapsed.
- `npm run doctor` smoke test resolves as soon as both the `camoufox_status` and `browse` responses arrive instead of always waiting the full 30s timeout; the 30s timer remains the upper bound for a hung/dead browser.
- Selector screenshots now clamp the element clip to the page viewport before capture, so a partially offscreen element after `scrollIntoView` no longer produces a clip Playwright rejects.
- CI `release` job now also depends on `publish-clawhub`, so a GitHub Release is only cut after the ClawHub bundle publishes successfully (previously a failed ClawHub publish still released a version ClawHub didn't have).
- `registerJsonTool` no longer redeclares the SDK's `registerTool` signature through `unknown`; it narrows the callback to the SDK's `ToolCallback` type at the boundary, which is less fragile across SDK upgrades.
- Narrowed the npm package `files` globs so the published tarball ships only the runtime plugin bundle (9 files) instead of all 71 files under `plugins/`, excluding generated eval/iteration/reports content that the ClawHub staging already omits.

### Fixed
- Docker runtime stage no longer runs `npm ci` in the slim image: `better-sqlite3` 13 (pulled in by `camoufox-js` 0.12.0) has no prebuilt binary for that target and the slim image has no compiler toolchain. The builder stage now runs `npm prune --omit=dev` after building and the runtime stage copies `node_modules` as-is.

### Security
- Dependency refresh: `npm audit` clean (was 11 vulnerabilities: 7 high, 3 moderate, 1 low). Lockfile bumps cover all open Dependabot PRs (fast-uri, hono, brace-expansion, ip-address, body-parser); `adm-zip` forced to `^0.6.0` via overrides (GHSA-xcpc-8h2w-3j85, `camoufox-js` 0.12.0 now also requires `^0.6.0` directly); `js-yaml` override bumped 4.2.0 -> 4.3.1 (the old override was itself vulnerable).
- Selector screenshots enforce the dimension policy against the element's real size before viewport clamping, so an oversize element can no longer slip under the policy via the clamp.

## [2.4.0] - 2026-07-06

### Fixed
- Pinned `camoufox-js` fetch command version in npm scripts, preflight error messages, and documentation to `0.10.2` to prevent layout corruption/mismatch issues from installing the newer 0.11.x layout.
- Added `/tmp` disk space pressure warnings and troubleshooting for `ENOSPC` errors during fetch.
- Documented Hermes non-TTY prompt gotcha with `printf "Y\n" |` pipe instructions to prevent automated installation cancellations.
- Added troubleshooting for stale MCP server process caching `browserAvailable: false` status at startup.
- Documented routing rules comparing cheap host web tools vs. Camoufox.
- Moved "Tool Names by Host" higher in documentation for better visibility.

## [2.3.0] - 2026-07-06

### Added
- CI now publishes the OpenClaw/ClawHub bundle (`@whit3rabbit/camoufox-mcp`) on tagged releases via a `publish-clawhub` job (`clawhub package validate` + `publish --family bundle-plugin` from a clean staging dir), using OIDC trusted publishing with a `CLAWHUB_TOKEN` fallback. Previously the bundle was never published, so `openclaw plugins install clawhub:@whit3rabbit/camoufox-mcp` could not resolve. Requires a one-time trusted-publisher setup on ClawHub for scope `@whit3rabbit`.
- `llms.txt` at the repo root: a link-style install index with per-host commands (Claude Code, Codex, OpenClaw, Hermes, opencode, Pi) for coding agents.

### Fixed
- A `browse`/`snapshot`/`sequence` call on a machine without the Camoufox binary now fails fast with an actionable message naming the fix command (`npx -y camoufox-js fetch`) instead of a generic launch error. npx installs do not prefetch the ~780MB binary.
- Rewrote the OpenClaw and Hermes install docs (README, `docs/configuration.md`): OpenClaw leads with the registry-free `openclaw mcp add …` path that works today (ClawHub install marked as post-publish); Hermes documents the two-step skill + `hermes mcp add` flow with an explicit warning not to use `hermes plugins install` (this repo has no root `plugin.yaml`, so it is rejected as an invalid plugin). Corrected the Hermes tool-name prefix to `mcp__camoufox…`.

## [2.2.0] - 2026-07-04

### Fixed
- Pinned `playwright-core` as a direct dependency (`1.59.0`), not only via `overrides`. npm `overrides` bind the root project only, so `npx camoufox-mcp-server@latest` and global installs previously let `camoufox-js`'s `playwright-core: *` peer float to the latest release (1.61+), which the Camoufox Juggler rejects (`Browser.setDefaultViewport ... isMobile ... not described in this scheme`) — the published server failed to launch a browser on those install paths. The direct pin holds `playwright-core` at 1.59.0 for every install path; the `overrides` entry remains for transitive dedupe.

### Added
- `npm run doctor` preflight (`scripts/doctor.mjs`, no new deps): checks Node >=22, the exact `camoufox-js` pin, that `playwright-core` is a direct pin at the expected version, that the cached browser build matches, then drives a real `browse` to prove the browser launches. Prints the exact fix (including the cache-wipe command) for each failure.
- Skill/docs coverage for bringing the server up and troubleshooting: a local bring-up flow in `SKILL.md`, and troubleshooting entries for corrupt/mismatched browser cache, `better-sqlite3` native-module rebuilds, and `playwright-core` drift under `npx @latest`.

## [2.1.6] - 2026-07-03

### Fixed
- Eliminated `better-sqlite3` NODE_MODULE_VERSION/ABI mismatch failures when the gateway spawns the server with a different Node version than the one that installed dependencies (for example Hermes launching Node 25 via nvm against an npx cache installed under Node 22). On Node 22.15+ the server now redirects camoufox-js's `better-sqlite3` import to a shim backed by the built-in `node:sqlite` module, so the native binary is never loaded. Set `CAMOUFOX_MCP_NO_SQLITE_SHIM=1` to opt out.
- Native module ABI errors that still occur (shim opted out or unavailable) now include an actionable hint in tool error output: the runtime Node version and path, the npx cache location (`~/.npm/_npx`), and rebuild guidance.

### Changed
- Corrected troubleshooting and skill docs that claimed `better-sqlite3` errors come from the host or gateway dependency tree — it is a transitive dependency of this server via `camoufox-js`. Documented the npx cache pitfall and added a troubleshooting entry for Cloudflare challenge pages.

## [2.1.0] - 2026-06-18

### Added
- Advertised server policy in the `initialize` response under `capabilities.extensions["camoufox-mcp"].policy` (`unsafeOptionsAllowed`, `evaluateAllowed`, `captchaAutonomous`, default wait strategy and stealth profile), so clients can inspect posture without launching a browser.
- Logged a stderr warning naming the rejected option family when unsafe browser options are sent without `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`.
- Added opt-in `clickMode: "auto"` for click actions, `CAPTCHA_AUTONOMOUS=true` for LLM-assisted challenge context and provider playbooks, and network sandbox posture reporting in `camoufox_status`.

### Changed
- Defaulted `waitStrategy` to `domcontentloaded` (was `load`) across `browse` and session navigation, avoiding hangs on sites with long-lived connections. Centralized the default and the default stealth profile as config constants.
- Corrected the plugin marketplace manifest to the current schema (top-level `description`/`version`) and documented the `/plugin marketplace add` + install flow.

### Fixed
- Bounded `browse_sequence` with a cumulative action timeout policy and graceful fatal shutdown cleanup.

## [2.0.5] - 2026-05-13

### Fixed
- Preserved blocked private-navigation errors when a page starts navigating during final content extraction.
- Avoided flaky selector screenshot stability waits under Node 24 CI.

## [2.0.4] - 2026-05-13

### Changed
- Switched the NPM release job to npm Trusted Publishing with GitHub Actions OIDC.
- Normalized the package binary path for NPM publish metadata.
- Removed and ignored the generated `repomix-output.xml` artifact.

## [2.0.3] - 2026-05-12

### Fixed
- Removed Playwright's low-level click path from `browse_sequence` click actions to avoid CI virtual display timeouts.

## [2.0.2] - 2026-05-12

### Fixed
- Made `browse_sequence` click actions stable under CI virtual display environments.

## [2.0.1] - 2026-05-12

### Fixed
- Updated the MCP server-reported version to match the package version.
- Made `browse_sequence` click actions avoid waiting for anchor-triggered navigations before the post-action safety guard runs.

## [2.0.0] - 2026-05-12

### Changed
- Raised the minimum supported Node.js version to 22.
- The default `browse` wait strategy is now `load` so JavaScript verification pages have time to complete before content extraction.
- Updated the README install quick start.
- Updated runtime and test dependencies.

### Security
- Bumped transitive `form-data` dependency to 4.0.4.
- Bumped transitive `tar-fs` dependency to 2.1.4.

## [1.5.0] - 2026-05-11

### Added
- Bounded JSON browse responses with text, HTML, and metadata output modes.
- CSS selector extraction and configurable output character limits.
- Server policy controls for unsafe browser options, concurrency, queue length, and screenshot limits.
- Initial URL, redirect, final URL, and browser request SSRF protections for local, private, link-local, and reserved address space.
- Local and Docker regression tests for blocked localhost targets and unsafe browser options.

### Changed
- Docker publishing targets `linux/amd64`.
- The default browse response returns visible text instead of raw HTML.

### Fixed
- CI now fails on local test failures.
- Local test runner now executes from the repository root.

## [1.1.0] - 2025-01-10

### Added
- Enhanced anti-detection features with OS auto-rotation
- Configurable wait strategies (domcontentloaded, load, networkidle)
- Custom timeout parameter (5-300 seconds)
- Humanize option for realistic cursor movements
- Locale configuration support
- Custom viewport dimensions
- Screenshot capture capability
- Comprehensive parameter validation with Zod
- Multi-architecture Docker support (amd64/arm64)
- NPM package configuration with executable binary
- GitHub Actions CI/CD pipeline

### Changed
- Upgraded from basic browse tool to enhanced parameter support
- Improved error handling and logging
- Better TypeScript type safety

### Fixed
- Docker container headless mode detection
- Browser cleanup on process termination

## [1.0.0] - 2025-01-09

### Added
- Initial release
- Basic browse tool with URL parameter
- MCP server implementation
- Docker support
- Camoufox browser integration
