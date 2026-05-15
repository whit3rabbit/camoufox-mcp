import { z } from "zod";
import { captchaDetectionOutputShape, diagnosticsOutputSchema, networkDiagnosticOutputSchema } from "./primitives.js";

export const networkSecurityOutputSchema = z.object({
  ssrfPolicy: z.literal("app_layer_best_effort"),
  sandboxMode: z.enum(["unknown", "declared", "docker", "strict-declared"]),
  sandboxDeclared: z.boolean(),
  strictSandboxRequired: z.boolean(),
  warning: z.string().optional(),
});

export const statusOutputSchema = z.object({
  version: z.string(),
  browser: z.literal("camoufox"),
  browserAvailable: z.boolean(),
  browserPath: z.string().optional(),
  headlessMode: z.union([z.boolean(), z.literal("virtual")]),
  platform: z.string(),
  activeBrowsers: z.number(),
  activeSessions: z.number(),
  queuedRequests: z.number(),
  maxConcurrency: z.number(),
  maxQueue: z.number(),
  maxSessions: z.number(),
  sessionTtlMs: z.number(),
  unsafeOptionsAllowed: z.boolean(),
  evaluateAllowed: z.boolean(),
  captchaAutonomous: z.boolean(),
  networkSecurity: networkSecurityOutputSchema,
});

export const linksOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  selector: z.string().optional(),
  selectorFound: z.boolean(),
  links: z.array(z.object({
    text: z.string(),
    href: z.string(),
    selector: z.string(),
    visible: z.boolean(),
    confidence: z.number(),
  })),
  truncated: z.boolean(),
  maxLinks: z.number(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const formsOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  selector: z.string().optional(),
  selectorFound: z.boolean(),
  forms: z.array(z.object({
    selector: z.string(),
    fields: z.array(z.object({
      label: z.string().optional(),
      type: z.string(),
      name: z.string().optional(),
      selector: z.string(),
      required: z.boolean(),
      placeholder: z.string().optional(),
      value: z.string().optional(),
      options: z.array(z.object({
        text: z.string(),
        value: z.string(),
      })).optional(),
    })),
    submit: z.object({
      text: z.string().optional(),
      selector: z.string(),
    }).optional(),
  })),
  truncated: z.boolean(),
  maxForms: z.number(),
  maxFields: z.number(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const outlineOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  description: z.string().optional(),
  selector: z.string().optional(),
  selectorFound: z.boolean(),
  headings: z.array(z.object({
    level: z.number(),
    text: z.string(),
    selector: z.string(),
  })),
  landmarks: z.array(z.string()),
  truncated: z.boolean(),
  maxItems: z.number(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const findOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  query: z.string(),
  selector: z.string().optional(),
  selectorFound: z.boolean(),
  matches: z.array(z.object({
    text: z.string(),
    selector: z.string(),
    score: z.number(),
  })),
  truncated: z.boolean(),
  maxMatches: z.number(),
  contextChars: z.number(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const networkSummaryOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  requests: z.number(),
  failed: z.number(),
  blocked: z.number(),
  statusCounts: z.record(z.string(), z.number()),
  resourceTypeCounts: z.record(z.string(), z.number()),
  topFailures: z.array(networkDiagnosticOutputSchema),
  truncated: z.boolean(),
  ...captchaDetectionOutputShape,
});
