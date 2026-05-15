import type { Page, Response } from "playwright-core";
import type { OutlinePayload } from "../types.js";
import { redactUrl } from "../utils.js";

export async function buildOutlinePayload(
  page: Page,
  response: Response | null,
  maxItems: number,
  selector?: string,
): Promise<OutlinePayload> {
  const extracted = await page.evaluate(
    ({ maxOutlineItems, cssSelector }: { maxOutlineItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { headings: [], landmarks: [], description: undefined, truncated: false, found: false };
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

      const headingCandidates = Array.from(root.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4, h5, h6"));
      const headings: Array<{ level: number; text: string; selector: string }> = [];
      let truncated = false;
      for (const heading of headingCandidates) {
        const text = (heading.textContent ?? "").replace(/\s+/g, " ").trim();
        if (!text) {
          continue;
        }
        if (headings.length >= maxOutlineItems) {
          truncated = true;
          break;
        }
        headings.push({
          level: Number.parseInt(heading.tagName.slice(1), 10),
          text: text.slice(0, 500),
          selector: selectorFor(heading),
        });
      }

      const landmarkCandidates = Array.from(root.querySelectorAll("[role], header, nav, main, aside, footer, form"));
      const landmarks: string[] = [];
      for (const landmark of landmarkCandidates) {
        if (landmarks.length >= maxOutlineItems) {
          truncated = true;
          break;
        }
        const role = landmark.getAttribute("role") ?? landmark.tagName.toLowerCase();
        if (role && !landmarks.includes(role)) {
          landmarks.push(role);
        }
      }

      const description = document.querySelector<HTMLMetaElement>("meta[name='description']")?.content;
      return {
        headings,
        landmarks,
        description: description?.slice(0, 1000),
        truncated,
        found: true,
      };
    },
    { maxOutlineItems: maxItems, cssSelector: selector },
  );

  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    description: extracted.description,
    selector,
    selectorFound: extracted.found,
    headings: extracted.headings,
    landmarks: extracted.landmarks,
    truncated: extracted.truncated,
    maxItems,
  };
}
