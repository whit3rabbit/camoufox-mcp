import type { Browser, BrowserContext, Page, Response } from "playwright-core";
import type { CaptchaPolicy, DiagnosticsPayload, ScreenshotMetadata } from "./payload-types.js";

export type BrowserInstance = Browser;
export type SupportedOs = "windows" | "macos" | "linux";
export type HeadlessMode = boolean | "virtual";
export type WaitStrategy = "domcontentloaded" | "load" | "networkidle";
export type ClickMode = "dom" | "pointer" | "auto";
export type StealthProfile = "normal" | "privacy" | "human_assisted" | "fast" | "debug";
export type WindowSize = [number, number];
export type SlotRelease = () => void;
export type ProxyConfig = string | { server: string; username?: string; password?: string };

export interface RequestGuard {
  // Throws the recorded block, if any. Synchronous: it does not wait for
  // redirect validations that are still resolving DNS.
  assertAllowed(): void;
  // Waits for pending redirect validations, bounded by a deadline that fails
  // closed.
  settle(): Promise<void>;
  // settle() followed by assertAllowed(). Use before returning page state.
  assertSettled(): Promise<void>;
  // Returns the recorded block for reporting. A block that was aborted before
  // anything was sent is cleared once reported; a block for a request the
  // browser already issued stays until reset().
  takeBlock(): Error | undefined;
  // Start a new navigation in a long-lived session: clears the request budget,
  // recorded blocks, pending validations, and the DNS cache.
  reset(): void;
}

export interface SessionRecord {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  requestGuard: RequestGuard;
  diagnostics: DiagnosticsCollector;
  selectedOS: SupportedOs;
  waitStrategy: WaitStrategy;
  // CAPTCHA policy persisted at session start so the documented "pause" default
  // drives detection on every subsequent navigate/action/snapshot/resume without
  // the caller re-passing captchaPolicy on each call.
  captchaPolicy: CaptchaPolicy;
  // Default navigation timeout from browse_session_start's `timeout`.
  navigationTimeout: number;
  releaseSlot: SlotRelease;
  rawUrls: string[];
  secrets: string[];
  createdAt: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
  lastNavigationResponse: Response | null;
  op: Promise<void>;
  closing: boolean;
  closed: boolean;
}

export interface CamoufoxOptions {
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

export interface BrowserLaunchInput {
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

export interface ExtractedContent {
  value: string;
  truncated: boolean;
  found: boolean;
}

export interface ScreenshotResult {
  screenshotMetadata: ScreenshotMetadata;
  mimeType: string;
  base64?: string;
}

export interface CommonBrowserInput extends BrowserLaunchInput {
  url: string;
}

export interface BrowserOperationContext {
  page: Page;
  response: Response | null;
  requestGuard: RequestGuard;
  diagnostics: DiagnosticsCollector;
  selectedOS: SupportedOs;
  waitStrategy: WaitStrategy;
  // CAPTCHA policy after the stealth profile's defaults were applied.
  captchaPolicy: CaptchaPolicy | undefined;
  getLastNavigationResponse: () => Response | null;
}

export interface DiagnosticsCollector {
  payload(): DiagnosticsPayload | undefined;
  // Drop collected entries. Sessions call this on each navigation so
  // diagnostics describe the current page instead of the first one.
  reset(): void;
}
