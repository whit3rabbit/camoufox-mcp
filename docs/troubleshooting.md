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

### Debug Mode

To see detailed logs, run the server directly:

```bash
node dist/index.js
```
