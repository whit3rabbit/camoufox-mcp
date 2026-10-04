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
      if (msg.id === 1) {
        console.log(JSON.stringify(msg.result?.capabilities?.extensions?.['camoufox-mcp'] ?? msg, null, 2));
      }
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

Use Node >=22.15 for repository builds, including the optional launcher for its TypeScript declarations:

```bash
npm install --include=optional
npm run build
npm run fetch:camoufox
npm run doctor
```

Then replace the spawn command above with:

```js
const p = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
});
```

## Test a Private Development Host

For a trusted private hostname, add the allowlist to the local checkout's spawned server environment:

```js
env: {
  ...process.env,
  CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS: 'localhost,laravel.test,dashboard.internal'
}
```

Preserve existing entries when editing an MCP host configuration. The setting supports any exact hostname that resolves to an ordinary private or loopback address, not only `.test` or `localhost`. Node and the browser must both resolve the name in their own environment. IP literals, URLs, ports, and wildcards are not valid entries.

Restart the server and check `camoufox_status.networkSecurity.allowedPrivateHosts`, then send the `browse` request with your development URL. The startup list is also exposed at `initialize.result.capabilities.extensions["camoufox-mcp"].policy.allowedPrivateHosts`. An absent status field means the server build does not support this setting; use repository `main` or a release containing the feature.

On an eligible private-host denial, `tools/call` returns `isError: true` and text containing the exact `CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=<hostname>` setting and restart instruction. Read that text even when `structuredContent` is absent. The blocked hostname can belong to a resource, redirect, or proxy rather than the initial page.

Configure server `env`, not tool arguments or unsafe browser options. The allowlist cannot permit metadata, link-local, multicast, or reserved addresses; those errors do not offer this remedy.

## Test Browser Compatibility Mode

With the optional launcher installed on Node >=22.15, run `CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run fetch:camoufox` and the same command prefix for doctor. Add `CAMOUFOX_MCP_BROWSER_COMPATIBILITY: '1'` to the spawned process environment. Use the same `CAMOUFOX_INSTALL_DIR` if you override the separate compatibility cache.

Inspect `camoufox_status.browserCompatibility` for mode, expected/installed versions, launcher, and warning. Both modes report `worldIsolationEnabled: false`. Compatibility restores page/iframe WebSocket interception by disabling the newer browser's isolation; worker sockets remain outside that interception. Keep actual network egress controls for untrusted pages.

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

The initialize response also advertises the active policy at `result.capabilities.extensions["camoufox-mcp"].policy`.

## Hard-Site Payload Template

This is a starting point for local retesting, not a guaranteed bypass. Leave `locale` unset unless the user or operator explicitly asks for locale testing. If you set it, match the approved target locale and align `intl.accept_languages` to the same locale family.

```json
{
  "url": "https://www.reddit.com/",
  "stealthProfile": "normal",
  "os": "windows",
  "waitStrategy": "domcontentloaded",
  "timeout": 30000,
  "firefox_user_prefs": {
    "dom.ipc.enabled": false,
    "media.navigator.enabled": false,
    "privacy.resistFingerprinting": true,
    "network.http.altsvc.enabled": false,
    "dom.battery.enabled": false
  }
}
```

Approved locale override syntax:

```json
{
  "locale": "<approved-locale>",
  "firefox_user_prefs": {
    "intl.accept_languages": "<approved-locale>,<base-language>;q=0.9"
  }
}
```

If this returns an unsafe-options error, either remove `firefox_user_prefs` or restart the MCP server with the explicit unsafe env var. If it reports a denied unsafe pref, remove that specific pref; denied prefs are rejected even when unsafe options are enabled.
