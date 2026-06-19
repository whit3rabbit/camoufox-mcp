# Usage Examples

## Usage

Once configured, the Camoufox MCP server provides bounded browser tools that your AI assistant can use to navigate websites, inspect page structure, extract low-context page data, capture screenshots, inspect diagnostics, and run short-lived isolated sessions.

Available tools:
- `camoufox_status`: return server, browser, queue, session, and policy status.
- `browse`: navigate once and return bounded text, HTML, metadata, diagnostics, and optional screenshot output.
- `browse_snapshot`: navigate once and return bounded visible text, ARIA snapshot data, and interactive element metadata.
- `browse_sequence`: navigate once, run up to 25 CSS-selector actions, then return final content, snapshot data, diagnostics, and optional screenshot output.
- `browse_links`: navigate once and return navigable links only.
- `browse_forms`: navigate once and return form fields and submit controls.
- `browse_outline`: navigate once and return headings, description, and landmarks.
- `browse_find`: navigate once, search visible text, and return bounded context matches.
- `browse_screenshot`: navigate once and capture a bounded screenshot as a first-class tool.
- `browse_console`: navigate once and return bounded console diagnostics.
- `browse_network_summary`: navigate once and return bounded network counts and failures.
- `browse_session_start`, `browse_session_navigate`, `browse_session_action`, `browse_session_snapshot`, `browse_session_resume`, `browse_session_close`: manage short-lived isolated browser sessions.

### Natural Language Triggers

The AI assistant can use the browser tools when you use phrases like:

**Basic Browsing:**
- "**Search** for information about..."
- "**Visit** this website: ..."
- "**Check** what's on ..."
- "**Navigate** to ..."
- "**Fetch** content from ..."
- "**Browse** to ..."
- "**Go to** the website ..."
- "**Open** this page: ..."
- "**Look at** this URL: ..."
- "**Scrape** data from ..."

**Privacy & Stealth:**
- "Visit **privately**..."
- "Browse in **stealth mode**..."
- "Browse **through a proxy**..."
- "**Block tracking** while visiting..."

**Screenshots:**
- "**Take a screenshot** of..."
- "**Capture an image** of..."
- "**Show me visually** what ... looks like"
- "I want to **see how** ... appears"

**Performance:**
- "**Quick browse** to..."
- "**Fast loading** of..."
- "Browse **without images**..."
- "**Lightweight browsing** to..."
- "**Text-only** content from..."

### Basic Usage Examples

```
Can you check what's on example.com?
```

```
Search for information on the latest tech news from techcrunch.com
```

```
Visit github.com and tell me what's trending
```

The AI will usually use `browse` to retrieve visible text by default. Raw HTML is available with `outputMode: "html"`, and page structure is available through `browse_snapshot`.

For lower-context workflows, prefer `browse_links`, `browse_forms`, `browse_outline`, or `browse_find` over raw HTML. Use session tools for login flows, multi-step forms, carts, dashboards, and human-in-the-loop challenge handling.

### Advanced Usage

```
Please visit example.com using a Windows browser with a 1920x1080 viewport and wait for all resources to load. Take a screenshot too.
```

### More Conversational Examples

```
I need to research the current stock price of Apple. Can you go to finance.yahoo.com and search for AAPL?
```

```
Check if the restaurant's website has their menu online. Visit bistro-example.com and look for their menu section.
```

```
I'm looking for job postings in tech. Can you browse to linkedin.com/jobs and see what's available?
```

```
Navigate to the documentation site for React and find information about hooks.
```

The AI can use advanced parameters like:
- `os`: Spoof operating system (windows, macos, linux)
- `waitStrategy`: How to wait for page load. Defaults to `domcontentloaded`; use `load` or `networkidle` only for pages where waiting for all resources or network quiescence is useful.
- `timeout`: Maximum time to wait (5-300 seconds)
- `outputMode`: Return visible text, raw HTML, or metadata only
- `maxChars`: Cap returned text or HTML
- `selector`: Limit extraction to one CSS selector
- `viewport`: Custom browser dimensions
- `screenshot`: Capture a screenshot
- `screenshotOptions`: Capture full-page, selector-only, PNG, or JPEG screenshots
- `includeConsole`: Return bounded console diagnostics
- `includeNetwork`: Return bounded network diagnostics
- `humanize`: Enable realistic mouse movements
- `locale`: Set browser locale (e.g., 'en-US', 'fr-FR')
- `block_webrtc`: Block WebRTC for privacy
- `proxy`: Use a proxy server for requests
- `enable_cache`: Enable browser caching
- `window`: Set fixed window size

### Example with Privacy Options

```
Browse example.com with WebRTC blocked and through an HTTP proxy server proxy.example.com:8080
```

### Example with Custom Preferences

```
Visit example.com with a fixed 1280x720 window size and custom Firefox preferences to disable JavaScript
```

### Example with Performance Optimization

```
Browse news.example.com with images blocked for faster loading and a 10 second timeout
```

### Privacy & Stealth Examples

```
Browse example.com with WebRTC blocked and fingerprint protection enabled
```

```
Visit sensitive-site.com through an HTTP proxy
```

```
Browse privately to banking-site.com with WebRTC blocked and fingerprint protection
```

```
Access geo-blocked content via proxy server proxy.example.com:8080
```

### Screenshot Examples

```
Take a screenshot of the homepage at example.com
```

```
Capture an image of how the login page looks on mobile-site.com
```

```
Show me visually what the product page looks like on store.example.com
```

### Snapshot Examples

```
Inspect the interactive elements on example.com
```

```
Get a page snapshot for the login form at app-example.com
```

### Interaction Sequence Examples

```
Open example.com and click the main link, then tell me where it ends up
```

```
Open a search page, fill the search input, submit it, and summarize the results
```

### Performance & Speed Examples

```
Quick browse to news-site.com without loading images for faster access
```

```
Lightweight browsing to documentation-site.com, text content only
```

```
Fast loading of search results from search-engine.com, no images needed
```

### Advanced Privacy Combinations

```
Visit example.com with WebRTC blocked, WebGL blocked, images blocked, and geoip detection disabled
```

```
Browse through HTTP proxy proxy.example.com:8080 with username 'user' and password 'pass' to access restricted content
```

### Cross-Origin & Embedded Content

```
Browse iframe-test.example.com with Cross-Origin-Opener-Policy disabled when embedded content requires it
```

```
Inspect embedded content on complex-site.com
```
