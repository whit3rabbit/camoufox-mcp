import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertCompatibilityNode, assertDefaultAddonsInstalled, ensureCompatibilityAssets, ensureCompatibilityGeoip, isBrowserInstalled, PinnedFetcher, selectedBuild, verifyArchiveDigest } from "../scripts/fetch-browser.mjs";
import { OS_NAME } from "camoufox-js/dist/pkgman.js";

const dir = mkdtempSync(join(tmpdir(), "camoufox-fetch-test-"));
try {
  writeFileSync(join(dir, "version.json"), JSON.stringify(selectedBuild));
  assert.equal(isBrowserInstalled(dir), false, "metadata alone must not prevent repair");
  const binary = OS_NAME === "mac" ? join(dir, "Camoufox.app", "Contents", "MacOS", "camoufox")
    : join(dir, OS_NAME === "win" ? "camoufox.exe" : "camoufox-bin");
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, "fixture");
  chmodSync(binary, 0o755);
  assert.equal(isBrowserInstalled(dir), true);
  assert.equal(isBrowserInstalled(dir, { version: "999.0", release: "beta.1" }), false);

  const archive = join(dir, "archive.zip");
  writeFileSync(archive, "corrupt download");
  await assert.rejects(verifyArchiveDigest(archive, "0".repeat(64)), /SHA-256 mismatch/);
  await verifyArchiveDigest(archive, createHash("sha256").update("corrupt download").digest("hex"));
  const fetcher = new PinnedFetcher();
  fetcher.getAsset = () => { throw new Error("Release listing must never be consulted"); };
  await fetcher.fetchLatest();
  assert.equal(fetcher.url, `https://github.com/daijro/camoufox/releases/download/v${selectedBuild.version}-${selectedBuild.release}/camoufox-${selectedBuild.version}-${selectedBuild.release}-${OS_NAME}.${fetcher.arch}.zip`);
  await assert.rejects(fetcher.extractZip(archive), /SHA-256 mismatch/, "checksums must be verified before extraction");

  const splitConfig = { name: "split", urls: { ipv4: "fixture", ipv6: "fixture" } };
  const ipv4 = join(dir, "split-ipv4.mmdb");
  const ipv6 = join(dir, "split-ipv6.mmdb");
  writeFileSync(ipv4, "fresh IPv4 database");
  let downloads = 0;
  let stale = false;
  const splitGeoip = {
    loadGeoipConfig: () => splitConfig,
    getMmdbPath: (version, config) => {
      assert.equal(config, splitConfig);
      return version === "ipv4" ? ipv4 : ipv6;
    },
    needsUpdate: async () => stale,
    downloadMmdb: async () => {
      downloads += 1;
      writeFileSync(ipv4, "downloaded IPv4 database");
      writeFileSync(ipv6, "downloaded IPv6 database");
    },
  };
  await ensureCompatibilityGeoip(splitGeoip);
  assert.equal(downloads, 1, "fresh IPv4 must not hide a missing IPv6 database");
  await ensureCompatibilityGeoip(splitGeoip);
  assert.equal(downloads, 1, "complete fresh split databases must not be downloaded again");
  stale = true;
  await ensureCompatibilityGeoip(splitGeoip);
  assert.equal(downloads, 2, "stale databases still need refresh");

  const combined = join(dir, "combined.mmdb");
  writeFileSync(combined, "fresh combined database");
  await ensureCompatibilityGeoip({
    loadGeoipConfig: () => ({ name: "combined" }),
    getMmdbPath: () => combined,
    needsUpdate: async () => false,
    downloadMmdb: async () => { throw new Error("A fresh combined database must not be downloaded"); },
  });
  rmSync(ipv6);
  await assert.rejects(ensureCompatibilityGeoip({
    ...splitGeoip,
    downloadMmdb: async () => {},
  }), /every required address family/, "an incomplete repair must not claim assets are ready");

  assert.throws(() => assertCompatibilityNode("22.14.0"), /Node >=22.15/);
  assertCompatibilityNode("22.15.0");
  assertCompatibilityNode("24.0.0");
  const addonDir = join(dir, "UBO");
  const requestedAddons = [];
  const assets = {
    ...splitGeoip,
    ensureModel: async () => {},
    isModelInstalled: () => true,
    DefaultAddons: { UBO: "fixture" },
    executablePath: "/fixture/camoufox-bin",
    getAddonPath: (name, executablePath) => { requestedAddons.push([name, executablePath]); return addonDir; },
  };
  // The launcher bundles its addons with the browser and launches without one
  // that is missing. The fetch must not report success in that state.
  await assert.rejects(ensureCompatibilityAssets(assets), /UBO addon is missing from the browser install/);
  assert.deepEqual(requestedAddons[0], ["UBO", "/fixture/camoufox-bin"], "addons are located beside the pinned executable");
  await assert.rejects(ensureCompatibilityAssets({
    ...assets,
    isModelInstalled: () => false,
  }), /fingerprint model installation is incomplete/);
  mkdirSync(addonDir);
  await assert.rejects(ensureCompatibilityAssets(assets), /UBO addon is missing/, "an addon directory without a manifest is not installed");
  writeFileSync(join(addonDir, "manifest.json"), "{}");
  await ensureCompatibilityAssets(assets);

  // Default mode: the upstream downloader swallows a failed addon download, so
  // the fetch checks the result before reporting success.
  const defaultDir = join(dir, "default-cache");
  const defaultResources = OS_NAME === "mac" ? join(defaultDir, "Camoufox.app", "Contents", "Resources") : defaultDir;
  mkdirSync(join(defaultResources, "addons", "UBO"), { recursive: true });
  assert.throws(() => assertDefaultAddonsInstalled(["UBO"], defaultDir), /UBO addon installation failed.*rerun the fetch/);
  writeFileSync(join(defaultResources, "addons", "UBO", "manifest.json"), "{}");
  assert.doesNotThrow(() => assertDefaultAddonsInstalled(["UBO"], defaultDir));
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log("browser fetch unit tests passed");
