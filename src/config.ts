import { existsSync, readFileSync } from "node:fs";
import type { NetworkSandboxMode, NetworkSecurityStatus, SupportedOs } from "./types.js";

export const SERVER_VERSION = "2.0.7";
export const DEFAULT_MAX_CHARS = 30000;
export const MAX_MAX_CHARS = 200000;
export const DEFAULT_MAX_ELEMENTS = 100;
export const MAX_MAX_ELEMENTS = 500;
export const MAX_SEQUENCE_ACTIONS = 25;
export const DEFAULT_ACTION_TIMEOUT_MS = 10000;
export const MAX_GUARDED_REQUESTS = 1024;
export const MAX_EXTRACT_NODES = 50000;
export const GUARD_SETTLE_MS = 100;
export const SESSION_CLOSE_GRACE_MS = 5000;
export const ALLOW_UNSAFE_OPTIONS = process.env.CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS === "1";
export const ALLOW_EVALUATE = process.env.CAMOUFOX_MCP_ALLOW_EVALUATE === "1";
export const CAPTCHA_AUTONOMOUS = process.env.CAPTCHA_AUTONOMOUS === "true";
export const NETWORK_SANDBOX_DECLARED = process.env.CAMOUFOX_MCP_NETWORK_SANDBOX === "1";
export const REQUIRE_NETWORK_SANDBOX = process.env.CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX === "1";

export const SUPPORTED_OSES: readonly SupportedOs[] = ["windows", "macos", "linux"] as const;
export const DENIED_BROWSER_ARG_FLAGS = new Set([
  "--allow-insecure-localhost",
  "--allow-running-insecure-content",
  "--disable-extensions-except",
  "--disable-setuid-sandbox",
  "--disable-web-security",
  "--host-resolver-rules",
  "--ignore-certificate-errors",
  "--load-extension",
  "--no-proxy-server",
  "--no-sandbox",
  "--profile",
  "--proxy-bypass-list",
  "--proxy-pac-url",
  "--proxy-server",
  "--remote-allow-origins",
  "--remote-debugging-address",
  "--remote-debugging-pipe",
  "--remote-debugging-port",
  "--user-data-dir",
  "-profile",
]);
export const DENIED_FIREFOX_PREF_KEYS = new Set([
  "devtools.chrome.enabled",
  "devtools.debugger.prompt-connection",
  "devtools.debugger.remote-enabled",
  "dom.serviceWorkers.enabled",
  "media.peerconnection.enabled",
  "network.proxy.allow_hijacking_localhost",
  "network.proxy.no_proxies_on",
  "security.cert_pinning.enforcement_level",
  "security.fileuri.strict_origin_policy",
  "security.mixed_content.block_active_content",
]);
export const DENIED_FIREFOX_PREF_PREFIXES = [
  "devtools.",
  "network.proxy.",
  "security.sandbox.",
];

export function readBoundedInteger(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, value));
}

export const MAX_CONCURRENCY = readBoundedInteger("CAMOUFOX_MCP_MAX_CONCURRENCY", 1, 1, 8);
export const MAX_QUEUE = readBoundedInteger("CAMOUFOX_MCP_MAX_QUEUE", 8, 0, 100);
export const QUEUE_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_QUEUE_TIMEOUT_MS", 30000, 1000, 300000);
export const LAUNCH_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_LAUNCH_TIMEOUT_MS", 30000, 1000, 300000);
export const SEQUENCE_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_SEQUENCE_TIMEOUT_MS", 120000, 1000, 300000);
export const MAX_SCREENSHOT_BYTES = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_BYTES", 5 * 1024 * 1024, 1024, 20 * 1024 * 1024);
export const MAX_SCREENSHOT_WIDTH = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_WIDTH", 1920, 320, 3840);
export const MAX_SCREENSHOT_HEIGHT = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_HEIGHT", 1080, 240, 2160);
export const MAX_SCREENSHOT_AREA = MAX_SCREENSHOT_WIDTH * MAX_SCREENSHOT_HEIGHT;
export const MAX_DIAGNOSTIC_ENTRIES = readBoundedInteger("CAMOUFOX_MCP_MAX_DIAGNOSTIC_ENTRIES", 100, 1, 1000);
export const MAX_DIAGNOSTIC_TEXT_CHARS = readBoundedInteger("CAMOUFOX_MCP_MAX_DIAGNOSTIC_TEXT_CHARS", 2000, 100, 20000);
export const MAX_SESSIONS = readBoundedInteger("CAMOUFOX_MCP_MAX_SESSIONS", 1, 1, 4);
export const SESSION_TTL_MS = readBoundedInteger("CAMOUFOX_MCP_SESSION_TTL_MS", 600000, 300000, 900000);

export function fileContains(path: string, value: string): boolean {
  try {
    return readFileSync(path, "utf8").includes(value);
  } catch {
    return false;
  }
}

export function isLikelyContainerRuntime(): boolean {
  return existsSync("/.dockerenv")
    || fileContains("/proc/1/cgroup", "docker")
    || fileContains("/proc/1/cgroup", "kubepods");
}

export function detectNetworkSandboxMode(): NetworkSandboxMode {
  if (NETWORK_SANDBOX_DECLARED && REQUIRE_NETWORK_SANDBOX) {
    return "strict-declared";
  }

  if (NETWORK_SANDBOX_DECLARED) {
    return "declared";
  }

  if (isLikelyContainerRuntime()) {
    return "docker";
  }

  return "unknown";
}

export function buildNetworkSecurityStatus(): NetworkSecurityStatus {
  const sandboxMode = detectNetworkSandboxMode();
  const warning = sandboxMode === "unknown" || sandboxMode === "docker"
    ? "SSRF filtering is application-layer best effort. Use container, VM, or firewall egress rules for untrusted URLs. Container detection is not proof of private-network egress filtering."
    : undefined;

  return {
    ssrfPolicy: "app_layer_best_effort",
    sandboxMode,
    sandboxDeclared: NETWORK_SANDBOX_DECLARED,
    strictSandboxRequired: REQUIRE_NETWORK_SANDBOX,
    warning,
  };
}

export function assertNetworkSandboxPolicy(): void {
  if (REQUIRE_NETWORK_SANDBOX && !NETWORK_SANDBOX_DECLARED) {
    throw new Error(
      "CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX=1 requires CAMOUFOX_MCP_NETWORK_SANDBOX=1 after configuring container/VM/firewall egress controls.",
    );
  }
}
