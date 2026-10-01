# Camoufox MCP Server

An MCP (Model Context Protocol) server that provides browser automation capabilities using [Camoufox](https://github.com/daijro/camoufox), a privacy-focused Firefox fork with advanced anti-detection features.

## Quick Install

Use the published npm package unless you are developing this repository locally.

### Tell your LLM

```bash
Install camoufox-mcp and the skill using this URL: https://raw.githubusercontent.com/whit3rabbit/camoufox-mcp/refs/heads/main/llms.txt
```

### Claude Code CLI

```bash
claude mcp add camoufox -- npx -y camoufox-mcp-server@latest
```

For a shared project-scoped Claude Code config:

```bash
claude mcp add --scope project camoufox -- npx -y camoufox-mcp-server@latest
```

Verify with `/mcp` inside Claude Code.

### Codex CLI

```bash
codex mcp add camoufox -- npx -y camoufox-mcp-server@latest
```

Codex stores MCP servers in `~/.codex/config.toml` by default. Verify with `/mcp` inside Codex.

### Agent Skill and Plugin Bundle

Use these when you want the `camoufox` skill plus the packaged MCP server config. If you only need the MCP server, use the Claude Code or Codex MCP commands above. Bare `npx -y camoufox-mcp-server@latest` remains safe by default. The packaged plugin bundle enables `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1` so the skill can use `firefox_user_prefs`, `args`, and `exclude_addons` for hard-site tuning.

#### OpenClaw

Register the MCP server directly. This works today with no registry publish (`--arg`
is singular and repeatable; the `--env` flag enables the unsafe-option tuning):

```bash
openclaw mcp add camoufox --command npx --arg -y --arg camoufox-mcp-server@latest --env CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1
openclaw mcp list
```

OpenClaw exposes the tools with provider-safe names such as `camoufox__browse`.

Or install the published ClawHub bundle (skill + MCP config in one step):

```bash
openclaw plugins install clawhub:@whit3rabbit/camoufox-mcp
openclaw plugins inspect camoufox
openclaw plugins doctor
openclaw gateway restart
```

#### Claude Code

Install the plugin from this repo's marketplace:

```text
/plugin marketplace add whit3rabbit/camoufox-mcp
/plugin install camoufox@camoufox-mcp
```

Restart Claude Code or start a new session after installing.

#### Codex

Install the plugin from this repo's marketplace:

```bash
codex plugin marketplace add whit3rabbit/camoufox-mcp
codex plugin add camoufox@camoufox-mcp
```

Restart Codex or start a new thread after installing.

#### Hermes

Two commands: install the skill, then register the MCP server (Hermes skill installs do
**not** auto-register MCP servers).

```bash
hermes skills install whit3rabbit/camoufox-mcp/plugins/camoufox/skills/camoufox
printf "Y\n" | hermes mcp add camoufox --command npx --env CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 --args -y camoufox-mcp-server@latest
```

> **Hermes TTY Gotcha:** `hermes mcp add` interactively prompts `"Enable all 17 tools? [Y/n/select]"`. On a non-TTY (piped/scripted inputs), the default response is `"n"` (canceled). Pipe `Y\n` as shown above to enable tools automatically.

Do **not** run `hermes plugins install …` for this repo. Hermes plugins are Python
packages with a root `plugin.yaml`; this repo has neither, so it clones but is rejected
as "not a valid plugin." Use the two commands above.

Hermes treats `--args` as plain argv tokens and it must be the last option. Do not pass a
JSON array string there. In `~/.hermes/config.yaml`, `env` must be a **mapping**
(`KEY: "value"`), not a list. Verify with:

```bash
hermes mcp list
hermes mcp test camoufox
```

First `browse` on a fresh machine needs the browser binary once (~780MB); if a call
reports it is missing, run the pinned fetch script and retry: `npm run fetch:camoufox`
(repo checkout) or `node node_modules/camoufox-mcp-server/scripts/fetch-browser.mjs`
(package install). Do not use `npx camoufox-js fetch`: since 2026-09-24 it installs an
unreleased 152.0.4-beta.31 browser from upstream's `font-bundle-v1` build-input release,
and that build breaks the server's private-WebSocket SSRF guard.

Restart Hermes from a separate terminal after changing MCP config. Hermes namespaces MCP
tools as `mcp_camoufox_<tool>` (single underscore, e.g. `mcp_camoufox_browse`,
`mcp_camoufox_camoufox_status`; some setups show the double-underscore form
`mcp__camoufox__browse`) — use whatever your tool list shows, and confirm
`mcp_camoufox_camoufox_status` reports `unsafeOptionsAllowed: true`. `browser_navigate` is
Hermes' own built-in browser tool, not Camoufox.

For local-clone installs and additional hosts, see [Configuration for AI assistants](docs/configuration.md#installable-agent-skill-and-plugin-bundle).

### opencode

Add this to `opencode.json` in your project or to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "camoufox": {
      "type": "local",
      "command": ["npx", "-y", "camoufox-mcp-server@latest"],
      "enabled": true
    }
  }
}
```

Verify with:

```bash
opencode mcp list
```

### Pi Coding Agent

Install the MCP adapter, then add Camoufox to `.mcp.json` or `~/.config/mcp/mcp.json`:

```bash
pi install npm:pi-mcp-adapter
```

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"]
    }
  }
}
```

## Try Camoufox

Once configured, ask your assistant for browser work in plain language:

```text
Use Camoufox to browse https://example.com and return metadata only.
```

```text
Use Camoufox to inspect the interactive elements on https://example.com.
```

```text
Use Camoufox to open https://example.com, take a screenshot, and summarize the visible page.
```

```text
Use Camoufox to browse https://developer.mozilla.org with images blocked and WebRTC blocked.
```

## Features

- Advanced anti-detection: rotating OS fingerprints, realistic cursor movements, and browser fingerprint spoofing.
- Enhanced parameters: configurable wait strategies, timeouts, viewport dimensions, diagnostics, and screenshots.
- Cross-platform: works on Windows, macOS, and Linux, including Docker.
- Privacy controls: SSRF protections, WebRTC blocking, WebGL blocking, image blocking, proxy support, and bounded output.
- Session tools: short-lived isolated browser sessions with challenge pause/resume support.

## Requirements

- Node.js 22 or higher
- Python 3.x for running tests

## Versioning

`camoufox-js` (0.12.0) and `playwright-core` (1.59.0) are pinned, fetching the Camoufox 152.0.4-beta.28 browser build. `playwright-core` is a **direct** pinned dependency (not just an `overrides` entry) because npm `overrides` only bind the root project: without a direct pin, `npx`/global installs let `camoufox-js`'s peer float `playwright-core` to the latest, and `playwright-core` 1.60+ is incompatible with the Camoufox browser (1.60 breaks a navigation guard; 1.61 sends an `isMobile` viewport option Firefox/Camoufox rejects). The pins are the newest combination that passes the full test suite. Run `npm run doctor` to check them end-to-end, and do not loosen them without re-running `npm run test:all`. The browser download itself is pinned by `scripts/fetch-browser.mjs` (via `npm run fetch:camoufox`): plain `camoufox-js fetch` currently resolves to an unreleased 152.0.4-beta.31 build that fails the suite's private-WebSocket rejection test on both playwright-core 1.59.0 and 1.63.0.

## Documentation

- [Configuration for AI assistants](docs/configuration.md)
- [Usage examples](docs/examples.md)
- [Tool parameters](docs/tool-parameters.md)
- [Server policy](docs/server-policy.md)
- [Development](docs/development.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Privacy and security](docs/privacy-security.md)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome. Please submit a pull request or open an issue for bugs and feature requests.

## Acknowledgments

- Built with [Camoufox](https://github.com/daijro/camoufox)
- Uses the [Model Context Protocol](https://modelcontextprotocol.io/)
- Powered by [Playwright](https://playwright.dev/)

## Support

If you encounter issues, check [Troubleshooting](docs/troubleshooting.md) first, then open an issue on GitHub with logs and environment details.
