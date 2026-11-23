import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const version = readJson("package.json").version;
assert.equal(typeof version, "string", "package.json must declare a release version");

for (const path of [
  ".claude-plugin/marketplace.json",
  "plugins/camoufox/.claude-plugin/plugin.json",
  "plugins/camoufox/.codex-plugin/plugin.json",
  "plugins/camoufox/package.json",
  "plugins/camoufox/openclaw.plugin.json",
]) {
  assert.equal(readJson(path).version, version, `${path} version must match package.json`);
}

// Pins drift silently otherwise: 2.7.2 shipped with docs still naming 2.7.0, and the
// plugin bundle would run whatever "latest" is on npm with unsafe options enabled.
const mcpArgs = readJson("plugins/camoufox/.mcp.json").mcpServers?.camoufox?.args ?? [];
assert.ok(
  mcpArgs.includes(`camoufox-mcp-server@${version}`),
  "plugins/camoufox/.mcp.json must pin camoufox-mcp-server to the release version",
);
for (const path of [
  "README.md",
  "AGENTS.md",
  "llms.txt",
  "docs/configuration.md",
  "docs/browser-compatibility.md",
  "docs/troubleshooting.md",
  "plugins/camoufox/skills/camoufox/SKILL.md",
]) {
  for (const [, pinned] of readFileSync(new URL(path, root), "utf8").matchAll(/camoufox-mcp-server@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/g)) {
    assert.equal(pinned, version, `${path} pins camoufox-mcp-server@${pinned}; refresh it to ${version}`);
  }
}

const source = readFileSync(new URL("src/config.ts", root), "utf8");
const serverVersion = source.match(/export const SERVER_VERSION\s*=\s*["']([^"']+)["']/)?.[1];
assert.equal(serverVersion, version, "src/config.ts SERVER_VERSION must match package.json");
const lock = readJson("package-lock.json");
assert.equal(lock.version, version, "package-lock.json version must match package.json");
assert.equal(lock.packages?.[""]?.version, version, "package-lock.json root package must match package.json");

// Reject mismatched tags before any dependent CI job can publish an artifact.
const tag = process.env.GITHUB_REF_TYPE === "tag"
  ? process.env.GITHUB_REF_NAME
  : process.env.GITHUB_REF?.startsWith("refs/tags/") ? process.env.GITHUB_REF.slice("refs/tags/".length) : undefined;
if (tag !== undefined) {
  assert.equal(tag, `v${version}`, "release tag must match package.json");
  const changelog = readFileSync(new URL("CHANGELOG.md", root), "utf8");
  assert.ok(changelog.includes(`## [${version}] - `), "release tag requires its versioned changelog entry");
}

console.log(`Release version ${version} is synchronized${tag ? ` with ${tag}` : ""}.`);
