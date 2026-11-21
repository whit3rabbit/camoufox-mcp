import type { Page } from "playwright-core";
import chalk from "chalk";
import { MAX_FULL_PAGE_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_WIDTH } from "./config.js";
import type { ScreenshotMetadata, ScreenshotOptions, ScreenshotResult, WindowSize } from "./types.js";
import { describeError } from "./utils.js";

export function isScreenshotDimensionAllowed(viewport?: { width: number; height: number }, window?: WindowSize): boolean {
  const width = viewport?.width ?? window?.[0] ?? MAX_SCREENSHOT_WIDTH;
  const height = viewport?.height ?? window?.[1] ?? MAX_SCREENSHOT_HEIGHT;
  return width <= MAX_SCREENSHOT_WIDTH && height <= MAX_SCREENSHOT_HEIGHT;
}

export function isScreenshotAreaAllowed(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
    && width <= MAX_SCREENSHOT_WIDTH
    && height <= MAX_SCREENSHOT_HEIGHT;
}

// The part of a full page that policy allows capturing, anchored at the top
// left. A full page is taller than a viewport by design, so it has its own
// height cap; anything beyond the caps is cut off and reported as clipped.
export function fullPageClip(pageWidth: number, pageHeight: number): { width: number; height: number; clipped: boolean } | undefined {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
    return undefined;
  }

  const width = Math.min(Math.floor(pageWidth), MAX_SCREENSHOT_WIDTH);
  const height = Math.min(Math.floor(pageHeight), MAX_FULL_PAGE_SCREENSHOT_HEIGHT);
  return { width, height, clipped: width < Math.floor(pageWidth) || height < Math.floor(pageHeight) };
}

// Intersect an element's viewport rectangle with the viewport. Cutting the
// origin at zero without shrinking the size shifts the capture off the element.
export function visibleElementClip(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number } | null,
): { x: number; y: number; width: number; height: number } {
  const left = Math.max(0, rect.x);
  const top = Math.max(0, rect.y);
  const right = viewport ? Math.min(rect.x + rect.width, viewport.width) : rect.x + rect.width;
  const bottom = viewport ? Math.min(rect.y + rect.height, viewport.height) : rect.y + rect.height;
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export async function captureCaptchaScreenshot(page: Page, safeUrl: string): Promise<ScreenshotResult | undefined> {
  try {
    return await captureScreenshot(page, safeUrl, { fullPage: false });
  } catch {
    return undefined;
  }
}

export async function captureScreenshot(page: Page, safeUrl: string, options?: ScreenshotOptions): Promise<ScreenshotResult> {
  const type = options?.type ?? "png";
  const screenshotMetadata: ScreenshotMetadata = {
    requested: true,
    included: false,
    maxBytes: MAX_SCREENSHOT_BYTES,
    type,
    fullPage: options?.selector ? false : Boolean(options?.fullPage),
    selector: options?.selector,
  };
  const mimeType = type === "jpeg" ? "image/jpeg" : "image/png";
  const baseOptions = {
    type,
    quality: type === "jpeg" ? options?.quality : undefined,
  };

  try {
    let buffer: Buffer;
    if (options?.selector) {
      const locator = page.locator(options.selector).first();
      const count = await locator.count();
      if (count === 0) {
        screenshotMetadata.selectorFound = false;
        screenshotMetadata.error = "Screenshot selector was not found.";
        return { screenshotMetadata, mimeType };
      }

      screenshotMetadata.selectorFound = true;
      const rect = await locator.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      });

      if (rect.width <= 0 || rect.height <= 0) {
        screenshotMetadata.error = "Screenshot selector has no visible area.";
        return { screenshotMetadata, mimeType };
      }

      // Enforce the dimension policy on the element's real size, not the
      // visible clip; clipping would otherwise shrink an oversize element under
      // the limit and silently bypass the policy.
      if (!isScreenshotAreaAllowed(rect.width, rect.height)) {
        screenshotMetadata.error = `Screenshot selector exceeds server dimension policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`;
        return { screenshotMetadata, mimeType };
      }

      // Playwright rejects clips that fall outside the viewport. viewportSize()
      // is null when no fixed viewport is set; then only the origin is bounded.
      const clampedClip = visibleElementClip(rect, page.viewportSize());
      if (clampedClip.width <= 0 || clampedClip.height <= 0) {
        screenshotMetadata.error = "Screenshot selector has no visible area.";
        return { screenshotMetadata, mimeType };
      }

      buffer = await page.screenshot({
        ...baseOptions,
        clip: clampedClip,
      });
    } else {
      let clip: { x: number; y: number; width: number; height: number } | undefined;
      if (options?.fullPage) {
        const dimensions = await page.evaluate(() => {
          const documentElement = document.documentElement;
          const body = document.body;
          return {
            width: Math.max(
              documentElement.scrollWidth,
              documentElement.clientWidth,
              body?.scrollWidth ?? 0,
              body?.clientWidth ?? 0,
            ),
            height: Math.max(
              documentElement.scrollHeight,
              documentElement.clientHeight,
              body?.scrollHeight ?? 0,
              body?.clientHeight ?? 0,
            ),
          };
        });

        const allowed = fullPageClip(dimensions.width, dimensions.height);
        if (!allowed) {
          screenshotMetadata.error = "Full-page screenshot could not measure the page.";
          return { screenshotMetadata, mimeType };
        }

        screenshotMetadata.pageWidth = dimensions.width;
        screenshotMetadata.pageHeight = dimensions.height;
        if (allowed.clipped) {
          screenshotMetadata.clipped = true;
          clip = { x: 0, y: 0, width: allowed.width, height: allowed.height };
        }
      }

      buffer = await page.screenshot({
        ...baseOptions,
        fullPage: Boolean(options?.fullPage),
        ...(clip ? { clip } : {}),
      });
    }

    screenshotMetadata.bytes = buffer.length;

    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      screenshotMetadata.error = "Screenshot exceeded server byte limit.";
      console.error(chalk.yellow(`[Camoufox] Screenshot omitted for ${safeUrl}: byte limit exceeded.`));
      return { screenshotMetadata, mimeType };
    }

    console.error(chalk.green(`[Camoufox] Screenshot captured for ${safeUrl}.`));
    return {
      screenshotMetadata: {
        ...screenshotMetadata,
        included: true,
      },
      mimeType,
      base64: buffer.toString("base64"),
    };
  } catch (screenshotError) {
    screenshotMetadata.error = describeError(screenshotError);
    console.error(chalk.yellow(`[Camoufox] Screenshot failed: ${screenshotMetadata.error}`));
    return { screenshotMetadata, mimeType };
  }
}
