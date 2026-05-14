import assert from "node:assert/strict";
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
  "192.168.0.1",
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

console.log("Policy unit tests passed.");
