# Browser compatibility

The default remains Camoufox 152.0.4-beta.28 with `camoufox-js` 0.12.0 and `playwright-core` 1.59.0. You can opt into Camoufox 156.0.1-beta.33 with page and iframe WebSocket interception restored. This requires disabling the newer browser's world isolation, which exposes automation JavaScript to websites.

## Enable the newer browser

Compatibility mode requires Node.js 22.15 or higher and the optional `@camoufox/camoufox` launcher. The published default runtime supports Node.js 22.0 or higher without that launcher. Building this repository requires Node.js 22.15 or higher and the optional launcher for its TypeScript declarations. From a repository checkout, install optional dependencies and supporting assets, then use the same environment when starting the server:

```bash
npm install --include=optional
npm run build
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run fetch:camoufox
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run doctor
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm start
```

The public bootstrap commands are added in release 2.6.0. Until it is published, use the checkout commands above. After publication, an npx install can fetch and verify compatibility mode without locating its npm cache:

```bash
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npx --yes --package camoufox-mcp-server@2.6.0 camoufox-mcp-fetch
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npx --yes --package camoufox-mcp-server@2.6.0 camoufox-mcp-doctor
```

Global installs of 2.6.0 expose `camoufox-mcp-fetch` and `camoufox-mcp-doctor` directly. Add `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1` to your MCP host's server environment so it launches the matching mode.

The newer browser uses the official `@camoufox/camoufox` 0.5.7-beta.4 launcher and its default fingerprint model. If npm skipped optional dependencies, use Node.js 22.15 or higher and run `npm install --include=optional` before enabling compatibility mode. The server's direct `playwright-core` pin stays at 1.59.0. The installer prepares the fingerprint model, addons, and geolocation database before launch.

Without an explicit `CAMOUFOX_INSTALL_DIR`, compatibility mode uses a separate sibling cache named `camoufox-compatibility`. For example, macOS uses `~/Library/Caches/camoufox-compatibility`. Set `CAMOUFOX_INSTALL_DIR` on both installation and startup to choose another directory. Unset the compatibility flag to return to the default browser.

Check `camoufox_status.browserCompatibility`: it reports the mode, expected and installed versions, launcher, and world-isolation warning. Run an actual `browse` to confirm the browser launches.

## Why WebSocket routing needs a workaround

The failure affects Playwright interception of page-created WebSockets. Under newer Camoufox world isolation, Playwright installs its replacement `WebSocket` constructor in a separate JavaScript world. A website keeps using the original constructor, so the routing callback never runs. That silently bypasses this server's private-WebSocket request guard. [Upstream issue #775](https://github.com/daijro/camoufox/issues/775) describes the failure and the proposed browser-level fix.

Compatibility mode sets `disableWorldIsolation: true` for every launch. Playwright's routing code then reaches the website's JavaScript world. Compared with newer upstream defaults, this reduces stealth: websites can inspect automation bindings and the replaced WebSocket constructor. The server keeps this mode opt-in and continues applying its URL policy.

The beta.28 default predates this world-isolation change and already runs automation in the page's JavaScript world. Both server modes report `worldIsolationEnabled: false`; the compatibility warning describes the departure from newer upstream defaults.

The [`mw:` init-script fix in PR #745](https://github.com/daijro/camoufox/pull/745) does not repair the whole routing mechanism. Its bindings and dispatch calls also need to reach the page.

## Remaining network and output limits

Playwright's frame-based `routeWebSocket` does not prevent WebSockets opened by dedicated workers. Real-browser probes on beta.28 default and beta.33 compatibility each recorded zero routing callbacks and one accepted upgrade on a local WebSocket server. This limitation exists in both modes.

For untrusted URLs, enforce private-network blocking with actual VM, firewall, or filtering-proxy egress rules. Browser-context isolation and a Docker container alone do not establish those rules. The server's URL policy remains best-effort; see [privacy and security](privacy-security.md).

Focused extractors have finite count and per-field limits. A shared response byte budget remains an improvement to pursue: many individually bounded fields can still produce a large MCP response.

Snapshot extraction reads text, interactive metadata, and ARIA separately. It now detects main-frame navigation and document replacement, including reloads at the same URL, with up to three extraction attempts within a 10-second deadline. Continued navigation returns an error rather than a mixed snapshot. Response metadata follows the document after it commits and reaches `DOMContentLoaded`. Actions are not replayed by the retry. Use an explicit `waitFor` action when a page must reach a particular state. DOM changes within one document remain live.

## Release and download policy

As of 2026-10-03, [156.0.1-beta.33](https://github.com/daijro/camoufox/releases/tag/v156.0.1-beta.33) is the newest published browser release and is marked prerelease. Its notes cover humanized input and release automation. The native routing fix described in #775 remains open. The [Firefox 157 update in PR #822](https://github.com/daijro/camoufox/pull/822) is also open, with no published browser release to adopt.

Use `npm run fetch:camoufox`. The installer selects an exact tagged asset from `browser-builds.json` and verifies its SHA-256 before extraction. The manifest records all six supported platform assets for each mode. Runtime preflight rejects the wrong browser version before launch.

Avoid `camoufox-js fetch`: its release-list selection previously picked beta.31 assets from the `font-bundle-v1` build-input release. Status and launch preflight now inspect the cache without starting downloads. Re-running the pinned installer repairs a cache whose metadata exists but executable is missing.

## Validation

Doctor and a live `browse` to `https://example.com` passed in both modes. Beta.33 compatibility probes also blocked private WebSockets from pages and iframes without connecting to the target. The worker probes above establish the remaining interception gap.

Earlier runs passed all 64 Python browser-suite cases in both modes on macOS arm64. Focused checks after the installer and policy follow-ups passed policy, sequence, SQLite, preflight, compatibility adapter, and pinned-fetch suites. Lint passed, and `npm audit` reported zero vulnerabilities. The subsequent Docker runtime run exposed the snapshot-navigation race described above; use the matching CI run for validation of that fix.

A fresh compatibility install verified the browser archive. The final installer run verified the required assets, and both final doctor runs completed a real browse. The npm package dry run confirmed the installer, doctor, and shared browser manifest are included.

Anti-detection quality has not been tested. These checks do not establish a private-network sandbox, and worker WebSockets retain the limitation described above.

The Dockerfile copies the bootstrap scripts and browser manifest into its runtime image. CI tests both modes on Ubuntu 24.04 with Node 22 and 24; pull requests also run the browser suite against the built `linux/amd64` Docker image. Use the matching [GitHub Actions run](https://github.com/whit3rabbit/camoufox-mcp/actions/workflows/ci.yml) for Linux and Docker results. Windows remains untested.
