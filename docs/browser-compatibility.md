# Browser compatibility

The default remains Camoufox 152.0.4-beta.28 with `camoufox-js` 0.12.0 and `playwright-core` 1.59.0. You can opt into Camoufox 158.0.1-beta.41 with page and iframe WebSocket interception restored. This requires disabling the newer browser's world isolation, which exposes automation JavaScript to websites.

## Enable the newer browser

Compatibility mode requires Node.js 22.15 or higher and the optional `camoufox` launcher. The published default runtime supports Node.js 22.0 or higher without that launcher. Building this repository requires Node.js 22.15 or higher and the optional launcher for its TypeScript declarations. From a repository checkout, install optional dependencies and supporting assets, then use the same environment when starting the server:

```bash
npm ci --include=optional
npm run build
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run fetch:camoufox
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run doctor
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm start
```

The public bootstrap commands were added in release 2.6.0. From a checkout, use the commands above. An npx install can fetch and verify compatibility mode without locating its npm cache:

```bash
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npx --yes --package camoufox-mcp-server@2.7.3 camoufox-mcp-fetch
CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npx --yes --package camoufox-mcp-server@2.7.3 camoufox-mcp-doctor
```

Global installs of 2.6.0 expose `camoufox-mcp-fetch` and `camoufox-mcp-doctor` directly. Add `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1` to your MCP host's server environment so it launches the matching mode.

The newer browser uses the official `camoufox` 0.5.9 launcher, the renamed successor of `@camoufox/camoufox`, and its default fingerprint model. If npm skipped optional dependencies, use Node.js 22.15 or higher and run `npm ci --include=optional` before enabling compatibility mode. The server's direct `playwright-core` pin stays at 1.59.0. The installer prepares the fingerprint model and geolocation database and verifies the uBlock Origin addon bundled with the browser before launch. The launcher keeps its fingerprint model and GeoIP databases in its own cache directory (`~/.cache/camoufox` on Linux, following `XDG_CACHE_HOME`; `~/Library/Caches/camoufox` on macOS), which `CAMOUFOX_INSTALL_DIR` does not move. A default-mode browser install replaces that directory, so rerun the compatibility fetch afterwards.

Without an explicit `CAMOUFOX_INSTALL_DIR`, compatibility mode uses a separate sibling cache named `camoufox-compatibility`. For example, macOS uses `~/Library/Caches/camoufox-compatibility`; on Windows the sibling is `%LOCALAPPDATA%\\camoufox\\camoufox\\Cache-compatibility`. Set `CAMOUFOX_INSTALL_DIR` on both installation and startup to choose another directory. Unset the compatibility flag to return to the default browser.

Check `camoufox_status.browserCompatibility`: it reports the mode, expected and installed versions, launcher, and world-isolation warning. Run an actual `browse` to confirm the browser launches.

## Why WebSocket routing needs a workaround

The failure affects Playwright interception of page-created WebSockets. Under newer Camoufox world isolation, Playwright installs its replacement `WebSocket` constructor in a separate JavaScript world. A website keeps using the original constructor, so the routing callback never runs. That silently bypasses this server's private-WebSocket request guard. [Upstream issue #775](https://github.com/daijro/camoufox/issues/775) describes the failure and the proposed browser-level fix.

Compatibility mode sets `disableWorldIsolation: true` for every launch. Playwright's routing code then reaches the website's JavaScript world. Compared with newer upstream defaults, this reduces stealth: websites can inspect automation bindings and the replaced WebSocket constructor. The server keeps this mode opt-in and continues applying its URL policy.

The beta.28 default predates this world-isolation change and already runs automation in the page's JavaScript world. Both server modes report `worldIsolationEnabled: false`; the compatibility warning describes the departure from newer upstream defaults.

The [`mw:` init-script fix in PR #745](https://github.com/daijro/camoufox/pull/745) does not repair the whole routing mechanism. Its bindings and dispatch calls also need to reach the page.

## Remaining network and output limits

Playwright's frame-based `routeWebSocket` does not prevent WebSockets opened by dedicated workers. Real-browser probes on beta.28 default and the earlier beta.33 compatibility build each recorded zero routing callbacks and one accepted upgrade on a local WebSocket server. This limitation exists in both modes.

For untrusted URLs, enforce private-network blocking with actual VM, firewall, or filtering-proxy egress rules. Browser-context isolation and a Docker container alone do not establish those rules. The server's URL policy remains best-effort; see [privacy and security](privacy-security.md).

Focused extractors have finite count and per-field limits. A shared response byte budget remains an improvement to pursue: many individually bounded fields can still produce a large MCP response.

Snapshot extraction reads text, interactive metadata, and ARIA separately. It now detects main-frame navigation and document replacement, including reloads at the same URL, with up to three extraction attempts within a 10-second deadline. Continued navigation returns an error rather than a mixed snapshot. Response metadata follows the document after it commits and reaches `DOMContentLoaded`. Actions are not replayed by the retry. Use an explicit `waitFor` action when a page must reach a particular state. DOM changes within one document remain live.

## Requests held while uBlock Origin starts

In default mode, a request issued a few seconds after launch can reach the network seconds late. uBlock Origin suspends network activity until its filter lists have loaded (its `suspendUntilListsAreLoaded` setting, on by default in Firefox). Every launch uses a fresh profile, so the lists are loaded from scratch each time. Requests issued before the addon starts listening pass at once, which is why the initial navigation is not delayed. Requests issued after that and before the lists are ready are held and then released together.

Measured on 2026-11-21 on Linux x86_64 in a 4-CPU cloud container (Node 22.23, Xvfb, beta.28, uBlock Origin 1.76.6), with timers that fire on time in the page:

| Request issued after launch | Result |
| --- | --- |
| up to about 2 s | passes at once |
| about 2 s to 6 s | held, then all released together at about 6 s |
| later, or after 10 s idle before the first load | passes at once |

Excluding the addon removes the delay entirely, and `headless: true` behaves the same as the virtual display. Pinning the browser to one CPU moved the release to about 7.5 s. `network.http.throttle.enable`, `network.http.tailing.enabled`, the connectivity and captive-portal services, `network.proxy.type`, the proxy environment variables, and `humanize` were ruled out earlier. Other machines were not measured: the window's length there is unknown, and the timing-dependent cases have passed on GitHub Actions. Compatibility mode was not re-measured for this; an earlier probe on that build saw about 0.6 s.

`node tests/probe_startup_request_hold.mjs` repeats the measurement (`--no-ubo` excludes the addon, `--idle` waits before loading).

The server does not change the addon's setting: releasing requests early would let them bypass filtering. Consequences for callers:

- A late subresource, `fetch`, or script-driven navigation in the first seconds of a launch arrives later than the page scheduled it. Use a `waitFor` action for content that depends on it.
- A click that starts a navigation in that window returns before the navigation commits. Snapshot reads wait for a started navigation, within their 10-second deadline, and then describe the new document. They never repeat the action. A navigation that does not commit in time returns the current document with `ariaSnapshotError` naming the wait.

## Release and download policy

As of 2026-11-21:

- **Default mode is unchanged** at beta.28 with `camoufox-js` 0.12.0. [#775](https://github.com/daijro/camoufox/issues/775) (WebSocket route mocks land in the isolated world) is still open with no activity since it was filed, and no release from beta.34 through beta.42 mentions world isolation or WebSocket routing. A direct probe of 158.0.1-beta.41 with default isolation confirmed it: page and iframe WebSockets to a loopback listener were not routed and both connected. With `disableWorldIsolation` the same probe routed and closed both with no connection.
- **Compatibility mode moved** from 156.0.1-beta.33 to [158.0.1-beta.41](https://github.com/daijro/camoufox/releases/tag/v158.0.1-beta.41), upstream's latest release, and from the deprecated `@camoufox/camoufox` 0.5.7-beta.4 launcher to its renamed successor `camoufox` 0.5.9, which pairs with that build. The fingerprint model now comes from the launcher's `fpgen-js` dependency and uBlock Origin ships inside the browser archive. [159.0-beta.42](https://github.com/daijro/camoufox/releases/tag/v159.0-beta.42) is a prerelease and was not evaluated.
- **Playwright stays at 1.59.0.** Both launchers cap `playwright-core` below 1.63, Playwright 1.61 and later need browser beta.30 or newer (which rules them out for the default build), and [#873](https://github.com/daijro/camoufox/issues/873) reports that Playwright 1.64 breaks every `page.route()` on builds before beta.42.

Use `npm run fetch:camoufox`. The installer selects an exact tagged asset from `browser-builds.json` and verifies its SHA-256 before extraction. The manifest records all six supported platform assets for each mode. Runtime preflight rejects the wrong browser version before launch.

Avoid `camoufox-js fetch`: its release-list selection previously picked beta.31 assets from the `font-bundle-v1` build-input release. Status and launch preflight now inspect the cache without starting downloads. Re-running the pinned installer repairs a cache whose metadata exists but executable is missing.

## Validation

Current pins, checked on 2026-11-21 on Linux x86_64 in a cloud container (Node 22.23, Xvfb):

- **Compatibility mode, `camoufox` 0.5.9 with 158.0.1-beta.41:** the Python browser suite passed 74 of 74 cases in two consecutive runs with GeoIP enabled, including the four private-WebSocket cases and the screenshot cases, with no non-protocol output on stdout. The pinned installer verified the archive digest and the bundled uBlock Origin addon. All six platform archives were hashed and each digest equals the one upstream publishes for the release; only the Linux x86_64 archive was installed and run.
- **Default mode, `camoufox-js` 0.12.0 with 152.0.4-beta.28:** 74 of 74 cases with `--no-geoip` in one full run, with no non-protocol output on stdout; that container could not fetch the GeoIP database, so GeoIP-enabled launches were not exercised in this run. Before the timing changes above, four cases that depend on a request issued after load failed there in three of three runs: uBlock Origin held the request past each fixed wait (see [requests held while uBlock Origin starts](#requests-held-while-ublock-origin-starts)). With the changes those four passed in eight consecutive runs. An earlier run on the previous code recorded 73 of 74 with GeoIP enabled.
- **Not checked there:** doctor's live smoke test (the container's TLS-intercepting proxy breaks any public HTTPS browse), the Docker image, macOS, and Windows. Use the matching CI run for those.

Earlier evidence for the previous pins: all 64 Python browser-suite cases passed in both modes on macOS arm64 with beta.28 and beta.33, and doctor completed a real browse in both. The worker probes above establish the remaining interception gap.

Anti-detection quality has not been tested. These checks do not establish a private-network sandbox, and worker WebSockets retain the limitation described above.

The Dockerfile copies the bootstrap scripts and browser manifest into its runtime image. CI tests both modes on Ubuntu 24.04 with Node 22 and 24; pull requests also run the browser suite against the built `linux/amd64` Docker image. Use the matching [GitHub Actions run](https://github.com/whit3rabbit/camoufox-mcp/actions/workflows/ci.yml) for Linux and Docker results. Windows remains untested.
