import type { Page, Response } from "playwright-core";

export function trackNavigationResponses(
  page: Page,
  onCommitted: (response: Response | null) => void = () => undefined,
): () => Response | null {
  let pending: Response | null = null;
  let current: Response | null = null;
  page.on("response", (response) => {
    const request = response.request();
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) pending = response;
  });
  page.on("requestfailed", (request) => {
    if (pending?.request() === request) pending = null;
  });
  // Response headers can arrive before commit. DOM readiness belongs to a new
  // document, while hash/history changes leave the current response untouched.
  page.on("domcontentloaded", () => {
    current = pending;
    pending = null;
    onCommitted(current);
  });
  return () => current;
}
