# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript-based MCP (Model Context Protocol) server that provides browser automation capabilities using Camoufox (a privacy-focused Firefox fork). The server exposes browser tools with bounded output and extensive privacy controls:
- `camoufox_status`: return server, browser, queue, session, policy, and network-security posture status.
- `browse`: navigate once and return bounded text, HTML, metadata, diagnostics, and optional screenshot output.
- `browse_snapshot`: navigate once and return bounded visible text, ARIA snapshot data, and interactive element metadata.
- `browse_sequence`: navigate once, run a bounded CSS-selector action sequence, then return final content, snapshot data, diagnostics, and optional screenshot output.
- `browse_links`, `browse_forms`, `browse_outline`, `browse_find`: low-context page extraction tools.
- `browse_screenshot`, `browse_console`, `browse_network_summary`: focused screenshot and diagnostics tools.
- `browse_session_*`: short-lived isolated browser sessions with challenge pause/resume, best-effort `attempt` metadata, and optional LLM-assisted provider playbooks when `CAPTCHA_AUTONOMOUS=true`.

## Commands

### Development
- `npm run build` - Clean and compile TypeScript to dist/
- `npm run dev` - Watch mode for TypeScript compilation
- `npm start` - Run the compiled server
- `npm test` - Build and run Python test client locally
- `npm run test:unit` - Build and run deterministic policy unit tests
- `npm run test:camoufox` - Run Camoufox-specific tests
- `npx eslint src/` - Run ESLint for code quality checks

### Docker
- Docker images are published by the GitHub Actions workflow for `linux/amd64`
- Local image build: `docker buildx build --platform linux/amd64 -t camoufox-mcp .`
- `./tests/run_tests.sh` - Run tests using Docker container
- `./tests/run_tests_local.sh` - Run tests against local server

### Testing Individual Components
- Run Python test client directly: `python tests/test_client.py` (supports --mode docker|local)
- Test server in Docker: `docker run --rm followthewhit3rabbit/camoufox-mcp`

## Architecture

### Core Server (`src/index.ts`)
The main MCP server implementation:
- Uses stdio transport for communication
- Implements one-shot, focused extraction, diagnostics, screenshot, and ephemeral session tools with comprehensive parameter sets
- Automatically detects environment (Docker/Linux vs local) for headless mode selection
- Handles graceful shutdown on SIGINT/SIGTERM
- Returns JSON payloads with visible text by default, optional raw HTML or metadata-only output, and optional screenshot capture
- Enhanced error handling with detailed debugging information

### Browser Integration
- Uses `camoufox-js` for browser automation
- Supports OS spoofing (Windows 11, macOS, Linux) with automatic rotation
- Implements configurable headless modes:
  - Standard headless for local development
  - Virtual display (Xvfb) for Linux/Docker environments
  - User-configurable headless option
- Enhanced privacy controls:
  - WebRTC blocking
  - Image blocking for faster loading
  - WebGL blocking (anti-fingerprinting)
  - Cross-Origin-Opener-Policy control
  - Proxy support with authentication
  - Custom Firefox preferences
  - Addon exclusion control

### Docker Architecture
Multi-stage build process:
1. Builder stage: Compiles TypeScript and fetches Camoufox browser
2. Runtime stage: Debian Bookworm slim image with Node.js and required dependencies
3. Uses Xvfb for headless operation in containers
4. The release workflow publishes `linux/amd64` images

## Browse Tool Parameters

The `browse` tool supports extensive configuration options:

### Core Parameters
- `url` (required): Target URL to navigate to
- `waitStrategy`: Page load strategy (domcontentloaded, load, networkidle)
- `timeout`: Page load timeout (5-300 seconds)
- `outputMode`: Response content mode (text, html, metadata)
- `maxChars`: Maximum text or HTML characters to return
- `selector`: Optional CSS selector to limit extraction
- `screenshot`: Capture PNG screenshot after loading

### Privacy & Anti-Detection
- `os`: OS spoofing (windows, macos, linux) - auto-rotates if not specified
- `humanize`: Enable realistic cursor movements (default: true)
- `geoip`: Auto-detect geolocation from IP (default: true)
- `block_webrtc`: Block WebRTC entirely for privacy
- `block_images`: Block images for faster loading
- `block_webgl`: Block WebGL to prevent fingerprinting
- `disable_coop`: Disable Cross-Origin-Opener-Policy

### Browser Configuration
- `locale`: Browser locale setting
- `viewport`: Custom viewport dimensions
- `headless`: Headless mode control (auto-detects if not specified)
- `proxy`: Proxy configuration (string or object with auth)
- `enable_cache`: Enable browser caching
- `firefox_user_prefs`: Custom Firefox preferences
- `exclude_addons`: Exclude default addons
- `window`: Fixed window size
- `args`: Additional browser arguments

## Key Implementation Details

- The server validates tool calls using comprehensive Zod schemas
- Initial URLs, final navigation URLs, and browser requests are rejected if they target localhost, private, link-local, or reserved IP space
- Session slots are reserved before launch so concurrent starts cannot exceed `CAMOUFOX_MCP_MAX_SESSIONS`
- Session reads/actions must surface delayed blocked requests before returning page state
- Click actions support `clickMode`: `dom` is the default CI/Xvfb-stable DOM activation path, `pointer` uses Playwright pointer input, and `auto` tries pointer first before DOM fallback.
- `camoufox_status.networkSecurity` reports application-layer best-effort SSRF policy and conservative network sandbox posture. Docker/container detection is not proof of egress filtering.
- CAPTCHA handling is manual by default. `captchaPolicy: "attempt"` returns challenge metadata, interactive elements, a bounded screenshot, and a suggested strategy. When `CAPTCHA_AUTONOMOUS=true` is set, responses use `challengeHandling: "llm_assisted"` and include provider-specific `challengePlaybook` context when known. The server never solves CAPTCHAs itself or invokes an external skill.
- Browser instances are created per request (not persisted)
- Error handling includes detailed error messages for debugging
- Process lifecycle is managed with proper cleanup on exit
- Cross-platform support with architecture-specific browser fetching
- Screenshot capture returns base64-encoded PNG data
- Enhanced logging with colored output for better debugging
