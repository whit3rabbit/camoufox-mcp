import assert from "node:assert/strict";
import { activateElement, findDisallowedAction, runSequenceActionsWithBudget, sequenceTimeoutBudget } from "../dist/sequence.js";
import { OperationTimeoutError, isOperationTimeout } from "../dist/utils.js";
import { installRequestGuard } from "../dist/browser-runtime.js";
import { DEFAULT_ACTION_TIMEOUT_MS, MAX_SEQUENCE_ACTIONS, SEQUENCE_TIMEOUT_MS } from "../dist/config.js";

// Finding #9: the schema allows up to MAX_SEQUENCE_ACTIONS (25) actions, but the
// sequence timeout budget must be large enough to admit that many at the default
// per-action timeout. Previously the default SEQUENCE_TIMEOUT_MS was 120000ms,
// which rejected any sequence with 13+ default-timeout actions.
function defaultClickAction() {
  return { type: "click", selector: "#a" };
}

// 25 default-timeout actions (25 * 10000 = 250000) must fit the default budget.
const maxActions = Array.from({ length: MAX_SEQUENCE_ACTIONS }, defaultClickAction);
assert.equal(
  sequenceTimeoutBudget(maxActions),
  MAX_SEQUENCE_ACTIONS * DEFAULT_ACTION_TIMEOUT_MS,
  "budget should sum default per-action timeouts",
);
assert.ok(
  sequenceTimeoutBudget(maxActions) <= SEQUENCE_TIMEOUT_MS,
  `default SEQUENCE_TIMEOUT_MS (${SEQUENCE_TIMEOUT_MS}ms) must admit MAX_SEQUENCE_ACTIONS (${MAX_SEQUENCE_ACTIONS}) at the default action timeout`,
);

// 26 actions should exceed MAX_SEQUENCE_ACTIONS logically but the budget check is
// purely additive; verify the budget math scales linearly.
assert.equal(sequenceTimeoutBudget(Array.from({ length: 26 }, defaultClickAction)), 260000);

const passingGuard = { assertAllowed() {}, async settle() {}, async assertSettled() {}, takeBlock() {}, reset() {} };

let guardHttpRequest;
const requestGuard = await installRequestGuard({
  on() {},
  async route(_pattern, handler) { guardHttpRequest = handler; },
  async routeWebSocket() {},
});
const actionError = new Error("Selector wait failed after a private request");
let actionAttempts = 0;
let abortedRequests = 0;
const failingPage = {
  async waitForSelector() {
    actionAttempts += 1;
    await guardHttpRequest({
      request: () => ({ url: () => "http://blocked.localhost:80/private?token=sequence-policy-secret#fragment" }),
      async abort() { abortedRequests += 1; },
    });
    throw actionError;
  },
};

// A blocked request can fail the action before the normal post-action guard
// check. Preserve the actionable policy error and never replay the action.
await assert.rejects(runSequenceActionsWithBudget(failingPage, requestGuard, [
  { type: "waitFor", selector: "#missing", timeout: 1000 },
  { type: "waitFor", selector: "#must-not-run", timeout: 1000 },
], [], []), (error) => {
  assert.match(error.message, /Blocked unsafe browser request/);
  assert.match(error.message, /CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS=blocked\.localhost/);
  assert.match(error.message, /restart/);
  assert.doesNotMatch(error.message, /sequence-policy-secret|#fragment/);
  return true;
});
assert.equal(actionAttempts, 1);
assert.equal(abortedRequests, 1);

await assert.rejects(runSequenceActionsWithBudget({
  async waitForSelector() { throw actionError; },
}, passingGuard, [
  { type: "waitFor", selector: "#missing", timeout: 1000 },
], [], []), (error) => error === actionError, "ordinary action errors retain their original identity");

await assert.rejects(runSequenceActionsWithBudget({
  keyboard: { press: () => new Promise(() => {}) },
}, passingGuard, [
  { type: "press", key: "Enter", timeout: 1 },
], [], []), (error) => {
  assert.match(error.message, /Press action timed out\./, "local action timeouts retain their original message");
  assert.ok(isOperationTimeout(error), "local timeouts are identified by type");
  return true;
});

// Page code can throw any text. Only this server's own deadline counts as a
// local timeout, so a page cannot close a session by imitating the message.
assert.equal(isOperationTimeout(new Error("Something timed out.")), false);
assert.equal(isOperationTimeout(new OperationTimeoutError("Click action")), true);

await assert.rejects(runSequenceActionsWithBudget({
  mouse: { wheel: () => new Promise(() => {}) },
}, passingGuard, [
  { type: "scroll", deltaX: 0, deltaY: 100, timeout: 1 },
], [], []), /Scroll action timed out\./, "a hung wheel scroll is bounded");

// evaluate is refused before launch unless enabled, whatever precedes it.
assert.match(findDisallowedAction([{ type: "click", selector: "#a" }, { type: "evaluate", expression: "1" }]) ?? "", /Evaluate action is disabled/);
assert.equal(findDisallowedAction([{ type: "click", selector: "#a" }]), undefined);

// clickMode "auto": a failed trial dispatched nothing, so the DOM fallback is
// safe. Once the trial passes, a failing pointer click may already have
// delivered events and must not be followed by a second, DOM click.
function fakeClickPage({ trialFails, clickFails }) {
  const calls = [];
  const locator = {
    first() { return locator; },
    async waitFor() {},
    async isEnabled() { return true; },
    async click(options) {
      calls.push(options.trial ? "trial" : "pointer");
      if (options.trial && trialFails) throw new Error("element is covered");
      if (!options.trial && clickFails) throw new Error("pointer click failed midway");
    },
    async evaluate() { calls.push("dom"); },
  };
  return { calls, page: { locator: () => locator } };
}

const covered = fakeClickPage({ trialFails: true });
await activateElement(covered.page, "#a", 1000, undefined, "auto");
assert.deepEqual(covered.calls, ["trial", "dom"], "a failed trial falls back to one DOM click");

const pointerOk = fakeClickPage({});
await activateElement(pointerOk.page, "#a", 1000, undefined, "auto");
assert.deepEqual(pointerOk.calls, ["trial", "pointer"]);

const midway = fakeClickPage({ clickFails: true });
await assert.rejects(activateElement(midway.page, "#a", 1000, undefined, "auto"), /pointer click failed midway/);
assert.deepEqual(midway.calls, ["trial", "pointer"], "no DOM click after a pointer click that may have landed");

const domDefault = fakeClickPage({});
await activateElement(domDefault.page, "#a", 1000);
assert.deepEqual(domDefault.calls, ["dom"], "the default mode stays a DOM click");

console.log("Sequence unit tests passed.");
