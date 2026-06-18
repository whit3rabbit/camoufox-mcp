# Camoufox JSON-RPC Debugging Reference

Use this when the MCP host has not registered the server yet, or when you need to verify a Camoufox payload without relying on host tool discovery.

## Test the Published Server

This uses the installable package and keeps unsafe browser options disabled.

```bash
node << 'NODESCRIPT'
const { spawn } = require('child_process');

const p = spawn('npx', ['-y', 'camoufox-mcp-server@latest'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});

let response = '';
p.stdout.on('data', (d) => { response += d.toString(); });
p.stderr.on('data', (d) => {
  const s = d.toString();
  if (!s.includes('Camoufox') && !s.includes('Shutting')) {
    console.error('ERR:', s.substring(0, 300));
  }
});

p.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'json-rpc-debug', version: '1.0' }
  }
}) + '\n');

setTimeout(() => {
  p.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'camoufox_status',
      arguments: {}
    }
  }) + '\n');
}, 1000);

setTimeout(() => {
  p.stdin.write(JSON.stringify({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'browse',
      arguments: {
        url: 'https://example.com',
        waitStrategy: 'domcontentloaded',
        outputMode: 'metadata'
      }
    }
  }) + '\n');
}, 1500);

setTimeout(() => {
  for (const line of response.split('\n').filter(Boolean)) {
    try {
      const msg = JSON.parse(line);
      if (msg.id === 2 || msg.id === 3) {
        console.log(JSON.stringify(msg.result?.structuredContent ?? msg, null, 2));
      }
    } catch {}
  }
  p.kill();
}, 15000);
NODESCRIPT
```

## Test a Local Checkout

Build first:

```bash
npm install
npm run build
```

Then replace the spawn command above with:

```js
const p = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});
```

## Opt In to Unsafe Browser Options

Only use this when the operator has approved `firefox_user_prefs`, `args`, or `exclude_addons`:

```js
env: {
  ...process.env,
  CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS: '1'
}
```

Confirm opt-in with `camoufox_status` before sending unsafe options. The status payload should include:

```json
{
  "unsafeOptionsAllowed": true
}
```

## Hard-Site Payload Template

This is a starting point for local retesting, not a guaranteed bypass.

```json
{
  "url": "https://www.reddit.com/",
  "stealthProfile": "normal",
  "os": "windows",
  "locale": "en-US",
  "waitStrategy": "domcontentloaded",
  "timeout": 30000,
  "firefox_user_prefs": {
    "dom.ipc.enabled": false,
    "media.navigator.enabled": false,
    "privacy.resistFingerprinting": true,
    "network.http.altsvc.enabled": false,
    "dom.serviceWorkers.enabled": false,
    "dom.battery.enabled": false,
    "intl.accept_languages": "en-US,en;q=0.9"
  }
}
```

If this returns an unsafe-options error, either remove `firefox_user_prefs` or restart the MCP server with the explicit unsafe env var.
