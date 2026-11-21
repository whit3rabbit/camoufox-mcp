import type { Frame, Page, Response } from "playwright-core";
import type { SnapshotElement, SnapshotPayload } from "../types.js";
import { describeError, redactUrl, truncateString, withTimeout } from "../utils.js";
import { extractPageContent } from "./content.js";

export async function extractSnapshotElements(
  page: Page,
  maxElements: number,
  selector?: string,
): Promise<{ elements: SnapshotElement[]; truncated: boolean; found: boolean }> {
  return page.evaluate(
    ({ maxItems, cssSelector }: { maxItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { elements: [], truncated: false, found: false };
      }

      function textOf(element: Element): string {
        return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      }

      function cssIdent(value: string): string {
        if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
          return CSS.escape(value);
        }

        return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
      }

      function selectorFor(element: Element): string {
        if (element.id) {
          return `#${cssIdent(element.id)}`;
        }

        const path: string[] = [];
        let current: Element | null = element;
        // Walk to the nearest ancestor with an id, or to the root. A path cut off
        // at a fixed depth is relative and matches the first similar subtree.
        while (current && current !== document.documentElement) {
          if (current !== element && current.id) {
            path.unshift(`#${cssIdent(current.id)}`);
            break;
          }
          let part = current.tagName.toLowerCase();
          if (current.classList.length > 0) {
            part += `.${Array.from(current.classList).slice(0, 2).map(cssIdent).join(".")}`;
          }

          const currentTagName = current.tagName;
          const parent: Element | null = current.parentElement;
          if (parent) {
            const sameTagSiblings = Array.from(parent.children).filter((child: Element) => child.tagName === currentTagName);
            if (sameTagSiblings.length > 1) {
              part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
            }
          }

          path.unshift(part);
          current = parent;
        }

        return path.join(" > ");
      }

      function inferredRole(element: Element): string | undefined {
        const explicit = element.getAttribute("role");
        if (explicit) {
          return explicit;
        }

        const tagName = element.tagName.toLowerCase();
        if (tagName === "a" && element.hasAttribute("href")) {
          return "link";
        }
        if (tagName === "button") {
          return "button";
        }
        if (tagName === "select") {
          return "combobox";
        }
        if (tagName === "textarea") {
          return "textbox";
        }
        if (tagName === "input") {
          const type = (element.getAttribute("type") ?? "text").toLowerCase();
          if (["button", "submit", "reset"].includes(type)) {
            return "button";
          }
          if (type === "checkbox") {
            return "checkbox";
          }
          if (type === "radio") {
            return "radio";
          }
          return "textbox";
        }

        return undefined;
      }

      function accessibleName(element: Element): string | undefined {
        const direct = element.getAttribute("aria-label")
          ?? element.getAttribute("alt")
          ?? element.getAttribute("title")
          ?? element.getAttribute("placeholder");
        if (direct?.trim()) {
          return direct.trim().slice(0, 300);
        }

        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (text) {
            return text.slice(0, 300);
          }
        }

        return textOf(element) || undefined;
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return false;
        }

        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
      }

      const candidateSelector = [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "[role]",
        "[tabindex]:not([tabindex='-1'])",
        "[contenteditable='true']",
      ].join(",");
      const candidates = [
        ...(root.matches(candidateSelector) ? [root] : []),
        ...Array.from(root.querySelectorAll(candidateSelector)),
      ];

      const elements = [];
      let truncated = false;
      for (const element of candidates) {
        if (!isVisible(element)) {
          continue;
        }

        if (elements.length >= maxItems) {
          truncated = true;
          break;
        }

        const rect = element.getBoundingClientRect();
        elements.push({
          tag: element.tagName.toLowerCase(),
          selector: selectorFor(element),
          role: inferredRole(element),
          name: accessibleName(element),
          text: textOf(element) || undefined,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }

      return {
        elements,
        truncated,
        found: true,
      };
    },
    { maxItems: maxElements, cssSelector: selector },
  );
}

const SNAPSHOT_ATTEMPTS = 3;
const SNAPSHOT_TIMEOUT_MS = 10000;
const ARIA_SNAPSHOT_TIMEOUT_MS = 3000;
// Kept back from the snapshot budget while waiting on a pending navigation, so
// the document it commits can still be read in full.
const PENDING_NAVIGATION_RESERVE_MS = 2500;

class SnapshotNavigationChanged extends Error {}

function isNavigationReadError(error: unknown): boolean {
  return error instanceof SnapshotNavigationChanged
    || /execution context was destroyed|cannot find context with (?:specified )?id/i.test(describeError(error));
}

// Playwright holds locator reads while a main-frame navigation has started but
// not committed, and names that wait in the call log of the resulting timeout.
// The match depends on the pinned playwright-core wording; if it stops
// matching, the read falls back to reporting the timeout as a diagnostic.
function isPendingNavigationTimeout(error: unknown): boolean {
  // The target URL is included once its request is known: `waiting for" <url>" navigation`.
  return /waiting for(?:\s*"[^"\n]*")? navigation to finish/i.test(describeError(error));
}

async function readSnapshotPayload(
  page: Page,
  maxChars: number,
  maxElements: number,
  selector: string | undefined,
  remainingMs: () => number,
): Promise<SnapshotPayload> {
  const text = await extractPageContent(page, "text", maxChars, selector);
  const elementSnapshot = await extractSnapshotElements(page, maxElements, selector);
  const payload: SnapshotPayload = {
    url: redactUrl(page.url()),
    title: await page.title(),
    selector,
    selectorFound: text.found && elementSnapshot.found,
    maxChars,
    maxElements,
    text: text.value,
    textTruncated: text.truncated,
    elements: elementSnapshot.elements,
    elementsTruncated: elementSnapshot.truncated,
  };

  if (!payload.selectorFound) {
    return payload;
  }

  const target = selector ? page.locator(selector).first() : page.locator("body").first();
  let timeout = Math.min(ARIA_SNAPSHOT_TIMEOUT_MS, remainingMs());
  for (;;) {
    try {
      const aria = await target.ariaSnapshot({ timeout });
      const truncated = truncateString(aria, maxChars);
      payload.ariaSnapshot = truncated.value;
      payload.ariaSnapshotTruncated = truncated.truncated;
      break;
    } catch (snapshotError) {
      const waitBudget = remainingMs() - PENDING_NAVIGATION_RESERVE_MS;
      if (isNavigationReadError(snapshotError)) throw snapshotError;
      // An action such as a link click can return before its navigation
      // commits, and the browser can hold that request for seconds. Keep
      // waiting for the commit rather than describe the outgoing document.
      // The caller then re-reads the new document; the action never reruns.
      if (isPendingNavigationTimeout(snapshotError) && waitBudget > 0) {
        timeout = Math.min(ARIA_SNAPSHOT_TIMEOUT_MS, waitBudget);
        continue;
      }
      payload.ariaSnapshotError = describeError(snapshotError);
      break;
    }
  }

  return payload;
}

export async function buildSnapshotPayload(
  page: Page,
  response: Response | null,
  maxChars: number,
  maxElements: number,
  selector?: string,
  getResponse: () => Response | null = () => response,
): Promise<SnapshotPayload> {
  const deadline = Date.now() + SNAPSHOT_TIMEOUT_MS;
  const remainingMs = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Snapshot timed out.");
    return remaining;
  };
  let generation = 0;
  const onNavigation = (frame: Frame) => {
    if (frame === page.mainFrame()) generation += 1;
  };
  page.on("framenavigated", onNavigation);

  try {
    return await withTimeout((async () => {
      for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
        const attemptGeneration = generation;
        let documentHandle;
        try {
          await page.waitForLoadState("domcontentloaded", { timeout: remainingMs() });
          documentHandle = await page.evaluateHandle(() => document);
          const payload = await readSnapshotPayload(page, maxChars, maxElements, selector, remainingMs);
          // A retained document handle detects reloads at the same URL too.
          // Retry only extraction, never the action that triggered navigation.
          if (attemptGeneration !== generation || !await documentHandle.evaluate((original) => original === document)) {
            throw new SnapshotNavigationChanged("Document changed during snapshot extraction.");
          }
          const currentResponse = getResponse();
          payload.status = currentResponse?.status();
          payload.contentType = currentResponse?.headers()["content-type"];
          if (attemptGeneration !== generation || !await documentHandle.evaluate((original) => original === document)) {
            throw new SnapshotNavigationChanged("Document changed during snapshot metadata extraction.");
          }
          return payload;
        } catch (error) {
          remainingMs();
          if (!isNavigationReadError(error)) throw error;
          if (attempt === SNAPSHOT_ATTEMPTS - 1) {
            throw new Error(`Snapshot could not stabilize after ${SNAPSHOT_ATTEMPTS} attempts.`, { cause: error });
          }
        } finally {
          await documentHandle?.dispose().catch(() => undefined);
        }
      }
      throw new Error("Snapshot could not stabilize.");
    })(), SNAPSHOT_TIMEOUT_MS, "Snapshot");
  } finally {
    page.off("framenavigated", onNavigation);
  }
}
