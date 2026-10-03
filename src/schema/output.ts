import { z } from "zod";
import { captchaDetectionOutputShape, diagnosticsOutputSchema, networkDiagnosticOutputSchema } from "./primitives.js";

// Reused sub-schema for the per-screenshot metadata block emitted by every tool
// that can capture a screenshot (browse, sequence, screenshot, sessions).
export const screenshotMetadataOutputSchema = z.object({
  requested: z.boolean(),
  included: z.boolean(),
  bytes: z.number().optional(),
  maxBytes: z.number().optional(),
  type: z.enum(["png", "jpeg"]).optional(),
  fullPage: z.boolean().optional(),
  selector: z.string().optional(),
  selectorFound: z.boolean().optional(),
  error: z.string().optional(),
}).optional();

// Snapshot interactive element, reused by snapshot/sequence/session payloads.
const snapshotElementOutputSchema = z.object({
  tag: z.string(),
  selector: z.string(),
  role: z.string().optional(),
  name: z.string().optional(),
  text: z.string().optional(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }).optional(),
});

// One step result from a sequence action run, reused by sequence/session-action.
const sequenceActionResultOutputSchema = z.object({
  index: z.number(),
  type: z.string(),
  selector: z.string().optional(),
  status: z.literal("ok"),
  result: z.string().optional(),
  resultTruncated: z.boolean().optional(),
  durationMs: z.number(),
});

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
  browserCompatibility: z.object({
    mode: z.enum(["default", "compatibility"]),
    expectedVersion: z.string(),
    installedVersion: z.string().optional(),
    launcher: z.string(),
    worldIsolationEnabled: z.boolean(),
    warning: z.string().optional(),
  }),
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

// --- browse / snapshot / sequence -------------------------------------------------

export const browseOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  outputMode: z.enum(["text", "html", "metadata"]),
  truncated: z.boolean(),
  maxChars: z.number(),
  selector: z.string().optional(),
  selectorFound: z.boolean().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  screenshot: screenshotMetadataOutputSchema,
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const snapshotOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  selector: z.string().optional(),
  selectorFound: z.boolean(),
  maxChars: z.number(),
  maxElements: z.number(),
  text: z.string(),
  textTruncated: z.boolean(),
  ariaSnapshot: z.string().optional(),
  ariaSnapshotTruncated: z.boolean().optional(),
  ariaSnapshotError: z.string().optional(),
  elements: z.array(snapshotElementOutputSchema),
  elementsTruncated: z.boolean(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const sequenceOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  initialStatus: z.number().optional(),
  actions: z.array(sequenceActionResultOutputSchema),
  snapshot: z.object({
    url: z.string(),
    title: z.string().optional(),
    status: z.number().optional(),
    contentType: z.string().optional(),
    selector: z.string().optional(),
    selectorFound: z.boolean(),
    maxChars: z.number(),
    maxElements: z.number(),
    text: z.string(),
    textTruncated: z.boolean(),
    ariaSnapshot: z.string().optional(),
    ariaSnapshotTruncated: z.boolean().optional(),
    ariaSnapshotError: z.string().optional(),
    elements: z.array(snapshotElementOutputSchema),
    elementsTruncated: z.boolean(),
    diagnostics: diagnosticsOutputSchema,
  }).optional(),
  outputMode: z.enum(["text", "html", "metadata"]),
  truncated: z.boolean(),
  maxChars: z.number(),
  selector: z.string().optional(),
  selectorFound: z.boolean().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  screenshot: screenshotMetadataOutputSchema,
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

// --- console / screenshot ---------------------------------------------------------

// browse_console handler-built payload. includeNetwork defaults off, so network
// is optional; includeConsole defaults on, so console is always present.
export const consoleOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  console: z.array(z.object({
    type: z.string(),
    text: z.string(),
    location: z.object({
      url: z.string().optional(),
      lineNumber: z.number().optional(),
      columnNumber: z.number().optional(),
    }).optional(),
  })),
  consoleTruncated: z.boolean().optional(),
  network: z.array(networkDiagnosticOutputSchema).optional(),
  ...captchaDetectionOutputShape,
});

// browse_screenshot handler-built payload. screenshot metadata is always present.
export const screenshotOutputSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  screenshot: z.object({
    requested: z.boolean(),
    included: z.boolean(),
    bytes: z.number().optional(),
    maxBytes: z.number().optional(),
    type: z.enum(["png", "jpeg"]).optional(),
    fullPage: z.boolean().optional(),
    selector: z.string().optional(),
    selectorFound: z.boolean().optional(),
    error: z.string().optional(),
  }),
  ...captchaDetectionOutputShape,
});

// --- sessions ---------------------------------------------------------------------

const sessionEnvelopeShape = {
  sessionId: z.string(),
  expiresAt: z.string(),
};

export const sessionStartOutputSchema = z.object({
  sessionId: z.string(),
  expiresAt: z.string(),
  browser: z.literal("camoufox"),
  selectedOS: z.string(),
  headlessMode: z.union([z.boolean(), z.literal("virtual")]),
  stealthProfile: z.enum(["normal", "privacy", "human_assisted", "fast", "debug"]).optional(),
  captchaPolicy: z.enum(["detect", "pause", "fail", "attempt"]),
});

// navigate spreads a browse payload under the session envelope.
export const sessionNavigateOutputSchema = z.object({
  ...sessionEnvelopeShape,
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  outputMode: z.enum(["text", "html", "metadata"]),
  truncated: z.boolean(),
  maxChars: z.number(),
  selector: z.string().optional(),
  selectorFound: z.boolean().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

// action returns one action result plus a snapshot.
export const sessionActionOutputSchema = z.object({
  ...sessionEnvelopeShape,
  action: sequenceActionResultOutputSchema,
  snapshot: z.object({
    url: z.string(),
    title: z.string().optional(),
    status: z.number().optional(),
    contentType: z.string().optional(),
    selector: z.string().optional(),
    selectorFound: z.boolean(),
    maxChars: z.number(),
    maxElements: z.number(),
    text: z.string(),
    textTruncated: z.boolean(),
    ariaSnapshot: z.string().optional(),
    ariaSnapshotTruncated: z.boolean().optional(),
    ariaSnapshotError: z.string().optional(),
    elements: z.array(snapshotElementOutputSchema),
    elementsTruncated: z.boolean(),
    diagnostics: diagnosticsOutputSchema,
  }),
  ...captchaDetectionOutputShape,
});

// snapshot/resume share the same shape (envelope + snapshot + diagnostics).
const sessionSnapshotBaseSchema = z.object({
  ...sessionEnvelopeShape,
  url: z.string(),
  title: z.string().optional(),
  status: z.number().optional(),
  contentType: z.string().optional(),
  selector: z.string().optional(),
  selectorFound: z.boolean(),
  maxChars: z.number(),
  maxElements: z.number(),
  text: z.string(),
  textTruncated: z.boolean(),
  ariaSnapshot: z.string().optional(),
  ariaSnapshotTruncated: z.boolean().optional(),
  ariaSnapshotError: z.string().optional(),
  elements: z.array(snapshotElementOutputSchema),
  elementsTruncated: z.boolean(),
  diagnostics: diagnosticsOutputSchema,
  ...captchaDetectionOutputShape,
});

export const sessionSnapshotOutputSchema = sessionSnapshotBaseSchema;
export const sessionResumeOutputSchema = sessionSnapshotBaseSchema;

export const sessionCloseOutputSchema = z.object({
  sessionId: z.string(),
  closed: z.boolean(),
});
