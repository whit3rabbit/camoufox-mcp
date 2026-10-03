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

First `browse` on a fresh machine needs the browser binary once; download and storage
requirements vary by platform and build. If a call
reports it is missing, run the pinned fetch script and retry: `npm run fetch:camoufox`
(repo checkout). After release 2.6.0 is published, npx installs can use
`npx --yes --package camoufox-mcp-server@2.6.0 camoufox-mcp-fetch`.
Global installs of 2.6.0 provide `camoufox-mcp-fetch` and `camoufox-mcp-doctor`.
Do not use `camoufox-js fetch`: its release selection can install a build that
bypasses page WebSocket interception.

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

- Published default runtime: Node.js 22.0 or higher
- Repository builds and compatibility mode: Node.js 22.15 or higher, with `npm install --include=optional`
- Python 3.x for running tests

## Versioning

The default pins are `camoufox-js` 0.12.0, `playwright-core` 1.59.0, and Camoufox 152.0.4-beta.28. Keep `playwright-core` as a direct pinned dependency: npm `overrides` alone do not pin it for `npx` or global installs. Run `npm run doctor` to verify the selected build and a real browser launch.

Camoufox 156.0.1-beta.33 is available through opt-in compatibility mode. It restores page and iframe WebSocket interception by disabling the newer browser's world isolation, reducing stealth compared with its upstream defaults. The beta.28 default predates that isolation change. Worker WebSockets evade interception in both modes, so untrusted browsing needs network egress controls. See [browser compatibility setup and evidence](docs/browser-compatibility.md) before enabling it.

| Environment variable | Default | Effect |
| --- | --- | --- |
| `CAMOUFOX_MCP_BROWSER_COMPATIBILITY` | Unset | Set to `1` during installation and startup to select beta.33 with reduced stealth. |
| `CAMOUFOX_INSTALL_DIR` | OS cache, separate `camoufox-compatibility` cache when opted in | Override the browser directory; use the same value during installation and startup. |

Use `npm run fetch:camoufox` for tagged downloads with SHA-256 checks. The shared [browser manifest](browser-builds.json) pins both modes. Avoid `camoufox-js fetch`, whose release selection can install a build that bypasses WebSocket interception.

## Documentation

- [Configuration for AI assistants](docs/configuration.md)
- [Browser compatibility](docs/browser-compatibility.md)
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
