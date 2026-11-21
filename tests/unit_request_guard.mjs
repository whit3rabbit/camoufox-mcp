import assert from "node:assert/strict";
import { installRequestGuard } from "../dist/browser-runtime.js";
import { MAX_GUARDED_REQUESTS } from "../dist/config.js";

// A fake browser context that captures the guard's handlers so each kind of
// request can be driven by hand.
function fakeContext() {
  const handlers = {};
  return {
    handlers,
    on(event, handler) { handlers[event] = handler; },
    async route(_pattern, handler) { handlers.route = handler; },
    async routeWebSocket(_pattern, handler) { handlers.webSocket = handler; },
  };
}

function request(url, redirectedFrom = null) {
  return { url: () => url, redirectedFrom: () => redirectedFrom };
}

function routeFor(url) {
  const route = { aborted: 0, continued: 0, request: () => request(url), async abort() { route.aborted += 1; }, async continue() { route.continued += 1; } };
  return route;
}

// Resolver stub: names map to address lists; a function value is called.
function resolverFor(table, lookups = []) {
  return async (hostname) => {
    lookups.push(hostname);
    const entry = table[hostname];
    if (!entry) throw new Error("ENOTFOUND");
    const addresses = typeof entry === "function" ? await entry() : entry;
    return addresses.map((address) => ({ address }));
  };
}

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

// --- Redirect hops ---------------------------------------------------------
// Route handlers run only for the first request of a redirect chain. A hop to a
// name that resolves to loopback must still be recorded once DNS answers.
{
  const context = fakeContext();
  const guard = await installRequestGuard(context, resolverFor({ "public.example": ["93.184.216.34"], "rebind.example": ["127.0.0.1"] }));
  const first = request("https://public.example/start");
  context.handlers.request(first);
  context.handlers.request(request("https://rebind.example/admin?token=hop-secret#frag", first));

  assert.doesNotThrow(() => guard.assertAllowed(), "nothing is recorded until the lookup finishes");
  await assert.rejects(guard.assertSettled(), (error) => {
    assert.match(error.message, /Blocked unsafe browser request to https:\/\/rebind\.example\/admin/);
    assert.doesNotMatch(error.message, /hop-secret|#frag/, "the reported URL is redacted");
    return true;
  });

  // The hop was already sent, so reporting it does not clear it.
  assert.ok(guard.takeBlock());
  assert.throws(() => guard.assertAllowed(), /rebind\.example/, "a sent block stays until the next navigation");
  guard.reset();
  assert.doesNotThrow(() => guard.assertAllowed());
  assert.equal(guard.takeBlock(), undefined);
}

// A hop to a public name passes, and a hop straight to an IP literal is caught
// synchronously as a sent block.
{
  const context = fakeContext();
  const guard = await installRequestGuard(context, resolverFor({ "cdn.example": ["93.184.216.34"] }));
  const first = request("https://public.example/");
  context.handlers.request(request("https://cdn.example/asset.js", first));
  await guard.assertSettled();

  context.handlers.request(request("http://169.254.169.254/latest/meta-data/", first));
  assert.throws(() => guard.assertAllowed(), /169\.254\.169\.254/);
  guard.takeBlock();
  assert.throws(() => guard.assertAllowed(), /169\.254\.169\.254/, "an IP-literal hop was sent, so it is sticky too");
}

// --- Prevented blocks ------------------------------------------------------
// A routed request to private space is aborted before anything is sent. In a
// session it is reported once and then cleared.
{
  const context = fakeContext();
  const guard = await installRequestGuard(context, resolverFor({}));
  const route = routeFor("http://10.0.0.5/internal");
  await context.handlers.route(route);
  assert.equal(route.aborted, 1);
  assert.equal(route.continued, 0);
  assert.throws(() => guard.assertAllowed(), /10\.0\.0\.5/);
  assert.match(guard.takeBlock().message, /10\.0\.0\.5/);
  assert.doesNotThrow(() => guard.assertAllowed(), "a prevented block is cleared once reported");
}

// A later sent block is not hidden behind an earlier prevented one.
{
  const context = fakeContext();
  const guard = await installRequestGuard(context, resolverFor({ "rebind.example": ["10.1.2.3"] }));
  await context.handlers.route(routeFor("http://10.0.0.5/internal"));
  context.handlers.request(request("https://rebind.example/", request("https://public.example/")));
  await guard.settle();
  assert.match(guard.takeBlock().message, /rebind\.example/, "the sent block is reported first");
  assert.throws(() => guard.assertAllowed(), /rebind\.example/);
}

// --- Failure handling ------------------------------------------------------
// A resolver that never answers fails closed instead of hanging the guard, and
// a rejecting validation never becomes an unhandled rejection (which would shut
// the server down).
{
  const context = fakeContext();
  const guard = await installRequestGuard(context, resolverFor({ "broken.example": () => { throw new Error("SERVFAIL"); } }));
  context.handlers.request(request("https://broken.example/", request("https://public.example/")));
  await assert.rejects(guard.assertSettled(), /Could not resolve URL host/);
}

// --- DNS coalescing --------------------------------------------------------
{
  const context = fakeContext();
  const lookups = [];
  const guard = await installRequestGuard(context, resolverFor({ "assets.example": ["93.184.216.34"] }, lookups));
  const routes = Array.from({ length: 20 }, (_, index) => routeFor(`https://assets.example/file-${index}.js`));
  await Promise.all(routes.map((route) => context.handlers.route(route)));
  assert.equal(routes.filter((route) => route.continued === 1).length, 20);
  assert.equal(lookups.length, 1, "concurrent requests to one host share a lookup");

  guard.reset();
  await context.handlers.route(routeFor("https://assets.example/again.js"));
  assert.equal(lookups.length, 2, "a new navigation resolves afresh");
}

// --- Request budget --------------------------------------------------------
{
  const context = fakeContext();
  const guard = await installRequestGuard(context, resolverFor({ "assets.example": ["93.184.216.34"] }));
  for (let index = 0; index < MAX_GUARDED_REQUESTS; index += 1) {
    await context.handlers.route(routeFor(`https://assets.example/${index}`));
  }
  guard.assertAllowed();
  const overBudget = routeFor("https://assets.example/one-too-many");
  await context.handlers.route(overBudget);
  assert.equal(overBudget.aborted, 1);
  assert.throws(() => guard.assertAllowed(), /Too many browser requests/);
  guard.takeBlock();
  assert.throws(() => guard.assertAllowed(), /Too many browser requests/, "an exhausted budget stays exhausted until reset");
  guard.reset();
  const afterReset = routeFor("https://assets.example/after-reset");
  await context.handlers.route(afterReset);
  assert.equal(afterReset.continued, 1);
}

// A validation that finishes after reset() belongs to the previous document.
{
  const context = fakeContext();
  let release;
  const guard = await installRequestGuard(context, resolverFor({ "slow.example": () => new Promise((resolve) => { release = () => resolve(["127.0.0.1"]); }) }));
  context.handlers.request(request("https://slow.example/", request("https://public.example/")));
  guard.reset();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  await guard.assertSettled();
}

await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(unhandled, [], "guard validations must never reject unhandled");

console.log("Request guard unit tests passed.");
