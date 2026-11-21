import assert from "node:assert/strict";
import { captureScreenshot, fullPageClip, isScreenshotAreaAllowed, visibleElementClip } from "../dist/screenshots.js";
import { MAX_FULL_PAGE_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_WIDTH } from "../dist/config.js";

// --- Full-page limits -------------------------------------------------------
// A full page is taller than one viewport by design. It used to be held to the
// viewport height limit, which rejected nearly every real page.
assert.deepEqual(fullPageClip(1280, 3000), { width: 1280, height: 3000, clipped: false });
assert.deepEqual(fullPageClip(1280, MAX_FULL_PAGE_SCREENSHOT_HEIGHT + 500), { width: 1280, height: MAX_FULL_PAGE_SCREENSHOT_HEIGHT, clipped: true });
assert.deepEqual(fullPageClip(MAX_SCREENSHOT_WIDTH + 400, 900), { width: MAX_SCREENSHOT_WIDTH, height: 900, clipped: true });
assert.equal(fullPageClip(0, 900), undefined);
assert.equal(fullPageClip(Number.NaN, 900), undefined);

// Element captures keep the viewport-sized policy.
assert.equal(isScreenshotAreaAllowed(MAX_SCREENSHOT_WIDTH, MAX_SCREENSHOT_HEIGHT), true);
assert.equal(isScreenshotAreaAllowed(MAX_SCREENSHOT_WIDTH, MAX_SCREENSHOT_HEIGHT + 1), false);

// --- Element clip -----------------------------------------------------------
// An element hanging off the left edge: the old code moved x to 0 but kept the
// full width, so the capture slid right by the hidden amount.
assert.deepEqual(
  visibleElementClip({ x: -40, y: 10, width: 200, height: 50 }, { width: 800, height: 600 }),
  { x: 0, y: 10, width: 160, height: 50 },
);
assert.deepEqual(
  visibleElementClip({ x: 700, y: 580, width: 200, height: 50 }, { width: 800, height: 600 }),
  { x: 700, y: 580, width: 100, height: 20 },
);
assert.deepEqual(
  visibleElementClip({ x: 900, y: 10, width: 50, height: 50 }, { width: 800, height: 600 }),
  { x: 900, y: 10, width: 0, height: 50 },
  "an element entirely outside the viewport has no visible area",
);
assert.deepEqual(
  visibleElementClip({ x: -10, y: -10, width: 100, height: 100 }, null),
  { x: 0, y: 0, width: 90, height: 90 },
);

// --- captureScreenshot with a fake page --------------------------------------
function fakePage(pageSize) {
  const calls = [];
  return {
    calls,
    async evaluate() { return pageSize; },
    async screenshot(options) { calls.push(options); return Buffer.from("png-bytes"); },
  };
}

const ordinary = fakePage({ width: 1280, height: 3000 });
const ordinaryResult = await captureScreenshot(ordinary, "https://example.com/", { fullPage: true });
assert.equal(ordinaryResult.screenshotMetadata.included, true);
assert.equal(ordinaryResult.screenshotMetadata.pageHeight, 3000);
assert.equal(ordinaryResult.screenshotMetadata.clipped, undefined);
assert.equal(ordinary.calls[0].fullPage, true);
assert.equal(ordinary.calls[0].clip, undefined, "a page within the limits is captured whole");

const tall = fakePage({ width: 1280, height: MAX_FULL_PAGE_SCREENSHOT_HEIGHT * 3 });
const tallResult = await captureScreenshot(tall, "https://example.com/", { fullPage: true });
assert.equal(tallResult.screenshotMetadata.included, true);
assert.equal(tallResult.screenshotMetadata.clipped, true);
assert.equal(tallResult.screenshotMetadata.pageHeight, MAX_FULL_PAGE_SCREENSHOT_HEIGHT * 3);
assert.deepEqual(tall.calls[0].clip, { x: 0, y: 0, width: 1280, height: MAX_FULL_PAGE_SCREENSHOT_HEIGHT });

const viewportOnly = fakePage({ width: 1280, height: 3000 });
const viewportResult = await captureScreenshot(viewportOnly, "https://example.com/", {});
assert.equal(viewportOnly.calls[0].fullPage, false);
assert.equal(viewportResult.screenshotMetadata.pageHeight, undefined, "page size is reported for full-page captures only");

console.log("Screenshot unit tests passed.");
