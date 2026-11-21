import type { Page, Response } from "playwright-core";
import { CAPTCHA_AUTONOMOUS } from "./config.js";
import type { CaptchaDetection, CaptchaElementInfo, CaptchaIframeInfo, CaptchaPolicy, CaptchaProvider, RequestGuard, ScreenshotResult } from "./types.js";
import { redactUrl, truncateString } from "./utils.js";
import { captureCaptchaScreenshot } from "./screenshots.js";
import { runGuardedPageRead } from "./browser-runtime.js";

// Selectors offered for elements inside a challenge frame. Each string is both
// the locator that is queried and the selector handed back to the caller, so
// "selector >> nth=i" always names the element that was inspected.
const CHALLENGE_ELEMENT_SELECTORS: Array<{ elType: CaptchaElementInfo["type"]; baseSelector: string }> = [
  { elType: "checkbox", baseSelector: "input[type='checkbox'], [role='checkbox']" },
  { elType: "button", baseSelector: "button, [role='button'], input[type='submit']" },
  { elType: "input", baseSelector: "input[type='text'], input:not([type]), textarea" },
];
const CHALLENGE_ATTRIBUTE_TIMEOUT_MS = 1000;

interface ChallengeIframeData {
  src: string;
  title: string;
  // Index among every iframe in document order.
  nth: number;
  // How many iframes the provider selector for this frame matches.
  providerMatches: number;
}

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

// One table drives both the Node-side classification and the in-page count of
// frames each provider selector matches. Patterns are regex sources so the
// table can cross into page.evaluate as plain data.
const CAPTCHA_PROVIDER_FRAMES: Array<{ provider: CaptchaProvider; pattern: string; selector: string }> = [
  { provider: "recaptcha", pattern: "recaptcha", selector: "iframe[src*='recaptcha']" },
  { provider: "hcaptcha", pattern: "hcaptcha", selector: "iframe[src*='hcaptcha']" },
  { provider: "turnstile", pattern: "turnstile|challenges\\.cloudflare", selector: "iframe[src*='turnstile'], iframe[src*='challenges.cloudflare']" },
];

export function classifyCaptchaProvider(src: string): { provider: CaptchaProvider; selector: string } | undefined {
  const match = CAPTCHA_PROVIDER_FRAMES.find(({ pattern }) => new RegExp(pattern).test(src));
  return match ? { provider: match.provider, selector: match.selector } : undefined;
}

export async function detectChallenge(page: Page, response?: Response | null, attemptMode = false): Promise<CaptchaDetection> {
  const { signals, iframeData } = await page.evaluate(({ collectIframeData, providerFrames }: { collectIframeData: boolean; providerFrames: Array<{ pattern: string; selector: string }> }) => {
    const found: string[] = [];
    const add = (signal: string) => {
      if (!found.includes(signal) && found.length < 20) {
        found.push(signal);
      }
    };

    const providerSelector = (src: string): string | undefined =>
      providerFrames.find(({ pattern }) => new RegExp(pattern).test(src))?.selector;

    const iframeInfo: Array<{ src: string; title: string; nth: number; providerMatches: number }> = [];
    const allIframes = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    for (let i = 0; i < allIframes.length; i++) {
      const iframe = allIframes[i];
      const haystack = `${iframe.src} ${iframe.title}`.toLowerCase();
      if (/(captcha|recaptcha|hcaptcha|turnstile)/.test(haystack)) {
        add("iframe:captcha");
        if (collectIframeData) {
          const selector = providerSelector(iframe.src);
          iframeInfo.push({
            src: iframe.src,
            title: iframe.title,
            nth: i,
            providerMatches: selector ? document.querySelectorAll(selector).length : 0,
          });
        }
      }
    }

    // Match challenge response fields by name. A bare "token" or "challenge"
    // also matches every CSRF field, which flagged ordinary login forms.
    for (const input of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea"))) {
      const haystack = `${input.name} ${input.id}`.toLowerCase();
      if (/captcha|turnstile/.test(haystack)) {
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

    // Structural markers of a challenge page. Searching the whole markup for
    // "cloudflare" matched any page that loads a script from its CDN.
    if (document.querySelector(
      "#challenge-form, #challenge-stage, #challenge-running, #cf-challenge-running, .cf-turnstile, "
      + "iframe[src*='challenges.cloudflare.com'], script[src*='challenges.cloudflare.com/turnstile']",
    )) {
      add("markup:challenge-provider");
    }

    return { signals: found, iframeData: collectIframeData ? iframeInfo : undefined };
  }, { collectIframeData: attemptMode, providerFrames: CAPTCHA_PROVIDER_FRAMES.map(({ pattern, selector }) => ({ pattern, selector })) })
    .catch(() => ({ signals: [] as string[], iframeData: undefined as ChallengeIframeData[] | undefined }));

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

  for (const { src, title, nth, providerMatches } of (iframeData ?? []).slice(0, 3)) {
    const classified = classifyCaptchaProvider(src);
    // The provider selector is the readable choice, but it only identifies
    // this frame when nothing else matches it: reCAPTCHA renders an anchor and
    // a challenge frame that both do. Otherwise address the frame by its
    // document-order position (Playwright's "nth" engine; nth-of-type counts
    // siblings, not the document).
    const selector = classified && providerMatches === 1 ? classified.selector : `iframe >> nth=${nth}`;
    if (classified) provider = classified.provider;

    captchaIframes.push({
      selector,
      src: truncateString(redactUrl(src), 500).value,
      title: title ? truncateString(title, 200).value : undefined,
    });

    // Best-effort metadata for caller-guided challenge completion.
    try {
      const frameLoc = page.frameLocator(selector);

      for (const { elType, baseSelector } of CHALLENGE_ELEMENT_SELECTORS) {
        const loc = frameLoc.locator(baseSelector);
        const count = Math.min(await loc.count(), 5);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          const attribute = (name: string) => el.getAttribute(name, { timeout: CHALLENGE_ATTRIBUTE_TIMEOUT_MS }).catch(() => undefined);
          const label = await attribute("aria-label") ?? await attribute("title") ?? await attribute("name");
          interactiveElements.push({
            selector: count === 1 ? baseSelector : `${baseSelector} >> nth=${i}`,
            frame: selector,
            type: elType,
            label: label ? truncateString(label, 200).value : undefined,
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

  // "pause" and "attempt" both surface the detection with requiresUserAction.
  // "attempt" additionally enriches the detection upstream (iframe/interactive
  // hints + bounded screenshot) via detectChallenge/maybeDetectCaptcha.
  return {
    ...payload,
    ...detection,
    requiresUserAction: true,
  };
}

export async function maybeDetectCaptcha<T extends object>(
  page: Page,
  requestGuard: RequestGuard,
  response: Response | null,
  payload: T,
  captchaPolicy: CaptchaPolicy | undefined,
  safeUrl: string,
): Promise<{ mergedPayload: T & CaptchaDetection; captchaScreenshot?: ScreenshotResult }> {
  if (!captchaPolicy) {
    return { mergedPayload: payload as T & CaptchaDetection };
  }
  const attemptMode = captchaPolicy === "attempt";
  // Detection output and the attempt screenshot are page-derived data returned
  // to the caller, so they get the same guard and location checks as any read.
  // Callers return straight after this, so nothing later would catch a
  // navigation to a blocked location that happened in between.
  const { detection, captchaScreenshot } = await runGuardedPageRead(page, requestGuard, async () => {
    const detected = await detectChallenge(page, response, attemptMode);
    return {
      detection: detected,
      captchaScreenshot: attemptMode && detected.captchaDetected
        ? await captureCaptchaScreenshot(page, safeUrl)
        : undefined,
    };
  }, "Challenge detection");
  const mergedPayload = applyCaptchaPolicy(payload, detection, captchaPolicy);
  return { mergedPayload, captchaScreenshot };
}
