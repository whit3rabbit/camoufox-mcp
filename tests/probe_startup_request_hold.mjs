#!/usr/bin/env node
// Manual diagnostic, not part of any test script. Measures how late requests
// issued after page load reach a local server on the default browser build.
//
//   node tests/probe_startup_request_hold.mjs            # uBlock Origin loaded
//   node tests/probe_startup_request_hold.mjs --no-ubo   # addon excluded
//   node tests/probe_startup_request_hold.mjs --idle     # 10 s idle before loading
//
// uBlock Origin suspends network activity until its filter lists have loaded.
// On a fresh profile that takes seconds, so requests issued in that window are
// held and released together. See docs/browser-compatibility.md.
import http from "node:http";

// camoufox-js skips registering the installed addon when this is set.
delete process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
const { Camoufox } = await import("camoufox-js");

const flags = new Set(process.argv.slice(2));
const delays = [300, 900, 1500, 2500, 4000, 6000, 9000];
const started = performance.now();
const now = () => Math.round(performance.now() - started);

let pageAt;
const arrivals = new Map();
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://probe");
  if (url.pathname === "/page") {
    pageAt = now();
    response.setHeader("content-type", "text/html");
    response.end(`<!doctype html><script>
      for (const delay of ${JSON.stringify(delays)}) setTimeout(() => fetch("/late?delay=" + delay), delay);
    </script>`);
    return;
  }
  if (url.pathname === "/late") arrivals.set(Number(url.searchParams.get("delay")), now());
  response.end("ok");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await Camoufox({
  os: ["linux"],
  headless: process.platform === "linux" ? "virtual" : true,
  humanize: true,
  geoip: false,
  ...(flags.has("--no-ubo") ? { exclude_addons: ["UBO"] } : {}),
});
const launchedAt = now();
try {
  const page = await browser.newPage();
  if (flags.has("--idle")) await page.waitForTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.address().port}/page`, { waitUntil: "load" });
  await page.waitForTimeout(Math.max(...delays) + 8000);
} finally {
  await browser.close();
  server.close();
}

console.log(`page requested ${pageAt - launchedAt} ms after launch`);
for (const delay of delays) {
  const arrivedAt = arrivals.get(delay);
  // Includes the few tens of milliseconds the page takes to start its timers.
  console.log(arrivedAt === undefined
    ? `scheduled +${delay} ms: never arrived`
    : `scheduled +${delay} ms: arrived +${arrivedAt - pageAt} ms (${arrivedAt - pageAt - delay} ms late)`);
}
