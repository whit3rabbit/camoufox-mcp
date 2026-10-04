import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mock } from "node:test";
import { navigateSession } from "../dist/sessions.js";
import { isMangledDocumentUrl, navigateWithDocumentUrlCorrection } from "../dist/navigation.js";

const target = "https://93.184.216.34/";

class FakePage {
  calls = [];
  currentUrl = "about:blank";
  hooks = {};
  constructor(committedUrls, responseUrls = committedUrls) {
    this.committedUrls = committedUrls;
    this.responses = responseUrls.map((url, index) => url === null ? null : ({ url: () => url, status: () => 200 + index }));
  }
  url() { return this.currentUrl; }
  async goto(url, options) {
    this.calls.push({ url, options });
    const index = this.calls.length - 1;
    await this.hooks.goto?.(index);
    this.currentUrl = this.committedUrls[index];
    return this.responses[index];
  }
  async waitForTimeout() {}
}

function makeSession(page) {
  return {
    page,
    rawUrls: [],
    waitStrategy: "domcontentloaded",
    requestGuard: { resets: 0, resetBudget() { this.resets += 1; }, assertAllowed() {} },
  };
}

const drifted = new FakePage([`${target}/`, target], [target, target]);
const session = makeSession(drifted);
const response = await navigateSession(session, target, "load", 5000);
assert.equal(drifted.calls.length, 2, "committed document drift must cause one corrective navigation");
assert.equal(response, drifted.responses[1], "session payload must use the corrective response");
assert.equal(session.requestGuard.resets, 1, "correction must retain the navigation request budget");
assert.equal(drifted.calls[1].url, target);
assert.equal(drifted.calls[1].options.waitUntil, "load");
assert.ok(drifted.calls[1].options.timeout > 0 && drifted.calls[1].options.timeout <= 5000);

const urlCases = [
  ["https://example.com//", "https://example.com/", true],
  ["https://example.com///a//b?x=1#section", "https://example.com/a/b?x=1#section", true],
  ["https://example.com/", "https://example.com/", false],
  ["http://example.com//", "https://example.com/", false],
  ["https://example.com:8443//", "https://example.com/", false],
  ["https://other.example.com//", "https://example.com/", false],
  ["https://example.com//?x=2", "https://example.com/?x=1", false],
  ["https://example.com//#other", "https://example.com/#section", false],
  ["https://example.com//other", "https://example.com/", false],
  ["https://example.com/a///b", "https://example.com/a//b", false],
  ["https://example.com/a%2Fb", "https://example.com/a/b", false],
  ["https://example.com//a%2Fb", "https://example.com/a/b", false],
  ["https://other:secret@example.com//", "https://user:secret@example.com/", false],
  ["https://example.com//?next=https://example.org//", "https://example.com/?next=https://example.org//", true],
  ["not a URL", "https://example.com/", false],
  ["about:blank", "https://example.com/", false],
];
for (const [committed, requested, expected] of urlCases) {
  assert.equal(isMangledDocumentUrl(committed, new URL(requested)), expected, committed);
}

const options = { waitUntil: "domcontentloaded", timeout: 5000 };
const navigate = (page, requested = target, assertSafe = async () => {}) =>
  navigateWithDocumentUrlCorrection(page, new URL(requested), options, assertSafe);

const normal = new FakePage([target]);
assert.equal(await navigate(normal), normal.responses[0]);
assert.equal(normal.calls.length, 1);

const redirected = new FakePage([`${target}/`]);
assert.equal(await navigate(redirected), redirected.responses[0]);
assert.equal(redirected.calls.length, 1, "an actual duplicate-slash network redirect must retain its document");

const changedPath = new FakePage([`${target}other//page`]);
await navigate(changedPath);
assert.equal(changedPath.calls.length, 1, "different redirect paths must not be collapsed");

const history = new FakePage([`${target}other//page`], [target]);
await navigate(history);
assert.equal(history.calls.length, 1, "different history paths must not be restored to the original request");

const intentional = new FakePage([`${target}/`]);
await navigate(intentional, `${target}/`);
assert.equal(intentional.calls.length, 1, "explicitly requested duplicate separators must retain their meaning");

const missingResponse = new FakePage([`${target}/`], [null]);
assert.equal(await navigate(missingResponse), null);
assert.equal(missingResponse.calls.length, 1, "a response-less navigation does not establish engine drift");

const hashTarget = `${target}a/b?x=1#section`;
const networkTarget = `${target}a/b?x=1`;
const hashDrift = new FakePage([`${target}a//b?x=1#section`, hashTarget], [networkTarget, networkTarget]);
assert.equal(await navigate(hashDrift, hashTarget), hashDrift.responses[1]);
assert.equal(hashDrift.calls.length, 2, "HTTP response URL omits the preserved document fragment");

const changedHash = new FakePage([`${target}/#other`], [target]);
await navigate(changedHash, `${target}#section`);
assert.equal(changedHash.calls.length, 1, "a changed document fragment must never be reset");

const nullCorrection = new FakePage([`${target}/`, target], [target, null]);
assert.equal(await navigate(nullCorrection), null, "corrective null responses must replace the initial response");
assert.equal(nullCorrection.calls.length, 2);

const repeated = new FakePage([`${target}/`, `${target}/`], [target, target]);
await assert.rejects(navigate(repeated), /remained malformed after one corrective navigation/);
assert.equal(repeated.calls.length, 2, "persistent engine drift must never cause a retry loop");

const repeatedNull = new FakePage([`${target}/`, `${target}/`], [target, null]);
await assert.rejects(navigate(repeatedNull), /remained malformed after one corrective navigation/);
assert.equal(repeatedNull.calls.length, 2);

const secondRedirect = new FakePage([`${target}/`, `${target}/`], [target, `${target}/`]);
assert.equal(await navigate(secondRedirect), secondRedirect.responses[1]);
assert.equal(secondRedirect.calls.length, 2, "a real redirect during correction must not be rewritten again");

const failedCorrection = new FakePage([`${target}/`, target], [target, target]);
failedCorrection.hooks.goto = (index) => { if (index === 1) throw new Error("corrective load failed"); };
await assert.rejects(navigate(failedCorrection), /corrective load failed/);
assert.equal(failedCorrection.calls.length, 2);

const blockedInitial = new FakePage([`${target}/`, target], [target, target]);
await assert.rejects(navigate(blockedInitial, target, async () => { throw new Error("Blocked unsafe browser request"); }), /Blocked unsafe browser request/);
assert.equal(blockedInitial.calls.length, 1, "blocked initial requests must surface before corrective reload");

const blockedCorrection = new FakePage([`${target}/`, target], [target, target]);
let guardReads = 0;
await assert.rejects(navigate(blockedCorrection, target, async () => {
  guardReads += 1;
  if (guardReads === 2) throw new Error("Blocked corrective browser request");
}), /Blocked corrective browser request/);
assert.equal(guardReads, 2, "each navigation must undergo the request and location safety check");
assert.equal(blockedCorrection.calls.length, 2);

const exhausted = new FakePage([`${target}/`, target], [target, target]);
let now = 0;
mock.method(performance, "now", () => now);
try {
  await assert.rejects(navigate(exhausted, target, async () => { now = 5001; }), /correction exceeded the navigation timeout/);
  assert.equal(exhausted.calls.length, 1, "an exhausted timeout must not become an unlimited second navigation");

  now = 0;
  const budgeted = new FakePage([`${target}/`, target], [target, target]);
  await navigate(budgeted, target, async () => { now += 400; });
  assert.equal(budgeted.calls[1].options.timeout, 4600, "correction shares the original timeout budget");
} finally {
  mock.restoreAll();
}

// Production opt-in is read at startup, so verify error classification in a
// fresh process without the browser-suite localhost exception.
const sessionsUrl = new URL("../dist/sessions.js", import.meta.url).href;
execFileSync(process.execPath, ["--input-type=module", "-e", `
  import assert from "node:assert/strict";
  import { navigateSession } from ${JSON.stringify(sessionsUrl)};
  const connectionError = new Error("page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:54321/");
  const guardError = new Error("Blocked unsafe browser request to http://169.254.169.254/");
  let blocked = false;
  const session = {
    rawUrls: [], waitStrategy: "domcontentloaded",
    page: { goto: async () => { throw connectionError; } },
    requestGuard: { resetBudget() {}, assertAllowed() { if (blocked) throw guardError; } },
  };
  await assert.rejects(navigateSession(session, "http://localhost:54321/"), (error) => error === connectionError);
  blocked = true;
  await assert.rejects(navigateSession(session, "http://localhost:54321/"), (error) => error === guardError);
`], { env: { ...process.env, NODE_ENV: "production", CAMOUFOX_MCP_TEST_ALLOW_LOCALHOST: "", CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS: "localhost" } });

console.log("Navigation drift, redirect preservation, guard, and timeout unit tests passed.");
