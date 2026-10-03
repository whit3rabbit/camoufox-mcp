#!/usr/bin/env node
// Preflight guardrail for the Camoufox MCP server.
// Catches the footguns that otherwise surface as cryptic runtime failures:
// wrong Node, drifted playwright-core, a mismatched/corrupt browser cache, or a
// dead browser. Run: `npm run doctor`. Exits nonzero on the first failure.
//
// No external deps on purpose: this must run before `npm install` is trusted.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import builds from "../browser-builds.json" with { type: "json" };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ponytail: single source of truth for the verified triple mirrors the
// "Dependency & Browser Pinning" section in CLAUDE.md. Bump here + there
// together when the gated upgrade in that section is adopted.
const compatibility = process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY === "1";
const selectedBuild = compatibility ? builds.compatibility : builds.default;
const EXPECTED = {
  camoufoxJs: builds.default.launcherVersion,
  playwrightCore: builds.playwrightCore,
  binaryVersion: selectedBuild.version,
  binaryRelease: selectedBuild.release,
};

const req = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const packageResolver = createRequire(import.meta.url);
// npm may hoist dependencies beside this package. Resolve manifests without loading code.
const installedPackage = (name) => JSON.parse(readFileSync(packageResolver.resolve(`${name}/package.json`), "utf8"));
let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m, fix) => {
  failed++;
  console.log(`  FAIL  ${m}`);
  if (fix) console.log(`        -> ${fix}`);
};

// 1. Node version (matches package.json engines).
function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  const minor = Number(process.versions.node.split(".")[1]);
  if (compatibility && (major < 22 || (major === 22 && minor < 15))) {
    fail(`Node ${process.versions.node} is too old for the compatibility launcher`, "use Node >=22.15");
  }
  else if (major >= 22) ok(`Node ${process.versions.node} (>=22)`);
  else fail(`Node ${process.versions.node} is < 22`, "use Node >=22 (see engines in package.json)");
}

// 2. camoufox-js is pinned exactly and installed at that version.
function checkCamoufoxPin() {
  const declared = req("package.json").dependencies["camoufox-js"];
  if (/^[\^~><=*]/.test(declared)) {
    fail(`camoufox-js pin "${declared}" is a range`, `pin the exact version "${EXPECTED.camoufoxJs}"`);
    return;
  }
  let installed;
  try {
    installed = installedPackage("camoufox-js").version;
  } catch {
    fail("camoufox-js is not installed", "run `npm install`");
    return;
  }
  if (declared === EXPECTED.camoufoxJs && installed === EXPECTED.camoufoxJs) {
    ok(`camoufox-js ${installed} (exact pin)`);
  } else {
    fail(`camoufox-js declared=${declared} installed=${installed}, expected ${EXPECTED.camoufoxJs}`, "run `npm install`");
  }
}

// 3. playwright-core is pinned as a DIRECT dependency and installed at that version.
// camoufox-js floats playwright-core (peer: *). `overrides` only bind the root
// project, so they do NOT pin it for npx/global installs of this package -- those
// would drift to the newest playwright-core, which is incompatible with the
// Camoufox Juggler (1.61 sends `isMobile`; 1.60 breaks the private-nav guard).
// A direct dependency is what holds the line for every install path.
function checkPlaywright() {
  const pkg = req("package.json");
  const direct = pkg.dependencies["playwright-core"];
  if (!direct) {
    fail("playwright-core is not a direct dependency", `add "playwright-core": "${EXPECTED.playwrightCore}" to dependencies`);
    return;
  }
  if (/^[\^~><=*]/.test(direct)) {
    fail(`playwright-core dep "${direct}" is a range`, `pin the exact version "${EXPECTED.playwrightCore}"`);
    return;
  }
  let installed;
  try {
    installed = installedPackage("playwright-core").version;
  } catch {
    fail("playwright-core is not installed", "run `npm install`");
    return;
  }
  if (direct === EXPECTED.playwrightCore && installed === EXPECTED.playwrightCore) {
    ok(`playwright-core ${installed} (direct pin)`);
  } else {
    fail(`playwright-core dep=${direct} installed=${installed} expected=${EXPECTED.playwrightCore}`, "run `npm install`");
  }
}

// 4. Cached browser binary matches the expected build.
// Overlaying a new build onto an old bundle corrupts it, so a mismatch must be
// fixed by wiping the cache, not by re-fetching over the top.
function cacheDir() {
  if (process.env.CAMOUFOX_INSTALL_DIR) return resolve(process.env.CAMOUFOX_INSTALL_DIR);
  if (compatibility) {
    const base = platform() === "darwin" ? join(homedir(), "Library", "Caches", "camoufox")
      : platform() === "win32" ? join(homedir(), "AppData", "Local", "camoufox", "camoufox", "Cache")
      : join(homedir(), ".cache", "camoufox");
    return `${base}-compatibility`;
  }
  if (platform() === "darwin") return join(homedir(), "Library", "Caches", "camoufox");
  if (platform() === "win32") return join(homedir(), "AppData", "Local", "camoufox", "camoufox", "Cache");
  // Match camoufox-js, which does not use XDG_CACHE_HOME for its browser cache.
  return join(homedir(), ".cache", "camoufox");
}
function checkBinary() {
  const dir = cacheDir();
  const wipe = platform() === "darwin"
    ? `rm -rf "${join(dir, "Camoufox.app")}" "${join(dir, "version.json")}" && npm run fetch:camoufox`
    : `rm -rf "${dir}" && npm run fetch:camoufox`;
  let v;
  try {
    v = JSON.parse(readFileSync(join(dir, "version.json"), "utf8"));
  } catch {
    fail(`no cached browser at ${dir}`, "run `npm run fetch:camoufox`");
    return;
  }
  if (v.version === EXPECTED.binaryVersion && v.release === EXPECTED.binaryRelease) {
    ok(`browser ${v.version}-${v.release}`);
  } else {
    fail(`browser ${v.version}-${v.release}, expected ${EXPECTED.binaryVersion}-${EXPECTED.binaryRelease}`, `wipe + refetch: ${wipe}`);
  }
}

// 5. Live smoke test: browserAvailable alone does not prove a launch works, so
// drive a real metadata browse through JSON-RPC against the built server.
function rpc(id, method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}
function smokeTest() {
  return new Promise((resolve) => {
    let dist;
    try {
      dist = req("package.json").bin["camoufox-mcp-server"];
    } catch {
      dist = "dist/index.js";
    }
    const distPath = join(ROOT, dist);
    try {
      readFileSync(distPath);
    } catch {
      fail(`${dist} not built`, "run `npm run build`");
      return resolve();
    }

    const p = spawn("node", [distPath], { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    // Parse responses as they arrive so the smoke test resolves as soon as both
    // the status (id 2) and browse (id 3) results are in, instead of always
    // waiting the full 30s fallback. The 30s timer remains the upper bound for a
    // hung/dead browser.
    let statusOk = false;
    let browseOk = false;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (statusOk) ok("camoufox_status.browserAvailable = true");
      else fail("camoufox_status did not report browserAvailable=true", "check `npm run fetch:camoufox` and server logs (`node dist/index.js`)");
      if (browseOk) ok("browse https://example.com returned (metadata)");
      else fail("browse smoke test did not return a non-error result", "run `node dist/index.js` and inspect stderr");
      try { p.kill(); } catch {}
      resolve();
    };

    const consume = () => {
      if (settled) return;
      for (const line of out.split("\n").filter(Boolean)) {
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id === 2 && !statusOk) {
          const sc = msg.result?.structuredContent ?? {};
          statusOk = sc.browserAvailable === true;
        }
        if (msg.id === 3 && !browseOk) {
          browseOk = msg.result && msg.result.isError !== true;
        }
      }
      if (statusOk && browseOk) {
        finish();
      }
    };

    p.stdout.on("data", (d) => { out += d.toString(); consume(); });
    p.stderr.on("data", () => {});

    p.stdin.write(rpc(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "doctor", version: "1.0" },
    }));
    setTimeout(() => p.stdin.write(rpc(2, "tools/call", { name: "camoufox_status", arguments: {} })), 800);
    setTimeout(() => p.stdin.write(rpc(3, "tools/call", {
      name: "browse",
      arguments: { url: "https://example.com", waitStrategy: "domcontentloaded", outputMode: "metadata" },
    })), 1400);

    const timer = setTimeout(finish, 30000);
    // If the server dies before either response, report what we have.
    p.on("exit", () => finish());
  });
}

console.log("Camoufox MCP doctor\n");
console.log("Pins & environment:");
checkNode();
checkCamoufoxPin();
if (compatibility) {
  try {
    const installed = installedPackage("@camoufox/camoufox").version;
    const declared = req("package.json").optionalDependencies?.["@camoufox/camoufox"];
    if (installed === selectedBuild.launcherVersion && declared === installed) ok(`official launcher ${installed} (exact pin)`);
    else fail("official launcher version mismatch", "use Node >=22.15 and run npm install --include=optional");
  } catch { fail("official launcher is not installed", "use Node >=22.15 and run npm install --include=optional"); }
  console.log("  World isolation disabled for WebSocket compatibility; automation is detectable.");
}
checkPlaywright();
checkBinary();
if (failed) {
  console.log("\nLive smoke test skipped until the preflight checks pass.");
} else {
  console.log("\nLive smoke test (launches the browser, ~a few seconds):");
  await smokeTest();
}

console.log("");
if (failed) {
  console.log(`${failed} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed.");
