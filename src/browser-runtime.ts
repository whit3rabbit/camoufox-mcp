import { Camoufox, type LaunchOptions } from "camoufox-js";
import type { Browser, BrowserContext, Page, Response, Route } from "playwright-core";
import chalk from "chalk";
import { isLoopbackNavigationError, normalizeHostname, parseAndValidateBrowserRequestUrl, resolveSystemHost, validateBrowserRequestUrl, validateTargetUrl, type HostResolver } from "./policy.js";
import { ALLOWED_PRIVATE_HOSTS, BROWSER_CLOSE_TIMEOUT_MS, DEFAULT_WAIT_STRATEGY, GUARD_DNS_CACHE_TTL_MS, GUARD_SETTLE_DEADLINE_MS, GUARD_SETTLE_MS, LAUNCH_TIMEOUT_MS, MAX_CONCURRENCY, MAX_GUARDED_REQUESTS, MAX_QUEUE, PAGE_READ_TIMEOUT_MS, QUEUE_TIMEOUT_MS } from "./config.js";
import { RequestCancelledError, currentRequestSignal, throwIfCancelled } from "./request-context.js";
import { createDiagnosticsCollector } from "./diagnostics.js";
import { browserContextOptions, buildCamoufoxOptions, validateCommonBrowserInput } from "./browser-options.js";
import { assertBrowserBinaryAvailable, assertDefaultLaunchAssets, probeBrowserBinary } from "./browser-preflight.js";
import { BROWSER_COMPATIBILITY, EXPECTED_BROWSER_BUILD } from "./browser-build.js";
import { launchCompatibilityBrowser } from "./browser-compatibility.js";
import { trackNavigationResponses } from "./navigation-response.js";
import { navigateWithDocumentUrlCorrection } from "./navigation.js";
import type { BrowserInstance, BrowserOperationContext, CamoufoxOptions, CommonBrowserInput, PendingBrowse, RequestGuard, SlotRelease } from "./types.js";
import { applyStealthProfile, defaultHeadlessMode, describeError, getProxySecrets, getProxyServer, redactUrl, selectOperatingSystem, withTimeout } from "./utils.js";

export { browserContextOptions, buildCamoufoxOptions, validateBrowserOptionsInput } from "./browser-options.js";
export { MISSING_BROWSER_MESSAGE, assertBrowserBinaryAvailable } from "./browser-preflight.js";

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

export async function acquireBrowserSlot(signal?: AbortSignal): Promise<SlotRelease> {
  if (shuttingDown) {
    throw new Error("Server is shutting down.");
  }
  throwIfCancelled(signal);

  if (activeBrowses < MAX_CONCURRENCY) {
    activeBrowses += 1;
    return releaseBrowserSlot;
  }

  if (pendingBrowses.length >= MAX_QUEUE) {
    throw new Error("Too many concurrent browse requests. Try again later.");
  }

  return new Promise((resolve, reject) => {
    const leaveQueue = (): void => {
      clearTimeout(entry.timer);
      signal?.removeEventListener("abort", onAbort);
      const index = pendingBrowses.indexOf(entry);
      if (index >= 0) {
        pendingBrowses.splice(index, 1);
      }
    };
    // A cancelled request must not keep its place and later take a slot.
    const onAbort = (): void => {
      leaveQueue();
      reject(new RequestCancelledError());
    };
    const entry: PendingBrowse = {
      reject: (error) => {
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
      timer: setTimeout(() => {
        leaveQueue();
        reject(new Error("Timed out waiting for a browse slot."));
      }, QUEUE_TIMEOUT_MS),
      start: () => {
        clearTimeout(entry.timer);
        signal?.removeEventListener("abort", onAbort);
        activeBrowses += 1;
        resolve(releaseBrowserSlot);
      },
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    pendingBrowses.push(entry);
  });
}

export async function withBrowserSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const release = await acquireBrowserSlot(signal);
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function launchCamoufoxBrowser(options: CamoufoxOptions): Promise<Browser> {
  // Both one-shot tools and sessions must reject a missing cache before Camoufox can fetch it.
  assertBrowserBinaryAvailable();
  if (!BROWSER_COMPATIBILITY) {
    assertDefaultLaunchAssets({ geoip: options.geoip, excludeAddons: options.exclude_addons });
  }
  let timedOut = false;
  const launchPromise = BROWSER_COMPATIBILITY
    ? launchCompatibilityBrowser(options, probeBrowserBinary(), Number(EXPECTED_BROWSER_BUILD.version.split(".")[0]))
    : Camoufox<undefined, Browser>(options as LaunchOptions);
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

type BlockKind = "prevented" | "sent";

export async function installRequestGuard(context: BrowserContext, resolveHost: HostResolver = resolveSystemHost): Promise<RequestGuard> {
  let inspectedRequests = 0;
  // "prevented": the request was aborted before anything left the browser.
  // "sent": the browser already issued it (a redirect hop), or the request
  // budget ran out. Kept apart so a later sent block is never masked.
  let preventedBlock: Error | undefined;
  let sentBlock: Error | undefined;
  // Bumped by reset() so validations started for an earlier document cannot
  // record a block against the next one.
  let generation = 0;
  const pendingValidations = new Set<Promise<void>>();
  let dnsCache = new Map<string, { expiresAt: number; records: ReturnType<HostResolver> }>();

  // Every routed request waits on DNS before it continues, and one page can
  // issue hundreds to the same host. Coalescing and a short positive cache do
  // not weaken the check: the browser resolves the name itself afterwards
  // either way, so this lookup was never the connect-time answer.
  const cachedResolver: HostResolver = (hostname) => {
    const now = Date.now();
    const cached = dnsCache.get(hostname);
    if (cached && cached.expiresAt > now) {
      return cached.records;
    }

    const cache = dnsCache;
    const entry = { expiresAt: now + GUARD_DNS_CACHE_TTL_MS, records: resolveHost(hostname) };
    cache.set(hostname, entry);
    entry.records.catch(() => {
      if (cache.get(hostname) === entry) {
        cache.delete(hostname);
      }
    });
    return entry.records;
  };

  function blockRequest(kind: BlockKind, rawUrl: string, reason: string): void {
    const error = new Error(`Blocked unsafe browser request to ${redactUrl(rawUrl)}. ${reason}`);
    if (kind === "sent") {
      sentBlock ??= error;
    } else {
      preventedBlock ??= error;
    }
  }

  function hasRequestBudget(rawUrl: string): boolean {
    if (inspectedRequests >= MAX_GUARDED_REQUESTS) {
      blockRequest("sent", rawUrl, "Too many browser requests.");
      return false;
    }

    inspectedRequests += 1;
    return true;
  }

  context.on("request", (request) => {
    const requestUrl = request.url();
    const isRedirectHop = request.redirectedFrom() !== null;
    let needsDnsCheck: boolean;
    try {
      needsDnsCheck = parseAndValidateBrowserRequestUrl(requestUrl).needsDnsCheck;
    } catch (requestError) {
      blockRequest(isRedirectHop ? "sent" : "prevented", requestUrl, describeError(requestError));
      return;
    }

    // Route handlers run only for the first request of a redirect chain, so a
    // hop to a name that resolves to private space is checked here. The hop is
    // already on the wire and cannot be aborted; recording it keeps page state
    // from being returned afterwards. Hops share the route budget, which keeps
    // a redirect loop from issuing unbounded lookups.
    if (!isRedirectHop || !needsDnsCheck || !hasRequestBudget(requestUrl)) {
      return;
    }

    const startedIn = generation;
    // Both outcomes are handled: an unhandled rejection would shut the server down.
    const validation: Promise<void> = validateBrowserRequestUrl(requestUrl, cachedResolver).then(
      () => undefined,
      (requestError: unknown) => {
        if (startedIn === generation) {
          blockRequest("sent", requestUrl, describeError(requestError));
        }
      },
    ).finally(() => {
      pendingValidations.delete(validation);
    });
    pendingValidations.add(validation);
  });

  await context.route("**/*", async (route: Route) => {
    const requestUrl = route.request().url();

    if (!hasRequestBudget(requestUrl)) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    try {
      await validateBrowserRequestUrl(requestUrl, cachedResolver);
    } catch (requestError) {
      blockRequest("prevented", requestUrl, describeError(requestError));
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
      await validateBrowserRequestUrl(requestUrl, cachedResolver);
    } catch (requestError) {
      blockRequest("prevented", requestUrl, describeError(requestError));
      await webSocket.close({ code: 1008, reason: "Blocked by server policy" }).catch(() => undefined);
      return;
    }

    webSocket.connectToServer();
  });

  function assertAllowed(): void {
    const block = sentBlock ?? preventedBlock;
    if (block) {
      throw block;
    }
  }

  async function settle(): Promise<void> {
    const deadline = Date.now() + GUARD_SETTLE_DEADLINE_MS;
    // A validation can finish while another hop arrives, so wait until the set
    // is empty rather than for one snapshot of it.
    while (pendingValidations.size > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        sentBlock ??= new Error("Blocked unsafe browser request. Redirect validation did not finish in time.");
        return;
      }
      await withTimeout(Promise.all(pendingValidations), remaining, "Redirect validation").catch(() => undefined);
    }
  }

  return {
    assertAllowed,
    settle,
    async assertSettled(): Promise<void> {
      await settle();
      assertAllowed();
    },
    takeBlock(): Error | undefined {
      const block = sentBlock ?? preventedBlock;
      preventedBlock = undefined;
      return block;
    },
    reset(): void {
      inspectedRequests = 0;
      preventedBlock = undefined;
      sentBlock = undefined;
      generation += 1;
      pendingValidations.clear();
      dnsCache = new Map();
    },
  };
}

// A failed navigation whose error names loopback was refused by the browser's
// own local-network handling. Report it as a policy block like any other.
export function describeNavigationFailure(navigationError: unknown, targetUrl: URL, safeUrl: string): unknown {
  if (!ALLOWED_PRIVATE_HOSTS.includes(normalizeHostname(targetUrl.hostname))
    && isLoopbackNavigationError(describeError(navigationError))) {
    return new Error(`Blocked unsafe browser request to ${safeUrl}.`, { cause: navigationError });
  }

  return navigationError;
}

export async function runBrowserOperation<T>(
  label: string,
  input: CommonBrowserInput,
  callback: (context: BrowserOperationContext) => Promise<T>,
): Promise<T> {
  // Read once, synchronously: see request-context.ts.
  const signal = currentRequestSignal();
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
    // Closing the browser rejects every pending Playwright call, which unwinds
    // the operation and frees the slot even when the page itself is hung.
    const onAbort = (): void => {
      console.error(chalk.yellow(`[Camoufox] Client cancelled ${label}; closing browser.`));
      void closeBrowser(browser);
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      throwIfCancelled(signal);
      const context = await browser.newContext(browserContextOptions(effectiveInput));
      const requestGuard = await installRequestGuard(context);
      const page = await context.newPage();

      const rawUrls = [effectiveInput.url, getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(effectiveInput.proxy);
      const diagnostics = createDiagnosticsCollector(page, effectiveInput, rawUrls, secrets);
      let lastNavigationResponse: Response | null = null;
      trackNavigationResponses(page, (committedResponse) => {
        lastNavigationResponse = committedResponse;
      });

      let response: Response | null;
      try {
        response = await navigateWithDocumentUrlCorrection(page, targetUrl, {
          waitUntil: waitStrategy,
          timeout: effectiveInput.timeout,
        }, () => settleAndAssertSafe(page, requestGuard));
      } catch (navigationError) {
        await requestGuard.assertSettled();
        throw describeNavigationFailure(navigationError, targetUrl, safeUrl);
      }

      return await callback({
        page,
        response,
        requestGuard,
        diagnostics,
        selectedOS,
        waitStrategy,
        captchaPolicy: effectiveInput.captchaPolicy,
        getLastNavigationResponse: () => lastNavigationResponse,
      });
    } catch (operationError) {
      // The browser was closed underneath the operation; the resulting
      // "target closed" error is noise next to the real reason.
      if (signal?.aborted) {
        throw new RequestCancelledError({ cause: operationError });
      }
      throw operationError;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      console.error(chalk.blue("[Camoufox] Closing browser."));
      await closeBrowser(browser);
    }
  }, signal);
}

export async function assertPageLocationSafe(page: Page): Promise<void> {
  if (page.url() === "about:blank") {
    return;
  }

  await validateTargetUrl(page.url());
}

export async function settleAndAssertSafe(page: Page, requestGuard: RequestGuard): Promise<void> {
  await page.waitForTimeout(GUARD_SETTLE_MS);
  await requestGuard.assertSettled();
  await assertPageLocationSafe(page);
  await requestGuard.assertSettled();
}

// Every read that returns page-derived data (text, snapshots, screenshots,
// titles, challenge detection) goes through here: the guard and the committed
// location are checked before and after, and the read itself is bounded so a
// page that never yields cannot hold the browse slot.
export async function runGuardedPageRead<T>(
  page: Page,
  requestGuard: RequestGuard,
  read: () => Promise<T>,
  label = "Page read",
): Promise<T> {
  try {
    await requestGuard.assertSettled();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    const result = await withTimeout(read(), PAGE_READ_TIMEOUT_MS, label);
    await page.waitForTimeout(GUARD_SETTLE_MS).catch(() => undefined);
    await requestGuard.assertSettled();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    return result;
  } catch (readError) {
    await page.waitForTimeout(GUARD_SETTLE_MS).catch(() => undefined);
    await requestGuard.assertSettled();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    throw readError;
  }
}

export async function closeBrowser(browser: BrowserInstance): Promise<void> {
  activeBrowsers.delete(browser);
  try {
    // A wedged browser must not hold shutdown, cancellation, or a session
    // close open indefinitely.
    await withTimeout(browser.close(), BROWSER_CLOSE_TIMEOUT_MS, "Browser close");
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
