import { Camoufox, type LaunchOptions } from "camoufox-js";
import type { Browser, BrowserContext, Page, Response, Route } from "playwright-core";
import chalk from "chalk";
import { parseAndValidateBrowserRequestUrl, validateBrowserRequestUrl, validateTargetUrl } from "./policy.js";
import { DEFAULT_WAIT_STRATEGY, GUARD_SETTLE_MS, LAUNCH_TIMEOUT_MS, MAX_CONCURRENCY, MAX_GUARDED_REQUESTS, MAX_QUEUE, QUEUE_TIMEOUT_MS } from "./config.js";
import { createDiagnosticsCollector } from "./diagnostics.js";
import { browserContextOptions, buildCamoufoxOptions, validateCommonBrowserInput } from "./browser-options.js";
import type { BrowserInstance, BrowserOperationContext, CamoufoxOptions, CommonBrowserInput, PendingBrowse, RequestGuard, SlotRelease } from "./types.js";
import { applyStealthProfile, defaultHeadlessMode, describeError, getProxySecrets, getProxyServer, redactUrl, selectOperatingSystem, withTimeout } from "./utils.js";

export { browserContextOptions, buildCamoufoxOptions, validateBrowserOptionsInput } from "./browser-options.js";

let shuttingDown = false;
let activeBrowses = 0;
const pendingBrowses: PendingBrowse[] = [];
const activeBrowsers = new Set<BrowserInstance>();

export function setBrowserShuttingDown(value: boolean): void { shuttingDown = value; }
export function activeBrowserCount(): number { return activeBrowsers.size; }
export function queuedBrowserRequestCount(): number { return pendingBrowses.length; }
export function trackBrowser(browser: BrowserInstance): void { activeBrowsers.add(browser); }

export function releaseBrowserSlot(): void {
  activeBrowses = Math.max(0, activeBrowses - 1);
  const next = pendingBrowses.shift();
  if (next) {
    next.start();
  }
}

export async function acquireBrowserSlot(): Promise<SlotRelease> {
  if (shuttingDown) {
    throw new Error("Server is shutting down.");
  }

  if (activeBrowses < MAX_CONCURRENCY) {
    activeBrowses += 1;
    return releaseBrowserSlot;
  }

  if (pendingBrowses.length >= MAX_QUEUE) {
    throw new Error("Too many concurrent browse requests. Try again later.");
  }

  return new Promise((resolve, reject) => {
    const entry: PendingBrowse = {
      reject,
      timer: setTimeout(() => {
        const index = pendingBrowses.indexOf(entry);
        if (index >= 0) {
          pendingBrowses.splice(index, 1);
        }
        reject(new Error("Timed out waiting for a browse slot."));
      }, QUEUE_TIMEOUT_MS),
      start: () => {
        clearTimeout(entry.timer);
        activeBrowses += 1;
        resolve(releaseBrowserSlot);
      },
    };

    pendingBrowses.push(entry);
  });
}

export async function withBrowserSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireBrowserSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function launchCamoufoxBrowser(options: CamoufoxOptions): Promise<Browser> {
  let timedOut = false;
  const launchPromise = Camoufox<undefined, Browser>(options as LaunchOptions);
  launchPromise.then(
    (browser) => {
      if (timedOut) {
        void closeBrowser(browser);
      }
    },
    () => undefined,
  );

  try {
    return await withTimeout(launchPromise, LAUNCH_TIMEOUT_MS, "Browser launch");
  } catch (error) {
    timedOut = true;
    throw error;
  }
}

export async function installRequestGuard(context: BrowserContext): Promise<RequestGuard> {
  let inspectedRequests = 0;
  let blockedRequestError: Error | undefined;

  function blockRequest(rawUrl: string, reason: string): void {
    if (!blockedRequestError) {
      blockedRequestError = new Error(`Blocked unsafe browser request to ${redactUrl(rawUrl)}. ${reason}`);
    }
  }

  function hasRequestBudget(rawUrl: string): boolean {
    if (inspectedRequests >= MAX_GUARDED_REQUESTS) {
      blockRequest(rawUrl, "Too many browser requests.");
      return false;
    }

    inspectedRequests += 1;
    return true;
  }

  context.on("request", (request) => {
    const requestUrl = request.url();
    try {
      parseAndValidateBrowserRequestUrl(requestUrl);
    } catch (requestError) {
      blockRequest(requestUrl, describeError(requestError));
    }
  });

  await context.route("**/*", async (route: Route) => {
    const requestUrl = route.request().url();

    if (!hasRequestBudget(requestUrl)) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    try {
      await validateBrowserRequestUrl(requestUrl);
    } catch (requestError) {
      blockRequest(requestUrl, describeError(requestError));
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    await route.continue().catch((continueError) => {
      console.error(chalk.yellow(`[Camoufox] Request continue failed: ${describeError(continueError)}`));
    });
  });

  await context.routeWebSocket(/.*/, async (webSocket) => {
    const requestUrl = webSocket.url();

    if (!hasRequestBudget(requestUrl)) {
      await webSocket.close({ code: 1008, reason: "Blocked by server policy" }).catch(() => undefined);
      return;
    }

    try {
      await validateBrowserRequestUrl(requestUrl);
    } catch (requestError) {
      blockRequest(requestUrl, describeError(requestError));
      await webSocket.close({ code: 1008, reason: "Blocked by server policy" }).catch(() => undefined);
      return;
    }

    webSocket.connectToServer();
  });

  return {
    assertAllowed(): void {
      if (blockedRequestError) {
        throw blockedRequestError;
      }
    },
    watchPage(page: Page): void {
      page.on("websocket", (webSocket) => {
        const requestUrl = webSocket.url();
        if (!hasRequestBudget(requestUrl)) {
          return;
        }

        try {
          parseAndValidateBrowserRequestUrl(requestUrl);
        } catch (requestError) {
          blockRequest(requestUrl, describeError(requestError));
        }
      });
    },
  };
}

export async function runBrowserOperation<T>(
  label: string,
  input: CommonBrowserInput,
  callback: (context: BrowserOperationContext) => Promise<T>,
): Promise<T> {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);
  const targetUrl = await validateCommonBrowserInput(effectiveInput);

  return withBrowserSlot(async () => {
    const selectedOS = selectOperatingSystem(effectiveInput.os);
    const waitStrategy = effectiveInput.waitStrategy ?? DEFAULT_WAIT_STRATEGY;
    const headlessMode = defaultHeadlessMode(effectiveInput.headless);

    console.error(chalk.blue(`[Camoufox] Launching browser to ${label}: ${safeUrl}`));

    const browser = await launchCamoufoxBrowser(buildCamoufoxOptions(effectiveInput, selectedOS, headlessMode));
    activeBrowsers.add(browser);

    try {
      const context = await browser.newContext(browserContextOptions(effectiveInput));
      const requestGuard = await installRequestGuard(context);
      const page = await context.newPage();
      requestGuard.watchPage(page);

      const rawUrls = [effectiveInput.url, getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(effectiveInput.proxy);
      const diagnostics = createDiagnosticsCollector(page, effectiveInput, rawUrls, secrets);
      let lastNavigationResponse: Response | null = null;
      page.on("response", (response) => {
        const request = response.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          lastNavigationResponse = response;
        }
      });

      let response: Response | null;
      try {
        response = await page.goto(targetUrl.toString(), {
          waitUntil: waitStrategy,
          timeout: effectiveInput.timeout,
        });
        lastNavigationResponse = response;
      } catch (navigationError) {
        const navigationErrorMessage = describeError(navigationError).toLowerCase();
        if (/\b(?:127\.0\.0\.1|localhost|ip6-localhost|ip6-loopback|::1)\b/.test(navigationErrorMessage)) {
          throw new Error(`Blocked unsafe browser request to ${safeUrl}.`, { cause: navigationError });
        }

        requestGuard.assertAllowed();
        throw navigationError;
      }

      await page.waitForTimeout(GUARD_SETTLE_MS);
      requestGuard.assertAllowed();
      await validateTargetUrl(page.url());
      requestGuard.assertAllowed();

      return await callback({
        page,
        response,
        requestGuard,
        diagnostics,
        selectedOS,
        waitStrategy,
        getLastNavigationResponse: () => lastNavigationResponse,
      });
    } finally {
      console.error(chalk.blue("[Camoufox] Closing browser."));
      await closeBrowser(browser);
    }
  });
}

export async function assertPageLocationSafe(page: Page): Promise<void> {
  if (page.url() === "about:blank") {
    return;
  }

  await validateTargetUrl(page.url());
}

export async function settleAndAssertSafe(page: Page, requestGuard: RequestGuard): Promise<void> {
  await page.waitForTimeout(GUARD_SETTLE_MS);
  requestGuard.assertAllowed();
  await assertPageLocationSafe(page);
  requestGuard.assertAllowed();
}

export async function runGuardedPageRead<T>(page: Page, requestGuard: RequestGuard, read: () => Promise<T>): Promise<T> {
  try {
    requestGuard.assertAllowed();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    const result = await read();
    await page.waitForTimeout(GUARD_SETTLE_MS).catch(() => undefined);
    requestGuard.assertAllowed();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    return result;
  } catch (readError) {
    await page.waitForTimeout(GUARD_SETTLE_MS).catch(() => undefined);
    requestGuard.assertAllowed();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    throw readError;
  }
}

export async function closeBrowser(browser: BrowserInstance): Promise<void> {
  activeBrowsers.delete(browser);
  try {
    await browser.close();
  } catch (closeError) {
    console.error(chalk.yellow(`[Camoufox] Browser close failed: ${describeError(closeError)}`));
  }
}

export async function closeActiveBrowsers(): Promise<void> {
  const browsers = Array.from(activeBrowsers);
  await Promise.all(browsers.map((browser) => closeBrowser(browser)));
}

export function rejectPendingBrowses(reason: string): void {
  const pending = pendingBrowses.splice(0);
  for (const entry of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
}
