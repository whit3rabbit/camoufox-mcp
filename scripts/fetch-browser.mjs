#!/usr/bin/env node
// Installs the Camoufox browser binary pinned to the verified release.
//
// Why not `camoufox-js fetch`: its updater picks the FIRST non-prerelease
// GitHub release carrying a matching `camoufox-<version>-<release>-<os>.<arch>.zip`
// asset. Since 2026-09-24 that is the `font-bundle-v1` build-input release,
// which also carries full browser zips labeled 152.0.4-beta.31 (its own notes
// say "Build input, not a browser download. Nothing here is meant to be
// installed."). beta.31 is not a tagged release and it breaks the
// context.routeWebSocket() interception behind this server's private-WebSocket
// SSRF guard: the "Reject Private WebSocket" suite case fails deterministically
// on playwright-core 1.59.0 AND 1.63.0. So asset selection is pinned here and
// the doctor (scripts/doctor.mjs EXPECTED) asserts the installed build matches.
// Bump the constants only together with a full `npm run test:all` pass and the
// AGENTS.md "Dependency & Browser Pinning" section.

import { CamoufoxFetcher, OS_NAME, installedVerStr } from "camoufox-js/dist/pkgman.js";
import { downloadMMDB, ALLOW_GEOIP } from "camoufox-js/dist/locale.js";
import { DefaultAddons, maybeDownloadAddons } from "camoufox-js/dist/addons.js";
import { getAsBooleanFromENV } from "camoufox-js/dist/utils.js";

const PINNED_VERSION = "152.0.4";
const PINNED_RELEASE = "beta.28";
const PINNED_FULL = `${PINNED_VERSION}-${PINNED_RELEASE}`;

class PinnedFetcher extends CamoufoxFetcher {
  // Skip the release listing entirely: resolve the pinned asset URL directly.
  async fetchLatest() {
    if (this._version_obj) return;
    const asset = `camoufox-${PINNED_FULL}-${OS_NAME}.${this.arch}.zip`;
    this._version_obj = {
      release: PINNED_RELEASE,
      version: PINNED_VERSION,
      fullString: PINNED_FULL,
    };
    this._url = `https://github.com/daijro/camoufox/releases/download/v${PINNED_FULL}/${asset}`;
  }
}

if (getAsBooleanFromENV("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", false)) {
  console.log("Skipping browser download / update check due to PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD set!");
  process.exit(0);
}

const updater = new PinnedFetcher();
let installed = null;
try {
  installed = installedVerStr();
} catch {
  installed = null;
}

if (installed === PINNED_FULL) {
  console.log(`Camoufox binaries up to date! Current version: v${installed}`);
} else {
  if (installed) {
    console.log(`Updating Camoufox binaries from v${installed} => v${PINNED_FULL}`);
  } else {
    console.log("Fetching Camoufox binaries...");
  }
  await updater.install();
}

if (ALLOW_GEOIP) {
  await downloadMMDB();
}
await maybeDownloadAddons(DefaultAddons);
