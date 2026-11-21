import type { Page, Response } from "playwright-core";
import type { FindPayload } from "../types.js";
import { redactUrl } from "../utils.js";

export async function buildFindPayload(
  page: Page,
  response: Response | null,
  query: string,
  maxMatches: number,
  contextChars: number,
  selector?: string,
): Promise<FindPayload> {
  const extracted = await page.evaluate(
    (
      { searchQuery, maxItems, surroundingChars, cssSelector }: {
        searchQuery: string;
        maxItems: number;
        surroundingChars: number;
        cssSelector?: string;
      },
    ) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { matches: [], truncated: false, found: false };
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
          const parent: Element | null = current.parentElement;
          if (parent) {
            const currentTagName = current.tagName;
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

      function isHiddenElement(element: Element): boolean {
        if (["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(element.tagName)) {
          return true;
        }
        if (element instanceof HTMLElement && element.hidden) {
          return true;
        }
        if (element.getAttribute("aria-hidden") === "true") {
          return true;
        }
        const style = window.getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse";
      }

      function isTextNodeVisible(node: Node): boolean {
        let current = node.parentElement;
        while (current) {
          if (isHiddenElement(current)) {
            return false;
          }
          if (current === root) {
            return true;
          }
          current = current.parentElement;
        }
        return true;
      }

      // Page text is whitespace-collapsed before matching, so the query is too;
      // otherwise a query containing a double space could never match.
      const collapsedQuery = searchQuery.replace(/\s+/g, " ");
      if (!collapsedQuery) {
        return { matches: [], truncated: false, found: true };
      }
      const queryPattern = new RegExp(collapsedQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = [];
      let truncated = false;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          if (!node.nodeValue || !isTextNodeVisible(node)) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      while (true) {
        const node = walker.nextNode();
        if (!node) {
          break;
        }

        const rawText = (node.nodeValue ?? "").replace(/\s+/g, " ");
        // Report every non-overlapping occurrence in this text node. Matching
        // case-insensitively on the original text keeps indices aligned:
        // lower-casing first can change a string's length ("\u0130").
        const nodeSelector = selectorFor(node.parentElement ?? root);
        queryPattern.lastIndex = 0;
        for (let match = queryPattern.exec(rawText); match; match = queryPattern.exec(rawText)) {
          if (matches.length >= maxItems) {
            truncated = true;
            break;
          }

          const start = Math.max(0, match.index - surroundingChars);
          const end = Math.min(rawText.length, match.index + match[0].length + surroundingChars);
          matches.push({
            text: rawText.slice(start, end).trim(),
            selector: nodeSelector,
            score: 1,
          });
        }

        if (truncated) {
          break;
        }
      }

      return { matches, truncated, found: true };
    },
    { searchQuery: query, maxItems: maxMatches, surroundingChars: contextChars, cssSelector: selector },
  );

  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    query,
    selector,
    selectorFound: extracted.found,
    matches: extracted.matches,
    truncated: extracted.truncated,
    maxMatches,
    contextChars,
  };
}
