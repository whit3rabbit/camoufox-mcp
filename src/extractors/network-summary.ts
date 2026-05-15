import type { Page, Response } from "playwright-core";
import type { DiagnosticsPayload, NetworkSummaryPayload } from "../types.js";
import { redactUrl } from "../utils.js";

export function buildNetworkSummary(
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
