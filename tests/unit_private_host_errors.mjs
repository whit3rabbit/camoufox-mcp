import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scratch = mkdtempSync(join(tmpdir(), "camoufox-private-host-errors-"));
const preload = join(scratch, "dns-fixtures.mjs");
writeFileSync(preload, `
  import dns from "node:dns/promises";
  import { syncBuiltinESMExports } from "node:module";
  const originalLookup = dns.lookup;
  const fixtures = new Map([
    ["dashboard.internal", ["127.0.0.1"]],
    ["intranet.corp", ["10.0.0.1"]],
    ["customname", ["192.168.0.1"]],
    ["metadata.internal", ["169.254.169.254"]],
    ["mixed.internal", ["127.0.0.1", "169.254.169.254"]],
    ["already.internal", ["fd00:ec2::254"]],
    ["app,db.internal", ["127.0.0.1"]],
  ]);
  dns.lookup = async (hostname, options) => fixtures.has(hostname)
    ? fixtures.get(hostname).map(address => ({ address, family: address.includes(":") ? 6 : 4 }))
    : originalLookup(hostname, options);
  syncBuiltinESMExports();
`);

const client = new Client({ name: "private-host-errors-test", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", preload, fileURLToPath(new URL("../dist/index.js", import.meta.url))],
  stderr: "pipe",
  env: {
    ...process.env,
    NODE_ENV: "production",
    CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST: "0",
    CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS: "already.internal",
    CAMOUFOX_MCP_NETWORK_SANDBOX: "0",
    CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX: "0",
  },
});

async function rejected(name, url) {
  const response = await client.callTool({ name, arguments: { url } });
  assert.equal(response.isError, true, `${name} must reject ${url}`);
  const message = response.content.filter(item => item.type === "text").map(item => item.text).join("\n");
  assert.ok(message.length > 0, "MCP errors must provide text even without structuredContent");
  return message;
}

try {
  await client.connect(transport);
  for (const [tool, hostname] of [
    ["browse", "dashboard.internal"],
    ["browse_screenshot", "intranet.corp"],
    ["browse_snapshot", "customname"],
  ]) {
    const message = await rejected(tool, `http://${hostname}/private`);
    assert.ok(message.includes(`CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=${hostname}`), message);
    assert.match(message, /MCP server environment/i);
    assert.match(message, /restart the MCP server/i);
    assert.match(message, /existing list/i);
  }

  for (const hostname of ["metadata.internal", "mixed.internal", "already.internal", "app,db.internal"]) {
    const message = await rejected("browse", `http://${hostname}/private`);
    assert.ok(!message.includes("CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS="), `An ineffective opt-in must not be recommended: ${message}`);
  }

  const directIp = await rejected("browse", "http://127.0.0.1/");
  assert.match(directIp, /resolvable DNS hostname/);
  assert.match(directIp, /IP literals cannot be allowlisted/);
  console.log("MCP private-host error guidance tests passed.");
} finally {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
}
