#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Camoufox } from "camoufox-js";
import chalk from "chalk";

/**
 * Configuration options for Camoufox browser instance
 * @interface CamoufoxOptions
 */
interface CamoufoxOptions {
  /** Array of operating systems to spoof for fingerprinting */
  os?: string[];
  /** Headless mode: true for standard, 'virtual' for Xvfb, false for GUI */
  headless?: boolean | 'virtual';
  /** Enable realistic human-like cursor movements and behavior */
  humanize?: boolean;
  /** Auto-detect geolocation based on IP address */
  geoip?: boolean;
  /** Enable uBlock Origin for enhanced privacy */
  ublock?: boolean;
  /** Block WebGL to prevent fingerprinting */
  block_webgl?: boolean;
  /** Block all images for faster loading */
  block_images?: boolean;
  /** Block WebRTC entirely for enhanced privacy */
  block_webrtc?: boolean;
  /** Disable Cross-Origin-Opener-Policy for iframe interaction */
  disable_coop?: boolean;
  /** Browser locale setting (e.g., 'en-US') */
  locale?: string;
  /** Viewport dimensions configuration */
  viewport?: { width: number; height: number };
  /** Proxy configuration: string URL or object with authentication */
  proxy?: string | { server: string; username?: string; password?: string };
  /** Enable browser caching for improved performance */
  enable_cache?: boolean;
  /** Custom Firefox user preferences */
  firefox_user_prefs?: Record<string, unknown>;
  /** List of default addons to exclude */
  exclude_addons?: string[];
  /** Fixed window size [width, height] */
  window?: [number, number];
  /** Additional browser command-line arguments */
  args?: string[];
}

/**
 * Initialize the MCP (Model Context Protocol) server with Camoufox browsing capabilities
 * Provides privacy-focused web browsing with anti-detection features
 */
const server = new McpServer({
  name: "camoufox-mcp-server",
  version: "1.4.0",
});

/**
 * Define the browse tool with comprehensive privacy and anti-detection parameters
 * This tool allows AI assistants to navigate websites while maintaining user privacy
 * and avoiding bot detection through various stealth techniques.
 */
server.tool(
  "browse",
  {
    url: z.string().describe("The URL to navigate to and retrieve content from. Use this tool when users ask to visit, check, search, navigate, browse, fetch, or scrape websites. Must be a fully qualified URL (e.g., 'https://example.com')."),
    os: z.enum(["windows", "macos", "linux"]).optional().describe("Optional OS to spoof. Can be 'windows', 'macos', or 'linux'. If not specified, will rotate between all OS types."),
    waitStrategy: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("domcontentloaded").describe("Wait strategy for page load. 'domcontentloaded' waits for DOM, 'load' waits for all resources, 'networkidle' waits for network activity to finish."),
    timeout: z.number().min(5000).max(300000).optional().default(60000).describe("Timeout in milliseconds for page load (5-300 seconds)."),
    humanize: z.boolean().optional().default(true).describe("Enable realistic cursor movements and human-like behavior for better stealth and anti-detection. Helps avoid bot detection by simulating natural user interactions."),
    locale: z.string().optional().describe("Browser locale (e.g., 'en-US', 'fr-FR')."),
    viewport: z.object({
      width: z.number().min(320).max(3840).default(1920),
      height: z.number().min(240).max(2160).default(1080)
    }).optional().describe("Custom viewport dimensions."),
    screenshot: z.boolean().optional().default(false).describe("Capture a screenshot/image of the page after loading. Use when users ask to take a screenshot, capture an image, show them visually, or want to see how the page looks."),
    block_webrtc: z.boolean().optional().default(true).describe("Block WebRTC entirely for enhanced privacy and stealth. Use when users want private browsing, to hide their real IP, prevent WebRTC leaks, or browse in stealth mode."),
    proxy: z.union([
      z.string().describe("Proxy URL (e.g., 'http://proxy.example.com:8080')"),
      z.object({
        server: z.string().describe("Proxy server URL"),
        username: z.string().optional().describe("Proxy username for authentication"),
        password: z.string().optional().describe("Proxy password for authentication")
      })
    ]).optional().describe("Proxy configuration for anonymous browsing. Use when users want to browse through a proxy, hide their IP, browse anonymously, or access content via a specific server location."),
    enable_cache: z.boolean().optional().default(false).describe("Cache pages, requests, etc. Uses more memory but improves performance when revisiting pages."),
    firefox_user_prefs: z.record(z.any()).optional().describe("Custom Firefox user preferences to set."),
    exclude_addons: z.array(z.string()).optional().describe("List of default addons to exclude (e.g., ['ublock_origin'])."),
    window: z.preprocess(
      (arg) => {
        if (Array.isArray(arg) && arg.length === 0) {
          return undefined;
        }
        return arg;
      },
      z.tuple([
      z.number().min(320).max(3840),
      z.number().min(240).max(2160)
    ]).optional()
    ).describe("Set fixed window size [width, height] instead of random generation. An empty array [] is accepted and treated as if the window parameter was not specified."),
    args: z.array(z.string()).optional().describe("Additional command-line arguments to pass to the browser."),
    block_images: z.boolean().optional().default(false).describe("Block all images for faster loading, reduced bandwidth, and lightweight browsing. Use when users want quick/fast browsing, text-only content, or to save bandwidth."),
    block_webgl: z.boolean().optional().default(false).describe("Block WebGL to prevent fingerprinting and tracking. Use for maximum privacy/stealth mode, but note it may cause detection on some sites that rely heavily on WebGL."),
    disable_coop: z.boolean().optional().default(false).describe("Disable Cross-Origin-Opener-Policy to allow interaction with iframes and cross-origin content. Use when users need to click elements in iframes or access embedded content."),
    geoip: z.boolean().optional().default(true).describe("Automatically detect geolocation based on IP address."),
    headless: z.boolean().optional().describe("Run browser in headless mode. Auto-detects best mode for environment if not specified."),
  },
  /**
   * Browse tool handler function
   * @param params - Object containing all browsing parameters
   * @param params.url - Target URL to navigate to
   * @param params.os - Operating system to spoof
   * @param params.waitStrategy - Page load wait strategy
   * @param params.timeout - Page load timeout in milliseconds
   * @param params.humanize - Enable human-like behavior
   * @param params.locale - Browser locale setting
   * @param params.viewport - Custom viewport dimensions
   * @param params.screenshot - Capture screenshot after loading
   * @param params.block_webrtc - Block WebRTC for privacy
   * @param params.proxy - Proxy configuration
   * @param params.enable_cache - Enable browser caching
   * @param params.firefox_user_prefs - Custom Firefox preferences
   * @param params.exclude_addons - Addons to exclude
   * @param params.window - Fixed window size
   * @param params.args - Additional browser arguments
   * @param params.block_images - Block image loading
   * @param params.block_webgl - Block WebGL
   * @param params.disable_coop - Disable Cross-Origin-Opener-Policy
   * @param params.geoip - Auto-detect geolocation
   * @param params.headless - Headless mode setting
   * @returns Promise resolving to content with HTML and optional screenshot
   */
  async ({ url, os, waitStrategy, timeout, humanize, locale, viewport, screenshot, block_webrtc, proxy, enable_cache, firefox_user_prefs, exclude_addons, window, args, block_images, block_webgl, disable_coop, geoip, headless }) => {
    let browser;

    try {
      console.error(chalk.blue(`[Camoufox] Launching browser to browse: ${url}`));
      
      // Detect if we're running in Docker/Linux or locally for optimal headless mode
      const isLinux = process.platform === 'linux';
      const headlessMode = headless !== undefined ? headless : (isLinux ? 'virtual' : true);
      
      // Auto-rotate OS fingerprint if not specified for better anti-detection
      const osOptions = ["windows", "macos", "linux"];
      const selectedOS = os || osOptions[Math.floor(Math.random() * osOptions.length)];
      
      // Launch Camoufox browser with comprehensive anti-detection and privacy settings
      browser = await Camoufox({
        os: [selectedOS], // Pass as array for BrowserForge rotation
        headless: headlessMode,
        humanize: humanize, // Enable realistic cursor movements
        geoip: geoip, // Auto-detect location based on IP
        ublock: true, // Keep uBlock Origin for better stealth
        block_webgl: block_webgl, // Block WebGL if requested
        block_images: block_images, // Block images if requested
        block_webrtc: block_webrtc,
        disable_coop: disable_coop,
        locale: locale,
        viewport: viewport ? {
          width: viewport.width,
          height: viewport.height
        } : undefined,
        proxy: proxy,
        enable_cache: enable_cache,
        firefox_user_prefs: firefox_user_prefs,
        exclude_addons: exclude_addons,
        window: window,
        args: args,
      } as CamoufoxOptions); // Type assertion to handle incomplete type definitions

      const page = await browser.newPage();
      await page.goto(url, { waitUntil: waitStrategy, timeout: timeout });
      
      const pageContent = await page.content(); // Get the full HTML content
      
      // Capture screenshot if requested, with error handling
      let screenshotBase64;
      if (screenshot) {
        try {
          const screenshotBuffer = await page.screenshot({ type: 'png' });
          screenshotBase64 = screenshotBuffer.toString('base64');
          console.error(chalk.green(`[Camoufox] Screenshot captured for ${url}.`));
        } catch (screenshotError) {
          console.error(chalk.yellow(`[Camoufox] Screenshot failed: ${screenshotError instanceof Error ? screenshotError.message : String(screenshotError)}`));
        }
      }

      // Build feature summary for logging
      const features = [
        `OS: ${selectedOS}`,
        `wait: ${waitStrategy}`,
        proxy ? 'proxy: enabled' : null,
        block_webrtc ? 'WebRTC: blocked' : null,
        block_images ? 'images: blocked' : null,
        block_webgl ? 'WebGL: blocked' : null,
        disable_coop ? 'COOP: disabled' : null,
        !geoip ? 'geoip: disabled' : null,
      ].filter(Boolean).join(', ');
      
      console.error(chalk.green(`[Camoufox] Successfully retrieved content from ${url} (${features}).`));

      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [{
        type: "text" as const,
        text: pageContent // Return the HTML content
      }];
      
      if (screenshotBase64) {
        content.push({
          type: "image",
          data: screenshotBase64,
          mimeType: "image/png"
        });
      }

      return {
        content
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`[Camoufox] Error during browsing: ${errorMessage}`));
      return {
        content: [{
          type: "text",
          text: `Failed to browse URL ${url}. Error: ${errorMessage}`
        }],
        isError: true
      };
    } finally {
      if (browser) {
        console.error(chalk.blue('[Camoufox] Closing browser.'));
        await browser.close();
      }
    }
  }
);

/**
 * Main function to start the MCP server with stdio transport
 * Handles server initialization and connection setup
 * @throws {Error} When server initialization fails
 */
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

/**
 * Handle process termination gracefully on SIGINT (Ctrl+C)
 * Ensures clean shutdown when user interrupts the process
 */
process.on('SIGINT', () => {
  console.error(chalk.yellow('\n[Camoufox] Shutting down server...'));
  process.exit(0);
});

/**
 * Handle process termination gracefully on SIGTERM
 * Ensures clean shutdown when process is terminated by system
 */
process.on('SIGTERM', () => {
  console.error(chalk.yellow('\n[Camoufox] Shutting down server...'));
  process.exit(0);
});

/**
 * Handle uncaught exceptions to prevent silent failures
 * Logs error details and exits with error code
 * @param error - The uncaught exception
 */
process.on('uncaughtException', (error) => {
  console.error(chalk.red('[Camoufox] Uncaught exception:', error));
  process.exit(1);
});

/**
 * Handle unhandled promise rejections
 * Prevents silent failures from unhandled async operations
 * @param reason - Rejection reason
 * @param promise - The rejected promise
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('[Camoufox] Unhandled rejection at:', promise, 'reason:', reason));
  process.exit(1);
});

runServer().catch((error) => {
  console.error(chalk.red("Fatal error running server:", error));
  process.exit(1);
});
