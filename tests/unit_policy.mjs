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

const policyUrl = new URL("../dist/policy.js", import.meta.url).href;
const configUrl = new URL("../dist/config.js", import.meta.url).href;
const proxyOptionsUrl = new URL("../dist/browser-options.js", import.meta.url).href;

function runPrivateHostScenario(allowedHosts, assertions) {
  // A fresh process and stub resolver exercise DNS policy without depending on
  // the runner's DNS or /etc/hosts configuration.
  execFileSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import dns from "node:dns/promises";
    import { syncBuiltinESMExports } from "node:module";
    let addresses = ["127.0.0.1"];
    let resolutionError;
    const lookedUpHosts = [];
    dns.lookup = async (hostname, options) => {
      assert.deepEqual(options, { all: true, verbatim: true });
      lookedUpHosts.push(hostname);
      if (resolutionError) throw resolutionError;
      return addresses.map((address) => ({ address }));
    };
    syncBuiltinESMExports();
    const { parseAndValidateTargetUrl, validateTargetUrl, validateBrowserRequestUrl } = await import(${JSON.stringify(policyUrl)});
    const { buildNetworkSecurityStatus, readAllowedPrivateHosts } = await import(${JSON.stringify(configUrl)});
    const { validateProxyConfig } = await import(${JSON.stringify(proxyOptionsUrl)});
    ${assertions}
  `], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS: allowedHosts,
      CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST: "0",
    },
  });
}

runPrivateHostScenario("", `
  await assert.rejects(validateTargetUrl("http://laravel.test/api-documentation"), /private, local, or reserved/);
  await assert.rejects(validateBrowserRequestUrl("ws://laravel.test/socket"), /private, local, or reserved/);
  await assert.rejects(validateProxyConfig("http://laravel.test:8080"), /Proxy server is not allowed/);
  assert.deepEqual(buildNetworkSecurityStatus().allowedPrivateHosts, []);
`);

runPrivateHostScenario(" Laravel.TEST.,localhost,dev.local,laravel.test ", `
  await assert.doesNotReject(validateTargetUrl("http://laravel.test/api-documentation"));
  await assert.doesNotReject(validateTargetUrl("http://LARAVEL.TEST.:8080/styles.css"));
  await assert.doesNotReject(validateTargetUrl("http://localhost:8080/"));
  await assert.doesNotReject(validateTargetUrl("http://dev.local/"));
  assert.equal(parseAndValidateTargetUrl("http://localhost/").needsDnsCheck, true, "explicit local hosts still require DNS validation");
  await assert.doesNotReject(validateBrowserRequestUrl("ws://laravel.test/socket"));
  await assert.doesNotReject(validateBrowserRequestUrl("wss://localhost/socket"));
  await assert.doesNotReject(validateProxyConfig({ server: "http://laravel.test:8080" }));
  assert.ok(lookedUpHosts.includes("laravel.test"));
  assert.deepEqual(buildNetworkSecurityStatus().allowedPrivateHosts, ["laravel.test", "localhost", "dev.local"]);

  for (const address of ["127.0.0.2", "10.0.0.1", "172.16.0.1", "192.168.0.1", "::1", "fd00::1", "fd00:ec3::1", "::ffff:127.0.0.1", "::ffff:c0a8:1", "93.184.216.34"]) {
    addresses = [address];
    await assert.doesNotReject(validateTargetUrl("http://laravel.test/"), address);
  }
  addresses = ["93.184.216.34", "127.0.0.1", "fd00::1"];
  await assert.doesNotReject(validateTargetUrl("http://laravel.test/"));

  for (const address of ["0.0.0.0", "169.254.169.254", "100.64.0.1", "100.127.255.255", "192.0.0.1", "192.0.2.5", "192.88.99.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "::", "64:ff9b::1", "64:ff9b:1::1", "100::1", "2001::1", "2001:db8::1", "2002::1", "fe80::1", "ff00::1", "::ffff:a9fe:a9fe", "fd00:ec2::254", "fd00:0ec2:0000:0000:0000:0000:0000:0254", "fd00:ec2:abcd:1::1"]) {
    addresses = ["127.0.0.1", address];
    await assert.rejects(validateTargetUrl("http://laravel.test/"), /private, local, or reserved/, address + " remains denied for allowlisted hosts");
    await assert.rejects(validateBrowserRequestUrl("ws://laravel.test/socket"), /private, local, or reserved/);
  }

  addresses = ["127.0.0.1"];
  for (const hostname of ["other.test", "sub.laravel.test", "laravel.test.evil.example", "evillaravel.test"]) {
    await assert.rejects(validateTargetUrl("http://" + hostname + "/"), /private, local, or reserved/, hostname + " does not inherit permission");
  }
  assert.throws(() => parseAndValidateTargetUrl("http://sub.localhost/"), /not allowed/);
  assert.throws(() => parseAndValidateTargetUrl("http://other.local/"), /not allowed/);
  assert.throws(() => parseAndValidateTargetUrl("http://127.0.0.1/"), /not allowed/);
  assert.throws(() => parseAndValidateTargetUrl("http://169.254.169.254/"), /not allowed/);
  assert.throws(() => parseAndValidateTargetUrl("file://laravel.test/etc/passwd"), /Only http and https/);

  addresses = [];
  await assert.rejects(validateTargetUrl("http://laravel.test/"), /did not resolve/);
  resolutionError = new Error("ENOTFOUND");
  await assert.rejects(validateTargetUrl("http://laravel.test/"), /Could not resolve/);
  resolutionError = undefined;
  addresses = ["127.0.0.1"];
  process.env.CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS = "other.test";
  await assert.rejects(validateTargetUrl("http://other.test/"), /private, local, or reserved/, "tool-time environment changes cannot expand the startup policy");

  for (const invalid of ["*.test", "http://laravel.test", "laravel.test:8080", "laravel.test/path", "127.0.0.1", "127.1", "0x7f000001", "256.0.0.1", "[::1]", "laravel..test", "-laravel.test", "laravel_test", "laravel.test,*.test"]) {
    assert.throws(() => readAllowedPrivateHosts(invalid), /CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS/, invalid);
  }
  assert.deepEqual(readAllowedPrivateHosts(" LOCALHOST, Laravel.Test. ,localhost"), ["localhost", "laravel.test"]);
`);

execFileSync(process.execPath, ["--input-type=module", "-e", `
  import assert from "node:assert/strict";
  await assert.rejects(import(${JSON.stringify(configUrl)}), /CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS/);
`], { env: { ...process.env, CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS: "*.test" } });

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
