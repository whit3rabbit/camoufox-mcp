# Development

Repository builds require Node.js >=22.15 and the optional launcher for its TypeScript declarations. The published default runtime supports Node.js >=22.0 without that launcher.

### Building from Source

```bash
# Clone the repository
git clone https://github.com/whit3rabbit/camoufox-mcp.git
cd camoufox-mcp

# Install dependencies
npm install --include=optional

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
npm install --include=optional
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

To test beta.33 compatibility, use `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1` for the pinned fetch, doctor, MCP host environment, and test command. The mode uses a separate cache unless `CAMOUFOX_INSTALL_DIR` is set. See [browser compatibility](browser-compatibility.md) for setup, verified versions, and network limits.

### Running Tests

```bash
# Run test suite
npm test

# Run with local server
python3 tests/test_client.py --mode local
```

The integration harness starts a local HTTP fixture server and sets `NODE_ENV=test`, `CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST=1`, and a fixture-port allowlist for the MCP process. These test-only settings are intentionally port-scoped so localhost SSRF rejection still runs without the escape hatch.

Run `npm run test:all` before a release. It covers lint, dependency audit, deterministic checks, a pinned browser fetch, and the local browser suite. GitHub Actions results are separate evidence; a local pass does not confirm CI.

The workflow runs on Ubuntu 24.04 with Node 22 and 24, each testing the default and compatibility browser modes. Every job runs `node tests/check_release_versions.mjs`, installs with `npm ci --include=optional`, and runs `npm run test:all`. Pull requests also build the `linux/amd64` Docker image and run the Python browser suite against it. Check the matching [GitHub Actions run](https://github.com/whit3rabbit/camoufox-mcp/actions/workflows/ci.yml) for completed Linux and Docker results.

Keep the seven release version fields and root lockfile records aligned. Tagged releases publish npm, Docker, the ClawHub bundle, and a GitHub Release automatically. Local ClawHub validation does not confirm an OpenClaw installation.

### Docker Build

```bash
# Build the AMD64 image used by releases
docker buildx build --platform linux/amd64 -t camoufox-mcp .
```
