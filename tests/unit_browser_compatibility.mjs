import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertCompatibilityGeoipDatabase, assertCompatibilityLauncherAvailable, buildCompatibilityOptions, buildProxyLookupUrl } from "../dist/browser-compatibility.js";

const executable = "/fixture/Camoufox.app/Contents/MacOS/camoufox";
// Disposable credentials preserve the escaping regressions without committing
// reusable authentication strings. These tests only assemble options and URLs.
const fixtureUsername = `fixture-${randomUUID()}@example.com`;
const fixturePassword = `fixture-${randomUUID()}:reserved/@`;
const ipv6Password = `fixture-${randomUUID()}#?`;
const overrideUsername = `fixture-${randomUUID()}`;
const overridePassword = `fixture-${randomUUID()}`;
const credentialUrl = new URL("http://proxy.example:8080/path");
credentialUrl.username = fixtureUsername;
credentialUrl.password = fixturePassword;
const explicitCredentialUrl = new URL("https://proxy.example");
explicitCredentialUrl.username = fixtureUsername;
explicitCredentialUrl.password = fixturePassword;
const explicitProxyInput = Object.freeze({ server: explicitCredentialUrl.href, username: overrideUsername, password: overridePassword });
const inherited = {
  CAMOU_CONFIG: '{"disableWorldIsolation":false}',
  CAMOU_CONFIG_1: '{"disableWorldIsolation":false}',
  CAMOU_CONFIG_2: "stale trailing chunk",
  CAMOU_PREFS_1: '{"network.proxy.type":0}',
  CAMOU_PREFS_999: "stale trailing prefs",
};
const previous = Object.fromEntries(Object.keys(inherited).map((key) => [key, process.env[key]]));
const geoipDir = mkdtempSync(join(tmpdir(), "camoufox-compatibility-geoip-"));

try {
  const missingLauncherResolver = createRequire(join(geoipDir, "missing-launcher.mjs")).resolve;
  assert.throws(() => assertCompatibilityLauncherAvailable(missingLauncherResolver), (error) => {
    assert.match(error.message, /Compatibility launcher is not installed.*npm install --include=optional/);
    assert.equal(error.cause.code, "MODULE_NOT_FOUND", "the missing optional package error must remain inspectable");
    return true;
  });
  const invalidPackage = Object.assign(new Error("malformed package.json"), { code: "ERR_INVALID_PACKAGE_CONFIG" });
  assert.throws(() => assertCompatibilityLauncherAvailable(() => { throw invalidPackage; }),
    (error) => error === invalidPackage, "unrelated package resolution errors must not become install guidance");
  assert.doesNotThrow(() => assertCompatibilityLauncherAvailable(() => "/fixture/launcher.js"));
  Object.assign(process.env, inherited);
  const prefs = { "permissions.default.image": 2 };
  const args = ["--fixture"];
  const window = [1280, 720];
  const options = buildCompatibilityOptions({
    os: ["macos"],
    headless: "virtual",
    humanize: true,
    geoip: false,
    ublock: true,
    proxy: credentialUrl.href,
    viewport: { width: 800, height: 600 },
    firefox_user_prefs: prefs,
    args,
    window,
  }, executable, 156);

  assert.equal(options.executable_path, executable, "the selected build must bypass managed cache resolution");
  assert.equal(options.ff_version, 156, "macOS fingerprints must use the selected Firefox version");
  assert.deepEqual(options.config, { disableWorldIsolation: true }, "WebSocket policy requires all three routing components in the page world");
  assert.deepEqual(options.proxy, {
    server: "http://proxy.example:8080",
    username: fixtureUsername,
    password: fixturePassword,
  }, "URL credentials must survive conversion to the official proxy object");
  const lookupUrl = new URL(buildProxyLookupUrl(options.proxy));
  assert.equal(lookupUrl.host, "proxy.example:8080", "credential characters must never become URL delimiters");
  assert.equal(decodeURIComponent(lookupUrl.username), fixtureUsername);
  assert.equal(decodeURIComponent(lookupUrl.password), fixturePassword);
  assert.match(lookupUrl.username, /%40/, "the username's '@' must remain escaped");
  assert.match(lookupUrl.password, /%3A/, "the password's ':' must remain escaped");
  assert.match(lookupUrl.password, /%2F/, "the password's '/' must remain escaped");
  assert.match(lookupUrl.password, /%40/, "the password's '@' must remain escaped");
  assert.equal(lookupUrl.pathname, "/");
  assert.equal(lookupUrl.search, "");
  assert.equal(lookupUrl.hash, "");
  assert.throws(() => new URL(`http://${options.proxy.username}:${options.proxy.password}@proxy.example:8080`),
    "the upstream unescaped conversion cannot represent this supported proxy credential");
  assert.equal(buildProxyLookupUrl(), undefined, "direct IP lookup must remain available without a proxy");
  const ipv6Proxy = new URL(buildProxyLookupUrl({ server: "http://[2001:4860:4860::8888]:8080", username: overrideUsername, password: ipv6Password }));
  assert.equal(ipv6Proxy.host, "[2001:4860:4860::8888]:8080");
  assert.equal(decodeURIComponent(ipv6Proxy.password), ipv6Password);
  assert.match(ipv6Proxy.password, /%23/, "the password's '#' must remain escaped");
  assert.match(ipv6Proxy.password, /%3F/, "the password's '?' must remain escaped");

  // A fresh IPv4 database alone used to pass preflight, then IPv6 lookup
  // triggered an upstream download on MCP stdout.
  const geoipPath = (version) => join(geoipDir, `${version}.mmdb`);
  writeFileSync(geoipPath("ipv4"), "fixture");
  assert.doesNotThrow(() => assertCompatibilityGeoipDatabase("8.8.8.8", geoipPath));
  assert.throws(() => assertCompatibilityGeoipDatabase("2001:4860:4860::8888", geoipPath),
    /ipv6 GeoIP database is missing.*CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run fetch:camoufox/);
  writeFileSync(geoipPath("ipv6"), "fixture");
  assert.doesNotThrow(() => assertCompatibilityGeoipDatabase("2001:4860:4860::8888", geoipPath));
  assert.doesNotThrow(() => assertCompatibilityGeoipDatabase("2001:4860:4860::8888", () => geoipPath("ipv4")),
    "a combined database can cover both address families");
  assert.equal(options.headless, "virtual");
  assert.equal(options.geoip, false);
  assert.equal("ublock" in options, false, "the legacy flag is not an official launch option");
  assert.equal("viewport" in options, false, "viewport belongs to the guarded browser context");
  for (const key of Object.keys(inherited)) {
    assert.equal(key in options.env, false, "inherited chunks must never override policy or new launch preferences");
    assert.equal(process.env[key], inherited[key], "building launch options must not mutate the server environment");
  }
  assert.equal(options.env.PATH, process.env.PATH);

  options.firefox_user_prefs["permissions.default.image"] = 1;
  options.args.push("--second");
  options.window[0] = 1920;
  assert.deepEqual(prefs, { "permissions.default.image": 2 });
  assert.deepEqual(args, ["--fixture"]);
  assert.deepEqual(window, [1280, 720]);

  const explicitAuth = buildCompatibilityOptions({
    proxy: explicitProxyInput,
    exclude_addons: ["ublock_origin"],
  }, executable, 156);
  assert.deepEqual(explicitAuth.proxy, { server: "https://proxy.example", username: overrideUsername, password: overridePassword });
  explicitAuth.proxy.password = fixturePassword;
  assert.equal(explicitProxyInput.password, overridePassword, "launch options must not alias or mutate the caller's proxy object");
  assert.deepEqual(explicitAuth.exclude_addons, ["UBO"]);
  assert.equal("fingerprint_preset" in explicitAuth, false, "compatibility uses the official synthetic fingerprint defaults");
  assert.throws(() => buildCompatibilityOptions({}, executable, NaN), /selected Firefox major version/);
  assert.throws(() => buildCompatibilityOptions({}, executable, 0), /selected Firefox major version/);
  assert.throws(() => buildCompatibilityOptions({ exclude_addons: ["unsupported"] }, executable, 156), /Unsupported default addon/);
} finally {
  rmSync(geoipDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

console.log("browser compatibility unit tests passed");
