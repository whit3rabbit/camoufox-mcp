import { DEFAULT_STEALTH_PROFILE, MAX_DIAGNOSTIC_TEXT_CHARS, SUPPORTED_OSES } from "./config.js";
import type { BrowserLaunchInput, ProxyConfig, StealthProfile, SupportedOs } from "./types.js";

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = url.search ? "?..." : "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

export function getProxyServer(proxy?: ProxyConfig): string | undefined {
  if (!proxy) {
    return undefined;
  }

  return typeof proxy === "string" ? proxy : proxy.server;
}

export function getProxySecrets(proxy?: ProxyConfig): string[] {
  if (!proxy || typeof proxy === "string") {
    return [];
  }

  return [proxy.username, proxy.password].filter((secret): secret is string => Boolean(secret));
}

export function sanitizeErrorMessage(message: string, rawUrls: string[], secrets: string[] = []): string {
  let sanitized = message;

  for (const secret of secrets) {
    sanitized = sanitized.replaceAll(secret, "<redacted>");
  }

  for (const rawUrl of rawUrls) {
    sanitized = sanitized.replaceAll(rawUrl, redactUrl(rawUrl));
  }

  return sanitized.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (matchedUrl) => {
    let suffix = "";
    let candidate = matchedUrl;
    while (candidate.length > 0 && /[),.;\]]$/.test(candidate)) {
      suffix = `${candidate[candidate.length - 1]}${suffix}`;
      candidate = candidate.slice(0, -1);
    }

    return `${redactUrl(candidate)}${suffix}`;
  });
}

export function truncateString(value: string, maxChars: number): { value: string; truncated: boolean } {
  return {
    value: value.slice(0, maxChars),
    truncated: value.length > maxChars,
  };
}

export function sanitizeDiagnosticText(value: string, rawUrls: string[], secrets: string[]): string {
  return truncateString(sanitizeErrorMessage(value, rawUrls, secrets), MAX_DIAGNOSTIC_TEXT_CHARS).value;
}

export function serializeBounded(value: unknown, maxChars: number, rawUrls: string[], secrets: string[]): { value: string; truncated: boolean } {
  let serialized: string;
  try {
    const json = JSON.stringify(value);
    serialized = json === undefined ? "undefined" : json;
  } catch {
    serialized = String(value);
  }

  return truncateString(sanitizeErrorMessage(serialized, rawUrls, secrets), maxChars);
}

export function selectOperatingSystem(os: SupportedOs | undefined): SupportedOs {
  if (os) {
    return os;
  }

  return SUPPORTED_OSES[Math.floor(Math.random() * SUPPORTED_OSES.length)];
}

export function defaultHeadlessMode(headless: boolean | "virtual" | undefined): boolean | "virtual" {
  if (headless !== undefined) {
    return headless;
  }

  return process.platform === "linux" ? "virtual" : true;
}

export function applyStealthProfile<T extends BrowserLaunchInput>(input: T): T {
  const profile = input.stealthProfile ?? DEFAULT_STEALTH_PROFILE;
  const defaults: BrowserLaunchInput = {
    humanize: true,
    geoip: true,
    block_webrtc: true,
    block_images: false,
    block_webgl: false,
    disable_coop: false,
    enable_cache: false,
    includeConsole: false,
    includeNetwork: false,
  };

  const profileDefaults: Record<StealthProfile, BrowserLaunchInput> = {
    normal: {},
    privacy: {
      block_webgl: true,
    },
    human_assisted: {
      headless: false,
      enable_cache: true,
      captchaPolicy: "pause",
    },
    fast: {
      block_images: true,
      humanize: false,
    },
    debug: {
      includeConsole: true,
      includeNetwork: true,
    },
  };

  return {
    ...defaults,
    ...profileDefaults[profile],
    ...input,
    stealthProfile: profile,
  };
}
