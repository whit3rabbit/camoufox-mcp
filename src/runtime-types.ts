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
  assertAllowed(): void;
  watchPage(page: Page): void;
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
  getLastNavigationResponse: () => Response | null;
}

export interface DiagnosticsCollector {
  payload(): DiagnosticsPayload | undefined;
}
