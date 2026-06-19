# Troubleshooting

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

4. **"Unsafe browser options are disabled"**
   - `firefox_user_prefs`, `args`, and `exclude_addons` require `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1`
   - Confirm the active state in `initialize.result.capabilities.extensions["camoufox-mcp"].policy.unsafeOptionsAllowed` or `camoufox_status.unsafeOptionsAllowed`
   - Check stderr for a warning naming the rejected option family

5. **Navigation hangs on sites with long-lived connections**
   - The default `waitStrategy` is `domcontentloaded`
   - If a call overrides it to `load` or `networkidle`, try removing the override or setting `waitStrategy: "domcontentloaded"`

6. **Hermes MCP tools do not appear or discovery fails**
   - Native module errors such as `better-sqlite3` compiled for the wrong Node.js version usually come from the host or gateway dependency tree, not this server
   - Rebuild the host dependency under the Node version used by that host, then restart the gateway so the MCP server process reloads native modules
   - For Hermes direct skill installs, register the MCP server explicitly:
     `hermes mcp add camoufox --command npx --env CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 --args -y camoufox-mcp-server@latest`
   - `--args` must be the last option and must receive plain argv tokens, not a JSON array string
   - In `~/.hermes/config.yaml`, `mcp_servers.camoufox.args` must be a YAML list and `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS` must be `"1"` without embedded quote characters
   - Verify with `hermes mcp list` and `hermes mcp test camoufox`, then restart Hermes from a separate terminal
   - Camoufox tools appear as `mcp_camoufox_*`; `browser_navigate` is Hermes' built-in browser, not Camoufox
   - If Hermes reports ambiguous `camoufox` skills, keep only one installed Camoufox skill path or load the categorized path explicitly

7. **OpenClaw still uses an old MCP process after rebuild**
   - Restart the OpenClaw gateway after changing config or rebuilding the server

### Debug Mode

To see detailed logs, run the server directly:

```bash
node dist/index.js
```
