import { randomUUID } from "node:crypto";
import type { Browser, Response } from "playwright-core";
import chalk from "chalk";
import { validateTargetUrl } from "./policy.js";
import { DEFAULT_ACTION_TIMEOUT_MS, DEFAULT_MAX_CHARS, DEFAULT_MAX_ELEMENTS, DEFAULT_WAIT_STRATEGY, MAX_SESSIONS, SESSION_CLOSE_GRACE_MS, SESSION_TTL_MS } from "./config.js";
import type { CaptchaPolicy, SessionRecord, SlotRelease, WaitStrategy } from "./types.js";
import type { SessionActionToolInput, SessionCloseToolInput, SessionNavigateToolInput, SessionResumeToolInput, SessionSnapshotToolInput, SessionStartToolInput } from "./schemas.js";
import { acquireBrowserSlot, browserContextOptions, buildCamoufoxOptions, closeBrowser, describeNavigationFailure, installRequestGuard, launchCamoufoxBrowser, runGuardedPageRead, settleAndAssertSafe, trackBrowser, validateBrowserOptionsInput } from "./browser-runtime.js";
import { currentRequestSignal, throwIfCancelled } from "./request-context.js";
import { createDiagnosticsCollector } from "./diagnostics.js";
import { trackNavigationResponses } from "./navigation-response.js";
import { navigateWithDocumentUrlCorrection } from "./navigation.js";
import { buildBrowsePayload, buildSnapshotPayload } from "./extractors.js";
import { maybeDetectCaptcha } from "./captcha.js";
import { buildSuccessContent, buildToolError } from "./responses.js";
import { actionTimeout, runSequenceAction } from "./sequence.js";
import { applyStealthProfile, defaultHeadlessMode, describeError, getProxySecrets, getProxyServer, isOperationTimeout, redactUrl, sanitizeErrorMessage, selectOperatingSystem, withTimeout } from "./utils.js";

const DEFAULT_SESSION_NAVIGATION_TIMEOUT_MS = DEFAULT_ACTION_TIMEOUT_MS * 6;
// Headroom over an action's own timeout before the session-level deadline fires.
const SESSION_ACTION_GRACE_MS = 2000;

let reservedSessions = 0;
const sessions = new Map<string, SessionRecord>();

export function activeSessionCount(): number { return sessions.size; }

export function sessionExpiresAt(session: SessionRecord): string {
  return new Date(session.expiresAt).toISOString();
}

export function resetSessionTtl(session: SessionRecord): void {
  clearTimeout(session.timer);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  session.timer = setTimeout(() => {
    void closeSession(session.id, "expired");
  }, SESSION_TTL_MS);
}

export function reserveSessionSlot(): boolean {
  if (reservedSessions >= MAX_SESSIONS) {
    return false;
  }

  reservedSessions += 1;
  return true;
}

export function releaseSessionSlot(): void {
  reservedSessions = Math.max(0, reservedSessions - 1);
}

export async function closeSessionNow(session: SessionRecord, reason: string): Promise<boolean> {
  if (session.closed) {
    return false;
  }

  session.closing = true;
  session.closed = true;
  sessions.delete(session.id);
  clearTimeout(session.timer);
  console.error(chalk.blue(`[Camoufox] Closing session ${session.id} (${reason}).`));
  try {
    await closeBrowser(session.browser);
  } finally {
    session.releaseSlot();
    releaseSessionSlot();
  }
  return true;
}

export async function closeSession(sessionId: string, reason: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  session.closing = true;
  sessions.delete(sessionId);
  clearTimeout(session.timer);
  await waitForSessionOperationCloseGrace(session);
  return closeSessionNow(session, reason);
}

export async function waitForSessionOperationCloseGrace(session: SessionRecord): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      session.op.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SESSION_CLOSE_GRACE_MS);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function closeActiveSessions(): Promise<void> {
  const ids = Array.from(sessions.keys());
  await Promise.all(ids.map((id) => closeSession(id, "shutdown")));
}

export async function getSession(sessionId: string): Promise<SessionRecord> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown or closed session: ${sessionId}`);
  }

  if (Date.now() > session.expiresAt) {
    await closeSession(sessionId, "expired");
    throw new Error(`Session expired: ${sessionId}`);
  }

  resetSessionTtl(session);
  return session;
}

export async function runSessionExclusive<T>(
  session: SessionRecord,
  operation: () => Promise<T>,
  // True when the failed operation left work running in the page that could
  // still land later. Only then is the session unusable.
  leftWorkRunning: (error: unknown) => boolean = () => false,
): Promise<T> {
  // Read synchronously, before queueing behind the session's current operation.
  const signal = currentRequestSignal();
  const run = session.op.catch(() => undefined).then(async () => {
    if (session.closing || session.closed) {
      throw new Error(`Session is closing or closed: ${session.id}`);
    }
    // A request cancelled while it waited its turn must not start. Once an
    // operation has started it runs to its own bounded end: interrupting it
    // would destroy session state the caller may still want.
    throwIfCancelled(signal);

    try {
      return await operation();
    } catch (error) {
      if (leftWorkRunning(error)) {
        await closeSessionNow(session, "operation-timeout");
      }
      throw error;
    }
  });

  session.op = run.then(() => undefined, () => undefined);
  return run;
}

export async function navigateSession(
  session: SessionRecord,
  url: string,
  waitStrategy?: WaitStrategy,
  timeout?: number,
): Promise<Response | null> {
  const safeUrl = redactUrl(url);
  const targetUrl = await validateTargetUrl(url);
  session.rawUrls.push(url);

  // A navigation replaces the document, so the previous page's request budget,
  // recorded blocks, and diagnostics no longer describe what will be returned.
  session.requestGuard.reset();
  session.diagnostics.reset();

  try {
    const response = await navigateWithDocumentUrlCorrection(session.page, targetUrl, {
      waitUntil: waitStrategy ?? session.waitStrategy,
      timeout: timeout ?? session.navigationTimeout,
    }, () => settleAndAssertSafe(session.page, session.requestGuard));
    return response;
  } catch (navigationError) {
    await session.requestGuard.assertSettled();
    throw describeNavigationFailure(navigationError, targetUrl, safeUrl);
  }
}

// What a failed session call reports. A recorded block explains the failure
// better than the secondary error it caused, and taking it here is what lets
// the session recover: see RequestGuard.takeBlock.
function sessionFailure(session: SessionRecord | undefined, error: unknown): unknown {
  return session?.requestGuard.takeBlock() ?? error;
}

export async function handleSessionStart(input: SessionStartToolInput) {
  const captchaPolicy = input.captchaPolicy ?? "pause";
  const effectiveInput = applyStealthProfile({
    ...input,
    captchaPolicy,
  });

  if (!reserveSessionSlot()) {
    return buildToolError(`Too many active sessions. Maximum is ${MAX_SESSIONS}.`);
  }

  let release: SlotRelease | undefined;
  let browser: Browser | undefined;
  try {
    await validateBrowserOptionsInput(effectiveInput);
    release = await acquireBrowserSlot(currentRequestSignal());
    const selectedOS = selectOperatingSystem(effectiveInput.os);
    const waitStrategy = effectiveInput.waitStrategy ?? DEFAULT_WAIT_STRATEGY;
    const headlessMode = defaultHeadlessMode(effectiveInput.headless);

    browser = await launchCamoufoxBrowser(buildCamoufoxOptions(effectiveInput, selectedOS, headlessMode));
    trackBrowser(browser);
    const context = await browser.newContext(browserContextOptions(effectiveInput));
    const requestGuard = await installRequestGuard(context);
    const page = await context.newPage();

    const id = `sess_${randomUUID()}`;
    const rawUrls = [getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
    const secrets = getProxySecrets(effectiveInput.proxy);
    const now = Date.now();
    const session: SessionRecord = {
      id,
      browser,
      context,
      page,
      requestGuard,
      diagnostics: createDiagnosticsCollector(page, effectiveInput, rawUrls, secrets),
      selectedOS,
      waitStrategy,
      captchaPolicy,
      navigationTimeout: effectiveInput.timeout ?? DEFAULT_SESSION_NAVIGATION_TIMEOUT_MS,
      releaseSlot: release,
      rawUrls,
      secrets,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      timer: setTimeout(() => {
        void closeSession(id, "expired");
      }, SESSION_TTL_MS),
      lastNavigationResponse: null,
      op: Promise.resolve(),
      closing: false,
      closed: false,
    };

    trackNavigationResponses(page, (response) => {
      session.lastNavigationResponse = response;
    });

    sessions.set(id, session);
    browser = undefined;
    release = undefined;

    return buildSuccessContent({
      sessionId: id,
      expiresAt: sessionExpiresAt(session),
      browser: "camoufox",
      selectedOS,
      headlessMode,
      stealthProfile: effectiveInput.stealthProfile,
      captchaPolicy,
    });
  } catch (error) {
    if (browser) {
      await closeBrowser(browser);
    }
    if (release) {
      release();
    }
    releaseSessionSlot();
    const errorMessage = sanitizeErrorMessage(
      describeError(error),
      [getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl)),
      getProxySecrets(effectiveInput.proxy),
    );
    return buildToolError(`Failed to start browser session. Error: ${errorMessage}`);
  }
}

export function sessionSanitizedError(error: unknown, session?: SessionRecord, extraRawUrls: string[] = []): string {
  const rawUrls = session ? [...session.rawUrls, ...extraRawUrls] : extraRawUrls;
  const secrets = session?.secrets ?? [];
  return sanitizeErrorMessage(describeError(error), rawUrls, secrets);
}

// Resolve the CAPTCHA policy for a session operation: a per-call override wins,
// otherwise fall back to the policy persisted at session start. Without this,
// starting a session with the documented "pause" default performed no detection
// on subsequent calls unless the caller re-passed captchaPolicy each time.
export function effectiveCaptchaPolicy(
  session: SessionRecord,
  input: { captchaPolicy?: CaptchaPolicy },
): CaptchaPolicy {
  return input.captchaPolicy ?? session.captchaPolicy;
}

export async function buildSessionSnapshotResult(
  session: SessionRecord,
  input: SessionSnapshotToolInput,
) {
  const snapshot = await runGuardedPageRead(
    session.page,
    session.requestGuard,
    () => buildSnapshotPayload(
      session.page,
      session.lastNavigationResponse,
      input.maxChars ?? DEFAULT_MAX_CHARS,
      input.maxElements ?? DEFAULT_MAX_ELEMENTS,
      input.selector,
      () => session.lastNavigationResponse,
    ),
  );
  // Surface the diagnostics collector that was created at session start but
  // previously never read. Snapshot/resume are the read-state operations, so
  // bounded console/network diagnostics belong here.
  const diagnostics = session.diagnostics.payload();
  const basePayload = { sessionId: session.id, expiresAt: sessionExpiresAt(session), ...snapshot, ...(diagnostics ? { diagnostics } : {}) };
  const captchaPolicy = effectiveCaptchaPolicy(session, input);
  const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(
    session.page,
    session.requestGuard,
    session.lastNavigationResponse,
    basePayload,
    captchaPolicy,
    redactUrl(session.page.url()),
  );
  return buildSuccessContent(mergedPayload, captchaScreenshot);
}

export async function handleSessionNavigate(input: SessionNavigateToolInput) {
  let session: SessionRecord | undefined;
  try {
    const currentSession = await getSession(input.sessionId);
    session = currentSession;
    return await runSessionExclusive(currentSession, async () => {
      const response = await navigateSession(currentSession, input.url, input.waitStrategy, input.timeout);
      const mode = input.outputMode ?? "text";
      const charLimit = input.maxChars ?? DEFAULT_MAX_CHARS;
      const payload = await runGuardedPageRead(
        currentSession.page,
        currentSession.requestGuard,
        () => buildBrowsePayload(currentSession.page, response, mode, charLimit, input.selector),
      );
      const basePayload = { sessionId: currentSession.id, expiresAt: sessionExpiresAt(currentSession), ...payload };
      const captchaPolicy = effectiveCaptchaPolicy(currentSession, input);
      const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(currentSession.page, currentSession.requestGuard, response, basePayload, captchaPolicy, redactUrl(input.url));
      return buildSuccessContent(mergedPayload, captchaScreenshot);
    });
  } catch (error) {
    return buildToolError(`Failed to navigate session. Error: ${sessionSanitizedError(sessionFailure(session, error), session, [input.url])}`);
  }
}

export async function handleSessionAction(input: SessionActionToolInput) {
  let session: SessionRecord | undefined;
  // Set when this server's own deadline abandoned the action mid-flight. The
  // abandoned step may still land in the page, so the session cannot be reused.
  // A Playwright timeout is different: Playwright stops the action itself.
  let actionAbandoned = false;
  try {
    const currentSession = await getSession(input.sessionId);
    session = currentSession;
    return await runSessionExclusive(currentSession, async () => {
      let actionResult;
      try {
        // Individual steps carry their own timeouts; this bounds the whole
        // action so no step without one can hold the session.
        actionResult = await withTimeout(
          runSequenceAction(currentSession.page, input.action, 0, currentSession.rawUrls, currentSession.secrets),
          actionTimeout(input.action) + SESSION_ACTION_GRACE_MS,
          "Session action",
        );
      } catch (actionError) {
        actionAbandoned = isOperationTimeout(actionError);
        throw actionError;
      }
      await settleAndAssertSafe(currentSession.page, currentSession.requestGuard);
      const snapshot = await runGuardedPageRead(
        currentSession.page,
        currentSession.requestGuard,
        () => buildSnapshotPayload(
          currentSession.page,
          currentSession.lastNavigationResponse,
          input.maxChars ?? DEFAULT_MAX_CHARS,
          input.maxElements ?? DEFAULT_MAX_ELEMENTS,
          input.selector,
          () => currentSession.lastNavigationResponse,
        ),
        "Snapshot",
      );
      const basePayload = { sessionId: currentSession.id, expiresAt: sessionExpiresAt(currentSession), action: actionResult, snapshot };
      const captchaPolicy = effectiveCaptchaPolicy(currentSession, input);
      const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(currentSession.page, currentSession.requestGuard, currentSession.lastNavigationResponse, basePayload, captchaPolicy, redactUrl(currentSession.page.url()));
      return buildSuccessContent(mergedPayload, captchaScreenshot);
    }, () => actionAbandoned);
  } catch (error) {
    // A network rejection can fail an action before its post-action guard
    // check runs, so give redirect validations a moment to finish first.
    await session?.requestGuard.settle();
    return buildToolError(`Failed to run session action. Error: ${sessionSanitizedError(sessionFailure(session, error), session)}`);
  }
}

export async function handleSessionSnapshot(input: SessionSnapshotToolInput) {
  let session: SessionRecord | undefined;
  try {
    const currentSession = await getSession(input.sessionId);
    session = currentSession;
    return await runSessionExclusive(currentSession, async () => buildSessionSnapshotResult(currentSession, input));
  } catch (error) {
    return buildToolError(`Failed to snapshot session. Error: ${sessionSanitizedError(sessionFailure(session, error), session)}`);
  }
}

export async function handleSessionResume(input: SessionResumeToolInput) {
  let session: SessionRecord | undefined;
  try {
    const currentSession = await getSession(input.sessionId);
    session = currentSession;
    return await runSessionExclusive(currentSession, async () => {
      if (input.waitStrategy) {
        await currentSession.page.waitForLoadState(input.waitStrategy, { timeout: input.timeout ?? DEFAULT_ACTION_TIMEOUT_MS });
        await settleAndAssertSafe(currentSession.page, currentSession.requestGuard);
      }
      return buildSessionSnapshotResult(currentSession, input);
    });
  } catch (error) {
    return buildToolError(`Failed to resume session. Error: ${sessionSanitizedError(sessionFailure(session, error), session)}`);
  }
}

export async function handleSessionClose(input: SessionCloseToolInput) {
  const closed = await closeSession(input.sessionId, "requested");
  return buildSuccessContent({
    sessionId: input.sessionId,
    closed,
  });
}
