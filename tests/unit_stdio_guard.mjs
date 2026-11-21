import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// MCP reserves stdout for JSON-RPC. Launcher dependencies print to it, so the
// server must keep the protocol stream clean whatever else writes to stdout.
const temporaryRoot = mkdtempSync(join(tmpdir(), "camoufox-stdio-guard-test-"));
const preload = join(temporaryRoot, "noise.mjs");
// Stands in for a dependency that prints progress while the server is running,
// and reports what the server left in its environment.
writeFileSync(preload, `
  setTimeout(() => {
    console.log("noise from console.log");
    console.info("noise from console.info");
    process.stdout.write("noise from process.stdout.write\\n");
    process.stdout.write(Buffer.from("noise from a buffer write\\n"), () => {});
    console.error("SKIP_DOWNLOAD=" + String(process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD));
  }, 250);
`);

try {
  const child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, fileURLToPath(new URL("../dist/index.js", import.meta.url))], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 15000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, `timed out waiting for ${label}\nstdout: ${stdout}\nstderr: ${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "stdio-guard-test", version: "0" } } });
  await waitFor(() => stdout.includes('"id":1'), "initialize response");
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  await waitFor(() => stderr.includes("SKIP_DOWNLOAD="), "the noisy dependency");
  send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "camoufox_status", arguments: {} } });
  await waitFor(() => stdout.includes('"id":2'), "status response");

  const lines = stdout.split("\n").filter((line) => line.trim());
  assert.ok(lines.length >= 2);
  for (const line of lines) {
    let message;
    assert.doesNotThrow(() => { message = JSON.parse(line); }, `stdout carried a non-JSON line: ${line.slice(0, 120)}`);
    assert.equal(message.jsonrpc, "2.0", "every stdout line is a JSON-RPC message");
  }
  for (const noise of ["noise from console.log", "noise from console.info", "noise from process.stdout.write", "noise from a buffer write"]) {
    assert.ok(stderr.includes(noise), `${noise} is diverted to stderr, not dropped`);
    assert.ok(!stdout.includes(noise));
  }
  // camoufox-js skips registering uBlock Origin when this variable is set.
  assert.match(stderr, /SKIP_DOWNLOAD=undefined/, "the server clears PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD from its own environment");

  // A client that disconnects closes the pipe without sending a signal.
  child.stdin.end();
  const timer = setTimeout(() => child.kill("SIGKILL"), 10000);
  const { code, signal } = await exited;
  clearTimeout(timer);
  assert.equal(signal, null, "the server exits on its own when stdin closes");
  assert.equal(code, 0);
  assert.match(stderr, /Shutting down server after stdin/);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("Stdio guard unit tests passed.");
