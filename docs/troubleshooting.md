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

### Debug Mode

To see detailed logs, run the server directly:

```bash
node dist/index.js
```
