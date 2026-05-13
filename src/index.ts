#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import { Camoufox, type LaunchOptions } from "camoufox-js";
import type { Browser, BrowserContext, Page, Response, Route } from "playwright-core";
import chalk from "chalk";

type OutputMode = "text" | "html" | "metadata";
type BrowserInstance = Browser;
type SupportedOs = "windows" | "macos" | "linux";
type HeadlessMode = boolean | "virtual";
type WaitStrategy = "domcontentloaded" | "load" | "networkidle";
type ScreenshotImageType = "png" | "jpeg";
type SlotRelease = () => void;
type ProxyConfig = string | { server: string; username?: string; password?: string };
type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  type?: ScreenshotImageType;
  quality?: number;
}

interface ScreenshotMetadata {
  requested: boolean;
  included: boolean;
  bytes?: number;
  maxBytes?: number;
  type?: ScreenshotImageType;
  fullPage?: boolean;
  selector?: string;
  selectorFound?: boolean;
  error?: string;
}

interface ConsoleDiagnostic {
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

interface NetworkDiagnostic {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  contentType?: string;
  failed?: boolean;
  errorText?: string;
}

interface DiagnosticsPayload {
  console?: ConsoleDiagnostic[];
  network?: NetworkDiagnostic[];
  consoleTruncated?: boolean;
  networkTruncated?: boolean;
}

interface PendingBrowse {
  start: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface BrowsePayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  outputMode: OutputMode;
  truncated: boolean;
  maxChars: number;
  selector?: string;
  selectorFound?: boolean;
  text?: string;
  html?: string;
  screenshot?: ScreenshotMetadata;
  diagnostics?: DiagnosticsPayload;
}

interface SnapshotElement {
  tag: string;
  selector: string;
  role?: string;
  name?: string;
  text?: string;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

interface SnapshotPayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  selector?: string;
  selectorFound: boolean;
  maxChars: number;
  maxElements: number;
  text: string;
  textTruncated: boolean;
  ariaSnapshot?: string;
  ariaSnapshotTruncated?: boolean;
  ariaSnapshotError?: string;
  elements: SnapshotElement[];
  elementsTruncated: boolean;
  diagnostics?: DiagnosticsPayload;
}

interface SequenceActionResult {
  index: number;
  type: string;
  selector?: string;
  status: "ok";
  result?: string;
  resultTruncated?: boolean;
  durationMs: number;
}

interface SequencePayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  initialStatus?: number;
  actions: SequenceActionResult[];
  snapshot?: SnapshotPayload;
  outputMode: OutputMode;
  truncated: boolean;
  maxChars: number;
  selector?: string;
  selectorFound?: boolean;
  text?: string;
  html?: string;
  screenshot?: ScreenshotMetadata;
  diagnostics?: DiagnosticsPayload;
}

interface CamoufoxOptions {
  os?: SupportedOs[];
  headless?: HeadlessMode;
  humanize?: boolean;
  geoip?: boolean;
  ublock?: boolean;
  block_webgl?: boolean;
  block_images?: boolean;
  block_webrtc?: boolean;
  disable_coop?: boolean;
  locale?: string;
  viewport?: { width: number; height: number };
  proxy?: ProxyConfig;
  enable_cache?: boolean;
  firefox_user_prefs?: Record<string, unknown>;
  exclude_addons?: string[];
  window?: [number, number];
  args?: string[];
}

interface ExtractedContent {
  value: string;
  truncated: boolean;
  found: boolean;
}

interface ScreenshotResult {
  screenshotMetadata: ScreenshotMetadata;
  mimeType: string;
  base64?: string;
}

interface CommonBrowserInput {
  url: string;
  os?: SupportedOs;
  waitStrategy?: WaitStrategy;
  timeout?: number;
  humanize?: boolean;
  locale?: string;
  viewport?: { width: number; height: number };
  block_webrtc?: boolean;
  proxy?: ProxyConfig;
  enable_cache?: boolean;
  firefox_user_prefs?: Record<string, unknown>;
  exclude_addons?: string[];
  window?: [number, number];
  args?: string[];
  block_images?: boolean;
  block_webgl?: boolean;
  disable_coop?: boolean;
  geoip?: boolean;
  headless?: boolean;
  includeConsole?: boolean;
  includeNetwork?: boolean;
}

interface BrowserOperationContext {
  page: Page;
  response: Response | null;
  requestGuard: RequestGuard;
  diagnostics: DiagnosticsCollector;
  selectedOS: SupportedOs;
  waitStrategy: WaitStrategy;
  getLastNavigationResponse: () => Response | null;
}

interface DiagnosticsCollector {
  payload(): DiagnosticsPayload | undefined;
}

const SERVER_VERSION = "1.5.0";
const DEFAULT_MAX_CHARS = 30000;
const MAX_MAX_CHARS = 200000;
const DEFAULT_MAX_ELEMENTS = 100;
const MAX_MAX_ELEMENTS = 500;
const MAX_SEQUENCE_ACTIONS = 25;
const DEFAULT_ACTION_TIMEOUT_MS = 10000;
const MAX_GUARDED_REQUESTS = 1024;
const MAX_EXTRACT_NODES = 50000;
const GUARD_SETTLE_MS = 100;
const ALLOW_UNSAFE_OPTIONS = process.env.CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS === "1";
const ALLOW_EVALUATE = process.env.CAMOUFOX_MCP_ALLOW_EVALUATE === "1";

const SUPPORTED_OSES: readonly SupportedOs[] = ["windows", "macos", "linux"] as const;
const DENIED_BROWSER_ARG_FLAGS = new Set([
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
const DENIED_FIREFOX_PREF_KEYS = new Set([
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
const DENIED_FIREFOX_PREF_PREFIXES = [
  "devtools.",
  "network.proxy.",
  "security.sandbox.",
];

function readBoundedInteger(name: string, defaultValue: number, min: number, max: number): number {
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

const MAX_CONCURRENCY = readBoundedInteger("CAMOUFOX_MCP_MAX_CONCURRENCY", 1, 1, 8);
const MAX_QUEUE = readBoundedInteger("CAMOUFOX_MCP_MAX_QUEUE", 8, 0, 100);
const QUEUE_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_QUEUE_TIMEOUT_MS", 30000, 1000, 300000);
const LAUNCH_TIMEOUT_MS = readBoundedInteger("CAMOUFOX_MCP_LAUNCH_TIMEOUT_MS", 30000, 1000, 300000);
const MAX_SCREENSHOT_BYTES = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_BYTES", 5 * 1024 * 1024, 1024, 20 * 1024 * 1024);
const MAX_SCREENSHOT_WIDTH = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_WIDTH", 1920, 320, 3840);
const MAX_SCREENSHOT_HEIGHT = readBoundedInteger("CAMOUFOX_MCP_MAX_SCREENSHOT_HEIGHT", 1080, 240, 2160);
const MAX_DIAGNOSTIC_ENTRIES = readBoundedInteger("CAMOUFOX_MCP_MAX_DIAGNOSTIC_ENTRIES", 100, 1, 1000);
const MAX_DIAGNOSTIC_TEXT_CHARS = readBoundedInteger("CAMOUFOX_MCP_MAX_DIAGNOSTIC_TEXT_CHARS", 2000, 100, 20000);

let activeBrowses = 0;
const pendingBrowses: PendingBrowse[] = [];
const activeBrowsers = new Set<BrowserInstance>();

const viewportSchema = z.object({
  width: z.number().min(320).max(3840).default(1920),
  height: z.number().min(240).max(2160).default(1080),
}).optional().describe("Custom viewport dimensions.");

const proxySchema = z.union([
  z.string().describe("Proxy URL (e.g., 'http://proxy.example.com:8080')"),
  z.object({
    server: z.string().describe("Proxy server URL"),
    username: z.string().optional().describe("Proxy username for authentication"),
    password: z.string().optional().describe("Proxy password for authentication"),
  }),
]).optional().describe("Proxy configuration for routing browser traffic through an HTTP(S) proxy. Proxy servers are checked against the same local-network URL policy as page requests.");

const windowSchema = z.preprocess(
  (arg) => {
    if (Array.isArray(arg) && arg.length === 0) {
      return undefined;
    }
    return arg;
  },
  z.tuple([
    z.number().min(320).max(3840),
    z.number().min(240).max(2160),
  ]).optional(),
).describe("Set fixed window size [width, height] instead of random generation. An empty array [] is accepted and treated as if the window parameter was not specified.");

const screenshotOptionsSchema = z.object({
  fullPage: z.boolean().optional().default(false).describe("Capture the full page instead of only the viewport. Byte and viewport/window limits still apply."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector for element-only screenshots."),
  type: z.enum(["png", "jpeg"]).optional().default("png").describe("Screenshot image type."),
  quality: z.number().int().min(1).max(100).optional().describe("JPEG quality from 1-100. Ignored for PNG."),
}).optional().describe("Optional screenshot capture settings. Used only when screenshot is true.");

const commonBrowserToolShape = {
  url: z.string().describe("The URL to navigate to. Must be a fully qualified http or https URL."),
  os: z.enum(["windows", "macos", "linux"]).optional().describe("Optional OS to spoof. Can be 'windows', 'macos', or 'linux'. If not specified, will rotate between all OS types."),
  waitStrategy: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("load").describe("Wait strategy for page load. 'domcontentloaded' waits for DOM, 'load' waits for all resources, 'networkidle' waits for network activity to finish."),
  timeout: z.number().min(5000).max(300000).optional().default(60000).describe("Timeout in milliseconds for page load (5-300 seconds)."),
  humanize: z.boolean().optional().default(true).describe("Enable realistic cursor movements and human-like behavior for better stealth and anti-detection."),
  locale: z.string().optional().describe("Browser locale (e.g., 'en-US', 'fr-FR')."),
  viewport: viewportSchema,
  block_webrtc: z.boolean().optional().default(true).describe("Block WebRTC entirely for enhanced privacy and stealth."),
  proxy: proxySchema,
  enable_cache: z.boolean().optional().default(false).describe("Cache pages, requests, etc. Uses more memory but improves performance when revisiting pages."),
  firefox_user_prefs: z.record(z.string(), z.any()).optional().describe("Custom Firefox user preferences to set."),
  exclude_addons: z.array(z.string()).optional().describe("List of default addons to exclude (e.g., ['ublock_origin']). Disabled unless CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1."),
  window: windowSchema,
  args: z.array(z.string()).optional().describe("Additional browser command-line arguments to pass to the browser."),
  block_images: z.boolean().optional().default(false).describe("Block all images for faster loading, reduced bandwidth, and lightweight browsing."),
  block_webgl: z.boolean().optional().default(false).describe("Block WebGL to prevent fingerprinting and tracking."),
  disable_coop: z.boolean().optional().default(false).describe("Disable Cross-Origin-Opener-Policy for sites that require it."),
  geoip: z.boolean().optional().default(true).describe("Automatically detect geolocation based on IP address."),
  headless: z.boolean().optional().describe("Run browser in headless mode. Auto-detects best mode for environment if not specified."),
  includeConsole: z.boolean().optional().default(false).describe("Include bounded page console diagnostics in the JSON response."),
  includeNetwork: z.boolean().optional().default(false).describe("Include bounded network diagnostics in the JSON response."),
};

const browseToolShape = {
  ...commonBrowserToolShape,
  url: z.string().describe("The URL to navigate to and retrieve content from. Use this tool when users ask to visit, check, search, navigate, browse, fetch, or scrape websites. Must be a fully qualified URL (e.g., 'https://example.com')."),
  outputMode: z.enum(["text", "html", "metadata"]).optional().default("text").describe("Response content mode. Defaults to visible text. Use 'html' only when raw HTML is explicitly needed."),
  maxChars: z.number().int().min(1000).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS).describe("Maximum text or HTML characters to return."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit extraction to one matching element."),
  screenshot: z.boolean().optional().default(false).describe("Capture a screenshot/image of the page after loading."),
  screenshotOptions: screenshotOptionsSchema,
};

const snapshotToolShape = {
  ...commonBrowserToolShape,
  maxChars: z.number().int().min(100).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS).describe("Maximum visible text and ARIA snapshot characters to return."),
  maxElements: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum interactive elements to return."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit snapshot extraction to one matching element."),
};

const actionTimeoutSchema = z.number().min(100).max(60000).optional();
const sequenceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    selector: z.string().max(2000),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("hover"),
    selector: z.string().max(2000),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().max(2000),
    value: z.string().max(MAX_MAX_CHARS),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string().max(2000),
    text: z.string().max(MAX_MAX_CHARS),
    delay: z.number().min(0).max(1000).optional().default(0),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("select"),
    selector: z.string().max(2000),
    value: z.union([z.string(), z.array(z.string())]),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("press"),
    selector: z.string().max(2000).optional(),
    key: z.string().min(1).max(100),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("waitFor"),
    selector: z.string().max(2000).optional(),
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional().default("visible"),
    loadState: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("scroll"),
    selector: z.string().max(2000).optional(),
    deltaX: z.number().min(-10000).max(10000).optional().default(0),
    deltaY: z.number().min(-10000).max(10000).optional().default(600),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("evaluate"),
    expression: z.string().max(4000),
    timeout: actionTimeoutSchema,
    maxChars: z.number().int().min(100).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS),
  }),
]);

const sequenceToolShape = {
  ...commonBrowserToolShape,
  actions: z.array(sequenceActionSchema).max(MAX_SEQUENCE_ACTIONS).describe("Bounded action sequence to run after navigation."),
  outputMode: z.enum(["text", "html", "metadata"]).optional().default("text").describe("Final response content mode."),
  maxChars: z.number().int().min(100).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS).describe("Maximum final text, HTML, snapshot, or evaluate-result characters to return."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit final content extraction to one matching element."),
  maxElements: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum final snapshot elements to return."),
  screenshot: z.boolean().optional().default(false).describe("Capture a screenshot/image after all actions finish."),
  screenshotOptions: screenshotOptionsSchema,
};

type BrowseToolInput = z.infer<z.ZodObject<typeof browseToolShape>>;
type SnapshotToolInput = z.infer<z.ZodObject<typeof snapshotToolShape>>;
type SequenceToolInput = z.infer<z.ZodObject<typeof sequenceToolShape>>;
type SequenceAction = z.infer<typeof sequenceActionSchema>;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function releaseBrowserSlot(): void {
  activeBrowses = Math.max(0, activeBrowses - 1);
  const next = pendingBrowses.shift();
  if (next) {
    next.start();
  }
}

async function acquireBrowserSlot(): Promise<SlotRelease> {
  if (shuttingDown) {
    throw new Error("Server is shutting down.");
  }

  if (activeBrowses < MAX_CONCURRENCY) {
    activeBrowses += 1;
    return releaseBrowserSlot;
  }

  if (pendingBrowses.length >= MAX_QUEUE) {
    throw new Error("Too many concurrent browse requests. Try again later.");
  }

  return new Promise((resolve, reject) => {
    const entry: PendingBrowse = {
      reject,
      timer: setTimeout(() => {
        const index = pendingBrowses.indexOf(entry);
        if (index >= 0) {
          pendingBrowses.splice(index, 1);
        }
        reject(new Error("Timed out waiting for a browse slot."));
      }, QUEUE_TIMEOUT_MS),
      start: () => {
        clearTimeout(entry.timer);
        activeBrowses += 1;
        resolve(releaseBrowserSlot);
      },
    };

    pendingBrowses.push(entry);
  });
}

async function withBrowserSlot<T>(fn: () => Promise<T>): Promise<T> {
  const release = await acquireBrowserSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out.`));
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = url.search ? "?..." : "";
    url.hash = "";
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}

function getProxyServer(proxy?: ProxyConfig): string | undefined {
  if (!proxy) {
    return undefined;
  }

  return typeof proxy === "string" ? proxy : proxy.server;
}

function getProxySecrets(proxy?: ProxyConfig): string[] {
  if (!proxy || typeof proxy === "string") {
    return [];
  }

  return [proxy.username, proxy.password].filter((secret): secret is string => Boolean(secret));
}

function sanitizeErrorMessage(message: string, rawUrls: string[], secrets: string[] = []): string {
  let sanitized = message;

  for (const secret of secrets) {
    sanitized = sanitized.replaceAll(secret, "<redacted>");
  }

  for (const rawUrl of rawUrls) {
    sanitized = sanitized.replaceAll(rawUrl, redactUrl(rawUrl));
  }

  return sanitized.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (matchedUrl) => {
    let suffix = "";
    let candidate = matchedUrl;
    while (candidate.length > 0 && /[),.;\]]$/.test(candidate)) {
      suffix = `${candidate[candidate.length - 1]}${suffix}`;
      candidate = candidate.slice(0, -1);
    }

    return `${redactUrl(candidate)}${suffix}`;
  });
}

function truncateString(value: string, maxChars: number): { value: string; truncated: boolean } {
  return {
    value: value.slice(0, maxChars),
    truncated: value.length > maxChars,
  };
}

function sanitizeDiagnosticText(value: string, rawUrls: string[], secrets: string[]): string {
  return truncateString(sanitizeErrorMessage(value, rawUrls, secrets), MAX_DIAGNOSTIC_TEXT_CHARS).value;
}

function serializeBounded(value: unknown, maxChars: number, rawUrls: string[], secrets: string[]): { value: string; truncated: boolean } {
  let serialized: string;
  try {
    const json = JSON.stringify(value);
    serialized = json === undefined ? "undefined" : json;
  } catch {
    serialized = String(value);
  }

  return truncateString(sanitizeErrorMessage(serialized, rawUrls, secrets), maxChars);
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  return (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "local"
    || hostname.endsWith(".local")
    || hostname === "ip6-localhost"
    || hostname === "ip6-loopback"
  );
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part) || part < 0 || part > 255)) {
    return true;
  }

  const [first, second, third] = parts;
  return first === 0
    || first === 10
    || first === 127
    || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0 && (third === 0 || third === 2))
    || (first === 192 && second === 168)
    || (first === 198 && second === 51 && third === 100)
    || (first === 198 && (second === 18 || second === 19))
    || (first === 203 && second === 0 && third === 113);
}

function ipv4FromMappedIpv6(address: string): string | undefined {
  const dotted = address.match(/^(?:::|0(?::0){4}:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) {
    return dotted[1];
  }

  const separatorParts = address.split("::");
  if (separatorParts.length > 2) {
    return undefined;
  }

  const head = separatorParts[0] ? separatorParts[0].split(":") : [];
  const tail = separatorParts[1] ? separatorParts[1].split(":") : [];
  const fillCount = separatorParts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fillCount < 0 || (separatorParts.length === 1 && head.length !== 8)) {
    return undefined;
  }

  const hextets = [
    ...head,
    ...Array<string>(fillCount).fill("0"),
    ...tail,
  ].map((hextet) => hextet.padStart(4, "0"));

  if (hextets.length !== 8 || !hextets.slice(0, 5).every((hextet) => hextet === "0000") || hextets[5] !== "ffff") {
    return undefined;
  }

  const high = Number.parseInt(hextets[6], 16);
  const low = Number.parseInt(hextets[7], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return undefined;
  }

  return [
    high >> 8,
    high & 255,
    low >> 8,
    low & 255,
  ].join(".");
}

function isBlockedIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(lower);
  if (mappedIpv4) {
    return isBlockedIpv4(mappedIpv4);
  }

  if (lower === "::" || lower === "::1" || lower === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const firstHextet = lower.split(":").find(Boolean);
  if (!firstHextet) {
    return true;
  }

  const first = Number.parseInt(firstHextet, 16);
  if (!Number.isFinite(first)) {
    return true;
  }

  return first === 0
    || (first >= 0xfc00 && first <= 0xfdff)
    || (first >= 0xfe80 && first <= 0xfebf)
    || (first >= 0xff00 && first <= 0xffff)
    || (first === 0x2001 && lower.startsWith("2001:db8"));
}

function isBlockedIp(address: string): boolean {
  const normalized = normalizeHostname(address);
  const version = isIP(normalized);
  if (version === 4) {
    return isBlockedIpv4(normalized);
  }

  if (version === 6) {
    return isBlockedIpv6(normalized);
  }

  return true;
}

function selectOperatingSystem(os: SupportedOs | undefined): SupportedOs {
  if (os) {
    return os;
  }

  return SUPPORTED_OSES[Math.floor(Math.random() * SUPPORTED_OSES.length)];
}

function defaultHeadlessMode(headless: boolean | "virtual" | undefined): boolean | "virtual" {
  if (headless !== undefined) {
    return headless;
  }

  return process.platform === "linux" ? "virtual" : true;
}

interface ParsedTargetUrl {
  parsed: URL;
  hostname: string;
  needsDnsCheck: boolean;
}

function parseAndValidateTargetUrl(rawUrl: string): ParsedTargetUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL must be fully qualified.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new Error("URL host is required.");
  }

  if (isBlockedHostname(hostname)) {
    throw new Error("Local hostnames are not allowed.");
  }

  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new Error("Private, local, or reserved IP addresses are not allowed.");
    }
    return {
      parsed,
      hostname,
      needsDnsCheck: false,
    };
  }

  return {
    parsed,
    hostname,
    needsDnsCheck: true,
  };
}

async function validateTargetUrl(rawUrl: string): Promise<URL> {
  const { parsed, hostname, needsDnsCheck } = parseAndValidateTargetUrl(rawUrl);

  if (!needsDnsCheck) {
    return parsed;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve URL host.");
  }

  if (records.length === 0) {
    throw new Error("URL host did not resolve to an address.");
  }

  if (records.some((record) => isBlockedIp(record.address))) {
    throw new Error("URL host resolves to a private, local, or reserved address.");
  }

  return parsed;
}

function browserRequestPolicyUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("URL must be fully qualified.");
  }

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }

  return parsed.toString();
}

function parseAndValidateBrowserRequestUrl(rawUrl: string): ParsedTargetUrl {
  return parseAndValidateTargetUrl(browserRequestPolicyUrl(rawUrl));
}

async function validateBrowserRequestUrl(rawUrl: string): Promise<URL> {
  return validateTargetUrl(browserRequestPolicyUrl(rawUrl));
}

async function validateProxyConfig(proxy?: ProxyConfig): Promise<void> {
  const server = getProxyServer(proxy);
  if (!server) {
    return;
  }

  try {
    await validateTargetUrl(server);
  } catch (error) {
    throw new Error(`Proxy server is not allowed. ${describeError(error)}`, { cause: error });
  }
}

async function launchCamoufoxBrowser(options: CamoufoxOptions): Promise<Browser> {
  let timedOut = false;
  const launchPromise = Camoufox<undefined, Browser>(options as LaunchOptions);
  launchPromise.then(
    (browser) => {
      if (timedOut) {
        void closeBrowser(browser);
      }
    },
    () => undefined,
  );

  try {
    return await withTimeout(launchPromise, LAUNCH_TIMEOUT_MS, "Browser launch");
  } catch (error) {
    timedOut = true;
    throw error;
  }
}

interface RequestGuard {
  assertAllowed(): void;
  watchPage(page: Page): void;
}

async function installRequestGuard(context: BrowserContext): Promise<RequestGuard> {
  let inspectedRequests = 0;
  let blockedRequestError: Error | undefined;

  function blockRequest(rawUrl: string, reason: string): void {
    if (!blockedRequestError) {
      blockedRequestError = new Error(`Blocked unsafe browser request to ${redactUrl(rawUrl)}. ${reason}`);
    }
  }

  function hasRequestBudget(rawUrl: string): boolean {
    if (inspectedRequests >= MAX_GUARDED_REQUESTS) {
      blockRequest(rawUrl, "Too many browser requests.");
      return false;
    }

    inspectedRequests += 1;
    return true;
  }

  context.on("request", (request) => {
    const requestUrl = request.url();
    try {
      parseAndValidateBrowserRequestUrl(requestUrl);
    } catch (requestError) {
      blockRequest(requestUrl, describeError(requestError));
    }
  });

  await context.route("**/*", async (route: Route) => {
    const requestUrl = route.request().url();

    if (!hasRequestBudget(requestUrl)) {
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    try {
      await validateBrowserRequestUrl(requestUrl);
    } catch (requestError) {
      blockRequest(requestUrl, describeError(requestError));
      await route.abort("blockedbyclient").catch(() => undefined);
      return;
    }

    await route.continue().catch((continueError) => {
      console.error(chalk.yellow(`[Camoufox] Request continue failed: ${describeError(continueError)}`));
    });
  });

  await context.routeWebSocket(/.*/, async (webSocket) => {
    const requestUrl = webSocket.url();

    if (!hasRequestBudget(requestUrl)) {
      await webSocket.close({ code: 1008, reason: "Blocked by server policy" }).catch(() => undefined);
      return;
    }

    try {
      await validateBrowserRequestUrl(requestUrl);
    } catch (requestError) {
      blockRequest(requestUrl, describeError(requestError));
      await webSocket.close({ code: 1008, reason: "Blocked by server policy" }).catch(() => undefined);
      return;
    }

    webSocket.connectToServer();
  });

  return {
    assertAllowed(): void {
      if (blockedRequestError) {
        throw blockedRequestError;
      }
    },
    watchPage(page: Page): void {
      page.on("websocket", (webSocket) => {
        const requestUrl = webSocket.url();
        if (!hasRequestBudget(requestUrl)) {
          return;
        }

        try {
          parseAndValidateBrowserRequestUrl(requestUrl);
        } catch (requestError) {
          blockRequest(requestUrl, describeError(requestError));
        }
      });
    },
  };
}

function hasUnsafeBrowserOptions(
  args?: string[],
  firefoxUserPrefs?: Record<string, unknown>,
  excludeAddons?: string[],
): boolean {
  return Boolean(
    (args?.length ?? 0) > 0
    || Object.keys(firefoxUserPrefs ?? {}).length > 0
    || (excludeAddons?.length ?? 0) > 0,
  );
}

function normalizedArgFlag(arg: string): string | undefined {
  const match = arg.trim().match(/^(-{1,2}[^\s=]+)/);
  return match?.[1]?.toLowerCase();
}

function findDeniedBrowserArg(args?: string[]): string | undefined {
  for (let index = 0; index < (args?.length ?? 0); index += 1) {
    const flag = normalizedArgFlag(args?.[index] ?? "");
    if (!flag) {
      continue;
    }

    if (DENIED_BROWSER_ARG_FLAGS.has(flag)) {
      return flag;
    }
  }

  return undefined;
}

function findDeniedFirefoxPref(firefoxUserPrefs?: Record<string, unknown>): string | undefined {
  for (const key of Object.keys(firefoxUserPrefs ?? {})) {
    const normalizedKey = key.toLowerCase();
    if (
      DENIED_FIREFOX_PREF_KEYS.has(normalizedKey)
      || DENIED_FIREFOX_PREF_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      return key;
    }
  }

  return undefined;
}

function findDeniedUnsafeBrowserOption(
  args?: string[],
  firefoxUserPrefs?: Record<string, unknown>,
): string | undefined {
  const deniedArg = findDeniedBrowserArg(args);
  if (deniedArg) {
    return `args contains ${deniedArg}`;
  }

  const deniedPref = findDeniedFirefoxPref(firefoxUserPrefs);
  if (deniedPref) {
    return `firefox_user_prefs contains ${deniedPref}`;
  }

  return undefined;
}

function isScreenshotDimensionAllowed(viewport?: { width: number; height: number }, window?: [number, number]): boolean {
  const width = viewport?.width ?? window?.[0] ?? MAX_SCREENSHOT_WIDTH;
  const height = viewport?.height ?? window?.[1] ?? MAX_SCREENSHOT_HEIGHT;
  return width <= MAX_SCREENSHOT_WIDTH && height <= MAX_SCREENSHOT_HEIGHT;
}

async function validateCommonBrowserInput(input: CommonBrowserInput): Promise<URL> {
  const targetUrl = await validateTargetUrl(input.url);
  await validateProxyConfig(input.proxy);

  if (!ALLOW_UNSAFE_OPTIONS && hasUnsafeBrowserOptions(input.args, input.firefox_user_prefs, input.exclude_addons)) {
    throw new Error(
      "Unsafe browser options are disabled by server policy. Set CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 to allow args, firefox_user_prefs, or exclude_addons.",
    );
  }

  const deniedUnsafeOption = findDeniedUnsafeBrowserOption(input.args, input.firefox_user_prefs);
  if (deniedUnsafeOption) {
    throw new Error(`Unsafe browser option is denied by server policy: ${deniedUnsafeOption}.`);
  }

  return targetUrl;
}

function buildCamoufoxOptions(input: CommonBrowserInput, selectedOS: SupportedOs, headlessMode: HeadlessMode): CamoufoxOptions {
  return {
    os: [selectedOS],
    headless: headlessMode,
    humanize: input.humanize,
    geoip: input.geoip,
    ublock: true,
    block_webgl: input.block_webgl,
    block_images: input.block_images,
    block_webrtc: input.block_webrtc,
    disable_coop: input.disable_coop,
    locale: input.locale,
    viewport: input.viewport ? {
      width: input.viewport.width,
      height: input.viewport.height,
    } : undefined,
    proxy: input.proxy,
    enable_cache: input.enable_cache,
    firefox_user_prefs: input.firefox_user_prefs,
    exclude_addons: input.exclude_addons,
    window: input.window,
    args: input.args,
  };
}

function browserContextOptions(input: CommonBrowserInput): Parameters<Browser["newContext"]>[0] {
  return {
    serviceWorkers: "block",
    viewport: input.viewport ? {
      width: input.viewport.width,
      height: input.viewport.height,
    } : undefined,
  };
}

async function extractPageContent(
  page: Page,
  outputMode: OutputMode,
  maxChars: number,
  selector?: string,
): Promise<ExtractedContent> {
  if (outputMode === "metadata") {
    return {
      value: "",
      truncated: false,
      found: false,
    };
  }

  return page.evaluate(
    (
      { mode, maxLength, cssSelector, maxNodes }: {
        mode: OutputMode;
        maxLength: number;
        cssSelector?: string;
        maxNodes: number;
      },
    ) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { value: "", truncated: false, found: false };
      }

      const limit = maxLength + 1;
      const blockedTextTags = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);

      function appendBounded(current: string, chunk: string): { value: string; truncated: boolean } {
        const available = limit - current.length;
        if (available <= 0) {
          return { value: current, truncated: chunk.length > 0 };
        }

        if (chunk.length > available) {
          return { value: `${current}${chunk.slice(0, available)}`, truncated: true };
        }

        return { value: `${current}${chunk}`, truncated: false };
      }

      function isHiddenElement(element: Element): boolean {
        if (blockedTextTags.has(element.tagName)) {
          return true;
        }

        if (element instanceof HTMLElement && element.hidden) {
          return true;
        }

        if (element.getAttribute("aria-hidden") === "true") {
          return true;
        }

        const style = window.getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse";
      }

      function isTextNodeVisible(node: Node): boolean {
        let current = node.parentElement;
        while (current) {
          if (isHiddenElement(current)) {
            return false;
          }

          if (current === root) {
            return true;
          }

          current = current.parentElement;
        }

        return true;
      }

      if (mode === "html") {
        const voidTags = new Set([
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "link",
          "meta",
          "param",
          "source",
          "track",
          "wbr",
        ]);
        let html = "";
        let truncated = false;
        let visitedNodes = 0;
        const stack: Array<{ node: Node; closing: boolean }> = [{ node: root, closing: false }];

        function escapeText(value: string): string {
          return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
        }

        function escapeAttribute(value: string): string {
          return escapeText(value).replaceAll("\"", "&quot;");
        }

        function appendHtml(chunk: string): void {
          const result = appendBounded(html, chunk);
          html = result.value;
          truncated = truncated || result.truncated;
        }

        while (stack.length > 0 && html.length < limit && visitedNodes < maxNodes) {
          const current = stack.pop();
          if (!current) {
            break;
          }

          const { node, closing } = current;
          if (closing) {
            appendHtml(`</${(node as Element).tagName.toLowerCase()}>`);
            continue;
          }

          visitedNodes += 1;
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            const tagName = element.tagName.toLowerCase();
            appendHtml(`<${tagName}`);
            for (const attribute of Array.from(element.attributes)) {
              appendHtml(` ${attribute.name}="${escapeAttribute(attribute.value)}"`);
            }
            appendHtml(">");

            if (voidTags.has(tagName)) {
              continue;
            }

            stack.push({ node: element, closing: true });
            for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
              stack.push({ node: element.childNodes[index], closing: false });
            }
          } else if (node.nodeType === Node.TEXT_NODE) {
            appendHtml(escapeText(node.nodeValue ?? ""));
          } else if (node.nodeType === Node.COMMENT_NODE) {
            appendHtml(`<!--${node.nodeValue ?? ""}-->`);
          }
        }

        truncated = truncated || stack.length > 0 || visitedNodes >= maxNodes || html.length > maxLength;
        return {
          value: html.slice(0, maxLength),
          truncated,
          found: true,
        };
      }

      let text = "";
      let truncated = false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !isTextNodeVisible(node)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (text.length < limit) {
        const node = walker.nextNode();
        if (!node) {
          break;
        }

        const result = appendBounded(text, node.nodeValue ?? "");
        text = result.value;
        truncated = truncated || result.truncated;
      }

      truncated = truncated || text.length > maxLength;
      return {
        value: text.slice(0, maxLength),
        truncated,
        found: true,
      };
    },
    { mode: outputMode, maxLength: maxChars, cssSelector: selector, maxNodes: MAX_EXTRACT_NODES },
  );
}

async function buildBrowsePayload(
  page: Page,
  response: Response | null,
  outputMode: OutputMode,
  maxChars: number,
  selector?: string,
): Promise<BrowsePayload> {
  const payload: BrowsePayload = {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    outputMode,
    truncated: false,
    maxChars,
    selector,
  };

  if (outputMode === "metadata") {
    return payload;
  }

  const extracted = await extractPageContent(page, outputMode, maxChars, selector);
  payload.truncated = extracted.truncated;
  payload.selectorFound = extracted.found;

  if (outputMode === "html") {
    payload.html = extracted.value;
  } else {
    payload.text = extracted.value;
  }

  return payload;
}

function createDiagnosticsCollector(
  page: Page,
  input: CommonBrowserInput,
  rawUrls: string[],
  secrets: string[],
): DiagnosticsCollector {
  const consoleEntries: ConsoleDiagnostic[] = [];
  const networkEntries: NetworkDiagnostic[] = [];
  const networkByRequest = new WeakMap<object, NetworkDiagnostic>();
  let consoleTruncated = false;
  let networkTruncated = false;

  if (input.includeConsole) {
    page.on("console", (message) => {
      if (consoleEntries.length >= MAX_DIAGNOSTIC_ENTRIES) {
        consoleTruncated = true;
        return;
      }

      const location = message.location();
      consoleEntries.push({
        type: message.type(),
        text: sanitizeDiagnosticText(message.text(), rawUrls, secrets),
        location: {
          url: location.url ? redactUrl(location.url) : undefined,
          lineNumber: location.lineNumber,
          columnNumber: location.columnNumber,
        },
      });
    });

    page.on("pageerror", (error) => {
      if (consoleEntries.length >= MAX_DIAGNOSTIC_ENTRIES) {
        consoleTruncated = true;
        return;
      }

      consoleEntries.push({
        type: "pageerror",
        text: sanitizeDiagnosticText(describeError(error), rawUrls, secrets),
      });
    });
  }

  if (input.includeNetwork) {
    page.on("request", (request) => {
      if (networkEntries.length >= MAX_DIAGNOSTIC_ENTRIES) {
        networkTruncated = true;
        return;
      }

      const entry: NetworkDiagnostic = {
        url: redactUrl(request.url()),
        method: request.method(),
        resourceType: request.resourceType(),
      };
      networkEntries.push(entry);
      networkByRequest.set(request, entry);
    });

    page.on("response", (response) => {
      const entry = networkByRequest.get(response.request());
      if (!entry) {
        return;
      }

      entry.status = response.status();
      entry.contentType = response.headers()["content-type"];
    });

    page.on("requestfailed", (request) => {
      const entry = networkByRequest.get(request);
      if (!entry) {
        return;
      }

      entry.failed = true;
      entry.errorText = sanitizeDiagnosticText(request.failure()?.errorText ?? "request failed", rawUrls, secrets);
    });
  }

  return {
    payload(): DiagnosticsPayload | undefined {
      const payload: DiagnosticsPayload = {};
      if (input.includeConsole) {
        payload.console = consoleEntries;
        if (consoleTruncated) {
          payload.consoleTruncated = true;
        }
      }
      if (input.includeNetwork) {
        payload.network = networkEntries;
        if (networkTruncated) {
          payload.networkTruncated = true;
        }
      }

      return input.includeConsole || input.includeNetwork ? payload : undefined;
    },
  };
}

function appendDiagnostics<T extends { diagnostics?: DiagnosticsPayload }>(payload: T, diagnostics?: DiagnosticsPayload): T {
  if (diagnostics) {
    payload.diagnostics = diagnostics;
  }

  return payload;
}

async function extractSnapshotElements(
  page: Page,
  maxElements: number,
  selector?: string,
): Promise<{ elements: SnapshotElement[]; truncated: boolean; found: boolean }> {
  return page.evaluate(
    ({ maxItems, cssSelector }: { maxItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { elements: [], truncated: false, found: false };
      }

      function textOf(element: Element): string {
        return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      }

      function cssIdent(value: string): string {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          return CSS.escape(value);
        }

        return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element): string {
        if (element.id) {
          return `#${cssIdent(element.id)}`;
        }

        const path: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.documentElement && path.length < 8) {
          let part = current.tagName.toLowerCase();
          if (current.classList.length > 0) {
            part += `.${Array.from(current.classList).slice(0, 2).map(cssIdent).join(".")}`;
          }

          const currentTagName = current.tagName;
          const parent: Element | null = current.parentElement;
          if (parent) {
            const sameTagSiblings = Array.from(parent.children).filter((child: Element) => child.tagName === currentTagName);
            if (sameTagSiblings.length > 1) {
              part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
            }
          }

          path.unshift(part);
          current = parent;
        }

        return path.join(" > ");
      }

      function inferredRole(element: Element): string | undefined {
        const explicit = element.getAttribute("role");
        if (explicit) {
          return explicit;
        }

        const tagName = element.tagName.toLowerCase();
        if (tagName === "a" && element.hasAttribute("href")) {
          return "link";
        }
        if (tagName === "button") {
          return "button";
        }
        if (tagName === "select") {
          return "combobox";
        }
        if (tagName === "textarea") {
          return "textbox";
        }
        if (tagName === "input") {
          const type = (element.getAttribute("type") ?? "text").toLowerCase();
          if (["button", "submit", "reset"].includes(type)) {
            return "button";
          }
          if (type === "checkbox") {
            return "checkbox";
          }
          if (type === "radio") {
            return "radio";
          }
          return "textbox";
        }

        return undefined;
      }

      function accessibleName(element: Element): string | undefined {
        const direct = element.getAttribute("aria-label")
          ?? element.getAttribute("alt")
          ?? element.getAttribute("title")
          ?? element.getAttribute("placeholder");
        if (direct?.trim()) {
          return direct.trim().slice(0, 300);
        }

        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (text) {
            return text.slice(0, 300);
          }
        }

        return textOf(element) || undefined;
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
      }

      const candidateSelector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "[role]",
        "[tabindex]:not([tabindex='-1'])",
        "[contenteditable='true']",
      ].join(",");
      const candidates = [
        ...(root.matches(candidateSelector) ? [root] : []),
        ...Array.from(root.querySelectorAll(candidateSelector)),
      ];

      const elements = [];
      for (const element of candidates) {
        if (elements.length >= maxItems) {
          break;
        }

        if (!isVisible(element)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        elements.push({
          tag: element.tagName.toLowerCase(),
          selector: selectorFor(element),
          role: inferredRole(element),
          name: accessibleName(element),
          text: textOf(element) || undefined,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }

      return {
        elements,
        truncated: candidates.length > elements.length,
        found: true,
      };
    },
    { maxItems: maxElements, cssSelector: selector },
  );
}

async function buildSnapshotPayload(
  page: Page,
  response: Response | null,
  maxChars: number,
  maxElements: number,
  selector?: string,
): Promise<SnapshotPayload> {
  const text = await extractPageContent(page, "text", maxChars, selector);
  const elementSnapshot = await extractSnapshotElements(page, maxElements, selector);
  const payload: SnapshotPayload = {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    selector,
    selectorFound: text.found && elementSnapshot.found,
    maxChars,
    maxElements,
    text: text.value,
    textTruncated: text.truncated,
    elements: elementSnapshot.elements,
    elementsTruncated: elementSnapshot.truncated,
  };

  if (!payload.selectorFound) {
    return payload;
  }

  try {
    const target = selector ? page.locator(selector).first() : page.locator("body").first();
    const aria = await target.ariaSnapshot({ timeout: 3000 });
    const truncated = truncateString(aria, maxChars);
    payload.ariaSnapshot = truncated.value;
    payload.ariaSnapshotTruncated = truncated.truncated;
  } catch (snapshotError) {
    payload.ariaSnapshotError = describeError(snapshotError);
  }

  return payload;
}

async function captureScreenshot(page: Page, safeUrl: string, options?: ScreenshotOptions): Promise<ScreenshotResult> {
  const type = options?.type ?? "png";
  const screenshotMetadata: ScreenshotMetadata = {
    requested: true,
    included: false,
    maxBytes: MAX_SCREENSHOT_BYTES,
    type,
    fullPage: options?.selector ? false : Boolean(options?.fullPage),
    selector: options?.selector,
  };
  const mimeType = type === "jpeg" ? "image/jpeg" : "image/png";
  const baseOptions = {
    type,
    quality: type === "jpeg" ? options?.quality : undefined,
  };

  try {
    let buffer: Buffer;
    if (options?.selector) {
      const locator = page.locator(options.selector).first();
      const count = await locator.count();
      if (count === 0) {
        screenshotMetadata.selectorFound = false;
        screenshotMetadata.error = "Screenshot selector was not found.";
        return { screenshotMetadata, mimeType };
      }

      screenshotMetadata.selectorFound = true;
      buffer = await locator.screenshot(baseOptions);
    } else {
      buffer = await page.screenshot({
        ...baseOptions,
        fullPage: Boolean(options?.fullPage),
      });
    }

    screenshotMetadata.bytes = buffer.length;

    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      screenshotMetadata.error = "Screenshot exceeded server byte limit.";
      console.error(chalk.yellow(`[Camoufox] Screenshot omitted for ${safeUrl}: byte limit exceeded.`));
      return { screenshotMetadata, mimeType };
    }

    console.error(chalk.green(`[Camoufox] Screenshot captured for ${safeUrl}.`));
    return {
      screenshotMetadata: {
        ...screenshotMetadata,
        included: true,
      },
      mimeType,
      base64: buffer.toString("base64"),
    };
  } catch (screenshotError) {
    screenshotMetadata.error = describeError(screenshotError);
    console.error(chalk.yellow(`[Camoufox] Screenshot failed: ${screenshotMetadata.error}`));
    return { screenshotMetadata, mimeType };
  }
}

function buildSuccessContent(payload: unknown, screenshotResult?: ScreenshotResult): { content: ToolContent[] } {
  const content: ToolContent[] = [{
    type: "text",
    text: JSON.stringify(payload, null, 2),
  }];

  if (screenshotResult?.base64) {
    content.push({
      type: "image",
      data: screenshotResult.base64,
      mimeType: screenshotResult.mimeType,
    });
  }

  return { content };
}

function buildToolFailure(label: string, safeUrl: string, error: unknown, input: CommonBrowserInput) {
  const errorMessage = sanitizeErrorMessage(
    describeError(error),
    [input.url, getProxyServer(input.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl)),
    getProxySecrets(input.proxy),
  );
  console.error(chalk.red(`[Camoufox] Error during ${label} ${safeUrl}: ${errorMessage}`));
  return buildToolError(`Failed to ${label} URL ${safeUrl}. Error: ${errorMessage}`);
}

async function runBrowserOperation<T>(
  label: string,
  input: CommonBrowserInput,
  callback: (context: BrowserOperationContext) => Promise<T>,
): Promise<T> {
  const safeUrl = redactUrl(input.url);
  const targetUrl = await validateCommonBrowserInput(input);

  return withBrowserSlot(async () => {
    const selectedOS = selectOperatingSystem(input.os);
    const waitStrategy = input.waitStrategy ?? "load";
    const headlessMode = defaultHeadlessMode(input.headless);

    console.error(chalk.blue(`[Camoufox] Launching browser to ${label}: ${safeUrl}`));

    const browser = await launchCamoufoxBrowser(buildCamoufoxOptions(input, selectedOS, headlessMode));
    activeBrowsers.add(browser);

    try {
      const context = await browser.newContext(browserContextOptions(input));
      const requestGuard = await installRequestGuard(context);
      const page = await context.newPage();
      requestGuard.watchPage(page);

      const rawUrls = [input.url, getProxyServer(input.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(input.proxy);
      const diagnostics = createDiagnosticsCollector(page, input, rawUrls, secrets);
      let lastNavigationResponse: Response | null = null;
      page.on("response", (response) => {
        const request = response.request();
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          lastNavigationResponse = response;
        }
      });

      let response: Response | null;
      try {
        response = await page.goto(targetUrl.toString(), {
          waitUntil: waitStrategy,
          timeout: input.timeout,
        });
        lastNavigationResponse = response;
      } catch (navigationError) {
        const navigationErrorMessage = describeError(navigationError).toLowerCase();
        if (/\b(?:127\.0\.0\.1|localhost|ip6-localhost|ip6-loopback|::1)\b/.test(navigationErrorMessage)) {
          throw new Error(`Blocked unsafe browser request to ${safeUrl}.`, { cause: navigationError });
        }

        requestGuard.assertAllowed();
        throw navigationError;
      }

      await page.waitForTimeout(GUARD_SETTLE_MS);
      requestGuard.assertAllowed();
      await validateTargetUrl(page.url());
      requestGuard.assertAllowed();

      return await callback({
        page,
        response,
        requestGuard,
        diagnostics,
        selectedOS,
        waitStrategy,
        getLastNavigationResponse: () => lastNavigationResponse,
      });
    } finally {
      console.error(chalk.blue("[Camoufox] Closing browser."));
      await closeBrowser(browser);
    }
  });
}

async function settleAndAssertSafe(page: Page, requestGuard: RequestGuard): Promise<void> {
  await page.waitForTimeout(GUARD_SETTLE_MS);
  requestGuard.assertAllowed();
  await validateTargetUrl(page.url());
  requestGuard.assertAllowed();
}

function actionTimeout(action: { timeout?: number }): number {
  return action.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
}

async function runSequenceAction(
  page: Page,
  action: SequenceAction,
  index: number,
  rawUrls: string[],
  secrets: string[],
): Promise<SequenceActionResult> {
  const started = Date.now();
  const timeout = actionTimeout(action);

  switch (action.type) {
    case "click":
      await page.locator(action.selector).first().click({ timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "hover":
      await page.locator(action.selector).first().hover({ timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "fill":
      await page.locator(action.selector).first().fill(action.value, { timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "type":
      await page.locator(action.selector).first().pressSequentially(action.text, {
        delay: action.delay,
        timeout,
      });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "select":
      await page.locator(action.selector).first().selectOption(action.value, { timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "press":
      if (action.selector) {
        await page.locator(action.selector).first().press(action.key, { timeout });
      } else {
        await page.keyboard.press(action.key);
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "waitFor":
      if (action.selector) {
        await page.waitForSelector(action.selector, { state: action.state, timeout });
      } else {
        await page.waitForLoadState(action.loadState ?? "load", { timeout });
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "scroll":
      if (action.selector) {
        await page.locator(action.selector).first().scrollIntoViewIfNeeded({ timeout });
      }
      await page.mouse.wheel(action.deltaX, action.deltaY);
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "evaluate": {
      if (!ALLOW_EVALUATE) {
        throw new Error("Evaluate action is disabled by server policy. Set CAMOUFOX_MCP_ALLOW_EVALUATE=1 to enable it.");
      }

      const result = await withTimeout(
        page.evaluate((expression) => globalThis.eval(expression), action.expression),
        timeout,
        "Evaluate action",
      );
      const serialized = serializeBounded(result, action.maxChars, rawUrls, secrets);
      return {
        index,
        type: action.type,
        status: "ok",
        result: serialized.value,
        resultTruncated: serialized.truncated,
        durationMs: Date.now() - started,
      };
    }
  }
}

function buildFeatureSummary(
  selectedOS: SupportedOs,
  waitStrategy: string,
  outputMode: OutputMode,
  charLimit: number,
  payload: BrowsePayload,
  proxy: unknown,
  blockWebrtc: boolean | undefined,
  blockImages: boolean | undefined,
  blockWebgl: boolean | undefined,
  disableCoop: boolean | undefined,
  geoip: boolean | undefined,
): string {
  const features = [
    `OS: ${selectedOS}`,
    `wait: ${waitStrategy}`,
    `output: ${outputMode}`,
    payload.truncated ? `truncated: ${charLimit}` : undefined,
    proxy ? "proxy: enabled" : undefined,
    blockWebrtc ? "WebRTC: blocked" : undefined,
    blockImages ? "images: blocked" : undefined,
    blockWebgl ? "WebGL: blocked" : undefined,
    disableCoop ? "COOP: disabled" : undefined,
    !geoip ? "geoip: disabled" : undefined,
  ].filter((feature): feature is string => feature !== undefined);

  return features.join(", ");
}

function isBlockedNavigationResponse(payload: BrowsePayload): boolean {
  if (payload.status !== 403) {
    return false;
  }

  const content = (payload.text ?? payload.html ?? "").toLowerCase();
  return content.includes("forbidden redirect url") || content.includes("blocked redirect");
}

function buildToolError(message: string) {
  return {
    content: [{
      type: "text" as const,
      text: message,
    }],
    isError: true,
  };
}

const server = new McpServer({
  name: "camoufox-mcp-server",
  version: SERVER_VERSION,
});

async function handleBrowse(input: BrowseToolInput) {
  const safeUrl = redactUrl(input.url);

  if (input.screenshot && !isScreenshotDimensionAllowed(input.viewport, input.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse", input, async ({
      page,
      response,
      requestGuard,
      diagnostics,
      selectedOS,
      waitStrategy,
    }) => {
      const mode = input.outputMode ?? "text";
      const charLimit = input.maxChars ?? DEFAULT_MAX_CHARS;
      const payload = await buildBrowsePayload(page, response, mode, charLimit, input.selector);
      requestGuard.assertAllowed();
      if (isBlockedNavigationResponse(payload)) {
        return buildToolError(`Blocked unsafe browser request to ${safeUrl}.`);
      }

      appendDiagnostics(payload, diagnostics.payload());

      let screenshotResult: ScreenshotResult | undefined;
      if (input.screenshot) {
        screenshotResult = await captureScreenshot(page, safeUrl, input.screenshotOptions);
        payload.screenshot = screenshotResult.screenshotMetadata;
      }
      requestGuard.assertAllowed();

      const features = buildFeatureSummary(
        selectedOS,
        waitStrategy,
        mode,
        charLimit,
        payload,
        input.proxy,
        input.block_webrtc,
        input.block_images,
        input.block_webgl,
        input.disable_coop,
        input.geoip,
      );
      console.error(chalk.green(`[Camoufox] Successfully retrieved content from ${safeUrl} (${features}).`));

      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse", safeUrl, error, input);
  }
}

async function handleSnapshot(input: SnapshotToolInput) {
  const safeUrl = redactUrl(input.url);

  try {
    return await runBrowserOperation("browse snapshot", input, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await buildSnapshotPayload(
        page,
        response,
        input.maxChars ?? DEFAULT_MAX_CHARS,
        input.maxElements ?? DEFAULT_MAX_ELEMENTS,
        input.selector,
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      console.error(chalk.green(`[Camoufox] Successfully captured snapshot from ${safeUrl}.`));

      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse snapshot", safeUrl, error, input);
  }
}

async function handleSequence(input: SequenceToolInput) {
  const safeUrl = redactUrl(input.url);

  if (input.screenshot && !isScreenshotDimensionAllowed(input.viewport, input.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse sequence", input, async ({
      page,
      response,
      requestGuard,
      diagnostics,
      getLastNavigationResponse,
    }) => {
      const rawUrls = [input.url, getProxyServer(input.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(input.proxy);
      const actions: SequenceActionResult[] = [];
      for (let index = 0; index < input.actions.length; index += 1) {
        const result = await runSequenceAction(page, input.actions[index], index, rawUrls, secrets);
        actions.push(result);
        await settleAndAssertSafe(page, requestGuard);
      }

      const mode = input.outputMode ?? "text";
      const charLimit = input.maxChars ?? DEFAULT_MAX_CHARS;
      const finalResponse = getLastNavigationResponse() ?? response;
      const contentPayload = await buildBrowsePayload(page, finalResponse, mode, charLimit, input.selector);
      requestGuard.assertAllowed();
      if (isBlockedNavigationResponse(contentPayload)) {
        return buildToolError(`Blocked unsafe browser request to ${safeUrl}.`);
      }

      const snapshot = await buildSnapshotPayload(
        page,
        finalResponse,
        charLimit,
        input.maxElements ?? DEFAULT_MAX_ELEMENTS,
        input.selector,
      );
      requestGuard.assertAllowed();

      const payload: SequencePayload = {
        url: contentPayload.url,
        title: contentPayload.title,
        status: contentPayload.status,
        contentType: contentPayload.contentType,
        initialStatus: response?.status(),
        actions,
        snapshot,
        outputMode: mode,
        truncated: contentPayload.truncated,
        maxChars: charLimit,
        selector: input.selector,
        selectorFound: contentPayload.selectorFound,
        text: contentPayload.text,
        html: contentPayload.html,
      };

      appendDiagnostics(payload, diagnostics.payload());

      let screenshotResult: ScreenshotResult | undefined;
      if (input.screenshot) {
        screenshotResult = await captureScreenshot(page, safeUrl, input.screenshotOptions);
        payload.screenshot = screenshotResult.screenshotMetadata;
      }
      requestGuard.assertAllowed();

      console.error(chalk.green(`[Camoufox] Successfully ran ${actions.length} actions from ${safeUrl}.`));
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse sequence", safeUrl, error, input);
  }
}

server.tool("browse", browseToolShape, async (input) => handleBrowse(input as BrowseToolInput));
server.tool("browse_snapshot", snapshotToolShape, async (input) => handleSnapshot(input as SnapshotToolInput));
server.tool("browse_sequence", sequenceToolShape, async (input) => handleSequence(input as SequenceToolInput));

async function closeBrowser(browser: BrowserInstance): Promise<void> {
  activeBrowsers.delete(browser);
  try {
    await browser.close();
  } catch (closeError) {
    console.error(chalk.yellow(`[Camoufox] Browser close failed: ${describeError(closeError)}`));
  }
}

async function closeActiveBrowsers(): Promise<void> {
  const browsers = Array.from(activeBrowsers);
  await Promise.all(browsers.map((browser) => closeBrowser(browser)));
}

function rejectPendingBrowses(reason: string): void {
  const pending = pendingBrowses.splice(0);
  for (const entry of pending) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
  }
}

async function runServer() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(chalk.yellow("Camoufox MCP Server is running on stdio..."));
  } catch (error) {
    console.error(chalk.red("Fatal error during server initialization:", error));
    process.exit(1);
  }
}

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.error(chalk.yellow(`\n[Camoufox] Shutting down server after ${signal}...`));
  rejectPendingBrowses("Server is shutting down.");
  await closeActiveBrowsers();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  console.error(chalk.red("[Camoufox] Uncaught exception:", error));
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(chalk.red("[Camoufox] Unhandled rejection at:", promise, "reason:", reason));
  process.exit(1);
});

runServer().catch((error) => {
  console.error(chalk.red("Fatal error running server:", error));
  process.exit(1);
});
