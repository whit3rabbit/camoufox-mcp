import type { Page, Response } from "playwright-core";
import type { SnapshotElement, SnapshotPayload } from "../types.js";
import { describeError, redactUrl, truncateString } from "../utils.js";
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
        while (current && current !== document.documentElement && path.length < 8) {
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

export async function buildSnapshotPayload(
  page: Page,
  response: Response | null,
  maxChars: number,
  maxElements: number,
  selector?: string,
): Promise<SnapshotPayload> {
  const text = await extractPageContent(page, "text", maxChars, selector);
  const elementSnapshot = await extractSnapshotElements(page, maxElements, selector);
  const payload: SnapshotPayload = {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
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

  try {
    const target = selector ? page.locator(selector).first() : page.locator("body").first();
    const aria = await target.ariaSnapshot({ timeout: 3000 });
    const truncated = truncateString(aria, maxChars);
    payload.ariaSnapshot = truncated.value;
    payload.ariaSnapshotTruncated = truncated.truncated;
  } catch (snapshotError) {
    payload.ariaSnapshotError = describeError(snapshotError);
  }

  return payload;
}
