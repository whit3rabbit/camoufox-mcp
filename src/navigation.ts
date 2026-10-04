import type { Page, Response } from "playwright-core";
import chalk from "chalk";
import type { WaitStrategy } from "./types.js";
import { redactUrl } from "./utils.js";

export function isMangledDocumentUrl(committedUrl: string, targetUrl: URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(committedUrl);
  } catch {
    return false;
  }

  if (!/\/{2,}/.test(parsed.pathname)) return false;
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/");
  // Comparing the complete URL also preserves credentials, query, hash, and
  // intentional duplicate separators in the caller's requested path.
  return parsed.href === targetUrl.href;
}

function isCanonicalNetworkResponse(response: Response | null, targetUrl: URL): boolean {
  if (!response) return false;
  const expected = new URL(targetUrl.href);
  const actual = new URL(response.url());
  // Fragments and URL credentials do not identify the HTTP request target.
  for (const url of [expected, actual]) {
    url.hash = "";
    url.username = "";
    url.password = "";
  }
  return actual.href === expected.href;
}

export async function navigateWithDocumentUrlCorrection(
  page: Pick<Page, "url" | "goto">,
  targetUrl: URL,
  options: { waitUntil: WaitStrategy; timeout?: number },
  assertSafe: () => Promise<void>,
): Promise<Response | null> {
  const startedAt = performance.now();
  let response = await page.goto(targetUrl.href, options);
  await assertSafe();

  // A real HTTP redirect can intentionally end at a duplicate-slash path.
  // Correct only when the network response used the original canonical URL.
  if (!isCanonicalNetworkResponse(response, targetUrl) || !isMangledDocumentUrl(page.url(), targetUrl)) {
    return response;
  }

  const remainingTimeout = options.timeout === undefined || options.timeout === 0
    ? options.timeout
    : Math.ceil(options.timeout - (performance.now() - startedAt));
  if (options.timeout !== 0 && remainingTimeout !== undefined && remainingTimeout < 1) {
    throw new Error("Document URL correction exceeded the navigation timeout.");
  }

  console.error(chalk.yellow(`[Camoufox] Correcting document URL drift from ${redactUrl(page.url())} to ${redactUrl(targetUrl.href)}.`));
  response = await page.goto(targetUrl.href, { ...options, timeout: remainingTimeout });
  await assertSafe();

  // A persistent engine fault must not loop or return a still-corrupt document.
  if ((!response || isCanonicalNetworkResponse(response, targetUrl)) && isMangledDocumentUrl(page.url(), targetUrl)) {
    throw new Error("Browser document URL remained malformed after one corrective navigation.");
  }
  return response;
}
