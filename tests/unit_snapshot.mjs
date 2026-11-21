import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock } from "node:test";
import { buildSnapshotPayload } from "../dist/extractors/snapshot.js";
import { trackNavigationResponses } from "../dist/navigation-response.js";

class FakePage extends EventEmitter {
  generation = 1;
  frame = {};
  calls = {};
  handles = 0;
  hooks = {};
  response = this.makeResponse(200);
  makeResponse(status, frame = this.frame) {
    const request = { isNavigationRequest: () => true, frame: () => frame };
    return { status: () => status, headers: () => ({ "content-type": "text/html" }), request: () => request };
  }
  mainFrame() { return this.frame; }
  url() { return "https://example.com/same-url"; }
  waitForLoadState(_state, { timeout }) { assert.ok(timeout > 0 && timeout <= 10000); return Promise.resolve(); }
  async phase(name, detail) {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    await this.hooks[name]?.(this.calls[name], detail);
  }
  navigate(emitNavigation = true) {
    this.generation += 1;
    this.response = this.makeResponse(404);
    if (emitNavigation) this.emit("framenavigated", this.frame);
  }
  async evaluate(_function, options) {
    if (options.mode === "text") {
      await this.phase("text");
      return { value: `document ${this.generation}`, truncated: false, found: true };
    }
    await this.phase("elements");
    return { elements: [{ text: `document ${this.generation}` }], truncated: false, found: true };
  }
  async evaluateHandle() {
    const original = this.generation;
    this.handles += 1;
    return {
      evaluate: async () => {
        await this.phase("identity");
        if (original !== this.generation) throw new Error("Execution context was destroyed, most likely because of a navigation.");
        return true;
      },
      dispose: async () => { this.handles -= 1; },
    };
  }
  async title() { return `title ${this.generation}`; }
  locator() {
    return { first: () => ({ ariaSnapshot: async ({ timeout }) => {
      assert.ok(timeout > 0 && timeout <= 3000);
      await this.phase("aria", timeout);
      return `ARIA document ${this.generation}`;
    } }) };
  }
}

const read = (page) => buildSnapshotPayload(page, null, 1000, 20, undefined, () => page.response);
const coherent = (payload, generation, status) => {
  assert.equal(payload.text, `document ${generation}`);
  assert.equal(payload.elements[0].text, `document ${generation}`);
  assert.equal(payload.title, `title ${generation}`);
  assert.equal(payload.ariaSnapshot, `ARIA document ${generation}`);
  assert.equal(payload.status, status);
};

const destroyed = new FakePage();
destroyed.hooks.text = (call) => {
  if (call === 1) {
    destroyed.navigate();
    throw new Error("Execution context was destroyed, most likely because of a navigation.");
  }
};
coherent(await read(destroyed), 2, 404);
assert.equal(destroyed.calls.text, 2);
assert.equal(destroyed.handles, 0);
assert.equal(destroyed.listenerCount("framenavigated"), 0);

const reload = new FakePage();
reload.hooks.aria = (call) => { if (call === 1) reload.navigate(); };
coherent(await read(reload), 2, 404);
assert.equal(reload.calls.text, 2, "same-URL reload must discard mixed-document text and ARIA");

const identityOnly = new FakePage();
identityOnly.hooks.aria = (call) => { if (call === 1) identityOnly.navigate(false); };
coherent(await read(identityOnly), 2, 404);
assert.equal(identityOnly.calls.text, 2, "document identity must catch replacement even without a navigation event");

const ariaNavigation = new FakePage();
ariaNavigation.hooks.aria = (call) => {
  if (call === 1) {
    ariaNavigation.navigate();
    throw new Error("Execution context was destroyed.");
  }
};
coherent(await read(ariaNavigation), 2, 404);
assert.equal(ariaNavigation.calls.aria, 2, "ARIA navigation errors must retry rather than become diagnostics");

const genuineError = new FakePage();
genuineError.hooks.text = () => { throw new Error("Invalid CSS selector"); };
await assert.rejects(read(genuineError), /Invalid CSS selector/);
assert.equal(genuineError.calls.text, 1, "genuine extraction errors must not retry");
assert.equal(genuineError.handles, 0);

const ariaError = new FakePage();
ariaError.hooks.aria = () => { throw new Error("ARIA snapshot unavailable"); };
assert.equal((await read(ariaError)).ariaSnapshotError, "ARIA snapshot unavailable");
assert.equal(ariaError.calls.aria, 1);

// Playwright reports a started but uncommitted navigation as a locator timeout.
// The wording is copied from playwright-core 1.59.0, which adds the target URL
// once the navigation request is known.
const pendingNavigationError = (target = "") => new Error(
  `locator.ariaSnapshot: Timeout 3000ms exceeded.\nCall log:\n  - waiting for locator('body').first()\n    - waiting for${target} navigation to finish...\n`,
);
const pendingNavigation = new FakePage();
pendingNavigation.hooks.aria = (call) => {
  if (call === 1) throw pendingNavigationError();
  if (call === 2) throw pendingNavigationError('" https://example.com/next"');
  if (call === 3) pendingNavigation.navigate();
};
coherent(await read(pendingNavigation), 2, 404);
assert.equal(pendingNavigation.calls.aria, 4, "a pending navigation must be waited for, then the new document read");
assert.equal(pendingNavigation.calls.text, 2, "waiting for a pending navigation must not spend extraction attempts");
assert.equal(pendingNavigation.handles, 0);

const unstable = new FakePage();
unstable.hooks.text = () => unstable.navigate();
await assert.rejects(read(unstable), /could not stabilize after 3 attempts/);
assert.equal(unstable.calls.text, 3, "continued navigation must have a finite attempt bound");
assert.equal(unstable.handles, 0);

const tracker = new FakePage();
const getResponse = trackNavigationResponses(tracker);
const oldResponse = tracker.makeResponse(200);
tracker.emit("response", oldResponse);
assert.equal(getResponse(), null, "headers cannot become current-document metadata before readiness");
tracker.emit("domcontentloaded");
assert.equal(getResponse(), oldResponse);
const pending = tracker.makeResponse(403);
tracker.emit("response", pending);
tracker.emit("framenavigated", tracker.frame);
assert.equal(getResponse(), oldResponse, "hash/history or pending full navigation must retain committed metadata");
tracker.emit("requestfailed", pending.request());
tracker.emit("framenavigated", tracker.frame);
assert.equal(getResponse(), oldResponse, "failed navigation cannot replace the current document response");
const newResponse = tracker.makeResponse(404);
tracker.emit("response", tracker.makeResponse(500, {}));
tracker.emit("response", newResponse);
tracker.emit("framenavigated", tracker.frame);
tracker.emit("domcontentloaded");
assert.equal(getResponse(), newResponse, "same-URL full reload must adopt its response at readiness");
tracker.emit("domcontentloaded");
assert.equal(getResponse(), null, "response-less new documents cannot inherit old HTTP status");

mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
try {
  const stalled = new FakePage();
  let rejectRead;
  stalled.hooks.text = () => new Promise((_resolve, reject) => { rejectRead = reject; });
  const result = read(stalled);
  await new Promise((resolve) => setImmediate(resolve));
  const rejection = assert.rejects(result, /Snapshot timed out\./);
  mock.timers.tick(10000);
  await rejection;
  assert.equal(stalled.listenerCount("framenavigated"), 0);
  // Browser cleanup after a session timeout rejects the outstanding protocol read.
  rejectRead(new Error("Target closed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stalled.handles, 0);

  // A navigation that never commits must not hold the read past its budget:
  // the current document is returned with the wait reported as a diagnostic.
  const neverCommits = new FakePage();
  const waits = [];
  neverCommits.hooks.aria = (_call, timeout) => {
    waits.push(timeout);
    mock.timers.tick(timeout);
    throw pendingNavigationError();
  };
  const stale = await read(neverCommits);
  assert.deepEqual(waits, [3000, 3000, 1500], "pending-navigation waits must leave time to read the next document");
  assert.equal(stale.text, "document 1");
  assert.equal(stale.status, 200);
  assert.equal(stale.ariaSnapshot, undefined);
  assert.match(stale.ariaSnapshotError, /waiting for navigation to finish/);
  assert.equal(neverCommits.calls.text, 1);
  assert.equal(neverCommits.handles, 0);
} finally {
  mock.timers.reset();
}

console.log("Snapshot navigation and response coherence unit tests passed.");
