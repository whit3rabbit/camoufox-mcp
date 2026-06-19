import type { Browser } from "playwright-core";
import chalk from "chalk";
import { validateTargetUrl } from "./policy.js";
import { ALLOW_UNSAFE_OPTIONS, DENIED_BROWSER_ARG_FLAGS, DENIED_FIREFOX_PREF_KEYS, DENIED_FIREFOX_PREF_PREFIXES } from "./config.js";
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

export function normalizedArgFlag(arg: string): string | undefined {
  const match = arg.trim().match(/^(-{1,2}[^\s=]+)/);
  return match?.[1]?.toLowerCase();
}

export function findDeniedBrowserArg(args?: string[]): string | undefined {
  for (let index = 0; index < (args?.length ?? 0); index += 1) {
    const flag = normalizedArgFlag(args?.[index] ?? "");
    if (!flag) {
      continue;
    }

    if (DENIED_BROWSER_ARG_FLAGS.has(flag)) {
      return flag;
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
