import type { HeadlessMode } from "./runtime-types.js";

export type OutputMode = "text" | "html" | "metadata";
export type ScreenshotImageType = "png" | "jpeg";
export type CaptchaPolicy = "detect" | "pause" | "fail" | "attempt";
export type CaptchaProvider = "recaptcha" | "hcaptcha" | "turnstile" | "cloudflare" | "text_captcha" | "generic";
export type NetworkSandboxMode = "unknown" | "declared" | "docker" | "strict-declared";
export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

export interface ScreenshotOptions {
  fullPage?: boolean;
  selector?: string;
  type?: ScreenshotImageType;
  quality?: number;
}

export interface ScreenshotMetadata {
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

export interface ConsoleDiagnostic {
  type: string;
  text: string;
  location?: {
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
}

export interface NetworkDiagnostic {
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  contentType?: string;
  failed?: boolean;
  errorText?: string;
}

export interface DiagnosticsPayload {
  console?: ConsoleDiagnostic[];
  network?: NetworkDiagnostic[];
  consoleTruncated?: boolean;
  networkTruncated?: boolean;
}

export interface NetworkSecurityStatus {
  ssrfPolicy: "app_layer_best_effort";
  sandboxMode: NetworkSandboxMode;
  sandboxDeclared: boolean;
  strictSandboxRequired: boolean;
  warning?: string;
}

export interface StatusPayload {
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
  captchaAutonomous: boolean;
  networkSecurity: NetworkSecurityStatus;
}

export interface PendingBrowse {
  start: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowsePayload {
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

export interface SnapshotElement {
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

export interface SnapshotPayload {
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

export interface SequenceActionResult {
  index: number;
  type: string;
  selector?: string;
  status: "ok";
  result?: string;
  resultTruncated?: boolean;
  durationMs: number;
}

export interface SequencePayload {
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

export interface LinkEntry {
  text: string;
  href: string;
  selector: string;
  visible: boolean;
  confidence: number;
}

export interface LinksPayload {
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

export interface FormFieldEntry {
  label?: string;
  type: string;
  name?: string;
  selector: string;
  required: boolean;
  placeholder?: string;
  value?: string;
  options?: Array<{ text: string; value: string }>;
}

export interface FormEntry {
  selector: string;
  fields: FormFieldEntry[];
  submit?: {
    text?: string;
    selector: string;
  };
}

export interface FormsPayload {
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

export interface OutlineHeading {
  level: number;
  text: string;
  selector: string;
}

export interface OutlinePayload {
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

export interface FindMatch {
  text: string;
  selector: string;
  score: number;
}

export interface FindPayload {
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

export interface NetworkSummaryPayload {
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

export interface CaptchaIframeInfo {
  selector: string;
  src: string;
  title?: string;
}

export interface CaptchaElementInfo {
  selector: string;
  frame?: string;
  type: "checkbox" | "input" | "button" | "image";
  label?: string;
}

export interface CaptchaDetection {
  captchaDetected: boolean;
  challengeSignals: string[];
  challengeHandling?: "manual" | "llm_assisted";
  requiresUserAction?: boolean;
  challengeType?: "captcha_or_bot_check";
  message?: string;
  challengeProvider?: CaptchaProvider;
  captchaIframes?: CaptchaIframeInfo[];
  interactiveElements?: CaptchaElementInfo[];
  suggestedStrategy?: string;
  challengePlaybook?: string;
}
