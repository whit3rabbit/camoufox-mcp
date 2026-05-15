import type { Page, Response } from "playwright-core";
import { CAPTCHA_AUTONOMOUS } from "./config.js";
import type { CaptchaDetection, CaptchaElementInfo, CaptchaIframeInfo, CaptchaPolicy, CaptchaProvider, ScreenshotResult } from "./types.js";
import { redactUrl, truncateString } from "./utils.js";
import { captureCaptchaScreenshot } from "./screenshots.js";

const CAPTCHA_STRATEGIES: Record<CaptchaProvider, string> = {
  recaptcha: "Use the returned iframe metadata and screenshot to guide manual reCAPTCHA completion, then resume the session.",
  hcaptcha: "Use the returned iframe metadata and screenshot to guide manual hCaptcha completion, then resume the session.",
  turnstile: "Wait briefly for automatic completion. If the challenge remains, use the returned metadata and screenshot to guide manual completion.",
  cloudflare: "Wait briefly for automatic completion. If still blocked, use the returned metadata and screenshot to guide manual completion.",
  text_captcha: "Use the returned screenshot to inspect the prompt, complete it manually, then resume the session.",
  generic: "Use the returned metadata and screenshot to inspect the challenge, complete it manually, then resume the session.",
};

const CAPTCHA_AUTONOMOUS_STRATEGY = "LLM-assisted challenge handling is enabled. Use challengeProvider, challengeSignals, captchaIframes, interactiveElements, visible page text, and the bounded screenshot to infer what the challenge asks for. Choose normal browser actions from that context and re-read session state after each action.";

const CAPTCHA_LLM_PLAYBOOKS: Record<CaptchaProvider, string> = {
  recaptcha: "Known reCAPTCHA pattern: an initial checkbox or button may be followed by an image, audio, or text challenge. Use captchaIframes to locate the challenge frame, interactiveElements to identify available controls, visible text to understand the prompt, and the bounded screenshot to reason about any visual task. If the challenge changes after an action, read the session state again before choosing the next action.",
  hcaptcha: "Known hCaptcha pattern: a checkbox or button may open an image-selection challenge with prompt text. Use captchaIframes, interactiveElements, visible text, and the bounded screenshot to identify the requested category and available controls. Re-read the session state after each action because hCaptcha often updates prompts or verification state.",
  turnstile: "Known Turnstile pattern: the challenge may complete automatically after a short wait, or expose a checkbox-like verification control. Use visible text, interactiveElements, network/load state, and the bounded screenshot to determine whether the page is still waiting, verified, or asking for an interaction.",
  cloudflare: "Known Cloudflare challenge pattern: the page may show a waiting/interstitial state, Turnstile control, or verification prompt. Use challengeSignals, visible text, interactiveElements, and the bounded screenshot to distinguish passive waiting from a requested action, then re-read state after each step.",
  text_captcha: "Known text CAPTCHA pattern: the page usually asks a short question or transcription task near an input. Use visible text, labels, input metadata, and the bounded screenshot to infer the requested answer and identify the submission control.",
  generic: "Generic challenge pattern: inspect visible text, interactiveElements, captchaIframes, challengeSignals, and the bounded screenshot to infer the requested task. Prefer incremental actions followed by a fresh session read because challenges often change after each interaction.",
};

export function classifyCaptchaProvider(src: string): { provider: CaptchaProvider; selector: string } | undefined {
  if (/recaptcha/.test(src)) return { provider: "recaptcha", selector: "iframe[src*='recaptcha']" };
  if (/hcaptcha/.test(src)) return { provider: "hcaptcha", selector: "iframe[src*='hcaptcha']" };
  if (/turnstile|challenges\.cloudflare/.test(src)) return { provider: "turnstile", selector: "iframe[src*='turnstile'], iframe[src*='challenges.cloudflare']" };
  return undefined;
}

export async function detectChallenge(page: Page, response?: Response | null, attemptMode = false): Promise<CaptchaDetection> {
  const { signals, iframeData } = await page.evaluate((collectIframeData: boolean) => {
    const found: string[] = [];
    const add = (signal: string) => {
      if (!found.includes(signal) && found.length < 20) {
        found.push(signal);
      }
    };

    const iframeInfo: Array<{ src: string; title: string; nth: number }> = [];
    const allIframes = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    for (let i = 0; i < allIframes.length; i++) {
      const iframe = allIframes[i];
      const haystack = `${iframe.src} ${iframe.title}`.toLowerCase();
      if (/(captcha|recaptcha|hcaptcha|turnstile)/.test(haystack)) {
        add("iframe:captcha");
        if (collectIframeData) {
          iframeInfo.push({ src: iframe.src, title: iframe.title, nth: i });
        }
      }
    }

    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("input"))) {
      const haystack = `${input.name} ${input.id} ${input.type}`.toLowerCase();
      if (/(captcha|challenge|token)/.test(haystack)) {
        add("input:challenge");
      }
    }

    const visibleText = (document.body?.innerText ?? "").toLowerCase();
    if (/verify (that )?you are human|checking your browser|human verification|security check/.test(visibleText)) {
      add("visibleText:human-verification");
    }

    const title = document.title.toLowerCase();
    if (/just a moment|attention required|security check|captcha/.test(title)) {
      add("title:challenge");
    }

    if (/cloudflare|cf-challenge|turnstile/.test(document.documentElement.innerHTML.toLowerCase())) {
      add("markup:challenge-provider");
    }

    return { signals: found, iframeData: collectIframeData ? iframeInfo : undefined };
  }, attemptMode).catch(() => ({ signals: [] as string[], iframeData: undefined as Array<{ src: string; title: string; nth: number }> | undefined }));

  if (response?.status() === 403 || response?.status() === 429) {
    signals.push(`status:${response.status()}`);
  }

  const uniqueSignals = Array.from(new Set(signals)).slice(0, 20);
  const captchaDetected = uniqueSignals.length > 0;

  if (!captchaDetected) {
    return { captchaDetected: false, challengeSignals: [] };
  }

  const base: CaptchaDetection = {
    captchaDetected: true,
    challengeSignals: uniqueSignals,
    challengeHandling: CAPTCHA_AUTONOMOUS ? "llm_assisted" : "manual",
    challengeType: "captcha_or_bot_check",
    message: CAPTCHA_AUTONOMOUS
      ? "A human verification challenge appears to be present. Autonomous challenge handling is enabled; use the returned challenge context to decide the next browser actions."
      : "A human verification challenge appears to be present. Complete it manually, then resume the session.",
  };

  if (!attemptMode) return base;

  const captchaIframes: CaptchaIframeInfo[] = [];
  const interactiveElements: CaptchaElementInfo[] = [];
  let provider: CaptchaProvider = "generic";

  for (const { src, title, nth } of (iframeData ?? []).slice(0, 3)) {
    const classified = classifyCaptchaProvider(src);
    const selector = classified?.selector ?? `iframe:nth-of-type(${nth + 1})`;
    if (classified) provider = classified.provider;

    captchaIframes.push({
      selector,
      src: truncateString(redactUrl(src), 500).value,
      title: title ? truncateString(title, 200).value : undefined,
    });

    // Best-effort metadata for caller-guided challenge completion.
    try {
      const frameLoc = page.frameLocator(selector);
      const elementTypes: Array<{ loc: ReturnType<typeof frameLoc.locator>; elType: CaptchaElementInfo["type"]; baseSelector: string }> = [
        { loc: frameLoc.locator('input[type="checkbox"], [role="checkbox"]'), elType: "checkbox", baseSelector: "input[type='checkbox'], [role='checkbox']" },
        { loc: frameLoc.locator("button, [role='button'], input[type='submit']"), elType: "button", baseSelector: "button, [role='button']" },
        { loc: frameLoc.locator("input[type='text'], input:not([type]), textarea"), elType: "input", baseSelector: "input[type='text'], textarea" },
      ];

      for (const { loc, elType, baseSelector } of elementTypes) {
        const count = Math.min(await loc.count(), 5);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          const label = await el.getAttribute("aria-label").catch(() => undefined)
            ?? await el.getAttribute("title").catch(() => undefined)
            ?? await el.getAttribute("name").catch(() => undefined);
          interactiveElements.push({
            selector: count === 1 ? baseSelector : `${baseSelector} >> nth=${i}`,
            frame: selector,
            type: elType,
            label: label || undefined,
          });
        }
      }
    } catch {
      // Cross-origin or frame not ready, skip
    }
  }

  if (provider === "generic" && uniqueSignals.includes("markup:challenge-provider")) {
    provider = "cloudflare";
  }
  if (provider === "generic" && uniqueSignals.some((signal) => signal.startsWith("input:"))) {
    provider = "text_captcha";
  }

  return {
    ...base,
    challengeProvider: provider,
    captchaIframes: captchaIframes.length > 0 ? captchaIframes : undefined,
    interactiveElements: interactiveElements.length > 0 ? interactiveElements : undefined,
    suggestedStrategy: CAPTCHA_AUTONOMOUS
      ? CAPTCHA_AUTONOMOUS_STRATEGY
      : CAPTCHA_STRATEGIES[provider],
    challengePlaybook: CAPTCHA_AUTONOMOUS ? CAPTCHA_LLM_PLAYBOOKS[provider] : undefined,
  };
}

export function applyCaptchaPolicy<T extends object>(
  payload: T,
  detection: CaptchaDetection,
  policy: CaptchaPolicy | undefined,
): T & CaptchaDetection {
  const effectivePolicy = policy ?? "pause";
  if (!detection.captchaDetected || effectivePolicy === "detect") {
    return { ...payload, ...detection };
  }

  if (effectivePolicy === "fail") {
    throw new Error(`Human verification challenge detected: ${detection.challengeSignals.join(", ")}`);
  }

  if (effectivePolicy === "attempt") {
    return {
      ...payload,
      ...detection,
      requiresUserAction: true,
    };
  }

  return {
    ...payload,
    ...detection,
    requiresUserAction: true,
  };
}

export async function maybeDetectCaptcha<T extends object>(
  page: Page,
  response: Response | null,
  payload: T,
  captchaPolicy: CaptchaPolicy | undefined,
  safeUrl: string,
): Promise<{ mergedPayload: T & CaptchaDetection; captchaScreenshot?: ScreenshotResult }> {
  if (!captchaPolicy) {
    return { mergedPayload: payload as T & CaptchaDetection };
  }
  const attemptMode = captchaPolicy === "attempt";
  const detection = await detectChallenge(page, response, attemptMode);
  const mergedPayload = applyCaptchaPolicy(payload, detection, captchaPolicy);
  const captchaScreenshot = attemptMode && detection.captchaDetected
    ? await captureCaptchaScreenshot(page, safeUrl)
    : undefined;
  return { mergedPayload, captchaScreenshot };
}
