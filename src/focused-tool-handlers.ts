import { DEFAULT_MAX_ELEMENTS, MAX_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_WIDTH } from "./config.js";
import type { ConsoleToolInput, FindToolInput, FormsToolInput, LinksToolInput, NetworkSummaryToolInput, OutlineToolInput, ScreenshotToolInput } from "./schemas.js";
import { runBrowserOperation, runGuardedPageRead } from "./browser-runtime.js";
import { maybeDetectCaptcha } from "./captcha.js";
import { buildFindPayload, buildFormsPayload, buildLinksPayload, buildNetworkSummary, buildOutlinePayload } from "./extractors.js";
import { buildSuccessContent, buildToolError, buildToolFailure } from "./responses.js";
import { captureScreenshot, isScreenshotDimensionAllowed } from "./screenshots.js";
import { redactUrl } from "./utils.js";
import { appendDiagnostics } from "./diagnostics.js";

export async function handleLinks(input: LinksToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse links", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildLinksPayload(
          page,
          response,
          input.maxLinks ?? DEFAULT_MAX_ELEMENTS,
          input.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse links", safeUrl, error, input);
  }
}

export async function handleForms(input: FormsToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse forms", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildFormsPayload(
          page,
          response,
          input.maxForms ?? 20,
          input.maxFields ?? DEFAULT_MAX_ELEMENTS,
          input.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse forms", safeUrl, error, input);
  }
}

export async function handleOutline(input: OutlineToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse outline", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildOutlinePayload(
          page,
          response,
          input.maxItems ?? DEFAULT_MAX_ELEMENTS,
          input.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse outline", safeUrl, error, input);
  }
}

export async function handleFind(input: FindToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse find", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildFindPayload(
          page,
          response,
          input.query,
          input.maxMatches ?? 5,
          input.contextChars ?? 300,
          input.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse find", safeUrl, error, input);
  }
}

export async function handleScreenshot(input: ScreenshotToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation.
  const safeUrl = redactUrl(input.url);

  if (!isScreenshotDimensionAllowed(input.viewport, input.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse screenshot", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
    }) => {
      // The image and title are page-derived data: read them through the guard
      // so a page that moved to a blocked location is never captured.
      const { screenshotResult, title } = await runGuardedPageRead(page, requestGuard, async () => ({
        screenshotResult: await captureScreenshot(page, safeUrl, {
          fullPage: input.fullPage,
          selector: input.selector,
          type: input.type,
          quality: input.quality,
        }),
        title: await page.title(),
      }), "Screenshot");
      const payload = {
        url: redactUrl(page.url()),
        title,
        status: response?.status(),
        contentType: response?.headers()["content-type"],
        screenshot: screenshotResult.screenshotMetadata,
      };
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        // captureScreenshot always returns an object (base64 only on success),
        // so the previous `screenshotResult ?? captchaScreenshot` never used the
        // bounded challenge screenshot. Prefer the main capture only when it
        // actually produced an image; otherwise surface the challenge capture.
        return buildSuccessContent(mergedPayload, screenshotResult.base64 ? screenshotResult : captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse screenshot", safeUrl, error, input);
  }
}

export async function handleConsole(input: ConsoleToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation. Honor the
  // caller's includeConsole/includeNetwork instead of forcing includeNetwork
  // off; the schema defaults includeConsole to true for this tool.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse console", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
      diagnostics,
    }) => {
      const title = await runGuardedPageRead(page, requestGuard, () => page.title());
      const diagnosticsPayload = diagnostics.payload();
      const payload = {
        url: redactUrl(page.url()),
        title,
        status: response?.status(),
        contentType: response?.headers()["content-type"],
        console: diagnosticsPayload?.console ?? [],
        consoleTruncated: diagnosticsPayload?.consoleTruncated ?? false,
        ...(diagnosticsPayload?.network ? { network: diagnosticsPayload.network } : {}),
      };
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse console", safeUrl, error, input);
  }
}

export async function handleNetworkSummary(input: NetworkSummaryToolInput) {
  // applyStealthProfile is applied once inside runBrowserOperation. The schema
  // defaults includeNetwork to true for this tool; includeConsole stays off.
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse network summary", input, async ({
      page,
      response,
      requestGuard,
      captchaPolicy,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildNetworkSummary(page, response, diagnostics.payload(), input.maxFailures ?? 10),
      );
      requestGuard.assertAllowed();
      if (captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, requestGuard, response, payload, captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse network summary", safeUrl, error, input);
  }
}
