import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { OS_NAME } from "camoufox-js/dist/pkgman.js";
import { BROWSER_INSTALL_DIR, EXPECTED_BROWSER_VERSION } from "./browser-build.js";
import { SERVER_VERSION } from "./config.js";

const FETCH_GUIDANCE = `Run the pinned fetch command with the same environment as the server: \`npm run fetch:camoufox\` (repo checkout), \`camoufox-mcp-fetch\` (global install), or \`npm exec --yes --package=camoufox-mcp-server@${SERVER_VERSION} -- camoufox-mcp-fetch\` (npx/package install).`;

export const MISSING_BROWSER_MESSAGE =
  `Camoufox browser binary not installed or incomplete. ${FETCH_GUIDANCE} Then retry. Do NOT use \`npx camoufox-js fetch\`: it can install a build that breaks this server's private-WebSocket SSRF guard.`;

class BrowserBuildMismatchError extends Error {}

export function probeBrowserBinary(): string {
  const installDir = BROWSER_INSTALL_DIR;
  const version: unknown = JSON.parse(readFileSync(join(installDir, "version.json"), "utf8"));
  if (!version || typeof version !== "object" ||
    !("version" in version) || typeof version.version !== "string" || !/^\d+(?:\.\d+)+$/.test(version.version) ||
    !("release" in version) || typeof version.release !== "string" || !version.release) {
    throw new Error("Invalid Camoufox version metadata.");
  }

  // A newer isolated build can silently bypass routeWebSocket. Reject drift before launch.
  if (`${version.version}-${version.release}` !== EXPECTED_BROWSER_VERSION) {
    throw new BrowserBuildMismatchError(`Camoufox build ${version.version}-${version.release} does not match required ${EXPECTED_BROWSER_VERSION}. ${FETCH_GUIDANCE}`);
  }
  const executablePath = OS_NAME === "mac"
    ? join(installDir, "Camoufox.app", "Contents", "MacOS", "camoufox")
    : join(installDir, OS_NAME === "win" ? "camoufox.exe" : "camoufox-bin");
  if (!statSync(executablePath).isFile()) {
    throw new Error("Camoufox executable is not a file.");
  }
  accessSync(executablePath, OS_NAME === "win" ? constants.F_OK : constants.X_OK);
  return executablePath;
}

export function assertBrowserBinaryAvailable(probe: () => unknown = probeBrowserBinary): void {
  try {
    probe();
  } catch (error) {
    if (error instanceof BrowserBuildMismatchError) throw error;
    throw new Error(MISSING_BROWSER_MESSAGE, { cause: error });
  }
}
