# Development

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

The integration harness starts a local HTTP fixture server and sets `NODE_ENV=test`, `CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST=1`, and a fixture-port allowlist for the MCP process. These test-only settings are intentionally port-scoped so localhost SSRF rejection still runs without the escape hatch.

### Docker Build

```bash
# Build the AMD64 image used by releases
docker buildx build --platform linux/amd64 -t camoufox-mcp .
```
