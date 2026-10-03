import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  browserRequestPolicyUrl,
  isBlockedIp,
  parseAndValidateTargetUrl,
} from "../dist/policy.js";

const blockedAddresses = [
  "0.0.0.0",
  "10.0.0.1",
  "127.0.0.1",
  "169.254.169.254",
  "172.16.0.1",
  "192.0.0.1",
  "192.0.2.5",
  "192.168.0.1",
  "192.88.99.1",
  "224.0.0.1",
  "::",
  "::1",
  "64:ff9b::1",
  "64:ff9b:1::1",
  "100::1",
  "2001::1",
  "2001:2::1",
  "2001:db8::1",
  "2002::1",
  "fc00::1",
  "fe80::1",
  "ff00::1",
];

for (const address of blockedAddresses) {
  assert.equal(isBlockedIp(address), true, `${address} should be blocked`);
  assert.throws(
    () => parseAndValidateTargetUrl(address.includes(":") ? `http://[${address}]/` : `http://${address}/`),
    /not allowed/,
    `${address} URL should be rejected`,
  );
}

const allowedAddresses = [
  "93.184.216.34",
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  // 192.0.0.0/16 was previously over-blocked; only /24s are reserved now.
  // 192.0.32.0/20 is ICANN-delegated public space (was wrongly blocked before).
  "192.0.31.255",
  "192.0.32.1",
];

for (const address of allowedAddresses) {
  assert.equal(isBlockedIp(address), false, `${address} should be allowed`);
  assert.equal(
    parseAndValidateTargetUrl(address.includes(":") ? `https://[${address}]/` : `https://${address}/`).needsDnsCheck,
    false,
  );
}

assert.equal(browserRequestPolicyUrl("ws://example.com/socket"), "http://example.com/socket");
assert.equal(browserRequestPolicyUrl("wss://example.com/socket"), "https://example.com/socket");

// Read unsafe-option policy in a fresh process so opt-in reaches the denylist,
// rather than passing because the default blanket restriction rejects prefs.
const browserOptionsUrl = new URL("../dist/browser-options.js", import.meta.url).href;
execFileSync(process.execPath, ["--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { validateBrowserOptionsInput } from ${JSON.stringify(browserOptionsUrl)};
  for (const key of ["dom.serviceWorkers.enabled", "dom.serviceworkers.enabled", "DOM.SERVICEWORKERS.ENABLED"]) {
    await assert.rejects(
      validateBrowserOptionsInput({ firefox_user_prefs: { [key]: true } }),
      /denied by server policy/,
      key + " must remain denied when unsafe options are enabled",
    );
  }
  await assert.doesNotReject(validateBrowserOptionsInput({ firefox_user_prefs: { "browser.startup.page": 0 } }));
`], { env: { ...process.env, CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS: "1" } });

const originalNodeEnv = process.env.NODE_ENV;
const originalAllowLocalhost = process.env.CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST;
const originalAllowedPorts = process.env.CAMOUFOX_MCP_TEST_ALLOWED_LOCALHOST_PORTS;
process.env.NODE_ENV = "test";
process.env.CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST = "1";
process.env.CAMOUFOX_MCP_TEST_ALLOWED_LOCALHOST_PORTS = "51234";
assert.equal(parseAndValidateTargetUrl("http://127.0.0.1:51234/fixture").needsDnsCheck, false);
assert.equal(parseAndValidateTargetUrl("http://host.docker.internal:51234/fixture").needsDnsCheck, false);
assert.throws(
  () => parseAndValidateTargetUrl("http://127.0.0.1:80/"),
  /not allowed/,
  "test localhost allowance should be scoped to the configured fixture port",
);
if (originalNodeEnv === undefined) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = originalNodeEnv;
}
if (originalAllowLocalhost === undefined) {
  delete process.env.CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST;
} else {
  process.env.CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST = originalAllowLocalhost;
}
if (originalAllowedPorts === undefined) {
  delete process.env.CAMOUFOX_MCP_TEST_ALLOWED_LOCALHOST_PORTS;
} else {
  process.env.CAMOUFOX_MCP_TEST_ALLOWED_LOCALHOST_PORTS = originalAllowedPorts;
}

console.log("Policy unit tests passed.");
