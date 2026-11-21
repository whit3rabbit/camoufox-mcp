import type { Locator, Page } from "playwright-core";
import chalk from "chalk";
import { ALLOW_EVALUATE, DEFAULT_ACTION_TIMEOUT_MS, SEQUENCE_TIMEOUT_MS } from "./config.js";
import type { SequenceAction } from "./schemas.js";
import type { ClickMode, RequestGuard, SequenceActionResult } from "./types.js";
import { describeError, serializeBounded, withTimeout } from "./utils.js";
import { settleAndAssertSafe } from "./browser-runtime.js";

const EVALUATE_DISABLED_MESSAGE = "Evaluate action is disabled by server policy. Set CAMOUFOX_MCP_ALLOW_EVALUATE=1 to enable it.";

export function actionTimeout(action: { timeout?: number }): number {
  return action.timeout ?? DEFAULT_ACTION_TIMEOUT_MS;
}

// Checked before a browser is launched so a disallowed step does not run the
// steps in front of it first.
export function findDisallowedAction(actions: SequenceAction[]): string | undefined {
  if (!ALLOW_EVALUATE && actions.some((action) => action.type === "evaluate")) {
    return EVALUATE_DISABLED_MESSAGE;
  }

  return undefined;
}

export function sequenceTimeoutBudget(actions: SequenceAction[]): number {
  return actions.reduce((total, action) => total + actionTimeout(action), 0);
}

export function resolveLocator(page: Page, selector: string, frame?: string): Locator {
  if (frame) return page.frameLocator(frame).locator(selector).first();
  return page.locator(selector).first();
}

export async function pointerClick(locator: Locator, timeout: number): Promise<void> {
  await locator.click({ timeout });
}

export async function domClick(locator: Locator, timeout: number): Promise<void> {
  // Camoufox's virtual display can hang during low-level mouse clicks in CI.
  // Keep this as DOM activation, without Playwright's stability-gated scroll
  // or pointer hit-testing, until mouse actions are stable under Xvfb.
  await withTimeout(
    locator.evaluate((element: HTMLElement) => {
      const clickable = element as HTMLElement & { click?: () => void };
      if (typeof clickable.click === "function") {
        clickable.click();
        return;
      }

      element.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      }));
    }),
    timeout,
    "Click action",
  );
}

export async function activateElement(page: Page, selector: string, timeout: number, frame?: string, clickMode: ClickMode = "dom"): Promise<void> {
  // One deadline for the whole click. Giving each stage a fresh timeout let a
  // single action run for several multiples of the caller's limit.
  const deadline = Date.now() + timeout;
  const remaining = (): number => Math.max(1, deadline - Date.now());

  const locator = resolveLocator(page, selector, frame);
  await locator.waitFor({ state: "visible", timeout: remaining() });
  if (!await locator.isEnabled({ timeout: remaining() })) {
    throw new Error(`Click selector is disabled: ${selector}`);
  }

  if (clickMode === "pointer") {
    await pointerClick(locator, remaining());
    return;
  }

  if (clickMode === "auto") {
    // A trial click runs Playwright's actionability and hit-target checks but
    // dispatches nothing. Falling back after it fails cannot double-click. A
    // real pointer click that fails may already have delivered events, so it
    // is never followed by a DOM click.
    let pointerActionable = false;
    try {
      await locator.click({ trial: true, timeout: Math.max(1, Math.floor(remaining() / 2)) });
      pointerActionable = true;
    } catch (error) {
      console.error(chalk.yellow(`[Camoufox] Pointer click is not actionable, using DOM click: ${describeError(error)}`));
    }

    if (pointerActionable) {
      await pointerClick(locator, remaining());
      return;
    }
  }

  await domClick(locator, remaining());
}

export async function runSequenceAction(
  page: Page,
  action: SequenceAction,
  index: number,
  rawUrls: string[],
  secrets: string[],
): Promise<SequenceActionResult> {
  const started = Date.now();
  const timeout = actionTimeout(action);

  switch (action.type) {
    case "click":
      await activateElement(page, action.selector, timeout, action.frame, action.clickMode);
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "hover":
      await resolveLocator(page, action.selector, action.frame).hover({ timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "fill":
      await resolveLocator(page, action.selector, action.frame).fill(action.value, { timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "type":
      await resolveLocator(page, action.selector, action.frame).pressSequentially(action.text, {
        delay: action.delay,
        timeout,
      });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "select":
      await resolveLocator(page, action.selector, action.frame).selectOption(action.value, { timeout });
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "press":
      if (action.selector) {
        await resolveLocator(page, action.selector, action.frame).press(action.key, { timeout });
      } else {
        await withTimeout(page.keyboard.press(action.key), timeout, "Press action");
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "waitFor":
      if (action.selector) {
        if (action.frame) {
          await resolveLocator(page, action.selector, action.frame).waitFor({ state: action.state, timeout });
        } else {
          await page.waitForSelector(action.selector, { state: action.state, timeout });
        }
      } else {
        await page.waitForLoadState(action.loadState ?? "load", { timeout });
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "scroll":
      if (action.selector) {
        const locator = resolveLocator(page, action.selector, action.frame);
        await locator.waitFor({ state: "attached", timeout });
        await withTimeout(
          locator.evaluate(async (element: HTMLElement, { deltaX, deltaY }: { deltaX: number; deltaY: number }) => {
            const target = element as HTMLElement;
            const beforeLeft = target.scrollLeft;
            const beforeTop = target.scrollTop;
            let scrollEventFired = false;
            await new Promise<void>((resolve) => {
              const timer = window.setTimeout(() => resolve(), 100);
              target.addEventListener("scroll", () => {
                scrollEventFired = true;
                window.clearTimeout(timer);
                resolve();
              }, { once: true });
              target.scrollBy(deltaX, deltaY);
              if (target.scrollLeft === beforeLeft && target.scrollTop === beforeTop) {
                window.clearTimeout(timer);
                resolve();
              }
            });
            if (!scrollEventFired && (target.scrollLeft !== beforeLeft || target.scrollTop !== beforeTop)) {
              target.dispatchEvent(new Event("scroll", { bubbles: true }));
            }
          }, { deltaX: action.deltaX, deltaY: action.deltaY }),
          timeout,
          "Scroll action",
        );
      } else {
        await withTimeout(page.mouse.wheel(action.deltaX, action.deltaY), timeout, "Scroll action");
      }
      return { index, type: action.type, selector: action.selector, status: "ok", durationMs: Date.now() - started };

    case "evaluate": {
      if (!ALLOW_EVALUATE) {
        throw new Error(EVALUATE_DISABLED_MESSAGE);
      }

      const result = await withTimeout(
        page.evaluate((expression) => globalThis.eval(expression), action.expression),
        timeout,
        "Evaluate action",
      );
      const serialized = serializeBounded(result, action.maxChars, rawUrls, secrets);
      return {
        index,
        type: action.type,
        status: "ok",
        result: serialized.value,
        resultTruncated: serialized.truncated,
        durationMs: Date.now() - started,
      };
    }
  }
}

export async function runSequenceActionsWithBudget(
  page: Page,
  requestGuard: RequestGuard,
  actionsInput: SequenceAction[],
  rawUrls: string[],
  secrets: string[],
): Promise<SequenceActionResult[]> {
  const actions: SequenceActionResult[] = [];

  try {
    await withTimeout((async () => {
      for (let index = 0; index < actionsInput.length; index += 1) {
        const result = await runSequenceAction(page, actionsInput[index], index, rawUrls, secrets);
        actions.push(result);
        await settleAndAssertSafe(page, requestGuard);
      }
    })(), SEQUENCE_TIMEOUT_MS, "Browse sequence");
  } catch (actionError) {
    // Network rejection can fail an action before its post-action guard check.
    await requestGuard.assertSettled();
    throw actionError;
  }

  return actions;
}
