import type { Page, Response } from "playwright-core";
import type { FormEntry, FormsPayload } from "../types.js";
import { redactUrl } from "../utils.js";

export async function extractForms(
  page: Page,
  maxForms: number,
  maxFields: number,
  selector?: string,
): Promise<{ forms: FormEntry[]; truncated: boolean; found: boolean }> {
  return page.evaluate(
    ({ maxFormItems, maxFieldItems, cssSelector }: { maxFormItems: number; maxFieldItems: number; cssSelector?: string }) => {
      const root = cssSelector
        ? document.querySelector(cssSelector)
        : document.body ?? document.documentElement;

      if (!root) {
        return { forms: [], truncated: false, found: false };
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
        if (element instanceof HTMLInputElement && element.name) {
          return `input[name="${element.name.replaceAll("\"", "\\\"")}"]`;
        }
        if (element instanceof HTMLTextAreaElement && element.name) {
          return `textarea[name="${element.name.replaceAll("\"", "\\\"")}"]`;
        }
        if (element instanceof HTMLSelectElement && element.name) {
          return `select[name="${element.name.replaceAll("\"", "\\\"")}"]`;
        }

        const path: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.documentElement && path.length < 8) {
          let part = current.tagName.toLowerCase();
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

      function textOf(element: Element | null): string | undefined {
        const text = (element?.textContent ?? "").replace(/\s+/g, " ").trim();
        return text ? text.slice(0, 300) : undefined;
      }

      function labelFor(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string | undefined {
        const aria = field.getAttribute("aria-label")?.trim();
        if (aria) {
          return aria.slice(0, 300);
        }

        const labelledBy = field.getAttribute("aria-labelledby");
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

        if (field.id) {
          const label = document.querySelector(`label[for="${cssIdent(field.id)}"]`);
          const text = textOf(label);
          if (text) {
            return text;
          }
        }

        const parentLabel = field.closest("label");
        const parentText = textOf(parentLabel);
        if (parentText) {
          return parentText;
        }

        return field.getAttribute("placeholder")?.trim().slice(0, 300) || undefined;
      }

      const formCandidates = [
        ...(root.matches("form") ? [root as HTMLFormElement] : []),
        ...Array.from(root.querySelectorAll<HTMLFormElement>("form")),
      ];
      if (formCandidates.length === 0) {
        const looseFields = Array.from(root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
        if (looseFields.length > 0) {
          formCandidates.push(root as HTMLFormElement);
        }
      }

      const forms = [];
      let fieldCount = 0;
      let truncated = false;
      for (const form of formCandidates) {
        if (forms.length >= maxFormItems) {
          truncated = true;
          break;
        }

        const fields = [];
        const fieldCandidates = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select"));
        for (const field of fieldCandidates) {
          const tagName = field.tagName.toLowerCase();
          const type = tagName === "input" ? (field.getAttribute("type") ?? "text").toLowerCase() : tagName;
          if (["hidden", "button", "submit", "reset", "image"].includes(type)) {
            continue;
          }
          if (fieldCount >= maxFieldItems) {
            truncated = true;
            break;
          }

          fieldCount += 1;
          const options = field instanceof HTMLSelectElement
            ? Array.from(field.options).slice(0, 50).map((option) => ({
              text: option.text.replace(/\s+/g, " ").trim().slice(0, 300),
              value: option.value,
            }))
            : undefined;
          fields.push({
            label: labelFor(field),
            type,
            name: field.getAttribute("name") ?? undefined,
            selector: selectorFor(field),
            required: field.hasAttribute("required"),
            placeholder: field.getAttribute("placeholder") ?? undefined,
            value: field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.value.slice(0, 300) : undefined,
            options,
          });
        }

        const submit = form.querySelector<HTMLButtonElement | HTMLInputElement>("button[type='submit'], input[type='submit'], button:not([type])");
        forms.push({
          selector: selectorFor(form),
          fields,
          submit: submit ? {
            text: textOf(submit) ?? submit.getAttribute("value") ?? undefined,
            selector: selectorFor(submit),
          } : undefined,
        });
      }

      return { forms, truncated, found: true };
    },
    { maxFormItems: maxForms, maxFieldItems: maxFields, cssSelector: selector },
  );
}

export async function buildFormsPayload(
  page: Page,
  response: Response | null,
  maxForms: number,
  maxFields: number,
  selector?: string,
): Promise<FormsPayload> {
  const extracted = await extractForms(page, maxForms, maxFields, selector);
  return {
    url: redactUrl(page.url()),
    title: await page.title(),
    status: response?.status(),
    contentType: response?.headers()["content-type"],
    selector,
    selectorFound: extracted.found,
    forms: extracted.forms,
    truncated: extracted.truncated,
    maxForms,
    maxFields,
  };
}
