import { readFileSync } from "node:fs";
import { join } from "node:path";
import { INSTALL_DIR } from "camoufox-js/dist/pkgman.js";

interface BrowserBuild {
  version: string;
  release: string;
  launcher: string;
  launcherVersion: string;
}

const builds = JSON.parse(readFileSync(new URL("../browser-builds.json", import.meta.url), "utf8")) as {
  default: BrowserBuild;
  compatibility: BrowserBuild;
};

export const BROWSER_COMPATIBILITY = process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY === "1";
export const EXPECTED_BROWSER_BUILD = BROWSER_COMPATIBILITY ? builds.compatibility : builds.default;
export const EXPECTED_BROWSER_VERSION = `${EXPECTED_BROWSER_BUILD.version}-${EXPECTED_BROWSER_BUILD.release}`;
// A separate default cache keeps opting in from replacing the verified browser.
export const BROWSER_INSTALL_DIR = BROWSER_COMPATIBILITY && !process.env.CAMOUFOX_INSTALL_DIR
  ? `${INSTALL_DIR}-compatibility`
  : String(INSTALL_DIR);

export function readInstalledBrowserVersion(): string | undefined {
  try {
    const data = JSON.parse(readFileSync(join(BROWSER_INSTALL_DIR, "version.json"), "utf8"));
    if (typeof data.version !== "string" || typeof data.release !== "string") return undefined;
    return `${data.version}-${data.release}`;
  } catch {
    return undefined;
  }
}

export function buildBrowserCompatibilityStatus() {
  return {
    mode: BROWSER_COMPATIBILITY ? "compatibility" as const : "default" as const,
    expectedVersion: EXPECTED_BROWSER_VERSION,
    installedVersion: readInstalledBrowserVersion(),
    launcher: EXPECTED_BROWSER_BUILD.launcher,
    // beta.28 predates isolated page worlds; beta.33 explicitly disables them here.
    worldIsolationEnabled: false,
    warning: BROWSER_COMPATIBILITY
      ? "World isolation is disabled to restore WebSocket interception. Websites can detect automation bindings."
      : undefined,
  };
}
