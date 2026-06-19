# Camoufox MCP Server

An MCP (Model Context Protocol) server that provides browser automation capabilities using [Camoufox](https://github.com/daijro/camoufox), a privacy-focused Firefox fork with advanced anti-detection features.

## Quick Install

Use the published npm package unless you are developing this repository locally.

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

Install the published ClawHub bundle:

```bash
openclaw plugins install clawhub:@whit3rabbit/camoufox-mcp
openclaw plugins inspect camoufox
openclaw plugins doctor
openclaw gateway restart
```

OpenClaw exposes bundled MCP tools with provider-safe names such as `camoufox__browse`.

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

Install the skill and then register the MCP server separately:

```bash
hermes skills install whit3rabbit/camoufox-mcp/plugins/camoufox/skills/camoufox
hermes mcp add camoufox --command npx --env CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS=1 --args -y camoufox-mcp-server@latest
```

Hermes direct skill installs do not automatically register MCP servers.

Hermes treats `--args` as plain argv tokens and it must be the last option. Do not pass a JSON array string there. Verify with:

```bash
hermes mcp list
hermes mcp test camoufox
```

Restart Hermes from a separate terminal after changing MCP config, then use `mcp_camoufox_camoufox_status` to confirm `unsafeOptionsAllowed: true`. `browser_navigate` is Hermes' built-in browser tool, not Camoufox.

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

`camoufox-js` and `playwright-core` are pinned (`camoufox-js` 0.10.2, `playwright-core` 1.59.0 via `overrides`). `camoufox-js` does not constrain `playwright-core`, so an unpinned install pulls the latest Playwright, and `playwright-core` 1.60+ is currently incompatible with the Camoufox browser build (1.60 breaks a navigation guard; 1.61 sends an `isMobile` viewport option Firefox/Camoufox rejects). The pins are the newest combination that passes the full test suite. They will be bumped once a newer Camoufox build and a compatible Playwright are verified together. Do not loosen them without re-running `npm run test:all`.

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
