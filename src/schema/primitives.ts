import { z } from "zod";

export const viewportSchema = z.object({
  width: z.number().min(320).max(3840).default(1920),
  height: z.number().min(240).max(2160).default(1080),
}).optional().describe("Custom viewport dimensions.");

export const proxySchema = z.union([
  z.string().describe("Proxy URL (e.g., 'http://proxy.example.com:8080')"),
  z.object({
    server: z.string().describe("Proxy server URL"),
    username: z.string().optional().describe("Proxy username for authentication"),
    password: z.string().optional().describe("Proxy password for authentication"),
  }),
]).optional().describe("Proxy configuration for routing browser traffic through an HTTP(S) proxy. Proxy servers are checked against the same local-network URL policy as page requests.");

export const windowSchema = z.preprocess(
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

export const screenshotOptionsSchema = z.object({
  fullPage: z.boolean().optional().default(false).describe("Capture the full page instead of only the viewport. Byte and viewport/window limits still apply."),
  selector: z.string().max(2000).optional().describe("Optional CSS selector for element-only screenshots."),
  type: z.enum(["png", "jpeg"]).optional().default("png").describe("Screenshot image type."),
  quality: z.number().int().min(1).max(100).optional().describe("JPEG quality from 1-100. Ignored for PNG."),
}).optional().describe("Optional screenshot capture settings. Used only when screenshot is true.");

export const stealthProfileSchema = z.enum(["normal", "privacy", "human_assisted", "fast", "debug"]).optional()
  .describe("Convenience profile for common Camoufox browser settings. Explicit options override profile values.");
export const captchaPolicySchema = z.enum(["detect", "pause", "fail", "attempt"]).optional()
  .describe("Challenge handling policy. 'detect' reports signals, 'pause' returns state for human action, 'fail' returns an error, 'attempt' returns enhanced challenge metadata, interactive elements, a bounded screenshot, and a suggested strategy. When CAPTCHA_AUTONOMOUS=true, responses are marked for LLM-assisted handling and include provider-specific challengePlaybook context when known.");
export const anyOutputSchema = z.object({}).passthrough();

export const consoleDiagnosticOutputSchema = z.object({
  type: z.string(),
  text: z.string(),
  location: z.object({
    url: z.string().optional(),
    lineNumber: z.number().optional(),
    columnNumber: z.number().optional(),
  }).optional(),
});

export const networkDiagnosticOutputSchema = z.object({
  url: z.string(),
  method: z.string(),
  resourceType: z.string(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  failed: z.boolean().optional(),
  errorText: z.string().optional(),
});

export const diagnosticsOutputSchema = z.object({
  console: z.array(consoleDiagnosticOutputSchema).optional(),
  network: z.array(networkDiagnosticOutputSchema).optional(),
  consoleTruncated: z.boolean().optional(),
  networkTruncated: z.boolean().optional(),
}).optional();

export const captchaIframeOutputSchema = z.object({
  selector: z.string(),
  src: z.string(),
  title: z.string().optional(),
});

export const captchaElementOutputSchema = z.object({
  selector: z.string(),
  frame: z.string().optional(),
  type: z.enum(["checkbox", "input", "button", "image"]),
  label: z.string().optional(),
});

export const captchaDetectionOutputShape = {
  captchaDetected: z.boolean().optional(),
  challengeSignals: z.array(z.string()).optional(),
  challengeHandling: z.enum(["manual", "llm_assisted"]).optional(),
  requiresUserAction: z.boolean().optional(),
  challengeType: z.literal("captcha_or_bot_check").optional(),
  message: z.string().optional(),
  challengeProvider: z.enum(["recaptcha", "hcaptcha", "turnstile", "cloudflare", "text_captcha", "generic"]).optional(),
  captchaIframes: z.array(captchaIframeOutputSchema).optional(),
  interactiveElements: z.array(captchaElementOutputSchema).optional(),
  suggestedStrategy: z.string().optional(),
  challengePlaybook: z.string().optional(),
};
