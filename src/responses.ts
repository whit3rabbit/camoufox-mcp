import chalk from "chalk";
import type { CommonBrowserInput, ScreenshotResult, ToolContent } from "./types.js";
import { describeError, getProxySecrets, getProxyServer, sanitizeErrorMessage } from "./utils.js";

export function buildSuccessContent(payload: unknown, screenshotResult?: ScreenshotResult): { content: ToolContent[]; structuredContent: Record<string, unknown> } {
  const content: ToolContent[] = [{
    type: "text",
    text: JSON.stringify(payload),
  }];

  if (screenshotResult?.base64) {
    content.push({
      type: "image",
      data: screenshotResult.base64,
      mimeType: screenshotResult.mimeType,
    });
  }

  return {
    content,
    structuredContent: typeof payload === "object" && payload !== null
      ? payload as Record<string, unknown>
      : { value: payload },
  };
}

export function buildToolFailure(label: string, safeUrl: string, error: unknown, input: CommonBrowserInput) {
  const errorMessage = sanitizeErrorMessage(
    describeError(error),
    [input.url, getProxyServer(input.proxy)].filter((rawUrl): rawUrl is string => Boolean(rawUrl)),
    getProxySecrets(input.proxy),
  );
  console.error(chalk.red(`[Camoufox] Error during ${label} ${safeUrl}: ${errorMessage}`));
  return buildToolError(`Failed to ${label} URL ${safeUrl}. Error: ${errorMessage}`);
}

export function buildToolError(message: string) {
  return {
    content: [{
      type: "text" as const,
      text: message,
    }],
    isError: true,
  };
}
