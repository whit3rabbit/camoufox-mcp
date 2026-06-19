import { randomUUID } from "node:crypto";
import type { Browser, Response } from "playwright-core";
import chalk from "chalk";
import { validateTargetUrl } from "./policy.js";
import { DEFAULT_ACTION_TIMEOUT_MS, DEFAULT_MAX_CHARS, DEFAULT_MAX_ELEMENTS, DEFAULT_WAIT_STRATEGY, MAX_SESSIONS, SESSION_CLOSE_GRACE_MS, SESSION_TTL_MS } from "./config.js";
import type { SessionRecord, SlotRelease, WaitStrategy } from "./types.js";
import type { SessionActionToolInput, SessionCloseToolInput, SessionNavigateToolInput, SessionResumeToolInput, SessionSnapshotToolInput, SessionStartToolInput } from "./schemas.js";
import { acquireBrowserSlot, browserContextOptions, buildCamoufoxOptions, closeBrowser, installRequestGuard, launchCamoufoxBrowser, runGuardedPageRead, settleAndAssertSafe, trackBrowser, validateBrowserOptionsInput } from "./browser-runtime.js";
import { createDiagnosticsCollector } from "./diagnostics.js";
import { buildBrowsePayload, buildSnapshotPayload } from "./extractors.js";
import { maybeDetectCaptcha } from "./captcha.js";
import { buildSuccessContent, buildToolError } from "./responses.js";
import { isLocalOperationTimeout, runSequenceAction } from "./sequence.js";
import { applyStealthProfile, defaultHeadlessMode, describeError, getProxySecrets, getProxyServer, redactUrl, sanitizeErrorMessage, selectOperatingSystem } from "./utils.js";

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
): Promise<T> {
  const run = session.op.catch(() => undefined).then(async () => {
    if (session.closing || session.closed) {
      throw new Error(`Session is closing or closed: ${session.id}`);
    }

    try {
      return await operation();
    } catch (error) {
      if (isLocalOperationTimeout(error)) {
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

  try {
    const response = await session.page.goto(targetUrl.toString(), {
      waitUntil: waitStrategy ?? session.waitStrategy,
      timeout: timeout ?? DEFAULT_ACTION_TIMEOUT_MS * 6,
    });
    session.lastNavigationResponse = response;
    await settleAndAssertSafe(session.page, session.requestGuard);
    return response;
  } catch (navigationError) {
    const navigationErrorMessage = describeError(navigationError).toLowerCase();
    if (/\b(?:127\.0\.0\.1|localhost|ip6-localhost|ip6-loopback|::1)\b/.test(navigationErrorMessage)) {
      throw new Error(`Blocked unsafe browser request to ${safeUrl}.`, { cause: navigationError });
    }

    session.requestGuard.assertAllowed();
    throw navigationError;
  }
}

export async function handleSessionStart(input: SessionStartToolInput) {
  const effectiveInput = applyStealthProfile({
    ...input,
    captchaPolicy: input.captchaPolicy ?? "pause",
  });

  if (!reserveSessionSlot()) {
    return buildToolError(`Too many active sessions. Maximum is ${MAX_SESSIONS}.`);
  }

  let release: SlotRelease | undefined;
  let browser: Browser | undefined;
  try {
    await validateBrowserOptionsInput(effectiveInput);
    release = await acquireBrowserSlot();
    const selectedOS = selectOperatingSystem(effectiveInput.os);
    const waitStrategy = effectiveInput.waitStrategy ?? DEFAULT_WAIT_STRATEGY;
    const headlessMode = defaultHeadlessMode(effectiveInput.headless);

    browser = await launchCamoufoxBrowser(buildCamoufoxOptions(effectiveInput, selectedOS, headlessMode));
    trackBrowser(browser);
    const context = await browser.newContext(browserContextOptions(effectiveInput));
    const requestGuard = await installRequestGuard(context);
    const page = await context.newPage();
    requestGuard.watchPage(page);

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
      captchaPolicy: effectiveInput.captchaPolicy ?? "pause",
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
    ),
  );
  const basePayload = { sessionId: session.id, expiresAt: sessionExpiresAt(session), ...snapshot };
  if (input.captchaPolicy) {
    const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(
      session.page,
      session.lastNavigationResponse,
      basePayload,
      input.captchaPolicy,
      redactUrl(session.page.url()),
    );
    return buildSuccessContent(mergedPayload, captchaScreenshot);
  }
  return buildSuccessContent(basePayload);
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
      if (input.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(currentSession.page, response, basePayload, input.captchaPolicy, redactUrl(input.url));
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(basePayload);
    });
  } catch (error) {
    return buildToolError(`Failed to navigate session. Error: ${sessionSanitizedError(error, session, [input.url])}`);
  }
}

export async function handleSessionAction(input: SessionActionToolInput) {
  let session: SessionRecord | undefined;
  try {
    const currentSession = await getSession(input.sessionId);
    session = currentSession;
    return await runSessionExclusive(currentSession, async () => {
      const actionResult = await runSequenceAction(currentSession.page, input.action, 0, currentSession.rawUrls, currentSession.secrets);
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
        ),
      );
      const basePayload = { sessionId: currentSession.id, expiresAt: sessionExpiresAt(currentSession), action: actionResult, snapshot };
      if (input.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(currentSession.page, currentSession.lastNavigationResponse, basePayload, input.captchaPolicy, redactUrl(currentSession.page.url()));
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(basePayload);
    });
  } catch (error) {
    return buildToolError(`Failed to run session action. Error: ${sessionSanitizedError(error, session)}`);
  }
}

export async function handleSessionSnapshot(input: SessionSnapshotToolInput) {
  let session: SessionRecord | undefined;
  try {
    const currentSession = await getSession(input.sessionId);
    session = currentSession;
    return await runSessionExclusive(currentSession, async () => buildSessionSnapshotResult(currentSession, input));
  } catch (error) {
    return buildToolError(`Failed to snapshot session. Error: ${sessionSanitizedError(error, session)}`);
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
    return buildToolError(`Failed to resume session. Error: ${sessionSanitizedError(error, session)}`);
  }
}

export async function handleSessionClose(input: SessionCloseToolInput) {
  const closed = await closeSession(input.sessionId, "requested");
  return buildSuccessContent({
    sessionId: input.sessionId,
    closed,
  });
}
