#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Camoufox, type LaunchOptions } from "camoufox-js";
import { launchPath } from "camoufox-js/dist/pkgman.js";
import type { Browser, BrowserContext, Locator, Page, Response, Route } from "playwright-core";
import chalk from "chalk";
import {
  parseAndValidateBrowserRequestUrl,
  validateBrowserRequestUrl,
  validateTargetUrl,
} from "./policy.js";

type OutputMode = "text" | "html" | "metadata";
type BrowserInstance = Browser;
type SupportedOs = "windows" | "macos" | "linux";
type HeadlessMode = boolean | "virtual";
type WaitStrategy = "domcontentloaded" | "load" | "networkidle";
type ScreenshotImageType = "png" | "jpeg";
type CaptchaPolicy = "detect" | "pause" | "fail" | "attempt";
type CaptchaProvider = "recaptcha" | "hcaptcha" | "turnstile" | "cloudflare" | "text_captcha" | "generic";
type StealthProfile = "normal" | "privacy" | "human_assisted" | "fast" | "debug";
type WindowSize = [number, number];
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

interface StatusPayload {
  version: string;
  browser: "camoufox";
  browserAvailable: boolean;
  browserPath?: string;
  headlessMode: HeadlessMode;
  platform: NodeJS.Platform;
  activeBrowsers: number;
  activeSessions: number;
  queuedRequests: number;
  maxConcurrency: number;
  maxQueue: number;
  maxSessions: number;
  sessionTtlMs: number;
  unsafeOptionsAllowed: boolean;
  evaluateAllowed: boolean;
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

interface LinkEntry {
  text: string;
  href: string;
  selector: string;
  visible: boolean;
  confidence: number;
}

interface LinksPayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  selector?: string;
  selectorFound: boolean;
  links: LinkEntry[];
  truncated: boolean;
  maxLinks: number;
  diagnostics?: DiagnosticsPayload;
}

interface FormFieldEntry {
  label?: string;
  type: string;
  name?: string;
  selector: string;
  required: boolean;
  placeholder?: string;
  value?: string;
  options?: Array<{ text: string; value: string }>;
}

interface FormEntry {
  selector: string;
  fields: FormFieldEntry[];
  submit?: {
    text?: string;
    selector: string;
  };
}

interface FormsPayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  selector?: string;
  selectorFound: boolean;
  forms: FormEntry[];
  truncated: boolean;
  maxForms: number;
  maxFields: number;
  diagnostics?: DiagnosticsPayload;
}

interface OutlineHeading {
  level: number;
  text: string;
  selector: string;
}

interface OutlinePayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  description?: string;
  selector?: string;
  selectorFound: boolean;
  headings: OutlineHeading[];
  landmarks: string[];
  truncated: boolean;
  maxItems: number;
  diagnostics?: DiagnosticsPayload;
}

interface FindMatch {
  text: string;
  selector: string;
  score: number;
}

interface FindPayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  query: string;
  selector?: string;
  selectorFound: boolean;
  matches: FindMatch[];
  truncated: boolean;
  maxMatches: number;
  contextChars: number;
  diagnostics?: DiagnosticsPayload;
}

interface NetworkSummaryPayload {
  url: string;
  title?: string;
  status?: number;
  contentType?: string;
  requests: number;
  failed: number;
  blocked: number;
  statusCounts: Record<string, number>;
  resourceTypeCounts: Record<string, number>;
  topFailures: NetworkDiagnostic[];
  truncated: boolean;
}

interface CaptchaIframeInfo {
  selector: string;
  src: string;
  title?: string;
}

interface CaptchaElementInfo {
  selector: string;
  frame?: string;
  type: "checkbox" | "input" | "button" | "image";
  label?: string;
}

interface CaptchaDetection {
  captchaDetected: boolean;
  challengeSignals: string[];
  requiresUserAction?: boolean;
  challengeType?: "captcha_or_bot_check";
  message?: string;
  challengeProvider?: CaptchaProvider;
  captchaIframes?: CaptchaIframeInfo[];
  interactiveElements?: CaptchaElementInfo[];
  suggestedStrategy?: string;
}

interface SessionRecord {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  requestGuard: RequestGuard;
  diagnostics: DiagnosticsCollector;
  selectedOS: SupportedOs;
  waitStrategy: WaitStrategy;
  releaseSlot: SlotRelease;
  rawUrls: string[];
  secrets: string[];
  createdAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  lastNavigationResponse: Response | null;
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
  window?: WindowSize;
  args?: string[];
}

interface BrowserLaunchInput {
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
  window?: WindowSize;
  args?: string[];
  block_images?: boolean;
  block_webgl?: boolean;
  disable_coop?: boolean;
  geoip?: boolean;
  headless?: boolean;
  includeConsole?: boolean;
  includeNetwork?: boolean;
  stealthProfile?: StealthProfile;
  captchaPolicy?: CaptchaPolicy;
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

interface CommonBrowserInput extends BrowserLaunchInput {
  url: string;
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

const SERVER_VERSION = "2.0.5";
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
const MAX_SCREENSHOT_AREA = MAX_SCREENSHOT_WIDTH * MAX_SCREENSHOT_HEIGHT;
const MAX_DIAGNOSTIC_ENTRIES = readBoundedInteger("CAMOUFOX_MCP_MAX_DIAGNOSTIC_ENTRIES", 100, 1, 1000);
const MAX_DIAGNOSTIC_TEXT_CHARS = readBoundedInteger("CAMOUFOX_MCP_MAX_DIAGNOSTIC_TEXT_CHARS", 2000, 100, 20000);
const MAX_SESSIONS = readBoundedInteger("CAMOUFOX_MCP_MAX_SESSIONS", 1, 1, 4);
const SESSION_TTL_MS = readBoundedInteger("CAMOUFOX_MCP_SESSION_TTL_MS", 600000, 300000, 900000);

let activeBrowses = 0;
let reservedSessions = 0;
const pendingBrowses: PendingBrowse[] = [];
const activeBrowsers = new Set<BrowserInstance>();
const sessions = new Map<string, SessionRecord>();

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
  z.array(z.number()).length(2).superRefine(([width, height], ctx) => {
    if (width < 320 || width > 3840) {
      ctx.addIssue({
        code: "custom",
        path: [0],
        message: "Window width must be between 320 and 3840.",
      });
    }
    if (height < 240 || height > 2160) {
      ctx.addIssue({
        code: "custom",
        path: [1],
        message: "Window height must be between 240 and 2160.",
      });
    }
  }).optional(),
).describe("Set fixed window size [width, height] instead of random generation. An empty array [] is accepted and treated as if the window parameter was not specified.");

const screenshotOptionsSchema = z.object({
  fullPage: z.boolean().optional().default(false).describe("Capture the full page instead of only the viewport. Byte and viewport/window limits still apply."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector for element-only screenshots."),
  type: z.enum(["png", "jpeg"]).optional().default("png").describe("Screenshot image type."),
  quality: z.number().int().min(1).max(100).optional().describe("JPEG quality from 1-100. Ignored for PNG."),
}).optional().describe("Optional screenshot capture settings. Used only when screenshot is true.");

const stealthProfileSchema = z.enum(["normal", "privacy", "human_assisted", "fast", "debug"]).optional()
  .describe("Convenience profile for common Camoufox browser settings. Explicit options override profile values.");
const captchaPolicySchema = z.enum(["detect", "pause", "fail", "attempt"]).optional()
  .describe("Challenge handling policy. 'detect' reports signals, 'pause' returns state for human action, 'fail' returns an error, 'attempt' returns enhanced challenge metadata and a bounded screenshot without solving or bypassing.");
const anyOutputSchema = z.object({}).passthrough();

const commonBrowserOptionShape = {
  os: z.enum(["windows", "macos", "linux"]).optional().describe("Optional OS to spoof. Can be 'windows', 'macos', or 'linux'. If not specified, will rotate between all OS types."),
  waitStrategy: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("load").describe("Wait strategy for page load. 'domcontentloaded' waits for DOM, 'load' waits for all resources, 'networkidle' waits for network activity to finish."),
  timeout: z.number().min(5000).max(300000).optional().default(60000).describe("Timeout in milliseconds for page load (5-300 seconds)."),
  humanize: z.boolean().optional().describe("Enable realistic cursor movements and human-like behavior for better stealth and anti-detection."),
  locale: z.string().optional().describe("Browser locale (e.g., 'en-US', 'fr-FR')."),
  viewport: viewportSchema,
  block_webrtc: z.boolean().optional().describe("Block WebRTC entirely for enhanced privacy and stealth."),
  proxy: proxySchema,
  enable_cache: z.boolean().optional().describe("Cache pages, requests, etc. Uses more memory but improves performance when revisiting pages."),
  firefox_user_prefs: z.record(z.string(), z.any()).optional().describe("Custom Firefox user preferences to set."),
  exclude_addons: z.array(z.string()).optional().describe("List of default addons to exclude (e.g., ['ublock_origin']). Disabled unless CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1."),
  window: windowSchema,
  args: z.array(z.string()).optional().describe("Additional browser command-line arguments to pass to the browser."),
  block_images: z.boolean().optional().describe("Block all images for faster loading, reduced bandwidth, and lightweight browsing."),
  block_webgl: z.boolean().optional().describe("Block WebGL to prevent fingerprinting and tracking."),
  disable_coop: z.boolean().optional().describe("Disable Cross-Origin-Opener-Policy for sites that require it."),
  geoip: z.boolean().optional().describe("Automatically detect geolocation based on IP address."),
  headless: z.boolean().optional().describe("Run browser in headless mode. Auto-detects best mode for environment if not specified."),
  includeConsole: z.boolean().optional().describe("Include bounded page console diagnostics in the JSON response."),
  includeNetwork: z.boolean().optional().describe("Include bounded network diagnostics in the JSON response."),
  stealthProfile: stealthProfileSchema,
  captchaPolicy: captchaPolicySchema,
};

const commonBrowserToolShape = {
  url: z.string().describe("The URL to navigate to. Must be a fully qualified http or https URL."),
  ...commonBrowserOptionShape,
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
const frameSchema = z.string().max(2000).optional()
  .describe("CSS selector of an iframe. The action's selector is resolved inside this iframe.");

const sequenceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("click"),
    selector: z.string().max(2000),
    frame: frameSchema,
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("hover"),
    selector: z.string().max(2000),
    frame: frameSchema,
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("fill"),
    selector: z.string().max(2000),
    frame: frameSchema,
    value: z.string().max(MAX_MAX_CHARS),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("type"),
    selector: z.string().max(2000),
    frame: frameSchema,
    text: z.string().max(MAX_MAX_CHARS),
    delay: z.number().min(0).max(1000).optional().default(0),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("select"),
    selector: z.string().max(2000),
    frame: frameSchema,
    value: z.union([z.string(), z.array(z.string())]),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("press"),
    selector: z.string().max(2000).optional(),
    frame: frameSchema,
    key: z.string().min(1).max(100),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("waitFor"),
    selector: z.string().max(2000).optional(),
    frame: frameSchema,
    state: z.enum(["attached", "detached", "visible", "hidden"]).optional().default("visible"),
    loadState: z.enum(["domcontentloaded", "load", "networkidle"]).optional(),
    timeout: actionTimeoutSchema,
  }),
  z.object({
    type: z.literal("scroll"),
    selector: z.string().max(2000).optional(),
    frame: frameSchema,
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

const selectorLimitShape = {
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit extraction to one matching element."),
};

const linksToolShape = {
  ...commonBrowserToolShape,
  ...selectorLimitShape,
  maxLinks: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum links to return."),
};

const formsToolShape = {
  ...commonBrowserToolShape,
  ...selectorLimitShape,
  maxForms: z.number().int().min(1).max(100).optional().default(20).describe("Maximum forms to return."),
  maxFields: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum fields to return across all forms."),
};

const outlineToolShape = {
  ...commonBrowserToolShape,
  ...selectorLimitShape,
  maxItems: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum headings and landmarks to return."),
};

const findToolShape = {
  ...commonBrowserToolShape,
  ...selectorLimitShape,
  query: z.string().min(1).max(500).describe("Visible text to search for on the page."),
  maxMatches: z.number().int().min(1).max(50).optional().default(5).describe("Maximum matches to return."),
  contextChars: z.number().int().min(50).max(2000).optional().default(300).describe("Characters of surrounding visible text to return per match."),
};

const screenshotToolShape = {
  ...commonBrowserToolShape,
  selector: z.string().max(2000).optional().describe("Optional CSS selector for element-only screenshots."),
  fullPage: z.boolean().optional().default(false).describe("Capture the full page instead of only the viewport."),
  type: z.enum(["png", "jpeg"]).optional().default("png").describe("Screenshot image type."),
  quality: z.number().int().min(1).max(100).optional().describe("JPEG quality from 1-100. Ignored for PNG."),
};

const consoleToolShape = {
  ...commonBrowserToolShape,
};

const networkSummaryToolShape = {
  ...commonBrowserToolShape,
  maxFailures: z.number().int().min(0).max(50).optional().default(10).describe("Maximum failed requests to include in the summary."),
};

const sessionStartToolShape = {
  ...commonBrowserOptionShape,
};

const sessionIdShape = {
  sessionId: z.string().min(1).max(200).describe("Session ID returned by browse_session_start."),
};

const sessionNavigateToolShape = {
  ...sessionIdShape,
  url: z.string().describe("The URL to navigate to. Must be a fully qualified http or https URL."),
  waitStrategy: z.enum(["domcontentloaded", "load", "networkidle"]).optional().describe("Optional wait strategy override for this navigation."),
  timeout: z.number().min(5000).max(300000).optional().describe("Optional timeout override for this navigation."),
  outputMode: z.enum(["text", "html", "metadata"]).optional().default("text").describe("Response content mode."),
  maxChars: z.number().int().min(100).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS).describe("Maximum text or HTML characters to return."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit extraction."),
  captchaPolicy: captchaPolicySchema,
};

const sessionActionToolShape = {
  ...sessionIdShape,
  action: sequenceActionSchema.describe("One bounded action to run in the existing session."),
  maxChars: z.number().int().min(100).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS).describe("Maximum final visible text characters to return in snapshot."),
  maxElements: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum final snapshot elements to return."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit final snapshot."),
  captchaPolicy: captchaPolicySchema,
};

const sessionSnapshotToolShape = {
  ...sessionIdShape,
  maxChars: z.number().int().min(100).max(MAX_MAX_CHARS).optional().default(DEFAULT_MAX_CHARS).describe("Maximum visible text and ARIA snapshot characters to return."),
  maxElements: z.number().int().min(1).max(MAX_MAX_ELEMENTS).optional().default(DEFAULT_MAX_ELEMENTS).describe("Maximum interactive elements to return."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector to limit snapshot extraction."),
  captchaPolicy: captchaPolicySchema,
};

const sessionResumeToolShape = {
  ...sessionSnapshotToolShape,
  waitStrategy: z.enum(["domcontentloaded", "load", "networkidle"]).optional().describe("Optional load state to wait for before reading the session."),
  timeout: z.number().min(100).max(60000).optional().default(DEFAULT_ACTION_TIMEOUT_MS).describe("Timeout in milliseconds for the resume wait."),
};

const sessionCloseToolShape = {
  ...sessionIdShape,
};

type WithWindowSize<T> = Omit<T, "window"> & { window?: WindowSize };
type BrowseToolInput = WithWindowSize<z.infer<z.ZodObject<typeof browseToolShape>>>;
type SnapshotToolInput = WithWindowSize<z.infer<z.ZodObject<typeof snapshotToolShape>>>;
type SequenceToolInput = WithWindowSize<z.infer<z.ZodObject<typeof sequenceToolShape>>>;
type SequenceAction = z.infer<typeof sequenceActionSchema>;
type LinksToolInput = WithWindowSize<z.infer<z.ZodObject<typeof linksToolShape>>>;
type FormsToolInput = WithWindowSize<z.infer<z.ZodObject<typeof formsToolShape>>>;
type OutlineToolInput = WithWindowSize<z.infer<z.ZodObject<typeof outlineToolShape>>>;
type FindToolInput = WithWindowSize<z.infer<z.ZodObject<typeof findToolShape>>>;
type ScreenshotToolInput = WithWindowSize<z.infer<z.ZodObject<typeof screenshotToolShape>>>;
type ConsoleToolInput = WithWindowSize<z.infer<z.ZodObject<typeof consoleToolShape>>>;
type NetworkSummaryToolInput = WithWindowSize<z.infer<z.ZodObject<typeof networkSummaryToolShape>>>;
type SessionStartToolInput = WithWindowSize<z.infer<z.ZodObject<typeof sessionStartToolShape>>>;
type SessionNavigateToolInput = z.infer<z.ZodObject<typeof sessionNavigateToolShape>>;
type SessionActionToolInput = z.infer<z.ZodObject<typeof sessionActionToolShape>>;
type SessionSnapshotToolInput = z.infer<z.ZodObject<typeof sessionSnapshotToolShape>>;
type SessionResumeToolInput = z.infer<z.ZodObject<typeof sessionResumeToolShape>>;
type SessionCloseToolInput = z.infer<z.ZodObject<typeof sessionCloseToolShape>>;

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

function applyStealthProfile<T extends BrowserLaunchInput>(input: T): T {
  const profile = input.stealthProfile ?? "normal";
  const defaults: BrowserLaunchInput = {
    humanize: true,
    geoip: true,
    block_webrtc: true,
    block_images: false,
    block_webgl: false,
    disable_coop: false,
    enable_cache: false,
    includeConsole: false,
    includeNetwork: false,
  };

  const profileDefaults: Record<StealthProfile, BrowserLaunchInput> = {
    normal: {},
    privacy: {
      block_webgl: true,
    },
    human_assisted: {
      headless: false,
      enable_cache: true,
      captchaPolicy: "pause",
    },
    fast: {
      block_images: true,
      humanize: false,
    },
    debug: {
      includeConsole: true,
      includeNetwork: true,
    },
  };

  return {
    ...defaults,
    ...profileDefaults[profile],
    ...input,
    stealthProfile: profile,
  };
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

async function validateBrowserOptionsInput(input: BrowserLaunchInput): Promise<void> {
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

function isScreenshotDimensionAllowed(viewport?: { width: number; height: number }, window?: WindowSize): boolean {
  const width = viewport?.width ?? window?.[0] ?? MAX_SCREENSHOT_WIDTH;
  const height = viewport?.height ?? window?.[1] ?? MAX_SCREENSHOT_HEIGHT;
  return width <= MAX_SCREENSHOT_WIDTH && height <= MAX_SCREENSHOT_HEIGHT;
}

function isScreenshotAreaAllowed(width: number, height: number): boolean {
  return Number.isFinite(width)
    && Number.isFinite(height)
    && width > 0
    && height > 0
    && width <= MAX_SCREENSHOT_WIDTH
    && height <= MAX_SCREENSHOT_HEIGHT
    && width * height <= MAX_SCREENSHOT_AREA;
}

async function validateCommonBrowserInput(input: CommonBrowserInput): Promise<URL> {
  const targetUrl = await validateTargetUrl(input.url);
  await validateBrowserOptionsInput(input);
  return targetUrl;
}

function buildCamoufoxOptions(input: BrowserLaunchInput, selectedOS: SupportedOs, headlessMode: HeadlessMode): CamoufoxOptions {
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

function browserContextOptions(input: BrowserLaunchInput): Parameters<Browser["newContext"]>[0] {
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
      const blockBoundaryTags = new Set([
        "ADDRESS",
        "ARTICLE",
        "ASIDE",
        "BLOCKQUOTE",
        "BR",
        "DD",
        "DETAILS",
        "DIALOG",
        "DIV",
        "DL",
        "DT",
        "FIELDSET",
        "FIGCAPTION",
        "FIGURE",
        "FOOTER",
        "FORM",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "HEADER",
        "HR",
        "LI",
        "MAIN",
        "NAV",
        "OL",
        "P",
        "PRE",
        "SECTION",
        "TABLE",
        "TBODY",
        "TD",
        "TFOOT",
        "TH",
        "THEAD",
        "TR",
        "UL",
      ]);

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
      let visitedNodes = 0;
      const stack: Array<{ node: Node; closing: boolean }> = [{ node: root, closing: false }];

      function appendText(chunk: string): void {
        const normalized = chunk.replace(/\s+/g, " ").trim();
        if (!normalized) {
          return;
        }

        const needsSpace = text.length > 0 && !/\s$/.test(text) && !/^[,.;:!?)]/.test(normalized);
        const result = appendBounded(text, `${needsSpace ? " " : ""}${normalized}`);
        text = result.value;
        truncated = truncated || result.truncated;
      }

      function appendBoundary(): void {
        if (!text || /\n$/.test(text)) {
          return;
        }

        const result = appendBounded(text.replace(/[ \t]+$/, ""), "\n");
        text = result.value;
        truncated = truncated || result.truncated;
      }

      while (stack.length > 0 && text.length < limit && visitedNodes < maxNodes) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        const { node, closing } = current;
        if (closing) {
          if (blockBoundaryTags.has((node as Element).tagName)) {
            appendBoundary();
          }
          continue;
        }

        visitedNodes += 1;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (isHiddenElement(element)) {
            continue;
          }

          if (element.tagName === "BR") {
            appendBoundary();
            continue;
          }

          if (blockBoundaryTags.has(element.tagName)) {
            appendBoundary();
          }

          stack.push({ node: element, closing: true });
          for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
            stack.push({ node: element.childNodes[index], closing: false });
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          appendText(node.nodeValue ?? "");
        }
      }

      const normalizedText = text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      truncated = truncated || stack.length > 0 || visitedNodes >= maxNodes || text.length > maxLength || normalizedText.length > maxLength;
      return {
        value: normalizedText.slice(0, maxLength),
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
  input: BrowserLaunchInput,
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
      let truncated = false;
      for (const element of candidates) {
        if (!isVisible(element)) {
          continue;
        }

        if (elements.length >= maxItems) {
          truncated = true;
          break;
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
        truncated,
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

async function extractLinks(
  page: Page,
  maxLinks: number,
  selector?: string,
): Promise<{ links: LinkEntry[]; truncated: boolean; found: boolean }> {
  return page.evaluate(
    ({ maxItems, cssSelector }: { maxItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { links: [], truncated: false, found: false };
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

          const parent: Element | null = current.parentElement;
          if (parent) {
            const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
            if (sameTagSiblings.length > 1) {
              part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
            }
          }

          path.unshift(part);
          current = parent;
        }

        return path.join(" > ");
      }

      function textOf(element: Element): string {
        return (element.textContent ?? element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
      }

      const candidates = [
        ...(root.matches("a[href]") ? [root as HTMLAnchorElement] : []),
        ...Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")),
      ];
      const links = [];
      let truncated = false;
      const seen = new Set<string>();

      for (const link of candidates) {
        const href = link.href;
        if (!href || seen.has(href)) {
          continue;
        }

        const visible = isVisible(link);
        const text = textOf(link);
        if (!text && !visible) {
          continue;
        }

        if (links.length >= maxItems) {
          truncated = true;
          break;
        }

        seen.add(href);
        links.push({
          text,
          href,
          selector: selectorFor(link),
          visible,
          confidence: visible && text ? 0.95 : visible || text ? 0.75 : 0.5,
        });
      }

      return { links, truncated, found: true };
    },
    { maxItems: maxLinks, cssSelector: selector },
  );
}

async function buildLinksPayload(
  page: Page,
  response: Response | null,
  maxLinks: number,
  selector?: string,
): Promise<LinksPayload> {
  const extracted = await extractLinks(page, maxLinks, selector);
  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    selector,
    selectorFound: extracted.found,
    links: extracted.links,
    truncated: extracted.truncated,
    maxLinks,
  };
}

async function extractForms(
  page: Page,
  maxForms: number,
  maxFields: number,
  selector?: string,
): Promise<{ forms: FormEntry[]; truncated: boolean; found: boolean }> {
  return page.evaluate(
    ({ maxFormItems, maxFieldItems, cssSelector }: { maxFormItems: number; maxFieldItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { forms: [], truncated: false, found: false };
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
        if (element instanceof HTMLInputElement && element.name) {
          return `input[name="${element.name.replaceAll("\"", "\\\"")}"]`;
        }
        if (element instanceof HTMLTextAreaElement && element.name) {
          return `textarea[name="${element.name.replaceAll("\"", "\\\"")}"]`;
        }
        if (element instanceof HTMLSelectElement && element.name) {
          return `select[name="${element.name.replaceAll("\"", "\\\"")}"]`;
        }

        const path: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.documentElement && path.length < 8) {
          let part = current.tagName.toLowerCase();
          const parent: Element | null = current.parentElement;
          if (parent) {
            const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
            if (sameTagSiblings.length > 1) {
              part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
            }
          }
          path.unshift(part);
          current = parent;
        }
        return path.join(" > ");
      }

      function textOf(element: Element | null): string | undefined {
        const text = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
        return text ? text.slice(0, 300) : undefined;
      }

      function labelFor(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | undefined {
        const aria = field.getAttribute("aria-label")?.trim();
        if (aria) {
          return aria.slice(0, 300);
        }

        const labelledBy = field.getAttribute("aria-labelledby");
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

        if (field.id) {
          const label = document.querySelector(`label[for="${cssIdent(field.id)}"]`);
          const text = textOf(label);
          if (text) {
            return text;
          }
        }

        const parentLabel = field.closest("label");
        const parentText = textOf(parentLabel);
        if (parentText) {
          return parentText;
        }

        return field.getAttribute("placeholder")?.trim().slice(0, 300) || undefined;
      }

      const formCandidates = [
        ...(root.matches("form") ? [root as HTMLFormElement] : []),
        ...Array.from(root.querySelectorAll<HTMLFormElement>("form")),
      ];
      if (formCandidates.length === 0) {
        const looseFields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
        if (looseFields.length > 0) {
          formCandidates.push(root as HTMLFormElement);
        }
      }

      const forms = [];
      let fieldCount = 0;
      let truncated = false;
      for (const form of formCandidates) {
        if (forms.length >= maxFormItems) {
          truncated = true;
          break;
        }

        const fields = [];
        const fieldCandidates = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
        for (const field of fieldCandidates) {
          const tagName = field.tagName.toLowerCase();
          const type = tagName === "input" ? (field.getAttribute("type") ?? "text").toLowerCase() : tagName;
          if (["hidden", "button", "submit", "reset", "image"].includes(type)) {
            continue;
          }
          if (fieldCount >= maxFieldItems) {
            truncated = true;
            break;
          }

          fieldCount += 1;
          const options = field instanceof HTMLSelectElement
            ? Array.from(field.options).slice(0, 50).map((option) => ({
              text: option.text.replace(/\s+/g, " ").trim().slice(0, 300),
              value: option.value,
            }))
            : undefined;
          fields.push({
            label: labelFor(field),
            type,
            name: field.getAttribute("name") ?? undefined,
            selector: selectorFor(field),
            required: field.hasAttribute("required"),
            placeholder: field.getAttribute("placeholder") ?? undefined,
            value: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value.slice(0, 300) : undefined,
            options,
          });
        }

        const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>("button[type='submit'], input[type='submit'], button:not([type])");
        forms.push({
          selector: selectorFor(form),
          fields,
          submit: submit ? {
            text: textOf(submit) ?? submit.getAttribute("value") ?? undefined,
            selector: selectorFor(submit),
          } : undefined,
        });
      }

      return { forms, truncated, found: true };
    },
    { maxFormItems: maxForms, maxFieldItems: maxFields, cssSelector: selector },
  );
}

async function buildFormsPayload(
  page: Page,
  response: Response | null,
  maxForms: number,
  maxFields: number,
  selector?: string,
): Promise<FormsPayload> {
  const extracted = await extractForms(page, maxForms, maxFields, selector);
  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    selector,
    selectorFound: extracted.found,
    forms: extracted.forms,
    truncated: extracted.truncated,
    maxForms,
    maxFields,
  };
}

async function buildOutlinePayload(
  page: Page,
  response: Response | null,
  maxItems: number,
  selector?: string,
): Promise<OutlinePayload> {
  const extracted = await page.evaluate(
    ({ maxOutlineItems, cssSelector }: { maxOutlineItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { headings: [], landmarks: [], description: undefined, truncated: false, found: false };
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
          const parent: Element | null = current.parentElement;
          if (parent) {
            const currentTagName = current.tagName;
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

      const headingCandidates = Array.from(root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"));
      const headings: Array<{ level: number; text: string; selector: string }> = [];
      let truncated = false;
      for (const heading of headingCandidates) {
        const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) {
          continue;
        }
        if (headings.length >= maxOutlineItems) {
          truncated = true;
          break;
        }
        headings.push({
          level: Number.parseInt(heading.tagName.slice(1), 10),
          text: text.slice(0, 500),
          selector: selectorFor(heading),
        });
      }

      const landmarkCandidates = Array.from(root.querySelectorAll("[role], header, nav, main, aside, footer, form"));
      const landmarks: string[] = [];
      for (const landmark of landmarkCandidates) {
        if (landmarks.length >= maxOutlineItems) {
          truncated = true;
          break;
        }
        const role = landmark.getAttribute("role") ?? landmark.tagName.toLowerCase();
        if (role && !landmarks.includes(role)) {
          landmarks.push(role);
        }
      }

      const description = document.querySelector<HTMLMetaElement>("meta[name='description']")?.content;
      return {
        headings,
        landmarks,
        description: description?.slice(0, 1000),
        truncated,
        found: true,
      };
    },
    { maxOutlineItems: maxItems, cssSelector: selector },
  );

  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    description: extracted.description,
    selector,
    selectorFound: extracted.found,
    headings: extracted.headings,
    landmarks: extracted.landmarks,
    truncated: extracted.truncated,
    maxItems,
  };
}

async function buildFindPayload(
  page: Page,
  response: Response | null,
  query: string,
  maxMatches: number,
  contextChars: number,
  selector?: string,
): Promise<FindPayload> {
  const extracted = await page.evaluate(
    (
      { searchQuery, maxItems, surroundingChars, cssSelector }: {
        searchQuery: string;
        maxItems: number;
        surroundingChars: number;
        cssSelector?: string;
      },
    ) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { matches: [], truncated: false, found: false };
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
          const parent: Element | null = current.parentElement;
          if (parent) {
            const currentTagName = current.tagName;
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

      function isHiddenElement(element: Element): boolean {
        if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(element.tagName)) {
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

      const normalizedQuery = searchQuery.toLowerCase();
      const matches = [];
      let truncated = false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !isTextNodeVisible(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (true) {
        const node = walker.nextNode();
        if (!node) {
          break;
        }

        const rawText = (node.nodeValue ?? "").replace(/\s+/g, " ");
        const index = rawText.toLowerCase().indexOf(normalizedQuery);
        if (index < 0) {
          continue;
        }

        if (matches.length >= maxItems) {
          truncated = true;
          break;
        }

        const start = Math.max(0, index - surroundingChars);
        const end = Math.min(rawText.length, index + searchQuery.length + surroundingChars);
        matches.push({
          text: rawText.slice(start, end).trim(),
          selector: selectorFor(node.parentElement ?? root),
          score: 1,
        });
      }

      return { matches, truncated, found: true };
    },
    { searchQuery: query, maxItems: maxMatches, surroundingChars: contextChars, cssSelector: selector },
  );

  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    query,
    selector,
    selectorFound: extracted.found,
    matches: extracted.matches,
    truncated: extracted.truncated,
    maxMatches,
    contextChars,
  };
}

const CAPTCHA_STRATEGIES: Record<CaptchaProvider, string> = {
  recaptcha: "Use the returned iframe metadata and screenshot to guide manual reCAPTCHA completion, then resume the session.",
  hcaptcha: "Use the returned iframe metadata and screenshot to guide manual hCaptcha completion, then resume the session.",
  turnstile: "Wait briefly for automatic completion. If the challenge remains, use the returned metadata and screenshot to guide manual completion.",
  cloudflare: "Wait briefly for automatic completion. If still blocked, use the returned metadata and screenshot to guide manual completion.",
  text_captcha: "Use the returned screenshot to inspect the prompt, complete it manually, then resume the session.",
  generic: "Use the returned metadata and screenshot to inspect the challenge, complete it manually, then resume the session.",
};

function classifyCaptchaProvider(src: string): { provider: CaptchaProvider; selector: string } | undefined {
  if (/recaptcha/.test(src)) return { provider: "recaptcha", selector: "iframe[src*='recaptcha']" };
  if (/hcaptcha/.test(src)) return { provider: "hcaptcha", selector: "iframe[src*='hcaptcha']" };
  if (/turnstile|challenges\.cloudflare/.test(src)) return { provider: "turnstile", selector: "iframe[src*='turnstile'], iframe[src*='challenges.cloudflare']" };
  return undefined;
}

async function detectChallenge(page: Page, response?: Response | null, attemptMode = false): Promise<CaptchaDetection> {
  const { signals, iframeData } = await page.evaluate((collectIframeData: boolean) => {
    const found: string[] = [];
    const add = (signal: string) => {
      if (!found.includes(signal) && found.length < 20) {
        found.push(signal);
      }
    };

    const iframeInfo: Array<{ src: string; title: string; nth: number }> = [];
    const allIframes = Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe"));
    for (let i = 0; i < allIframes.length; i++) {
      const iframe = allIframes[i];
      const haystack = `${iframe.src} ${iframe.title}`.toLowerCase();
      if (/(captcha|recaptcha|hcaptcha|turnstile)/.test(haystack)) {
        add("iframe:captcha");
        if (collectIframeData) {
          iframeInfo.push({ src: iframe.src, title: iframe.title, nth: i });
        }
      }
    }

    for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("input"))) {
      const haystack = `${input.name} ${input.id} ${input.type}`.toLowerCase();
      if (/(captcha|challenge|token)/.test(haystack)) {
        add("input:challenge");
      }
    }

    const visibleText = (document.body?.innerText ?? "").toLowerCase();
    if (/verify (that )?you are human|checking your browser|human verification|security check/.test(visibleText)) {
      add("visibleText:human-verification");
    }

    const title = document.title.toLowerCase();
    if (/just a moment|attention required|security check|captcha/.test(title)) {
      add("title:challenge");
    }

    if (/cloudflare|cf-challenge|turnstile/.test(document.documentElement.innerHTML.toLowerCase())) {
      add("markup:challenge-provider");
    }

    return { signals: found, iframeData: collectIframeData ? iframeInfo : undefined };
  }, attemptMode).catch(() => ({ signals: [] as string[], iframeData: undefined as Array<{ src: string; title: string; nth: number }> | undefined }));

  if (response?.status() === 403 || response?.status() === 429) {
    signals.push(`status:${response.status()}`);
  }

  const uniqueSignals = Array.from(new Set(signals)).slice(0, 20);
  const captchaDetected = uniqueSignals.length > 0;

  if (!captchaDetected) {
    return { captchaDetected: false, challengeSignals: [] };
  }

  const base: CaptchaDetection = {
    captchaDetected: true,
    challengeSignals: uniqueSignals,
    challengeType: "captcha_or_bot_check",
    message: "A human verification challenge appears to be present. Complete it manually, then resume the session.",
  };

  if (!attemptMode) return base;

  const captchaIframes: CaptchaIframeInfo[] = [];
  const interactiveElements: CaptchaElementInfo[] = [];
  let provider: CaptchaProvider = "generic";

  for (const { src, title, nth } of (iframeData ?? []).slice(0, 3)) {
    const classified = classifyCaptchaProvider(src);
    const selector = classified?.selector ?? `iframe:nth-of-type(${nth + 1})`;
    if (classified) provider = classified.provider;

    captchaIframes.push({ selector, src, title: title || undefined });

    // Best-effort metadata for caller-guided challenge completion.
    try {
      const frameLoc = page.frameLocator(selector);
      const elementTypes: Array<{ loc: ReturnType<typeof frameLoc.locator>; elType: CaptchaElementInfo["type"]; baseSelector: string }> = [
        { loc: frameLoc.locator('input[type="checkbox"], [role="checkbox"]'), elType: "checkbox", baseSelector: "input[type='checkbox'], [role='checkbox']" },
        { loc: frameLoc.locator("button, [role='button'], input[type='submit']"), elType: "button", baseSelector: "button, [role='button']" },
        { loc: frameLoc.locator("input[type='text'], input:not([type]), textarea"), elType: "input", baseSelector: "input[type='text'], textarea" },
      ];

      for (const { loc, elType, baseSelector } of elementTypes) {
        const count = Math.min(await loc.count(), 5);
        for (let i = 0; i < count; i++) {
          const el = loc.nth(i);
          const label = await el.getAttribute("aria-label").catch(() => undefined)
            ?? await el.getAttribute("title").catch(() => undefined)
            ?? await el.getAttribute("name").catch(() => undefined);
          interactiveElements.push({
            selector: count === 1 ? baseSelector : `${baseSelector} >> nth=${i}`,
            frame: selector,
            type: elType,
            label: label || undefined,
          });
        }
      }
    } catch {
      // Cross-origin or frame not ready, skip
    }
  }

  if (provider === "generic" && uniqueSignals.includes("markup:challenge-provider")) {
    provider = "cloudflare";
  }
  if (provider === "generic" && uniqueSignals.some((signal) => signal.startsWith("input:"))) {
    provider = "text_captcha";
  }

  return {
    ...base,
    challengeProvider: provider,
    captchaIframes: captchaIframes.length > 0 ? captchaIframes : undefined,
    interactiveElements: interactiveElements.length > 0 ? interactiveElements : undefined,
    suggestedStrategy: CAPTCHA_STRATEGIES[provider],
  };
}

function applyCaptchaPolicy<T extends object>(
  payload: T,
  detection: CaptchaDetection,
  policy: CaptchaPolicy | undefined,
): T & CaptchaDetection {
  const effectivePolicy = policy ?? "pause";
  if (!detection.captchaDetected || effectivePolicy === "detect") {
    return { ...payload, ...detection };
  }

  if (effectivePolicy === "fail") {
    throw new Error(`Human verification challenge detected: ${detection.challengeSignals.join(", ")}`);
  }

  if (effectivePolicy === "attempt") {
    return {
      ...payload,
      ...detection,
      requiresUserAction: true,
    };
  }

  return {
    ...payload,
    ...detection,
    requiresUserAction: true,
  };
}

async function maybeDetectCaptcha<T extends object>(
  page: Page,
  response: Response | null,
  payload: T,
  captchaPolicy: CaptchaPolicy | undefined,
  safeUrl: string,
): Promise<{ mergedPayload: T & CaptchaDetection; captchaScreenshot?: ScreenshotResult }> {
  if (!captchaPolicy) {
    return { mergedPayload: payload as T & CaptchaDetection };
  }
  const attemptMode = captchaPolicy === "attempt";
  const detection = await detectChallenge(page, response, attemptMode);
  const mergedPayload = applyCaptchaPolicy(payload, detection, captchaPolicy);
  const captchaScreenshot = attemptMode && detection.captchaDetected
    ? await captureCaptchaScreenshot(page, safeUrl)
    : undefined;
  return { mergedPayload, captchaScreenshot };
}

function buildNetworkSummary(
  page: Page,
  response: Response | null,
  diagnostics: DiagnosticsPayload | undefined,
  maxFailures: number,
): Promise<NetworkSummaryPayload> {
  return page.title().then((title) => {
    const network = diagnostics?.network ?? [];
    const statusCounts: Record<string, number> = {};
    const resourceTypeCounts: Record<string, number> = {};
    let failed = 0;
    let blocked = 0;

    for (const entry of network) {
      if (entry.status !== undefined) {
        statusCounts[String(entry.status)] = (statusCounts[String(entry.status)] ?? 0) + 1;
      }
      resourceTypeCounts[entry.resourceType] = (resourceTypeCounts[entry.resourceType] ?? 0) + 1;
      if (entry.failed || (entry.status !== undefined && entry.status >= 400)) {
        failed += 1;
      }
      if (entry.errorText?.toLowerCase().includes("blocked") || entry.status === 403) {
        blocked += 1;
      }
    }

    return {
      url: redactUrl(page.url()),
      title,
      status: response?.status(),
      contentType: response?.headers()["content-type"],
      requests: network.length,
      failed,
      blocked,
      statusCounts,
      resourceTypeCounts,
      topFailures: network
        .filter((entry) => entry.failed || (entry.status !== undefined && entry.status >= 400))
        .slice(0, maxFailures),
      truncated: Boolean(diagnostics?.networkTruncated),
    };
  });
}

async function captureCaptchaScreenshot(page: Page, safeUrl: string): Promise<ScreenshotResult | undefined> {
  try {
    return await captureScreenshot(page, safeUrl, { fullPage: false });
  } catch {
    return undefined;
  }
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
      const clip = await locator.evaluate((element) => {
        element.scrollIntoView({ block: "center", inline: "center" });
        const rect = element.getBoundingClientRect();
        return {
          x: Math.max(0, rect.x),
          y: Math.max(0, rect.y),
          width: rect.width,
          height: rect.height,
        };
      });

      if (clip.width <= 0 || clip.height <= 0) {
        screenshotMetadata.error = "Screenshot selector has no visible area.";
        return { screenshotMetadata, mimeType };
      }

      if (!isScreenshotAreaAllowed(clip.width, clip.height)) {
        screenshotMetadata.error = `Screenshot selector exceeds server dimension policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`;
        return { screenshotMetadata, mimeType };
      }

      buffer = await page.screenshot({
        ...baseOptions,
        clip,
      });
    } else {
      if (options?.fullPage) {
        const dimensions = await page.evaluate(() => {
          const documentElement = document.documentElement;
          const body = document.body;
          return {
            width: Math.max(
              documentElement.scrollWidth,
              documentElement.clientWidth,
              body?.scrollWidth ?? 0,
              body?.clientWidth ?? 0,
            ),
            height: Math.max(
              documentElement.scrollHeight,
              documentElement.clientHeight,
              body?.scrollHeight ?? 0,
              body?.clientHeight ?? 0,
            ),
          };
        });

        if (!isScreenshotAreaAllowed(dimensions.width, dimensions.height)) {
          screenshotMetadata.error = `Full-page screenshot exceeds server dimension policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`;
          return { screenshotMetadata, mimeType };
        }
      }

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

function buildSuccessContent(payload: unknown, screenshotResult?: ScreenshotResult): { content: ToolContent[]; structuredContent: Record<string, unknown> } {
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

  return {
    content,
    structuredContent: typeof payload === "object" && payload !== null
      ? payload as Record<string, unknown>
      : { value: payload },
  };
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
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);
  const targetUrl = await validateCommonBrowserInput(effectiveInput);

  return withBrowserSlot(async () => {
    const selectedOS = selectOperatingSystem(effectiveInput.os);
    const waitStrategy = effectiveInput.waitStrategy ?? "load";
    const headlessMode = defaultHeadlessMode(effectiveInput.headless);

    console.error(chalk.blue(`[Camoufox] Launching browser to ${label}: ${safeUrl}`));

    const browser = await launchCamoufoxBrowser(buildCamoufoxOptions(effectiveInput, selectedOS, headlessMode));
    activeBrowsers.add(browser);

    try {
      const context = await browser.newContext(browserContextOptions(effectiveInput));
      const requestGuard = await installRequestGuard(context);
      const page = await context.newPage();
      requestGuard.watchPage(page);

      const rawUrls = [effectiveInput.url, getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(effectiveInput.proxy);
      const diagnostics = createDiagnosticsCollector(page, effectiveInput, rawUrls, secrets);
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
          timeout: effectiveInput.timeout,
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

async function assertPageLocationSafe(page: Page): Promise<void> {
  if (page.url() === "about:blank") {
    return;
  }

  await validateTargetUrl(page.url());
}

async function settleAndAssertSafe(page: Page, requestGuard: RequestGuard): Promise<void> {
  await page.waitForTimeout(GUARD_SETTLE_MS);
  requestGuard.assertAllowed();
  await assertPageLocationSafe(page);
  requestGuard.assertAllowed();
}

async function runGuardedPageRead<T>(page: Page, requestGuard: RequestGuard, read: () => Promise<T>): Promise<T> {
  try {
    requestGuard.assertAllowed();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    const result = await read();
    await page.waitForTimeout(GUARD_SETTLE_MS).catch(() => undefined);
    requestGuard.assertAllowed();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    return result;
  } catch (readError) {
    await page.waitForTimeout(GUARD_SETTLE_MS).catch(() => undefined);
    requestGuard.assertAllowed();
    await assertPageLocationSafe(page);
    requestGuard.assertAllowed();
    throw readError;
  }
}

function actionTimeout(action: { timeout?: number }): number {
  return action.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
}

function resolveLocator(page: Page, selector: string, frame?: string): Locator {
  if (frame) return page.frameLocator(frame).locator(selector).first();
  return page.locator(selector).first();
}

async function activateElement(page: Page, selector: string, timeout: number, frame?: string): Promise<void> {
  const locator = resolveLocator(page, selector, frame);
  await locator.waitFor({ state: "visible", timeout });
  if (!await locator.isEnabled({ timeout })) {
    throw new Error(`Click selector is disabled: ${selector}`);
  }

  // Camoufox's virtual display can hang during low-level mouse clicks in CI.
  // Keep this as DOM activation, without Playwright's stability-gated scroll
  // or pointer hit-testing, until mouse actions are stable under Xvfb.
  await withTimeout(
    locator.evaluate((element: HTMLElement) => {
      const clickable = element as HTMLElement & { click?: () => void };
      if (typeof clickable.click === "function") {
        clickable.click();
        return;
      }

      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }),
    timeout,
    "Click action",
  );
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
      await activateElement(page, action.selector, timeout, action.frame);
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "hover":
      await resolveLocator(page, action.selector, action.frame).hover({ timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "fill":
      await resolveLocator(page, action.selector, action.frame).fill(action.value, { timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "type":
      await resolveLocator(page, action.selector, action.frame).pressSequentially(action.text, {
        delay: action.delay,
        timeout,
      });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "select":
      await resolveLocator(page, action.selector, action.frame).selectOption(action.value, { timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "press":
      if (action.selector) {
        await resolveLocator(page, action.selector, action.frame).press(action.key, { timeout });
      } else {
        await withTimeout(page.keyboard.press(action.key), timeout, "Press action");
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "waitFor":
      if (action.selector) {
        if (action.frame) {
          await resolveLocator(page, action.selector, action.frame).waitFor({ state: action.state, timeout });
        } else {
          await page.waitForSelector(action.selector, { state: action.state, timeout });
        }
      } else {
        await page.waitForLoadState(action.loadState ?? "load", { timeout });
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "scroll":
      if (action.selector) {
        const locator = resolveLocator(page, action.selector, action.frame);
        await locator.waitFor({ state: "attached", timeout });
        await withTimeout(
          locator.evaluate(async (element: HTMLElement, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
            const target = element as HTMLElement;
            const beforeLeft = target.scrollLeft;
            const beforeTop = target.scrollTop;
            let scrollEventFired = false;
            await new Promise<void>((resolve) => {
              const timer = window.setTimeout(() => resolve(), 100);
              target.addEventListener("scroll", () => {
                scrollEventFired = true;
                window.clearTimeout(timer);
                resolve();
              }, { once: true });
              target.scrollBy(deltaX, deltaY);
              if (target.scrollLeft === beforeLeft && target.scrollTop === beforeTop) {
                window.clearTimeout(timer);
                resolve();
              }
            });
            if (!scrollEventFired && (target.scrollLeft !== beforeLeft || target.scrollTop !== beforeTop)) {
              target.dispatchEvent(new Event("scroll", { bubbles: true }));
            }
          }, { deltaX: action.deltaX, deltaY: action.deltaY }),
          timeout,
          "Scroll action",
        );
      } else {
        await page.mouse.wheel(action.deltaX, action.deltaY);
      }
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

const readOnlyOpenWorld: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const nonReadOnlyOpenWorld: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

function buildStatusPayload(): StatusPayload {
  let browserAvailable: boolean;
  let browserPath: string | undefined;
  try {
    browserPath = String(launchPath());
    browserAvailable = true;
  } catch {
    browserAvailable = false;
  }

  return {
    version: SERVER_VERSION,
    browser: "camoufox",
    browserAvailable,
    browserPath,
    headlessMode: defaultHeadlessMode(undefined),
    platform: process.platform,
    activeBrowsers: activeBrowsers.size,
    activeSessions: sessions.size,
    queuedRequests: pendingBrowses.length,
    maxConcurrency: MAX_CONCURRENCY,
    maxQueue: MAX_QUEUE,
    maxSessions: MAX_SESSIONS,
    sessionTtlMs: SESSION_TTL_MS,
    unsafeOptionsAllowed: ALLOW_UNSAFE_OPTIONS,
    evaluateAllowed: ALLOW_EVALUATE,
  };
}

async function handleStatus() {
  return buildSuccessContent(buildStatusPayload());
}

async function handleBrowse(input: BrowseToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  if (effectiveInput.screenshot && !isScreenshotDimensionAllowed(effectiveInput.viewport, effectiveInput.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
      selectedOS,
      waitStrategy,
    }) => {
      const mode = effectiveInput.outputMode ?? "text";
      const charLimit = effectiveInput.maxChars ?? DEFAULT_MAX_CHARS;
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildBrowsePayload(page, response, mode, charLimit, effectiveInput.selector),
      );
      requestGuard.assertAllowed();
      if (isBlockedNavigationResponse(payload)) {
        return buildToolError(`Blocked unsafe browser request to ${safeUrl}.`);
      }

      appendDiagnostics(payload, diagnostics.payload());

      let screenshotResult: ScreenshotResult | undefined;
      if (effectiveInput.screenshot) {
        screenshotResult = await captureScreenshot(page, safeUrl, effectiveInput.screenshotOptions);
        payload.screenshot = screenshotResult.screenshotMetadata;
      }
      requestGuard.assertAllowed();

      const features = buildFeatureSummary(
        selectedOS,
        waitStrategy,
        mode,
        charLimit,
        payload,
        effectiveInput.proxy,
        effectiveInput.block_webrtc,
        effectiveInput.block_images,
        effectiveInput.block_webgl,
        effectiveInput.disable_coop,
        effectiveInput.geoip,
      );
      console.error(chalk.green(`[Camoufox] Successfully retrieved content from ${safeUrl} (${features}).`));

      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, screenshotResult ?? captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse", safeUrl, error, effectiveInput);
  }
}

async function handleSnapshot(input: SnapshotToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse snapshot", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildSnapshotPayload(
          page,
          response,
          effectiveInput.maxChars ?? DEFAULT_MAX_CHARS,
          effectiveInput.maxElements ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      console.error(chalk.green(`[Camoufox] Successfully captured snapshot from ${safeUrl}.`));

      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse snapshot", safeUrl, error, effectiveInput);
  }
}

async function handleSequence(input: SequenceToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  if (effectiveInput.screenshot && !isScreenshotDimensionAllowed(effectiveInput.viewport, effectiveInput.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse sequence", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
      getLastNavigationResponse,
    }) => {
      const rawUrls = [effectiveInput.url, getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
      const secrets = getProxySecrets(effectiveInput.proxy);
      const actions: SequenceActionResult[] = [];
      for (let index = 0; index < effectiveInput.actions.length; index += 1) {
        const result = await runSequenceAction(page, effectiveInput.actions[index], index, rawUrls, secrets);
        actions.push(result);
        await settleAndAssertSafe(page, requestGuard);
      }

      const mode = effectiveInput.outputMode ?? "text";
      const charLimit = effectiveInput.maxChars ?? DEFAULT_MAX_CHARS;
      const finalResponse = getLastNavigationResponse() ?? response;
      const contentPayload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildBrowsePayload(page, finalResponse, mode, charLimit, effectiveInput.selector),
      );
      requestGuard.assertAllowed();
      if (isBlockedNavigationResponse(contentPayload)) {
        return buildToolError(`Blocked unsafe browser request to ${safeUrl}.`);
      }

      const snapshot = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildSnapshotPayload(
          page,
          finalResponse,
          charLimit,
          effectiveInput.maxElements ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
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
        selector: effectiveInput.selector,
        selectorFound: contentPayload.selectorFound,
        text: contentPayload.text,
        html: contentPayload.html,
      };

      appendDiagnostics(payload, diagnostics.payload());

      let screenshotResult: ScreenshotResult | undefined;
      if (effectiveInput.screenshot) {
        screenshotResult = await captureScreenshot(page, safeUrl, effectiveInput.screenshotOptions);
        payload.screenshot = screenshotResult.screenshotMetadata;
      }
      requestGuard.assertAllowed();

      console.error(chalk.green(`[Camoufox] Successfully ran ${actions.length} actions from ${safeUrl}.`));
      if (effectiveInput.captchaPolicy) {
        const finalResponse = getLastNavigationResponse() ?? response;
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, finalResponse, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, screenshotResult ?? captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse sequence", safeUrl, error, effectiveInput);
  }
}

async function handleLinks(input: LinksToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse links", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildLinksPayload(
          page,
          response,
          effectiveInput.maxLinks ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse links", safeUrl, error, effectiveInput);
  }
}

async function handleForms(input: FormsToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse forms", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildFormsPayload(
          page,
          response,
          effectiveInput.maxForms ?? 20,
          effectiveInput.maxFields ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse forms", safeUrl, error, effectiveInput);
  }
}

async function handleOutline(input: OutlineToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse outline", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildOutlinePayload(
          page,
          response,
          effectiveInput.maxItems ?? DEFAULT_MAX_ELEMENTS,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse outline", safeUrl, error, effectiveInput);
  }
}

async function handleFind(input: FindToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse find", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildFindPayload(
          page,
          response,
          effectiveInput.query,
          effectiveInput.maxMatches ?? 5,
          effectiveInput.contextChars ?? 300,
          effectiveInput.selector,
        ),
      );
      requestGuard.assertAllowed();
      appendDiagnostics(payload, diagnostics.payload());
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse find", safeUrl, error, effectiveInput);
  }
}

async function handleScreenshot(input: ScreenshotToolInput) {
  const effectiveInput = applyStealthProfile(input);
  const safeUrl = redactUrl(effectiveInput.url);

  if (!isScreenshotDimensionAllowed(effectiveInput.viewport, effectiveInput.window)) {
    return buildToolError(`Screenshot dimensions exceed server policy (${MAX_SCREENSHOT_WIDTH}x${MAX_SCREENSHOT_HEIGHT}).`);
  }

  try {
    return await runBrowserOperation("browse screenshot", effectiveInput, async ({
      page,
      response,
      requestGuard,
    }) => {
      const screenshotResult = await captureScreenshot(page, safeUrl, {
        fullPage: effectiveInput.fullPage,
        selector: effectiveInput.selector,
        type: effectiveInput.type,
        quality: effectiveInput.quality,
      });
      requestGuard.assertAllowed();
      const payload = {
        url: redactUrl(page.url()),
        title: await page.title(),
        status: response?.status(),
        contentType: response?.headers()["content-type"],
        screenshot: screenshotResult.screenshotMetadata,
      };
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, screenshotResult ?? captchaScreenshot);
      }
      return buildSuccessContent(payload, screenshotResult);
    });
  } catch (error) {
    return buildToolFailure("browse screenshot", safeUrl, error, effectiveInput);
  }
}

async function handleConsole(input: ConsoleToolInput) {
  const effectiveInput = applyStealthProfile({
    ...input,
    includeConsole: true,
    includeNetwork: false,
  });
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse console", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      await runGuardedPageRead(page, requestGuard, () => page.title());
      requestGuard.assertAllowed();
      const payload = {
        url: redactUrl(page.url()),
        title: await page.title(),
        status: response?.status(),
        contentType: response?.headers()["content-type"],
        console: diagnostics.payload()?.console ?? [],
        consoleTruncated: diagnostics.payload()?.consoleTruncated ?? false,
      };
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse console", safeUrl, error, effectiveInput);
  }
}

async function handleNetworkSummary(input: NetworkSummaryToolInput) {
  const effectiveInput = applyStealthProfile({
    ...input,
    includeConsole: false,
    includeNetwork: true,
  });
  const safeUrl = redactUrl(effectiveInput.url);

  try {
    return await runBrowserOperation("browse network summary", effectiveInput, async ({
      page,
      response,
      requestGuard,
      diagnostics,
    }) => {
      const payload = await runGuardedPageRead(
        page,
        requestGuard,
        () => buildNetworkSummary(page, response, diagnostics.payload(), effectiveInput.maxFailures ?? 10),
      );
      requestGuard.assertAllowed();
      if (effectiveInput.captchaPolicy) {
        const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(page, response, payload, effectiveInput.captchaPolicy, safeUrl);
        return buildSuccessContent(mergedPayload, captchaScreenshot);
      }
      return buildSuccessContent(payload);
    });
  } catch (error) {
    return buildToolFailure("browse network summary", safeUrl, error, effectiveInput);
  }
}

function sessionExpiresAt(session: SessionRecord): string {
  return new Date(session.expiresAt).toISOString();
}

function resetSessionTtl(session: SessionRecord): void {
  clearTimeout(session.timer);
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  session.timer = setTimeout(() => {
    void closeSession(session.id, "expired");
  }, SESSION_TTL_MS);
}

function reserveSessionSlot(): boolean {
  if (reservedSessions >= MAX_SESSIONS) {
    return false;
  }

  reservedSessions += 1;
  return true;
}

function releaseSessionSlot(): void {
  reservedSessions = Math.max(0, reservedSessions - 1);
}

async function closeSession(sessionId: string, reason: string): Promise<boolean> {
  const session = sessions.get(sessionId);
  if (!session) {
    return false;
  }

  sessions.delete(sessionId);
  clearTimeout(session.timer);
  console.error(chalk.blue(`[Camoufox] Closing session ${sessionId} (${reason}).`));
  try {
    await closeBrowser(session.browser);
  } finally {
    session.releaseSlot();
    releaseSessionSlot();
  }
  return true;
}

async function closeActiveSessions(): Promise<void> {
  const ids = Array.from(sessions.keys());
  await Promise.all(ids.map((id) => closeSession(id, "shutdown")));
}

async function getSession(sessionId: string): Promise<SessionRecord> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`Unknown or closed session: ${sessionId}`);
  }

  if (Date.now() > session.expiresAt) {
    await closeSession(sessionId, "expired");
    throw new Error(`Session expired: ${sessionId}`);
  }

  resetSessionTtl(session);
  return session;
}

async function navigateSession(
  session: SessionRecord,
  url: string,
  waitStrategy?: WaitStrategy,
  timeout?: number,
): Promise<Response | null> {
  const safeUrl = redactUrl(url);
  const targetUrl = await validateTargetUrl(url);
  session.rawUrls.push(url);

  try {
    const response = await session.page.goto(targetUrl.toString(), {
      waitUntil: waitStrategy ?? session.waitStrategy,
      timeout: timeout ?? DEFAULT_ACTION_TIMEOUT_MS * 6,
    });
    session.lastNavigationResponse = response;
    await settleAndAssertSafe(session.page, session.requestGuard);
    return response;
  } catch (navigationError) {
    const navigationErrorMessage = describeError(navigationError).toLowerCase();
    if (/\b(?:127\.0\.0\.1|localhost|ip6-localhost|ip6-loopback|::1)\b/.test(navigationErrorMessage)) {
      throw new Error(`Blocked unsafe browser request to ${safeUrl}.`, { cause: navigationError });
    }

    session.requestGuard.assertAllowed();
    throw navigationError;
  }
}

async function handleSessionStart(input: SessionStartToolInput) {
  const effectiveInput = applyStealthProfile({
    ...input,
    captchaPolicy: input.captchaPolicy ?? "pause",
  });

  if (!reserveSessionSlot()) {
    return buildToolError(`Too many active sessions. Maximum is ${MAX_SESSIONS}.`);
  }

  let release: SlotRelease | undefined;
  let browser: Browser | undefined;
  try {
    await validateBrowserOptionsInput(effectiveInput);
    release = await acquireBrowserSlot();
    const selectedOS = selectOperatingSystem(effectiveInput.os);
    const waitStrategy = effectiveInput.waitStrategy ?? "load";
    const headlessMode = defaultHeadlessMode(effectiveInput.headless);

    browser = await launchCamoufoxBrowser(buildCamoufoxOptions(effectiveInput, selectedOS, headlessMode));
    activeBrowsers.add(browser);
    const context = await browser.newContext(browserContextOptions(effectiveInput));
    const requestGuard = await installRequestGuard(context);
    const page = await context.newPage();
    requestGuard.watchPage(page);

    const id = `sess_${randomUUID()}`;
    const rawUrls = [getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl));
    const secrets = getProxySecrets(effectiveInput.proxy);
    const now = Date.now();
    const session: SessionRecord = {
      id,
      browser,
      context,
      page,
      requestGuard,
      diagnostics: createDiagnosticsCollector(page, effectiveInput, rawUrls, secrets),
      selectedOS,
      waitStrategy,
      releaseSlot: release,
      rawUrls,
      secrets,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
      timer: setTimeout(() => {
        void closeSession(id, "expired");
      }, SESSION_TTL_MS),
      lastNavigationResponse: null,
    };

    sessions.set(id, session);
    browser = undefined;
    release = undefined;

    return buildSuccessContent({
      sessionId: id,
      expiresAt: sessionExpiresAt(session),
      browser: "camoufox",
      selectedOS,
      headlessMode,
      stealthProfile: effectiveInput.stealthProfile,
      captchaPolicy: effectiveInput.captchaPolicy ?? "pause",
    });
  } catch (error) {
    if (browser) {
      await closeBrowser(browser);
    }
    if (release) {
      release();
    }
    releaseSessionSlot();
    const errorMessage = sanitizeErrorMessage(
      describeError(error),
      [getProxyServer(effectiveInput.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl)),
      getProxySecrets(effectiveInput.proxy),
    );
    return buildToolError(`Failed to start browser session. Error: ${errorMessage}`);
  }
}

async function handleSessionNavigate(input: SessionNavigateToolInput) {
  try {
    const session = await getSession(input.sessionId);
    const response = await navigateSession(session, input.url, input.waitStrategy, input.timeout);
    const mode = input.outputMode ?? "text";
    const charLimit = input.maxChars ?? DEFAULT_MAX_CHARS;
    const payload = await runGuardedPageRead(
      session.page,
      session.requestGuard,
      () => buildBrowsePayload(session.page, response, mode, charLimit, input.selector),
    );
    const basePayload = { sessionId: session.id, expiresAt: sessionExpiresAt(session), ...payload };
    if (input.captchaPolicy) {
      const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(session.page, response, basePayload, input.captchaPolicy, redactUrl(input.url));
      return buildSuccessContent(mergedPayload, captchaScreenshot);
    }
    return buildSuccessContent(basePayload);
  } catch (error) {
    return buildToolError(`Failed to navigate session. Error: ${sanitizeErrorMessage(describeError(error), [input.url], [])}`);
  }
}

async function handleSessionAction(input: SessionActionToolInput) {
  try {
    const session = await getSession(input.sessionId);
    const actionResult = await runSequenceAction(session.page, input.action, 0, session.rawUrls, session.secrets);
    await settleAndAssertSafe(session.page, session.requestGuard);
    const snapshot = await runGuardedPageRead(
      session.page,
      session.requestGuard,
      () => buildSnapshotPayload(
        session.page,
        session.lastNavigationResponse,
        input.maxChars ?? DEFAULT_MAX_CHARS,
        input.maxElements ?? DEFAULT_MAX_ELEMENTS,
        input.selector,
      ),
    );
    const basePayload = { sessionId: session.id, expiresAt: sessionExpiresAt(session), action: actionResult, snapshot };
    if (input.captchaPolicy) {
      const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(session.page, session.lastNavigationResponse, basePayload, input.captchaPolicy, redactUrl(session.page.url()));
      return buildSuccessContent(mergedPayload, captchaScreenshot);
    }
    return buildSuccessContent(basePayload);
  } catch (error) {
    return buildToolError(`Failed to run session action. Error: ${sanitizeErrorMessage(describeError(error), [], [])}`);
  }
}

async function handleSessionSnapshot(input: SessionSnapshotToolInput) {
  try {
    const session = await getSession(input.sessionId);
    const snapshot = await runGuardedPageRead(
      session.page,
      session.requestGuard,
      () => buildSnapshotPayload(
        session.page,
        session.lastNavigationResponse,
        input.maxChars ?? DEFAULT_MAX_CHARS,
        input.maxElements ?? DEFAULT_MAX_ELEMENTS,
        input.selector,
      ),
    );
    const basePayload = { sessionId: session.id, expiresAt: sessionExpiresAt(session), ...snapshot };
    if (input.captchaPolicy) {
      const { mergedPayload, captchaScreenshot } = await maybeDetectCaptcha(session.page, session.lastNavigationResponse, basePayload, input.captchaPolicy, redactUrl(session.page.url()));
      return buildSuccessContent(mergedPayload, captchaScreenshot);
    }
    return buildSuccessContent(basePayload);
  } catch (error) {
    return buildToolError(`Failed to snapshot session. Error: ${sanitizeErrorMessage(describeError(error), [], [])}`);
  }
}

async function handleSessionResume(input: SessionResumeToolInput) {
  try {
    const session = await getSession(input.sessionId);
    if (input.waitStrategy) {
      await session.page.waitForLoadState(input.waitStrategy, { timeout: input.timeout ?? DEFAULT_ACTION_TIMEOUT_MS });
      await settleAndAssertSafe(session.page, session.requestGuard);
    }
    return await handleSessionSnapshot(input);
  } catch (error) {
    return buildToolError(`Failed to resume session. Error: ${sanitizeErrorMessage(describeError(error), [], [])}`);
  }
}

async function handleSessionClose(input: SessionCloseToolInput) {
  const closed = await closeSession(input.sessionId, "requested");
  return buildSuccessContent({
    sessionId: input.sessionId,
    closed,
  });
}

function registerJsonTool<InputArgs extends z.ZodRawShape>(
  name: string,
  description: string,
  inputSchema: InputArgs,
  annotations: ToolAnnotations,
  handler: (input: z.infer<z.ZodObject<InputArgs>>) => Promise<unknown>,
): void {
  const registerTool = server.registerTool.bind(server) as unknown as (
    toolName: string,
    config: {
      description: string;
      inputSchema: InputArgs;
      outputSchema: typeof anyOutputSchema;
      annotations: ToolAnnotations;
    },
    callback: (input: unknown) => Promise<unknown>,
  ) => void;

  registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema: anyOutputSchema,
      annotations,
    },
    async (input: unknown): Promise<unknown> => handler(input as z.infer<z.ZodObject<InputArgs>>),
  );
}

server.registerTool(
  "camoufox_status",
  {
    description: "Return server, browser, queue, session, and policy status without launching a page.",
    inputSchema: {},
    outputSchema: anyOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async () => handleStatus(),
);

registerJsonTool("browse", "Navigate once and return bounded page content.", browseToolShape, readOnlyOpenWorld, async (input) => handleBrowse(input as BrowseToolInput));
registerJsonTool("browse_snapshot", "Navigate once and return visible text, ARIA snapshot, and interactive metadata.", snapshotToolShape, readOnlyOpenWorld, async (input) => handleSnapshot(input as SnapshotToolInput));
registerJsonTool("browse_sequence", "Navigate once, run bounded selector actions, then return final state.", sequenceToolShape, nonReadOnlyOpenWorld, async (input) => handleSequence(input as SequenceToolInput));
registerJsonTool("browse_links", "Navigate once and return only visible navigable links.", linksToolShape, readOnlyOpenWorld, async (input) => handleLinks(input as LinksToolInput));
registerJsonTool("browse_forms", "Navigate once and return form fields and submit controls.", formsToolShape, readOnlyOpenWorld, async (input) => handleForms(input as FormsToolInput));
registerJsonTool("browse_outline", "Navigate once and return page headings and landmarks.", outlineToolShape, readOnlyOpenWorld, async (input) => handleOutline(input as OutlineToolInput));
registerJsonTool("browse_find", "Navigate once, search visible text, and return bounded context matches.", findToolShape, readOnlyOpenWorld, async (input) => handleFind(input as FindToolInput));
registerJsonTool("browse_screenshot", "Navigate once and capture a bounded screenshot.", screenshotToolShape, readOnlyOpenWorld, async (input) => handleScreenshot(input as ScreenshotToolInput));
registerJsonTool("browse_console", "Navigate once and return bounded console diagnostics.", consoleToolShape, readOnlyOpenWorld, async (input) => handleConsole(input as ConsoleToolInput));
registerJsonTool("browse_network_summary", "Navigate once and return a bounded network diagnostic summary.", networkSummaryToolShape, readOnlyOpenWorld, async (input) => handleNetworkSummary(input as NetworkSummaryToolInput));
registerJsonTool("browse_session_start", "Start an isolated short-lived browser session.", sessionStartToolShape, nonReadOnlyOpenWorld, async (input) => handleSessionStart(input as SessionStartToolInput));
registerJsonTool("browse_session_navigate", "Navigate an existing browser session.", sessionNavigateToolShape, nonReadOnlyOpenWorld, async (input) => handleSessionNavigate(input as SessionNavigateToolInput));
registerJsonTool("browse_session_action", "Run one bounded action in an existing browser session.", sessionActionToolShape, nonReadOnlyOpenWorld, async (input) => handleSessionAction(input as SessionActionToolInput));
registerJsonTool("browse_session_snapshot", "Read the current state of an existing browser session.", sessionSnapshotToolShape, readOnlyOpenWorld, async (input) => handleSessionSnapshot(input as SessionSnapshotToolInput));
registerJsonTool("browse_session_resume", "Resume a paused session after human action and return current state.", sessionResumeToolShape, nonReadOnlyOpenWorld, async (input) => handleSessionResume(input as SessionResumeToolInput));
registerJsonTool("browse_session_close", "Close an existing browser session.", sessionCloseToolShape, nonReadOnlyOpenWorld, async (input) => handleSessionClose(input as SessionCloseToolInput));

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
  await closeActiveSessions();
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
