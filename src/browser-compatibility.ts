import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { NewBrowserOptions } from "@camoufox/camoufox";
import type { Browser } from "playwright-core";
import type { CamoufoxOptions, ProxyConfig } from "./types.js";

const FETCH_COMMAND = "CAMOUFOX_MCP_BROWSER_COMPATIBILITY=1 npm run fetch:camoufox";

export function assertCompatibilityLauncherAvailable(
  resolve: (specifier: string) => string = createRequire(import.meta.url).resolve,
): void {
  try {
    resolve("@camoufox/camoufox");
  } catch (error) {
    // Resolve only the optional package entry before importing it. A missing
    // transitive dependency or native-library failure must keep its own error.
    if (error instanceof Error && "code" in error && error.code === "MODULE_NOT_FOUND") {
      throw new Error("Compatibility launcher is not installed. Use Node >=22.15 and reinstall with optional dependencies enabled (`npm install --include=optional`), then run: " + FETCH_COMMAND, { cause: error });
    }
    throw error;
  }
}

function normalizeProxy(proxy?: ProxyConfig): NewBrowserOptions["proxy"] {
  if (!proxy) return undefined;
  const source = typeof proxy === "string" ? { server: proxy } : proxy;
  const url = new URL(source.server);
  return {
    server: `${url.protocol}//${url.host}`,
    username: source.username ?? (url.username ? decodeURIComponent(url.username) : undefined),
    password: source.password ?? (url.password ? decodeURIComponent(url.password) : undefined),
  };
}

export function buildProxyLookupUrl(proxy?: NewBrowserOptions["proxy"]): string | undefined {
  if (!proxy) return undefined;
  const url = new URL(proxy.server);
  // Playwright needs decoded credentials, but the GeoIP client needs a URL.
  // Upstream concatenates them without escaping, so '/' or '@' breaks lookup.
  url.username = proxy.username ?? "";
  url.password = proxy.password ?? "";
  return url.href;
}

export function assertCompatibilityGeoipDatabase(
  ip: string,
  pathForVersion: (version: "ipv4" | "ipv6") => string,
): void {
  const ipVersion = ip.includes(":") ? "ipv6" : "ipv4";
  if (!existsSync(pathForVersion(ipVersion))) {
    throw new Error(`Compatibility ${ipVersion} GeoIP database is missing. Run: ${FETCH_COMMAND}`);
  }
}

export function buildCompatibilityOptions(
  options: CamoufoxOptions,
  executablePath: string,
  ffVersion: number,
): NewBrowserOptions {
  if (!Number.isInteger(ffVersion) || ffVersion < 1) {
    throw new Error("Browser compatibility requires the selected Firefox major version.");
  }

  // The launcher merges env last. Old config chunks could silently re-enable
  // isolation and disable the WebSocket policy even after requesting compatibility.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    value !== undefined
    && !/^CAMOU_(?:CONFIG|PREFS)(?:_|$)/.test(key),
  )) as Record<string, string>;

  return {
    os: options.os,
    headless: options.headless,
    humanize: options.humanize,
    geoip: options.geoip,
    block_webgl: options.block_webgl,
    block_images: options.block_images,
    block_webrtc: options.block_webrtc,
    disable_coop: options.disable_coop,
    locale: options.locale,
    proxy: normalizeProxy(options.proxy),
    enable_cache: options.enable_cache,
    firefox_user_prefs: options.firefox_user_prefs ? { ...options.firefox_user_prefs } : undefined,
    exclude_addons: options.exclude_addons?.map((addon) => {
      if (addon.toLowerCase() === "ublock_origin" || addon.toUpperCase() === "UBO") return "UBO";
      throw new Error("Unsupported default addon exclusion. Use UBO or ublock_origin.");
    }),
    window: options.window ? [...options.window] : undefined,
    args: options.args ? [...options.args] : undefined,
    // Explicit versions avoid the macOS application.ini lookup falling back to
    // an unrelated active build. UBO is included by the official launcher itself.
    executable_path: executablePath,
    ff_version: ffVersion,
    config: { disableWorldIsolation: true },
    env,
  };
}

export async function launchCompatibilityBrowser(
  options: CamoufoxOptions,
  executablePath: string,
  ffVersion: number,
): Promise<Browser> {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 15)) throw new Error("Browser compatibility requires Node >=22.15.");
  const mappedOptions = buildCompatibilityOptions(options, executablePath, ffVersion);
  assertCompatibilityLauncherAvailable();
  const [{ Camoufox }, { isModelInstalled }, { getAddonPath }] = await Promise.all([
    import("@camoufox/camoufox"),
    import("@camoufox/camoufox/dist/fpgen/model.js"),
    import("@camoufox/camoufox/dist/addons.js"),
  ]);

  // Upstream downloads report progress on stdout, which would corrupt MCP stdio.
  // Fetch all launch assets explicitly before allowing a compatibility launch.
  if (!isModelInstalled()) {
    throw new Error(`Compatibility fingerprint model is missing. Run: ${FETCH_COMMAND}`);
  }
  if (!mappedOptions.exclude_addons?.includes("UBO") && !existsSync(join(getAddonPath("UBO"), "manifest.json"))) {
    throw new Error(`Compatibility uBlock Origin addon is missing. Run: ${FETCH_COMMAND}`);
  }
  if (options.geoip) {
    const [{ getMmdbPath, loadGeoipConfig, needsUpdate }, { publicIP }] = await Promise.all([
      import("@camoufox/camoufox/dist/geolocation.js"),
      import("@camoufox/camoufox/dist/ip.js"),
    ]);
    const geoipConfig = loadGeoipConfig();
    if (await needsUpdate(geoipConfig)) {
      throw new Error(`Compatibility GeoIP database is missing or needs refresh. Run: ${FETCH_COMMAND}`);
    }
    const exitIp = await publicIP(buildProxyLookupUrl(mappedOptions.proxy));
    assertCompatibilityGeoipDatabase(exitIp, (version) => getMmdbPath(version, geoipConfig));
    // Passing the resolved address also avoids a second proxy URL conversion
    // inside the launcher, and checks the actual address family's database.
    mappedOptions.geoip = exitIp;
  }

  return Camoufox(mappedOptions);
}
