# Sequence Action Reference

These action objects are accepted by `browse_sequence` (as the `actions` array) and by `browse_session_action` (as a single `action`). Actions run in order; a failure stops the sequence.

Every action takes an optional `timeout` (milliseconds, 100–60000). Every selector-based action takes an optional `frame`: a CSS selector for an iframe, so the action's `selector` is resolved *inside* that iframe instead of the top document.

## Table of Contents

- click
- hover
- fill
- type
- select
- press
- waitFor
- scroll
- evaluate

## click

Click an element.

```json
{ "type": "click", "selector": "button[type=submit]", "clickMode": "dom" }
```

- `selector` (required): target element.
- `clickMode`: `"dom"` (default) activates via the DOM and is the most stable, especially in CI/headless. `"pointer"` uses real pointer input (more realistic, can trigger hover/JS handlers). `"auto"` tries pointer first, falls back to DOM. Start with `dom`; switch to `pointer` only if a click isn't registering.

## hover

Move the cursor over an element (e.g. to reveal a menu).

```json
{ "type": "hover", "selector": ".menu-trigger" }
```

## fill

Set an input's value in one shot. Prefer this for text fields and textareas — it's faster and more reliable than `type`.

```json
{ "type": "fill", "selector": "#email", "value": "alice@example.com" }
```

## type

Type text key by key. Use only when the page needs real per-keystroke events (autocomplete, key handlers, input masking) that `fill` skips.

```json
{ "type": "type", "selector": "#search", "text": "camoufox", "delay": 50 }
```

- `delay`: milliseconds between keystrokes (0–1000, default 0). A small delay (30–80) reads as more human.

## select

Choose option(s) in a `<select>` element.

```json
{ "type": "select", "selector": "#country", "value": "US" }
```

- `value`: a string, or an array of strings for a multi-select.

## press

Press a keyboard key. Provide a `selector` to focus an element first, or omit it to press on the active element.

```json
{ "type": "press", "selector": "#search", "key": "Enter" }
```

- `key`: a key name like `Enter`, `Escape`, `Tab`, `ArrowDown`, or a combo like `Control+a`.

## waitFor

Wait for an element state or a page load state before continuing. Use this between an action and the read that depends on it, instead of guessing with `timeout`.

```json
{ "type": "waitFor", "selector": "#results", "state": "visible" }
```

```json
{ "type": "waitFor", "loadState": "domcontentloaded" }
```

- `state`: `"visible"` (default), `"hidden"`, `"attached"`, `"detached"` — requires `selector`.
- `loadState`: `"domcontentloaded"`, `"load"`, `"networkidle"` — waits on page load instead of an element.

## scroll

Scroll the page or an element. Useful for lazy-loaded / infinite-scroll content.

```json
{ "type": "scroll", "deltaY": 1200 }
```

- `deltaX`, `deltaY`: pixels to scroll (−10000–10000). `deltaY` defaults to 600. Provide `selector` to scroll within a specific scrollable element.

## evaluate

Run JavaScript in the page and return a bounded result. **Disabled unless the operator sets `CAMOUFOX_MCP_ALLOW_EVALUATE=1`** — check `evaluateAllowed: true` in `camoufox_status` first, and only request this when the user has opted in.

```json
{ "type": "evaluate", "expression": "document.querySelectorAll('article').length", "maxChars": 2000 }
```

- `expression`: JS to run (max 4000 chars). The return value is serialized.
- `maxChars`: cap on the serialized result.

Reach for `evaluate` only when no structured tool (`browse_links`, `browse_outline`, `browse_find`, `browse_snapshot`) can answer the question. Those are cheaper and don't need the unsafe flag.
