import type { Page, Response } from "playwright-core";
import type { LinkEntry, LinksPayload } from "../types.js";
import { redactUrl } from "../utils.js";

export async function extractLinks(
  page: Page,
  maxLinks: number,
  selector?: string,
): Promise<{ links: LinkEntry[]; truncated: boolean; found: boolean }> {
  return page.evaluate(
    ({ maxItems, cssSelector }: { maxItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { links: [], truncated: false, found: false };
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

          const parent: Element | null = current.parentElement;
          if (parent) {
            const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
            if (sameTagSiblings.length > 1) {
              part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
            }
          }

          path.unshift(part);
          current = parent;
        }

        return path.join(" > ");
      }

      function textOf(element: Element): string {
        return (element.textContent ?? element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 500);
      }

      function isVisible(element: Element): boolean {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse";
      }

      const candidates = [
        ...(root.matches("a[href]") ? [root as HTMLAnchorElement] : []),
        ...Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]")),
      ];
      const links = [];
      let truncated = false;
      const seen = new Set<string>();

      for (const link of candidates) {
        const href = link.href;
        if (!href || seen.has(href)) {
          continue;
        }

        const visible = isVisible(link);
        const text = textOf(link);
        if (!text && !visible) {
          continue;
        }

        if (links.length >= maxItems) {
          truncated = true;
          break;
        }

        seen.add(href);
        links.push({
          text,
          href,
          selector: selectorFor(link),
          visible,
          confidence: visible && text ? 0.95 : visible || text ? 0.75 : 0.5,
        });
      }

      return { links, truncated, found: true };
    },
    { maxItems: maxLinks, cssSelector: selector },
  );
}

export async function buildLinksPayload(
  page: Page,
  response: Response | null,
  maxLinks: number,
  selector?: string,
): Promise<LinksPayload> {
  const extracted = await extractLinks(page, maxLinks, selector);
  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    selector,
    selectorFound: extracted.found,
    links: extracted.links,
    truncated: extracted.truncated,
    maxLinks,
  };
}
