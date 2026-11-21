import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

const browserOptionsUrl = new URL("../dist/browser-options.js", import.meta.url).href;
const configUrl = new URL("../dist/config.js", import.meta.url).href;

function runIsolated(source, env) {
  // Policy constants are read at import, so each posture needs a fresh process.
  return execFileSync(process.execPath, ["--input-type=module", "-e", source], {
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// --- Unsafe options enabled: the "always denied" list still applies ---------
runIsolated(`
  import assert from "node:assert/strict";
  import { findDeniedBrowserArg, validateBrowserOptionsInput } from ${JSON.stringify(browserOptionsUrl)};

  // Firefox accepts one or two dashes and any letter case for every flag.
  for (const flag of ["--remote-debugging-port", "-remote-debugging-port", "--REMOTE-DEBUGGING-PORT", "-start-debugger-server", "--start-debugger-server", "-profile", "--profile", "-P", "-url", "--new-window", "-new-tab", "-private-window", "--marionette", "-juggler", "--jsdebugger", "-devtools"]) {
    assert.ok(findDeniedBrowserArg([flag]), flag + " must be denied");
    await assert.rejects(validateBrowserOptionsInput({ args: [flag] }), /denied by server policy/, flag);
  }

  // Leftover arguments are opened as startup URLs, outside the request guard.
  for (const args of [
    ["http://169.254.169.254/latest/meta-data/"],
    ["internal.example"],
    ["/etc/passwd"],
    ["--kiosk", "http://10.0.0.1/"],
    ["--some-flag=http://127.0.0.1:8080/"],
    ["--some-flag=value"],
    ["--width=800;rm"],
    ["--width", "http://10.0.0.1/"],
  ]) {
    assert.ok(findDeniedBrowserArg(args), JSON.stringify(args) + " must be denied");
  }

  // Ordinary flags and the sizing flags that take a value stay usable.
  for (const args of [["--kiosk"], ["-headless"], ["--width=1280", "--height=720"], ["-width", "1280", "-height", "720"], ["--safe-mode", "--kiosk"]]) {
    assert.equal(findDeniedBrowserArg(args), undefined, JSON.stringify(args) + " must be allowed");
  }

  // Resolver, WebRTC, and remote-control prefs would move connections away from
  // the address this server validated or open a channel it cannot see.
  for (const key of ["network.dns.forceResolve", "network.dns.localDomains", "network.trr.mode", "network.trr.uri", "media.peerconnection.enabled", "media.peerconnection.ice.default_address_only", "remote.active-protocols", "marionette.port", "devtools.debugger.remote-enabled", "network.proxy.type", "security.csp.enable", "browser.startup.homepage", "NETWORK.DNS.FORCERESOLVE"]) {
    await assert.rejects(validateBrowserOptionsInput({ firefox_user_prefs: { [key]: "x" } }), /denied by server policy/, key);
  }
  for (const key of ["browser.startup.page", "privacy.resistFingerprinting", "permissions.default.image", "network.http.max-connections"]) {
    await assert.doesNotReject(validateBrowserOptionsInput({ firefox_user_prefs: { [key]: 1 } }), key);
  }

  await assert.doesNotReject(validateBrowserOptionsInput({ block_webrtc: false }), "opt-in allows re-enabling WebRTC");
`, { CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS: "1" });

// --- Default posture ------------------------------------------------------
runIsolated(`
  import assert from "node:assert/strict";
  import { validateBrowserOptionsInput } from ${JSON.stringify(browserOptionsUrl)};
  await assert.rejects(validateBrowserOptionsInput({ block_webrtc: false }), /block_webrtc: false is disabled by server policy/);
  await assert.doesNotReject(validateBrowserOptionsInput({ block_webrtc: true }));
  await assert.doesNotReject(validateBrowserOptionsInput({}));
  await assert.rejects(validateBrowserOptionsInput({ args: ["--kiosk"] }), /Unsafe browser options are disabled/);
`, { CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS: "" });

// --- Integer settings -----------------------------------------------------
// parseInt read "10m" as 10 and "1e5" as 1. Anything that is not a plain
// integer now keeps the default and says why on stderr.
function readSetting(value) {
  const result = execFileSync(process.execPath, ["--input-type=module", "-e", `
    const { MAX_QUEUE } = await import(${JSON.stringify(configUrl)});
    process.stdout.write(String(MAX_QUEUE));
  `], { env: { ...process.env, CAMOUFOX_MCP_MAX_QUEUE: value }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return Number(result);
}
assert.equal(readSetting("20"), 20);
assert.equal(readSetting(" 20 "), 20);
assert.equal(readSetting("1000"), 100, "values are clamped to the supported range");
assert.equal(readSetting("-5"), 0);
for (const invalid of ["10m", "1e5", "0x10", "12.5", "ten", "1 000"]) {
  assert.equal(readSetting(invalid), 8, JSON.stringify(invalid) + " falls back to the default");
}
assert.equal(readSetting(""), 8);
const warned = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(configUrl)});`], {
  env: { ...process.env, CAMOUFOX_MCP_MAX_QUEUE: "10m" }, encoding: "utf8",
});
assert.match(warned.stderr, /Ignoring CAMOUFOX_MCP_MAX_QUEUE="10m": expected an integer\. Using 8\./);
assert.equal(warned.stdout, "", "configuration warnings never go to stdout");

console.log("Option gate and configuration unit tests passed.");
