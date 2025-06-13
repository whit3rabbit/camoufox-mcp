#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Camoufox } from "camoufox-js";
import chalk from "chalk";

interface CamoufoxOptions {
  os?: string[];
  headless?: boolean | 'virtual';
  humanize?: boolean;
  geoip?: boolean;
  ublock?: boolean;
  block_webgl?: boolean;
  block_images?: boolean;
  block_webrtc?: boolean;
  disable_coop?: boolean;
  locale?: string;
  viewport?: { width: number; height: number };
  proxy?: string | { server: string; username?: string; password?: string };
  enable_cache?: boolean;
  firefox_user_prefs?: Record<string, any>;
  exclude_addons?: string[];
  window?: [number, number];
  args?: string[];
}

// Initialize the MCP server
const server = new McpServer({
  name: "camoufox-mcp-server",
  version: "1.3.0",
});

// Define the browse tool with enhanced parameters
server.tool(
  "browse",
  {
    url: z.string().describe("The URL to navigate to. Must be a fully qualified URL (e.g., 'https://example.com')."),
    os: z.enum(["windows", "macos", "linux"]).optional().describe("Optional OS to spoof. Can be 'windows', 'macos', or 'linux'. If not specified, will rotate between all OS types."),
    waitStrategy: z.enum(["domcontentloaded", "load", "networkidle"]).optional().default("domcontentloaded").describe("Wait strategy for page load. 'domcontentloaded' waits for DOM, 'load' waits for all resources, 'networkidle' waits for network activity to finish."),
    timeout: z.number().min(5000).max(300000).optional().default(60000).describe("Timeout in milliseconds for page load (5-300 seconds)."),
    humanize: z.boolean().optional().default(true).describe("Enable realistic cursor movements and human-like behavior."),
    locale: z.string().optional().describe("Browser locale (e.g., 'en-US', 'fr-FR')."),
    viewport: z.object({
      width: z.number().min(320).max(3840).default(1920),
      height: z.number().min(240).max(2160).default(1080)
    }).optional().describe("Custom viewport dimensions."),
    screenshot: z.boolean().optional().default(false).describe("Capture a screenshot of the page after loading."),
    block_webrtc: z.boolean().optional().default(false).describe("Block WebRTC entirely for enhanced privacy."),
    proxy: z.union([
      z.string().describe("Proxy URL (e.g., 'http://proxy.example.com:8080')"),
      z.object({
        server: z.string().describe("Proxy server URL"),
        username: z.string().optional().describe("Proxy username for authentication"),
        password: z.string().optional().describe("Proxy password for authentication")
      })
    ]).optional().describe("Proxy configuration for the browser."),
    enable_cache: z.boolean().optional().default(false).describe("Cache pages, requests, etc. Uses more memory but improves performance when revisiting pages."),
    firefox_user_prefs: z.record(z.any()).optional().describe("Custom Firefox user preferences to set."),
    exclude_addons: z.array(z.string()).optional().describe("List of default addons to exclude (e.g., ['ublock_origin'])."),
    window: z.tuple([
      z.number().min(320).max(3840),
      z.number().min(240).max(2160)
    ]).optional().describe("Set fixed window size [width, height] instead of random generation."),
    args: z.array(z.string()).optional().describe("Additional command-line arguments to pass to the browser."),
    block_images: z.boolean().optional().default(false).describe("Block all images for faster loading and reduced bandwidth usage."),
    block_webgl: z.boolean().optional().default(false).describe("Block WebGL to prevent fingerprinting. Only use for special cases as it may cause detection."),
    disable_coop: z.boolean().optional().default(false).describe("Disable Cross-Origin-Opener-Policy, allowing clicks on elements in cross-origin iframes."),
    geoip: z.boolean().optional().default(true).describe("Automatically detect geolocation based on IP address."),
    headless: z.boolean().optional().describe("Run browser in headless mode. Auto-detects best mode for environment if not specified."),
  },
  async ({ url, os, waitStrategy, timeout, humanize, locale, viewport, screenshot, block_webrtc, proxy, enable_cache, firefox_user_prefs, exclude_addons, window, args, block_images, block_webgl, disable_coop, geoip, headless }) => {
    let browser;

    try {
      console.error(chalk.blue(`[Camoufox] Launching browser to browse: ${url}`));
      
      // Detect if we're running in Docker/Linux or locally
      const isLinux = process.platform === 'linux';
      const headlessMode = headless !== undefined ? headless : (isLinux ? 'virtual' : true); // Use specified mode or auto-detect
      
      // Auto-rotate OS if not specified for better anti-detection
      const osOptions = ["windows", "macos", "linux"];
      const selectedOS = os || osOptions[Math.floor(Math.random() * osOptions.length)];
      
      // Launch Camoufox with enhanced anti-detection options
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

      const content: any[] = [{
        type: "text" as const,
        text: pageContent // Return the HTML content
      }];
      
      if (screenshotBase64) {
        content.push({
          type: "image" as any,
          source: {
            type: "base64" as const,
            media_type: "image/png" as const,
            data: screenshotBase64
          }
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

// Main function to start the server
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

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.error(chalk.yellow('\n[Camoufox] Shutting down server...'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error(chalk.yellow('\n[Camoufox] Shutting down server...'));
  process.exit(0);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('[Camoufox] Uncaught exception:', error));
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('[Camoufox] Unhandled rejection at:', promise, 'reason:', reason));
  process.exit(1);
});

runServer().catch((error) => {
  console.error(chalk.red("Fatal error running server:", error));
  process.exit(1);
});
