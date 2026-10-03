#!/usr/bin/env node
// Select tagged, checksummed builds, never the updater's ambiguous release listing.
import { createHash } from "node:crypto";
import { accessSync, constants, createReadStream, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import builds from "../browser-builds.json" with { type: "json" };

const compatibility = process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY === "1";
export const selectedBuild = compatibility ? builds.compatibility : builds.default;
const pinnedFull = `${selectedBuild.version}-${selectedBuild.release}`;
const defaultCache = process.platform === "darwin" ? join(homedir(), "Library", "Caches", "camoufox")
  : process.platform === "win32" ? join(homedir(), "AppData", "Local", "camoufox", "camoufox", "Cache")
  : join(homedir(), ".cache", "camoufox");
if (compatibility && !process.env.CAMOUFOX_INSTALL_DIR) {
  process.env.CAMOUFOX_INSTALL_DIR = `${defaultCache}-compatibility`;
}
const { CamoufoxFetcher, INSTALL_DIR, OS_NAME } = await import("camoufox-js/dist/pkgman.js");

export function isBrowserInstalled(dir = INSTALL_DIR, build = selectedBuild) {
  try {
    const metadata = JSON.parse(readFileSync(join(dir, "version.json"), "utf8"));
    if (metadata.version !== build.version || metadata.release !== build.release) return false;
    const binary = OS_NAME === "mac" ? join(dir, "Camoufox.app", "Contents", "MacOS", "camoufox")
      : join(dir, OS_NAME === "win" ? "camoufox.exe" : "camoufox-bin");
    if (!statSync(binary).isFile()) return false;
    accessSync(binary, OS_NAME === "win" ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function verifyArchiveDigest(file, expected) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== expected) throw new Error("Camoufox archive SHA-256 mismatch. Refusing to extract the download.");
}

export async function ensureCompatibilityGeoip({ downloadMmdb, getMmdbPath, loadGeoipConfig, needsUpdate }) {
  const config = loadGeoipConfig();
  const paths = [...new Set(["ipv4", "ipv6"].map((version) => getMmdbPath(version, config)))];
  // Upstream freshness checks inspect only IPv4. A split source can otherwise
  // keep a missing IPv6 database even after the launch error requests a refetch.
  if (paths.some((path) => !existsSync(path)) || await needsUpdate(config)) await downloadMmdb();
  if (paths.some((path) => !existsSync(path))) {
    throw new Error("Compatibility GeoIP download did not install every required address family.");
  }
}

export function assertCompatibilityNode(version = process.versions.node) {
  const [major, minor] = version.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 15)) {
    throw new Error("Browser compatibility requires Node >=22.15. Upgrade Node before fetching compatibility assets.");
  }
}

export async function ensureCompatibilityAssets({ ensureModel, isModelInstalled, DefaultAddons, maybeDownloadAddons, getAddonPath, ...geoip }) {
  await ensureModel();
  if (!isModelInstalled()) throw new Error("Compatibility fingerprint model installation is incomplete. Rerun the compatibility fetch.");
  await maybeDownloadAddons(DefaultAddons);
  // The upstream addon downloader swallows failures. Verify its result before
  // reporting success, since the runtime refuses launches without this asset.
  for (const addon of Object.keys(DefaultAddons)) {
    if (!existsSync(join(getAddonPath(addon), "manifest.json"))) {
      throw new Error(`Compatibility ${addon} addon installation failed. Rerun the compatibility fetch.`);
    }
  }
  await ensureCompatibilityGeoip(geoip);
}

async function loadCompatibilityAssets() {
  try {
    import.meta.resolve("@camoufox/camoufox");
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error("Compatibility launcher is not installed. Use Node >=22.15, run `npm install --include=optional`, then rerun the compatibility fetch.", { cause: error });
    }
    throw error;
  }
  const [model, addons, geoip] = await Promise.all([
    import("@camoufox/camoufox/dist/fpgen/index.js"),
    import("@camoufox/camoufox/dist/addons.js"),
    import("@camoufox/camoufox/dist/geolocation.js"),
  ]);
  return { ...model, ...addons, ...geoip };
}

export class PinnedFetcher extends CamoufoxFetcher {
  async fetchLatest() {
    if (this._version_obj) return;
    if (!selectedBuild.sha256[`${OS_NAME}.${this.arch}`]) {
      throw new Error(`No verified Camoufox ${pinnedFull} asset for ${OS_NAME}.${this.arch}.`);
    }
    const asset = `camoufox-${pinnedFull}-${OS_NAME}.${this.arch}.zip`;
    this._version_obj = { release: selectedBuild.release, version: selectedBuild.version, fullString: pinnedFull };
    this._url = `https://github.com/daijro/camoufox/releases/download/v${pinnedFull}/${asset}`;
  }
  async extractZip(file) {
    await verifyArchiveDigest(file, selectedBuild.sha256[`${OS_NAME}.${this.arch}`]);
    await super.extractZip(file);
  }
}

export async function main() {
  const skipDownload = process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD;
  if (skipDownload && skipDownload !== "0" && skipDownload !== "false") {
    console.log("Skipping browser download because PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set.");
    return;
  }
  let compatibilityAssets;
  if (compatibility) {
    assertCompatibilityNode();
    compatibilityAssets = await loadCompatibilityAssets();
  }
  const updater = new PinnedFetcher();
  if (isBrowserInstalled()) {
    console.log(`Camoufox ${pinnedFull} is installed at ${INSTALL_DIR}.`);
  } else {
    console.log(`Installing verified Camoufox ${pinnedFull} at ${INSTALL_DIR}.`);
    await updater.install();
  }
  if (compatibility) {
    await ensureCompatibilityAssets(compatibilityAssets);
    console.log("Compatibility assets ready. This mode disables world isolation and reduces stealth.");
  } else {
    const { downloadMMDB, ALLOW_GEOIP } = await import("camoufox-js/dist/locale.js");
    const { DefaultAddons, maybeDownloadAddons } = await import("camoufox-js/dist/addons.js");
    if (ALLOW_GEOIP) await downloadMMDB();
    await maybeDownloadAddons(DefaultAddons);
  }
}

// npm exposes bins through symlinks. Resolve the invoked path so the public
// fetch command runs main(), while imports by deterministic tests stay quiet.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) await main();
