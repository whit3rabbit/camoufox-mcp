import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = mkdtempSync(join(tmpdir(), "camoufox-preflight-test-"));
const previousInstallDir = process.env.CAMOUFOX_INSTALL_DIR;
const previousCompatibility = process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY;
delete process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY;
process.env.CAMOUFOX_INSTALL_DIR = join(temporaryRoot, "cache");

try {
  const { MISSING_BROWSER_MESSAGE, assertBrowserBinaryAvailable, probeBrowserBinary } = await import("../dist/browser-preflight.js");
  const { OS_NAME } = await import("camoufox-js/dist/pkgman.js");
  const executablePath = OS_NAME === "mac"
    ? join(process.env.CAMOUFOX_INSTALL_DIR, "Camoufox.app", "Contents", "MacOS", "camoufox")
    : join(process.env.CAMOUFOX_INSTALL_DIR, OS_NAME === "win" ? "camoufox.exe" : "camoufox-bin");
  const metadataPath = join(process.env.CAMOUFOX_INSTALL_DIR, "version.json");

  assert.throws(
    () => assertBrowserBinaryAvailable(() => { throw new Error("Missing executable"); }),
    (error) => {
      assert.match(error.message, /npm run fetch:camoufox/, "error should name the pinned fetch command");
      assert.match(error.message, /camoufox-mcp-fetch.*global install/, "global installs need a command on PATH");
      assert.match(error.message, /npm exec --yes --package=camoufox-mcp-server@[^ ]+ -- camoufox-mcp-fetch/, "npx installs need a public command pinned to this server version");
      assert.doesNotMatch(error.message, /node node_modules\//, "npx and global installs do not live under the user's working directory");
      assert.equal(error.message, MISSING_BROWSER_MESSAGE);
      return true;
    },
  );
  assert.doesNotThrow(() => assertBrowserBinaryAvailable(() => "/cache/camoufox/Camoufox"));
  assert.throws(probeBrowserBinary);
  assert.equal(existsSync(process.env.CAMOUFOX_INSTALL_DIR), false, "probing must not create the cache");

  mkdirSync(dirname(executablePath), { recursive: true });
  writeFileSync(metadataPath, JSON.stringify({ version: "152.0.4", release: "beta.28" }));
  assert.throws(probeBrowserBinary, "metadata without an executable is not an installed browser");
  writeFileSync(executablePath, "fixture executable");
  chmodSync(executablePath, 0o755);
  assert.equal(probeBrowserBinary(), executablePath);
  assert.doesNotThrow(() => assertBrowserBinaryAvailable());
  writeFileSync(metadataPath, JSON.stringify({ version: "156.0.1", release: "beta.33" }));
  assert.throws(() => assertBrowserBinaryAvailable(), /does not match required 152\.0\.4-beta\.28/,
    "a new isolated build must not silently disable WebSocket interception in default mode");

  for (const metadata of ["{broken JSON", JSON.stringify({ release: "beta.28" }), JSON.stringify({ version: "152.0.4", release: "alpha.1" })]) {
    writeFileSync(metadataPath, metadata);
    assert.throws(probeBrowserBinary, "corrupt or unsupported metadata must reject the cache");
  }
  writeFileSync(metadataPath, JSON.stringify({ version: "152.0.4", release: "beta.28" }));
  rmSync(executablePath);
  mkdirSync(executablePath);
  assert.throws(probeBrowserBinary, "a directory at the executable path must reject the cache");

  // A fresh process catches the upstream fire-and-forget downloader hidden by launchPath().
  const missingCache = join(temporaryRoot, "fresh-process-missing-cache");
  const freshProcess = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import { existsSync } from "node:fs";
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls++; throw new Error("Network disabled by preflight regression test"); };
    process.on("unhandledRejection", () => {});
    const { MISSING_BROWSER_MESSAGE, assertBrowserBinaryAvailable } = await import(${JSON.stringify(new URL("../dist/browser-preflight.js", import.meta.url).href)});
    const { launchCamoufoxBrowser } = await import(${JSON.stringify(new URL("../dist/browser-runtime.js", import.meta.url).href)});
    const { buildStatusPayload } = await import(${JSON.stringify(new URL("../dist/tool-handlers.js", import.meta.url).href)});
    const status = buildStatusPayload();
    assert.equal(status.browserAvailable, false);
    assert.equal(status.browserPath, undefined);
    assert.throws(assertBrowserBinaryAvailable, { message: MISSING_BROWSER_MESSAGE });
    await assert.rejects(launchCamoufoxBrowser({}), { message: MISSING_BROWSER_MESSAGE });
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(JSON.stringify({ fetchCalls, cacheExists: existsSync(process.env.CAMOUFOX_INSTALL_DIR) }));
    process.exit(0);
  `], {
    cwd: root,
    env: { ...process.env, CAMOUFOX_INSTALL_DIR: missingCache },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(freshProcess.error, undefined, freshProcess.error?.message);
  assert.equal(freshProcess.status, 0, freshProcess.stderr);
  assert.deepEqual(JSON.parse(freshProcess.stdout), { fetchCalls: 0, cacheExists: false });
  assert.equal(existsSync(missingCache), false);

  const compatibilityStatus = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { buildStatusPayload } = await import(${JSON.stringify(new URL("../dist/tool-handlers.js", import.meta.url).href)});
    const { BROWSER_INSTALL_DIR } = await import(${JSON.stringify(new URL("../dist/browser-build.js", import.meta.url).href)});
    console.log(JSON.stringify({ status: buildStatusPayload().browserCompatibility, dir: BROWSER_INSTALL_DIR }));
  `], {
    cwd: root,
    env: { ...process.env, CAMOUFOX_MCP_BROWSER_COMPATIBILITY: "1", CAMOUFOX_INSTALL_DIR: missingCache },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(compatibilityStatus.status, 0, compatibilityStatus.stderr);
  const reported = JSON.parse(compatibilityStatus.stdout);
  assert.equal(reported.dir, missingCache);
  assert.equal(reported.status.mode, "compatibility");
  assert.equal(reported.status.expectedVersion, "156.0.1-beta.33");
  assert.equal(reported.status.worldIsolationEnabled, false);
  assert.match(reported.status.warning, /detect automation/);
  assert.equal(existsSync(missingCache), false);

  const doctor = spawnSync(process.execPath, ["scripts/doctor.mjs"], {
    cwd: root,
    env: { ...process.env, CAMOUFOX_INSTALL_DIR: missingCache },
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(doctor.error, undefined, doctor.error?.message);
  assert.equal(doctor.status, 1, doctor.stderr);
  assert.ok(doctor.stdout.includes(`no cached browser at ${missingCache}`), "doctor must inspect CAMOUFOX_INSTALL_DIR");
  assert.match(doctor.stdout, /Live smoke test skipped/, "doctor must not launch against a failed preflight");
  assert.equal(existsSync(missingCache), false);

  // Exercise the shipped script in npm's installed layout, including hoisted dependencies.
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryRoot], {
    cwd: root,
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(packed.error, undefined, packed.error?.message);
  assert.equal(packed.status, 0, packed.stderr);
  const packedInfo = JSON.parse(packed.stdout)[0];
  const archive = join(temporaryRoot, packedInfo.filename);
  const hoistedModules = join(temporaryRoot, "packed-install", "node_modules");
  mkdirSync(hoistedModules, { recursive: true });
  const extracted = spawnSync("tar", ["-xzf", archive, "-C", hoistedModules], { encoding: "utf8", timeout: 5000 });
  assert.equal(extracted.error, undefined, extracted.error?.message);
  assert.equal(extracted.status, 0, extracted.stderr);
  const installedRoot = join(hoistedModules, "camoufox-mcp-server");
  renameSync(join(hoistedModules, "package"), installedRoot);
  assert.equal(existsSync(join(installedRoot, "node_modules")), false, "fixture must exercise dependencies outside the package");

  const builds = JSON.parse(readFileSync(join(installedRoot, "browser-builds.json"), "utf8"));
  const installedManifest = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
  const expectedBins = {
    "camoufox-mcp-server": "dist/index.js",
    "camoufox-mcp-fetch": "scripts/fetch-browser.mjs",
    "camoufox-mcp-doctor": "scripts/doctor.mjs",
  };
  assert.deepEqual(installedManifest.bin, expectedBins, "all supported install paths must expose the bootstrap commands");
  const binDir = join(hoistedModules, ".bin");
  mkdirSync(binDir);
  for (const [name, path] of Object.entries(expectedBins)) {
    assert.equal(existsSync(join(installedRoot, path)), true, `${name} must ship its entry file`);
    assert.match(readFileSync(join(installedRoot, path), "utf8"), /^#!\/usr\/bin\/env node\n/, `${name} needs a Node shebang`);
    if (name !== "camoufox-mcp-server") {
      const packedFile = packedInfo.files.find((file) => file.path === path);
      assert.ok(packedFile.mode & 0o111, `${name} must ship executable permissions`);
    }
    symlinkSync(join(installedRoot, path), join(binDir, name), "file");
  }
  assert.equal(installedManifest.engines.node, ">=22.0.0", "default mode must retain its declared Node support");
  assert.equal(installedManifest.dependencies["@camoufox/camoufox"], undefined, "the newer Node requirement must be optional for default installs");
  assert.equal(installedManifest.optionalDependencies["@camoufox/camoufox"], builds.compatibility.launcherVersion);
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  assert.equal(lock.packages[""].optionalDependencies["@camoufox/camoufox"], builds.compatibility.launcherVersion);
  assert.equal(lock.packages["node_modules/@camoufox/camoufox"].optional, true, "engine-strict installs may skip the incompatible optional launcher");
  for (const [name, version] of [
    ["camoufox-js", builds.default.launcherVersion],
    ["playwright-core", builds.playwrightCore],
    ["@camoufox/camoufox", builds.compatibility.launcherVersion],
  ]) {
    const dependencyDir = join(hoistedModules, name);
    mkdirSync(dependencyDir, { recursive: true });
    writeFileSync(join(dependencyDir, "package.json"), JSON.stringify({ name, version, main: "index.js", type: "module" }));
    writeFileSync(join(dependencyDir, "index.js"), "throw new Error('Doctor must not load dependency code');\n");
  }
  // A public fetch bin must enter main() through npm's symlink. This also
  // verifies its manifest and hoisted pkgman resolve without a browser download.
  const pkgmanDir = join(hoistedModules, "camoufox-js", "dist");
  mkdirSync(pkgmanDir);
  writeFileSync(join(pkgmanDir, "pkgman.js"), `
    export class CamoufoxFetcher {}
    export const INSTALL_DIR = process.env.CAMOUFOX_INSTALL_DIR;
    export const OS_NAME = ${JSON.stringify(OS_NAME)};
  `);
  for (const compatibility of [false, true]) {
    const packedFetch = spawnSync(process.execPath, [join(binDir, "camoufox-mcp-fetch")], {
      cwd: temporaryRoot,
      env: { ...process.env, CAMOUFOX_INSTALL_DIR: missingCache, CAMOUFOX_MCP_BROWSER_COMPATIBILITY: compatibility ? "1" : "0", PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(packedFetch.error, undefined, packedFetch.error?.message);
    assert.equal(packedFetch.status, 0, packedFetch.stderr);
    assert.match(packedFetch.stdout, /Skipping browser download/, "the npm symlink must execute the public fetch entry point");
    assert.equal(existsSync(missingCache), false, "skip-download bootstrap must not create a cache");
  }
  const runPackedDoctor = (compatibility) => spawnSync(process.execPath, [join(binDir, "camoufox-mcp-doctor")], {
    cwd: temporaryRoot,
    env: { ...process.env, CAMOUFOX_INSTALL_DIR: missingCache, CAMOUFOX_MCP_BROWSER_COMPATIBILITY: compatibility ? "1" : "0" },
    encoding: "utf8",
    timeout: 5000,
  });
  for (const compatibility of [false, true]) {
    const packedDoctor = runPackedDoctor(compatibility);
    assert.equal(packedDoctor.error, undefined, packedDoctor.error?.message);
    assert.equal(packedDoctor.status, 1, packedDoctor.stderr);
    assert.ok(packedDoctor.stdout.includes(`camoufox-js ${builds.default.launcherVersion} (exact pin)`), packedDoctor.stdout);
    assert.ok(packedDoctor.stdout.includes(`playwright-core ${builds.playwrightCore} (direct pin)`), packedDoctor.stdout);
    if (compatibility) assert.ok(packedDoctor.stdout.includes(`official launcher ${builds.compatibility.launcherVersion} (exact pin)`), packedDoctor.stdout);
    assert.match(packedDoctor.stdout, /1 check\(s\) failed\./, "only the missing browser should fail with hoisted packages");
  }
  rmSync(join(hoistedModules, "@camoufox/camoufox"), { recursive: true });
  const withoutOptionalLauncher = runPackedDoctor(false);
  assert.equal(withoutOptionalLauncher.status, 1, withoutOptionalLauncher.stderr);
  assert.match(withoutOptionalLauncher.stdout, /1 check\(s\) failed\./, "default mode must not require the optional launcher");
  const missingOptionalLauncher = runPackedDoctor(true);
  assert.equal(missingOptionalLauncher.status, 1, missingOptionalLauncher.stderr);
  assert.match(missingOptionalLauncher.stdout, /official launcher is not installed/);
  assert.match(missingOptionalLauncher.stdout, /npm install --include=optional/, "compatibility must explain how to install its optional launcher");
  rmSync(join(hoistedModules, "camoufox-js"), { recursive: true });
  const missingDependencyDoctor = runPackedDoctor(false);
  assert.equal(missingDependencyDoctor.error, undefined, missingDependencyDoctor.error?.message);
  assert.equal(missingDependencyDoctor.status, 1, missingDependencyDoctor.stderr);
  assert.match(missingDependencyDoctor.stdout, /camoufox-js is not installed/, "preinstall diagnostics must survive unresolved dependencies");
  assert.match(missingDependencyDoctor.stdout, /Live smoke test skipped/);
} finally {
  if (previousInstallDir === undefined) delete process.env.CAMOUFOX_INSTALL_DIR;
  else process.env.CAMOUFOX_INSTALL_DIR = previousInstallDir;
  if (previousCompatibility === undefined) delete process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY;
  else process.env.CAMOUFOX_MCP_BROWSER_COMPATIBILITY = previousCompatibility;
  rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("browser preflight unit tests passed");
