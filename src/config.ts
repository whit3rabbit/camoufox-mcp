import { existsSync, readFileSync } from "node:fs";
import { isIP } from "node:net";
import type { NetworkSandboxMode, NetworkSecurityStatus, StealthProfile, SupportedOs, WaitStrategy } from "./types.js";

export const SERVER_VERSION = "2.6.0";
export const DEFAULT_MAX_CHARS = 30000;
export const MAX_MAX_CHARS = 200000;
export const DEFAULT_MAX_ELEMENTS = 100;
export const MAX_MAX_ELEMENTS = 500;
export const MAX_SEQUENCE_ACTIONS = 25;
export const DEFAULT_ACTION_TIMEOUT_MS = 10000;
export const DEFAULT_WAIT_STRATEGY: WaitStrategy = "domcontentloaded";
export const DEFAULT_STEALTH_PROFILE: StealthProfile = "normal";
export const MAX_GUARDED_REQUESTS = 1024;
export const MAX_EXTRACT_NODES = 50000;
export const GUARD_SETTLE_MS = 100;
// Request-guard validations still pending after this long fail closed.
export const DNS_LOOKUP_TIMEOUT_MS = 5000;
export const GUARD_SETTLE_DEADLINE_MS = DNS_LOOKUP_TIMEOUT_MS + 2000;
export const GUARD_DNS_CACHE_TTL_MS = 5000;
export const BROWSER_CLOSE_TIMEOUT_MS = 10000;
export const SHUTDOWN_DEADLINE_MS = 15000;
export const SESSION_CLOSE_GRACE_MS = 5000;
export const ALLOW_UNSAFE_OPTIONS = process.env.CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS === "1";
export const ALLOW_EVALUATE = process.env.CAMOUFOX_MCP_ALLOW_EVALUATE === "1";
export const CAPTCHA_AUTONOMOUS = process.env.CAPTCHA_AUTONOMOUS === "true";
export const NETWORK_SANDBOX_DECLARED = process.env.CAMOUFOX_MCP_NETWORK_SANDBOX === "1";
export const REQUIRE_NETWORK_SANDBOX = process.env.CAMOUFOX_MCP_REQUIRE_NETWORK_SANDBOX === "1";

export function readAllowedPrivateHosts(raw = ""): readonly string[] {
  const hosts = raw.split(",").map((host) => host.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean);
  for (const host of hosts) {
    const validLabels = host.length <= 253 && host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
    let validDnsHost = false;
    // URL parsing also rejects alternate numeric spellings of IP literals.
    if (validLabels) {
      try {
        validDnsHost = isIP(new URL(`http://${host}/`).hostname) === 0;
      } catch {
        validDnsHost = false;
      }
    }
    if (!validDnsHost) {
      throw new Error("CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS must contain comma-separated exact DNS hostnames, without wildcards, URLs, ports, or IP literals.");
    }
  }
  return Object.freeze([...new Set(hosts)]);
}

export const ALLOWED_PRIVATE_HOSTS = readAllowedPrivateHosts(process.env.CAMOUFOX_MCP_ALLOWED_PRIVATE_HOSTS);

export const SUPPORTED_OSES: readonly SupportedOs[] = ["windows", "macos", "linux"] as const;
// Firefox accepts every flag with one or two leading dashes and in any case,
// so names are stored without dashes and compared after normalizing.
export const DENIED_BROWSER_ARG_FLAGS = new Set([
  "allow-insecure-localhost",
  "allow-running-insecure-content",
  "createprofile",
  "devtools",
  "disable-extensions-except",
  "disable-setuid-sandbox",
  "disable-web-security",
  "host-resolver-rules",
  "ignore-certificate-errors",
  "jsconsole",
  "jsdebugger",
  "juggler",
  "juggler-pipe",
  "load-extension",
  "marionette",
  "new-tab",
  "new-window",
  "no-proxy-server",
  "no-sandbox",
  "p",
  "private-window",
  "profile",
  "profilemanager",
  "proxy-bypass-list",
  "proxy-pac-url",
  "proxy-server",
  "remote-allow-hosts",
  "remote-allow-origins",
  "remote-debugging-address",
  "remote-debugging-pipe",
  "remote-debugging-port",
  "start-debugger-server",
  "url",
  "user-data-dir",
  "wait-for-jsdebugger",
]);
// Flags that may carry a value. Any other valued or positional argument is
// rejected: Firefox opens leftover arguments as URLs at startup, outside the
// per-context request guard.
export const VALUED_BROWSER_ARG_FLAGS = new Set(["height", "width"]);
export const DENIED_FIREFOX_PREF_KEYS = new Set([
  "browser.startup.homepage",
  "dom.serviceworkers.enabled",
  "security.cert_pinning.enforcement_level",
  "security.csp.enable",
  "security.fileuri.strict_origin_policy",
  "security.mixed_content.block_active_content",
]);
export const DENIED_FIREFOX_PREF_PREFIXES = [
  "devtools.",
  "marionette.",
  // WebRTC opens non-HTTP connections the request guard never sees.
  "media.peerconnection.",
  // Resolver overrides make the browser connect somewhere other than the
  // address this server validated.
  "network.dns.",
  "network.proxy.",
  "network.trr.",
  "remote.",
  "security.sandbox.",
];

export function readBoundedInteger(name: string, defaultValue: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return defaultValue;
  }

  // parseInt would accept "10m" as 10 and "1e5" as 1. A value that is not a
  // plain integer is a configuration mistake, so say so and keep the default.
  if (!/^\s*-?\d+\s*$/.test(raw)) {
    console.error(`[Camoufox] Ignoring ${name}=${JSON.stringify(raw)}: expected an integer. Using ${defaultValue}.`);
    return defaultValue;
  }

  return Math.min(max, Math.max(min, Number.parseInt(raw, 10)));
}

export const MAX_CONCURRENCY = readBoundedInteger("CAMOUFOX_MCP_MAX_CONCURRENCY", 1, 1, 8);
export const MAX_QUEUE = readBoundedInteger("CAMOUFOX_MCP_MAX_QUEUE", 8, 0, 100);
export const QUEUE_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_QUEUE_TIMEOUT_MS", 30000, 1000, 300000);
export const LAUNCH_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_LAUNCH_TIMEOUT_MS", 30000, 1000, 300000);
export const SEQUENCE_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_SEQUENCE_TIMEOUT_MS", 250000, 1000, 300000);
export const MAX_SCREENSHOT_BYTES = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_BYTES", 5 * 1024 * 1024, 1024, 20 * 1024 * 1024);
export const MAX_SCREENSHOT_WIDTH = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_WIDTH", 1920, 320, 3840);
export const MAX_SCREENSHOT_HEIGHT = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_HEIGHT", 1080, 240, 2160);
// Full-page captures are taller than one viewport by design. Pages beyond this
// height are clipped from the top instead of rejected.
export const MAX_FULL_PAGE_SCREENSHOT_HEIGHT = readBoundedInteger("CAMOUFOX_MCP_MAX_FULL_PAGE_SCREENSHOT_HEIGHT", 10000, 240, 32000);
// Upper bound for one guarded page read (text, snapshot, screenshot, detection).
export const PAGE_READ_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_PAGE_READ_TIMEOUT_MS", 30000, 1000, 300000);
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
    allowedPrivateHosts: [...ALLOWED_PRIVATE_HOSTS],
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
