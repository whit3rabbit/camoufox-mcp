import type { Page, Response } from "playwright-core";
import { MAX_EXTRACT_NODES } from "../config.js";
import type { BrowsePayload, ExtractedContent, OutputMode } from "../types.js";
import { redactUrl } from "../utils.js";

export async function extractPageContent(
  page: Page,
  outputMode: OutputMode,
  maxChars: number,
  selector?: string,
): Promise<ExtractedContent> {
  if (outputMode === "metadata") {
    return {
      value: "",
      truncated: false,
      found: false,
    };
  }

  return page.evaluate(
    (
      { mode, maxLength, cssSelector, maxNodes }: {
        mode: OutputMode;
        maxLength: number;
        cssSelector?: string;
        maxNodes: number;
      },
    ) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { value: "", truncated: false, found: false };
      }

      const limit = maxLength + 1;
      const blockedTextTags = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"]);
      const blockBoundaryTags = new Set([
        "ADDRESS",
        "ARTICLE",
        "ASIDE",
        "BLOCKQUOTE",
        "BR",
        "DD",
        "DETAILS",
        "DIALOG",
        "DIV",
        "DL",
        "DT",
        "FIELDSET",
        "FIGCAPTION",
        "FIGURE",
        "FOOTER",
        "FORM",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "HEADER",
        "HR",
        "LI",
        "MAIN",
        "NAV",
        "OL",
        "P",
        "PRE",
        "SECTION",
        "TABLE",
        "TBODY",
        "TD",
        "TFOOT",
        "TH",
        "THEAD",
        "TR",
        "UL",
      ]);

      function appendBounded(current: string, chunk: string): { value: string; truncated: boolean } {
        const available = limit - current.length;
        if (available <= 0) {
          return { value: current, truncated: chunk.length > 0 };
        }

        if (chunk.length > available) {
          return { value: `${current}${chunk.slice(0, available)}`, truncated: true };
        }

        return { value: `${current}${chunk}`, truncated: false };
      }

      function isHiddenElement(element: Element): boolean {
        if (blockedTextTags.has(element.tagName)) {
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

      if (mode === "html") {
        const voidTags = new Set([
          "area",
          "base",
          "br",
          "col",
          "embed",
          "hr",
          "img",
          "input",
          "link",
          "meta",
          "param",
          "source",
          "track",
          "wbr",
        ]);
        let html = "";
        let truncated = false;
        let visitedNodes = 0;
        const stack: Array<{ node: Node; closing: boolean }> = [{ node: root, closing: false }];

        function escapeText(value: string): string {
          return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
        }

        function escapeAttribute(value: string): string {
          return escapeText(value).replaceAll("\"", "&quot;");
        }

        function appendHtml(chunk: string): void {
          const result = appendBounded(html, chunk);
          html = result.value;
          truncated = truncated || result.truncated;
        }

        while (stack.length > 0 && html.length < limit && visitedNodes < maxNodes) {
          const current = stack.pop();
          if (!current) {
            break;
          }

          const { node, closing } = current;
          if (closing) {
            appendHtml(`</${(node as Element).tagName.toLowerCase()}>`);
            continue;
          }

          visitedNodes += 1;
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            const tagName = element.tagName.toLowerCase();
            appendHtml(`<${tagName}`);
            for (const attribute of Array.from(element.attributes)) {
              appendHtml(` ${attribute.name}="${escapeAttribute(attribute.value)}"`);
            }
            appendHtml(">");

            if (voidTags.has(tagName)) {
              continue;
            }

            stack.push({ node: element, closing: true });
            for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
              stack.push({ node: element.childNodes[index], closing: false });
            }
          } else if (node.nodeType === Node.TEXT_NODE) {
            appendHtml(escapeText(node.nodeValue ?? ""));
          } else if (node.nodeType === Node.COMMENT_NODE) {
            appendHtml(`<!--${node.nodeValue ?? ""}-->`);
          }
        }

        truncated = truncated || stack.length > 0 || visitedNodes >= maxNodes || html.length > maxLength;
        return {
          value: html.slice(0, maxLength),
          truncated,
          found: true,
        };
      }

      let text = "";
      let truncated = false;
      let visitedNodes = 0;
      const stack: Array<{ node: Node; closing: boolean }> = [{ node: root, closing: false }];

      function appendText(chunk: string): void {
        const normalized = chunk.replace(/\s+/g, " ").trim();
        if (!normalized) {
          return;
        }

        const needsSpace = text.length > 0 && !/\s$/.test(text) && !/^[,.;:!?)]/.test(normalized);
        const result = appendBounded(text, `${needsSpace ? " " : ""}${normalized}`);
        text = result.value;
        truncated = truncated || result.truncated;
      }

      function appendBoundary(): void {
        if (!text || /\n$/.test(text)) {
          return;
        }

        const result = appendBounded(text.replace(/[ \t]+$/, ""), "\n");
        text = result.value;
        truncated = truncated || result.truncated;
      }

      while (stack.length > 0 && text.length < limit && visitedNodes < maxNodes) {
        const current = stack.pop();
        if (!current) {
          break;
        }

        const { node, closing } = current;
        if (closing) {
          if (blockBoundaryTags.has((node as Element).tagName)) {
            appendBoundary();
          }
          continue;
        }

        visitedNodes += 1;
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (isHiddenElement(element)) {
            continue;
          }

          if (element.tagName === "BR") {
            appendBoundary();
            continue;
          }

          if (blockBoundaryTags.has(element.tagName)) {
            appendBoundary();
          }

          stack.push({ node: element, closing: true });
          for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
            stack.push({ node: element.childNodes[index], closing: false });
          }
        } else if (node.nodeType === Node.TEXT_NODE) {
          appendText(node.nodeValue ?? "");
        }
      }

      const normalizedText = text
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      truncated = truncated || stack.length > 0 || visitedNodes >= maxNodes || text.length > maxLength || normalizedText.length > maxLength;
      return {
        value: normalizedText.slice(0, maxLength),
        truncated,
        found: true,
      };
    },
    { mode: outputMode, maxLength: maxChars, cssSelector: selector, maxNodes: MAX_EXTRACT_NODES },
  );
}

export async function buildBrowsePayload(
  page: Page,
  response: Response | null,
  outputMode: OutputMode,
  maxChars: number,
  selector?: string,
): Promise<BrowsePayload> {
  const payload: BrowsePayload = {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    outputMode,
    truncated: false,
    maxChars,
    selector,
  };

  if (outputMode === "metadata") {
    return payload;
  }

  const extracted = await extractPageContent(page, outputMode, maxChars, selector);
  payload.truncated = extracted.truncated;
  payload.selectorFound = extracted.found;

  if (outputMode === "html") {
    payload.html = extracted.value;
  } else {
    payload.text = extracted.value;
  }

  return payload;
}
