import { probeBrowserBinary } from "./browser-preflight.js";
import { buildBrowserCompatibilityStatus } from "./browser-build.js";
import chalk from "chalk";
import { ALLOW_EVALUATE, ALLOW_UNSAFE_OPTIONS, CAPTCHA_AUTONOMOUS, DEFAULT_MAX_CHARS, DEFAULT_MAX_ELEMENTS, MAX_CONCURRENCY, MAX_QUEUE, MAX_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_WIDTH, MAX_SESSIONS, SEQUENCE_TIMEOUT_MS, SERVER_VERSION, SESSION_TTL_MS, buildNetworkSecurityStatus } from "./config.js";
import type { BrowsePayload, OutputMode, ScreenshotResult, SequencePayload, StatusPayload, SupportedOs } from "./types.js";
import type { BrowseToolInput, SequenceToolInput, SnapshotToolInput } from "./schemas.js";
import { activeBrowserCount, queuedBrowserRequestCount, runBrowserOperation, runGuardedPageRead } from "./browser-runtime.js";
import { maybeDetectCaptcha } from "./captcha.js";
import { activeSessionCount } from "./sessions.js";
import { buildBrowsePayload, buildSnapshotPayload } from "./extractors.js";
import { buildSuccessContent, buildToolError, buildToolFailure } from "./responses.js";
import { captureScreenshot, isScreenshotDimensionAllowed } from "./screenshots.js";
import { runSequenceActionsWithBudget, sequenceTimeoutBudget } from "./sequence.js";
import { defaultHeadlessMode, getProxySecrets, getProxyServer, redactUrl } from "./utils.js";
import { appendDiagnostics } from "./diagnostics.js";

export function buildFeatureSummary(
  selectedOS: SupportedOs,
  waitStrategy: string,
  outputMode: OutputMode,
  charLimit: number,
  payload: BrowsePayload,
  proxy: unknown,
  blockWebrtc: boolean | undefined,
  blockImages: boolean | undefined,
  blockWebgl: boolean | undefined,
  disableCoop: boolean | undefined,
  geoip: boolean | undefined,
): string {
  const features = [
    `OS: ${selectedOS}`,
    `wait: ${waitStrategy}`,
    `output: ${outputMode}`,
    payload.truncated ? `truncated: ${charLimit}` : undefined,
    proxy ? "proxy: enabled" : undefined,
    blockWebrtc ? "WebRTC: blocked" : undefined,
    blockImages ? "images: blocked" : undefined,
    blockWebgl ? "WebGL: blocked" : undefined,
    disableCoop ? "COOP: disabled" : undefined,
    !geoip ? "geoip: disabled" : undefined,
  ].filter((feature): feature is string => feature !== undefined);

  return features.join(", ");
}

export function isBlockedNavigationResponse(payload: BrowsePayload): boolean {
  if (payload.status !== 403) {
    return false;
  }

  const content = (payload.text ?? payload.html ?? "").toLowerCase();
  return content.includes("forbidden redirect url") || content.includes("blocked redirect");
}

export function buildStatusPayload(): StatusPayload {
  let browserAvailable: boolean;
  let browserPath: string | undefined;
  try {
    browserPath = probeBrowserBinary();
    browserAvailable = true;
  } catch {
    browserAvailable = false;
  }

  return {
    version: SERVER_VERSION,
    browser: "camoufox",
    browserAvailable,
    browserPath,
    browserCompatibility: buildBrowserCompatibilityStatus(),
    headlessMode: defaultHeadlessMode(undefined),
    platform: process.platform,
    activeBrowsers: activeBrowserCount(),
    activeSessions: activeSessionCount(),
    queuedRequests: queuedBrowserRequestCount(),
    maxConcurrency: MAX_CONCURRENCY,
    maxQueue: MAX_QUEUE,
    maxSessions: MAX_SESSIONS,
    sessionTtlMs: SESSION_TTL_MS,
    unsafeOptionsAllowed: ALLOW_UNSAFE_OPTIONS,
    evaluateAllowed: ALLOW_EVALUATE,
    captchaAutonomous: CAPTCHA_AUTONOMOUS,
    networkSecurity: buildNetworkSecurityStatus(),
  };
}

export async function handleStatus() {
  return buildSuccessContent(buildStatusPayload());
}

export async function handleBrowse(input: BrowseToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation; reading the
  // raw input here keeps redactUrl/screenshot checks on caller-supplied values.
  const safeUrl = redactUrl(input.url);

  if (input.screenshot && !isScreenshotDimensionAllowed(input.viewport, input.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse", input, async ({
      page,
      response,
      requestGuard,
      diagnostics,
      selectedOS,
      waitStrategy,
    }) => {
      const mode = input.outputMode ?? "text";
      const charLimit = input.maxChars ?? DEFAULT_MAX_CHARS;
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildBrowsePayload(page, response, mode, charLimit, input.selector),
      );
      requestGuard.assertAllowed();
      if (isBlockedNavigationResponse(payload)) {
        return buildToolError(`Blocked unsafe browser request to ${safeUrl}.`);
      }

      appendDiagnostics(payload, diagnostics.payload());

      let screenshotResult: ScreenshotResult | undefined;
      if (input.screenshot) {
        screenshotResult = await captureScreenshot(page, safeUrl, input.screenshotOptions);
        payload.screenshot = screenshotResult.screenshotMetadata;
      }
      requestGuard.assertAllowed();

      const features = buildFeatureSummary(
        selectedOS,
        waitStrategy,
        mode,
        charLimit,
        payload,
        input.proxy,
        input.block_webrtc,
        input.block_images,
        input.block_webgl,
        input.disable_coop,
        input.geoip,
      );
      console.error(chalk.green(`[Camoufox] Successfully retrieved content from ${safeUrl} (${features}).`));

      if (input.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, input.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, (screenshotResult && screenshotResult.base64) ? screenshotResult : captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse", safeUrl, error, input);
  }
}

export async function handleSnapshot(input: SnapshotToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse snapshot", input, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildSnapshotPayload(
          page,
          response,
          input.maxChars ?? DEFAULT_MAX_CHARS,
          input.maxElements ?? DEFAULT_MAX_ELEMENTS,
          input.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      console.error(chalk.green(`[Camoufox] Successfully captured snapshot from ${safeUrl}.`));

      if (input.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, input.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse snapshot", safeUrl, error, input);
  }
}

export async function handleSequence(input: SequenceToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  if (input.screenshot && !isScreenshotDimensionAllowed(input.viewport, input.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  if (sequenceTimeoutBudget(input.actions) > SEQUENCE_TIMEOUT_MS) {
    return buildToolError(`Sequence timeout budget exceeds server policy (${SEQUENCE_TIMEOUT_MS}ms).`);
  }

  try {
    return await runBrowserOperation("browse sequence", input, async ({
      page,
      response,
      requestGuard,
      diagnostics,
      getLastNavigationResponse,
    }) => {
      const rawUrls = [input.url, getProxyServer(input.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(input.proxy);
      const actions = await runSequenceActionsWithBudget(page, requestGuard, input.actions, rawUrls, secrets);

      const mode = input.outputMode ?? "text";
      const charLimit = input.maxChars ?? DEFAULT_MAX_CHARS;
      const finalResponse = getLastNavigationResponse() ?? response;
      const contentPayload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildBrowsePayload(page, finalResponse, mode, charLimit, input.selector),
      );
      requestGuard.assertAllowed();
      if (isBlockedNavigationResponse(contentPayload)) {
        return buildToolError(`Blocked unsafe browser request to ${safeUrl}.`);
      }

      const snapshot = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildSnapshotPayload(
          page,
          finalResponse,
          charLimit,
          input.maxElements ?? DEFAULT_MAX_ELEMENTS,
          input.selector,
        ),
      );
      requestGuard.assertAllowed();

      const payload: SequencePayload = {
        url: contentPayload.url,
        title: contentPayload.title,
        status: contentPayload.status,
        contentType: contentPayload.contentType,
        initialStatus: response?.status(),
        actions,
        snapshot,
        outputMode: mode,
        truncated: contentPayload.truncated,
        maxChars: charLimit,
        selector: input.selector,
        selectorFound: contentPayload.selectorFound,
        text: contentPayload.text,
        html: contentPayload.html,
      };

      appendDiagnostics(payload, diagnostics.payload());

      let screenshotResult: ScreenshotResult | undefined;
      if (input.screenshot) {
        screenshotResult = await captureScreenshot(page, safeUrl, input.screenshotOptions);
        payload.screenshot = screenshotResult.screenshotMetadata;
      }
      requestGuard.assertAllowed();

      console.error(chalk.green(`[Camoufox] Successfully ran ${actions.length} actions from ${safeUrl}.`));
      if (input.captchaPolicy) {
        const finalResponse = getLastNavigationResponse() ?? response;
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, finalResponse, payload, input.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, (screenshotResult && screenshotResult.base64) ? screenshotResult : captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse sequence", safeUrl, error, input);
  }
}

export {
  handleConsole,
  handleFind,
  handleForms,
  handleLinks,
  handleNetworkSummary,
  handleOutline,
  handleScreenshot,
} from "./focused-tool-handlers.js";
