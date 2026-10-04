# Troubleshooting

On a local checkout, run `npm run doctor` first. It checks Node version, the
`camoufox-js` and `playwright-core` pins, the cached browser build, and drives a
real `browse`, printing the exact fix for each failure. It resolves most of the
issues below in one command.

### Common Issues

1. **"Camoufox browser not found" or `browserAvailable: false` after fetch**
   - From a checkout, run `npm run fetch:camoufox`. Global installs of 2.6.0 provide `camoufox-mcp-fetch`. After release 2.6.0 is published, use `npx --yes --package camoufox-mcp-server@2.6.0 camoufox-mcp-fetch` for npx installs. Avoid `camoufox-js fetch`: the package's pinned installer selects a tagged, checksummed build.
   - For Docker, the browser is pre-installed.
   - If the browser is downloaded but status still reports it is missing:
     - **Environment mismatch:** Status inspects the cache on each call. Use the same `CAMOUFOX_INSTALL_DIR` and `CAMOUFOX_MCP_BROWSER_COMPATIBILITY` values for fetch, doctor, and the host's MCP process. Restart the host after changing those environment values.
     - **Wrong build or incomplete cache:** Re-run the pinned installer with the host's environment. It repairs missing assets and replaces mismatched browser builds (see item 10).

2. **"Cannot find module"**
   - Repository builds require Node.js >=22.15 and `npm install --include=optional`; the published default runtime supports Node.js >=22.0.
   - Compatibility mode requires the optional `@camoufox/camoufox` launcher. If npm skipped it, use Node.js >=22.15 and reinstall with `--include=optional` before enabling `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1`.
   - For global install: `npm install -g camoufox-mcp-server@latest`

3. **"MCP server not responding"**
   - Check that the server is properly configured in your AI assistant
   - Verify the command path is correct
   - Check logs for error messages

4. **"Unsafe browser options are disabled"**
   - `firefox_user_prefs`, `args`, and `exclude_addons` require `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`
   - Confirm the active state in `initialize.result.capabilities.extensions["camoufox-mcp"].policy.unsafeOptionsAllowed` or `camoufox_status.unsafeOptionsAllowed`
   - Check stderr for a warning naming the rejected option family

5. **Navigation hangs on sites with long-lived connections**
   - The default `waitStrategy` is `domcontentloaded`
   - If a call overrides it to `load` or `networkidle`, try removing the override or setting `waitStrategy: "domcontentloaded"`

6. **`better-sqlite3` NODE_MODULE_VERSION / ABI mismatch errors**
   - `better-sqlite3` is a dependency of this server, pulled in transitively through `camoufox-js`, which uses it to read a bundled WebGL fingerprint database
   - The native binary is downloaded for the Node ABI of the Node version that ran the install. If the gateway spawns the server with a different Node version (for example npm install under Node 22 but the gateway launches Node 25 via nvm), loading fails with `NODE_MODULE_VERSION X ... requires NODE_MODULE_VERSION Y`
   - As of 2.1.6 this error should no longer occur on Node 22.15+: the server redirects `better-sqlite3` to the built-in `node:sqlite` module, so no native binary is loaded. Set `CAMOUFOX_MCP_NO_SQLITE_SHIM=1` to opt out and use the native module
   - On older Node runtimes, note that when the server is launched via `npx`, its dependencies live in the npx cache (`~/.npm/_npx/<hash>/node_modules`) — rebuilding `better-sqlite3` in another checkout does not fix the copy the server actually loads. Clear the cache (`rm -rf ~/.npm/_npx`) using the same Node version the gateway spawns, or run `npm rebuild better-sqlite3` inside the npx cache directory itself
   - Restart the gateway afterwards so the MCP server process reloads native modules

7. **Hermes MCP tools do not appear or discovery fails**
   - For Hermes direct skill installs, register the MCP server explicitly:
     `hermes mcp add camoufox --command npx --env CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 --args -y camoufox-mcp-server@latest`
   - `--args` must be the last option and must receive plain argv tokens, not a JSON array string
   - In `~/.hermes/config.yaml`, `mcp_servers.camoufox.args` must be a YAML list and `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` must be `"1"` without embedded quote characters
   - Verify with `hermes mcp list` and `hermes mcp test camoufox`, then restart Hermes from a separate terminal
   - Camoufox tools appear as `mcp_camoufox_*`; `browser_navigate` is Hermes' built-in browser, not Camoufox
   - If Hermes reports ambiguous `camoufox` skills, keep only one installed Camoufox skill path or load the categorized path explicitly

8. **OpenClaw still uses an old MCP process after rebuild**
   - Restart the OpenClaw gateway after changing config or rebuilding the server

9. **Cloudflare or other challenge pages instead of content**
   - High-security sites may challenge any automated browser; this is expected and not fully solvable server-side
   - Enable `geoip` so the fingerprint locale/timezone matches the exit IP, and use `humanize` cursor movement
   - Datacenter IPs are heavily challenged; a residential or mobile proxy via the `proxy` option significantly improves pass rates
   - Session tools support challenge pause/resume so a human can complete an interactive challenge when needed

10. **Browser fails to launch / `Library not loaded: @rpath/libmozglue.dylib` after changing binary versions**
    - Overlaying browser builds can corrupt the cached bundle. The pinned installer clears the selected cache when replacing a build. Run `npm run fetch:camoufox` with the same environment as the server.
    - Default caches are `~/Library/Caches/camoufox` on macOS and `~/.cache/camoufox` on Linux. Compatibility mode uses a `camoufox-compatibility` sibling unless `CAMOUFOX_INSTALL_DIR` is set. `XDG_CACHE_HOME` does not select the browser directory.
    - If metadata matches but libraries are corrupt, stop the MCP process, remove or move aside that exact cache directory, and run the pinned installer again. `npm run doctor` reports which directory and build it expects.

11. **`Browser.setDefaultViewport ... isMobile ... not described in this scheme`, or anti-detection regressed after `npx @latest`**
    - This package pins `playwright-core` directly at 1.59.0 for checkout, npx, and global installs. An `overrides` entry alone would only constrain a root project and cannot replace the direct pin.
    - Earlier probes with older browser builds found Playwright 1.60 broke a navigation guard and 1.61 sent an unsupported `isMobile` field. Those results do not prove compatibility with beta.33. Keep the selected browser/launcher/Playwright pins together and test before changing them.
    - On a checkout, `npm run doctor` fails if `playwright-core` drifted off the pin

12. **`Error: ENOSPC: no space left on device, write` or partial-install errors during fetch**
    - Fetching needs space for the compressed archive, extracted browser, and supporting assets. Requirements vary by platform and build.
    - Check available space in the install directory and OS temporary directory. Failed downloads can leave installer scratch directories behind, especially on hosts with a small temporary filesystem.
    - Inspect those directories and confirm each is abandoned and unused by a live installer before removing that exact directory. Retry the pinned fetch after freeing space.

13. **"URL host resolves to a private, local, or reserved address" for a development site**
    - Set `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=laravel.test` in the MCP server's environment, then restart it. Use your site's exact hostname and add separate entries for local asset hosts.
    - The hostname must resolve in both the server and browser environments. This setting does not create DNS entries or make a host-side server reachable from Docker.
    - The default block prevents browser tools from probing local services. The opt-in allows loopback and private addresses for named hosts; metadata, link-local, and reserved addresses stay blocked. See [local development sites](server-policy.md#local-development-sites).

### Debug Mode

To see detailed logs, run the server directly:

```bash
node dist/index.js
```
