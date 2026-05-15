import { DEFAULT_MAX_ELEMENTS, MAX_SCREENSHOT_HEIGHT, MAX_SCREENSHOT_WIDTH } from "./config.js";
import type { ConsoleToolInput, FindToolInput, FormsToolInput, LinksToolInput, NetworkSummaryToolInput, OutlineToolInput, ScreenshotToolInput } from "./schemas.js";
import { runBrowserOperation, runGuardedPageRead } from "./browser-runtime.js";
import { maybeDetectCaptcha } from "./captcha.js";
import { buildFindPayload, buildFormsPayload, buildLinksPayload, buildNetworkSummary, buildOutlinePayload } from "./extractors.js";
import { buildSuccessContent, buildToolError, buildToolFailure } from "./responses.js";
import { captureScreenshot, isScreenshotDimensionAllowed } from "./screenshots.js";
import { applyStealthProfile, redactUrl } from "./utils.js";
import { appendDiagnostics } from "./diagnostics.js";

export async function handleLinks(input: LinksToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse links", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildLinksPayload(
          page,
          response,
          effectiveInput.maxLinks ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse links", safeUrl, error, effectiveInput);
  }
}

export async function handleForms(input: FormsToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse forms", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildFormsPayload(
          page,
          response,
          effectiveInput.maxForms ?? 20,
          effectiveInput.maxFields ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse forms", safeUrl, error, effectiveInput);
  }
}

export async function handleOutline(input: OutlineToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse outline", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildOutlinePayload(
          page,
          response,
          effectiveInput.maxItems ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse outline", safeUrl, error, effectiveInput);
  }
}

export async function handleFind(input: FindToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse find", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildFindPayload(
          page,
          response,
          effectiveInput.query,
          effectiveInput.maxMatches ?? 5,
          effectiveInput.contextChars ?? 300,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse find", safeUrl, error, effectiveInput);
  }
}

export async function handleScreenshot(input: ScreenshotToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  if (!isScreenshotDimensionAllowed(effectiveInput.viewport, effectiveInput.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse screenshot", effectiveInput, async ({
      page,
      response,
      requestGuard,
    }) => {
      const screenshotResult = await captureScreenshot(page, safeUrl, {
        fullPage: effectiveInput.fullPage,
        selector: effectiveInput.selector,
        type: effectiveInput.type,
        quality: effectiveInput.quality,
      });
      requestGuard.assertAllowed();
      const payload = {
        url: redactUrl(page.url()),
        title: await page.title(),
        status: response?.status(),
        contentType: response?.headers()["content-type"],
        screenshot: screenshotResult.screenshotMetadata,
      };
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, screenshotResult ?? captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse screenshot", safeUrl, error, effectiveInput);
  }
}

export async function handleConsole(input: ConsoleToolInput) {
  const effectiveInput = applyStealthProfile({
    ...input,
    includeConsole: true,
    includeNetwork: false,
  });
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse console", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      await runGuardedPageRead(page, requestGuard, () => page.title());
      requestGuard.assertAllowed();
      const payload = {
        url: redactUrl(page.url()),
        title: await page.title(),
        status: response?.status(),
        contentType: response?.headers()["content-type"],
        console: diagnostics.payload()?.console ?? [],
        consoleTruncated: diagnostics.payload()?.consoleTruncated ?? false,
      };
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse console", safeUrl, error, effectiveInput);
  }
}

export async function handleNetworkSummary(input: NetworkSummaryToolInput) {
  const effectiveInput = applyStealthProfile({
    ...input,
    includeConsole: false,
    includeNetwork: true,
  });
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse network summary", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildNetworkSummary(page, response, diagnostics.payload(), effectiveInput.maxFailures ?? 10),
      );
      requestGuard.assertAllowed();
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse network summary", safeUrl, error, effectiveInput);
  }
}
