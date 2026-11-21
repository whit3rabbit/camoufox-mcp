import type { Browser } from "playwright-core";
import chalk from "chalk";
import { validateTargetUrl } from "./policy.js";
import { ALLOW_UNSAFE_OPTIONS, DENIED_BROWSER_ARG_FLAGS, DENIED_FIREFOX_PREF_KEYS, DENIED_FIREFOX_PREF_PREFIXES, VALUED_BROWSER_ARG_FLAGS } from "./config.js";
import type { BrowserLaunchInput, CamoufoxOptions, CommonBrowserInput, HeadlessMode, ProxyConfig, SupportedOs } from "./types.js";
import { describeError, getProxyServer } from "./utils.js";

export async function validateProxyConfig(proxy?: ProxyConfig): Promise<void> {
  const server = getProxyServer(proxy);
  if (!server) {
    return;
  }

  try {
    await validateTargetUrl(server);
  } catch (error) {
    throw new Error(`Proxy server is not allowed. ${describeError(error)}`, { cause: error });
  }
}

export async function validateBrowserOptionsInput(input: BrowserLaunchInput): Promise<void> {
  await validateProxyConfig(input.proxy);

  if (!ALLOW_UNSAFE_OPTIONS && hasUnsafeBrowserOptions(input.args, input.firefox_user_prefs, input.exclude_addons)) {
    const requestedOptions = [
      input.args?.length ? "args" : undefined,
      Object.keys(input.firefox_user_prefs ?? {}).length > 0 ? "firefox_user_prefs" : undefined,
      input.exclude_addons?.length ? "exclude_addons" : undefined,
    ].filter((option): option is string => option !== undefined);
    console.error(chalk.yellow(
      `[Camoufox] Unsafe browser option warning: ${requestedOptions.join(", ")} requires CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1.`,
    ));
    throw new Error(
      "Unsafe browser options are disabled by server policy. Set CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 to allow args, firefox_user_prefs, or exclude_addons.",
    );
  }

  // WebRTC connects to ICE/TURN servers the page chooses, over transports the
  // request guard never sees, so re-enabling it is an unsafe option as well.
  if (!ALLOW_UNSAFE_OPTIONS && input.block_webrtc === false) {
    throw new Error(
      "block_webrtc: false is disabled by server policy. WebRTC bypasses the request guard. Set CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 to allow it.",
    );
  }

  const deniedUnsafeOption = findDeniedUnsafeBrowserOption(input.args, input.firefox_user_prefs);
  if (deniedUnsafeOption) {
    throw new Error(`Unsafe browser option is denied by server policy: ${deniedUnsafeOption}.`);
  }
}

export function hasUnsafeBrowserOptions(
  args?: string[],
  firefoxUserPrefs?: Record<string, unknown>,
  excludeAddons?: string[],
): boolean {
  return Boolean(
    (args?.length ?? 0) > 0
    || Object.keys(firefoxUserPrefs ?? {}).length > 0
    || (excludeAddons?.length ?? 0) > 0,
  );
}

interface ParsedBrowserArg {
  // Flag as written, lower-cased, without any inline value.
  flag: string;
  // Flag name without leading dashes.
  name: string;
  value?: string;
}

export function parseBrowserArg(arg: string): ParsedBrowserArg | undefined {
  const match = arg.trim().match(/^(-{1,2})([^\s=-][^\s=]*)(?:=([\s\S]*))?$/);
  if (!match) {
    return undefined;
  }

  const name = match[2].toLowerCase();
  return { flag: `${match[1]}${name}`, name, value: match[3] };
}

export function normalizedArgFlag(arg: string): string | undefined {
  return parseBrowserArg(arg)?.flag;
}

function isAllowedBrowserArgValue(value: string): boolean {
  return /^[\w.-]{1,64}$/.test(value);
}

function describeArg(arg: string): string {
  const trimmed = arg.trim();
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
}

export function findDeniedBrowserArg(args?: string[]): string | undefined {
  // Set when the previous flag takes its value as the next argument.
  let valueExpected = false;

  for (const arg of args ?? []) {
    const parsed = parseBrowserArg(arg);
    if (!parsed) {
      // Firefox opens leftover non-flag arguments as startup URLs, which load
      // outside the per-context request guard.
      if (valueExpected && isAllowedBrowserArgValue(arg.trim())) {
        valueExpected = false;
        continue;
      }
      return `positional argument "${describeArg(arg)}"`;
    }

    valueExpected = false;
    if (DENIED_BROWSER_ARG_FLAGS.has(parsed.name)) {
      return parsed.flag;
    }

    if (parsed.value !== undefined) {
      // Firefox splits "-flag=value" into two arguments, so a value on a flag
      // it does not consume is opened as a URL too.
      if (!VALUED_BROWSER_ARG_FLAGS.has(parsed.name) || !isAllowedBrowserArgValue(parsed.value)) {
        return `${parsed.flag} with a value`;
      }
    } else if (VALUED_BROWSER_ARG_FLAGS.has(parsed.name)) {
      valueExpected = true;
    }
  }

  return undefined;
}

export function findDeniedFirefoxPref(firefoxUserPrefs?: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(firefoxUserPrefs ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (
      DENIED_FIREFOX_PREF_KEYS.has(normalizedKey)
      || DENIED_FIREFOX_PREF_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      return key;
    }
  }

  return undefined;
}

export function findDeniedUnsafeBrowserOption(
  args?: string[],
  firefoxUserPrefs?: Record<string, unknown>,
): string | undefined {
  const deniedArg = findDeniedBrowserArg(args);
  if (deniedArg) {
    return `args contains ${deniedArg}`;
  }

  const deniedPref = findDeniedFirefoxPref(firefoxUserPrefs);
  if (deniedPref) {
    return `firefox_user_prefs contains ${deniedPref}`;
  }

  return undefined;
}

export async function validateCommonBrowserInput(input: CommonBrowserInput): Promise<URL> {
  const targetUrl = await validateTargetUrl(input.url);
  await validateBrowserOptionsInput(input);
  return targetUrl;
}

export function buildCamoufoxOptions(input: BrowserLaunchInput, selectedOS: SupportedOs, headlessMode: HeadlessMode): CamoufoxOptions {
  return {
    os: [selectedOS],
    headless: headlessMode,
    humanize: input.humanize,
    geoip: input.geoip,
    ublock: true,
    block_webgl: input.block_webgl,
    block_images: input.block_images,
    block_webrtc: input.block_webrtc,
    disable_coop: input.disable_coop,
    locale: input.locale,
    viewport: input.viewport ? {
      width: input.viewport.width,
      height: input.viewport.height,
    } : undefined,
    proxy: input.proxy,
    enable_cache: input.enable_cache,
    firefox_user_prefs: input.firefox_user_prefs,
    exclude_addons: input.exclude_addons,
    window: input.window,
    args: input.args,
  };
}

export function browserContextOptions(input: BrowserLaunchInput): Parameters<Browser["newContext"]>[0] {
  return {
    serviceWorkers: "block",
    viewport: input.viewport ? {
      width: input.viewport.width,
      height: input.viewport.height,
    } : undefined,
  };
}
