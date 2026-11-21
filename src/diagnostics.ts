import type { Page } from "playwright-core";
import { MAX_DIAGNOSTIC_ENTRIES } from "./config.js";
import type { BrowserLaunchInput, ConsoleDiagnostic, DiagnosticsCollector, DiagnosticsPayload, NetworkDiagnostic } from "./types.js";
import { describeError, redactUrl, sanitizeDiagnosticText } from "./utils.js";

export function createDiagnosticsCollector(
  page: Page,
  input: BrowserLaunchInput,
  rawUrls: string[],
  secrets: string[],
): DiagnosticsCollector {
  let consoleEntries: ConsoleDiagnostic[] = [];
  let networkEntries: NetworkDiagnostic[] = [];
  const networkByRequest = new WeakMap<object, NetworkDiagnostic>();
  let consoleTruncated = false;
  let networkTruncated = false;

  // Console keeps the most recent entries: on a long-lived page the latest
  // messages are the ones that explain its current state. Network keeps the
  // first entries, which describe how the page loaded.
  function pushConsole(entry: ConsoleDiagnostic): void {
    if (consoleEntries.length >= MAX_DIAGNOSTIC_ENTRIES) {
      consoleEntries.shift();
      consoleTruncated = true;
    }
    consoleEntries.push(entry);
  }

  if (input.includeConsole) {
    page.on("console", (message) => {
      const location = message.location();
      pushConsole({
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
      pushConsole({
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
        payload.console = [...consoleEntries];
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
    reset(): void {
      // New arrays: a payload already handed out must not change underneath
      // its reader.
      consoleEntries = [];
      networkEntries = [];
      consoleTruncated = false;
      networkTruncated = false;
    },
  };
}

export function appendDiagnostics<T extends { diagnostics?: DiagnosticsPayload }>(payload: T, diagnostics?: DiagnosticsPayload): T {
  if (diagnostics) {
    payload.diagnostics = diagnostics;
  }

  return payload;
}
