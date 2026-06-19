# Configuration for AI Assistants

## Installable Agent Skill and Plugin Bundle

The repository includes `plugins/camoufox/`, an installable bundle that packages:

- the `camoufox` skill at `plugins/camoufox/skills/camoufox/SKILL.md`
- the safe MCP config at `plugins/camoufox/.mcp.json`
- Codex plugin metadata at `plugins/camoufox/.codex-plugin/plugin.json`
- Claude plugin metadata at `plugins/camoufox/.claude-plugin/plugin.json`

The bundled MCP server config is intentionally safe by default:

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

It does not set `CAMOUFOX_MCP_ALLOW_UNSAFE_OPTIONS`. Add that env var only when the operator explicitly approves `firefox_user_prefs`, `args`, or `exclude_addons`. After enabling it, verify with `initialize.result.capabilities.extensions["camoufox-mcp"].policy.unsafeOptionsAllowed` or `camoufox_status.unsafeOptionsAllowed` before sending those options.

### Claude Code Plugin

From the public GitHub repository:

```text
/plugin marketplace add whit3rabbit/camoufox-mcp
/plugin install camoufox@camoufox-mcp
```

Or from a local clone of this repository:

```text
/plugin marketplace add /absolute/path/to/camoufox-mcp
/plugin install camoufox@camoufox-mcp
```

Claude reads `.claude-plugin/marketplace.json`, then installs the bundle from `plugins/camoufox/`. The `camoufox` skill is auto-discovered from `plugins/camoufox/skills/`, and the MCP server is registered from `plugins/camoufox/.mcp.json`. Restart Claude Code or start a new session after installing.

### Codex Plugin

Codex can read the repo marketplace at `.agents/plugins/marketplace.json`.

For a local clone:

```bash
codex plugin marketplace add /absolute/path/to/camoufox-mcp
codex plugin add camoufox@camoufox-mcp
```

Restart Codex or start a new thread after installing so the bundled skill and MCP server are loaded.

### OpenClaw Bundle

OpenClaw detects the bundle through `.codex-plugin/plugin.json` or `.claude-plugin/plugin.json`:

```bash
openclaw plugins install /absolute/path/to/camoufox-mcp/plugins/camoufox
openclaw plugins inspect camoufox
openclaw gateway restart
```

OpenClaw exposes bundled MCP tools with provider-safe names such as `camoufox__browse`.

### Hermes Skill

Hermes can install the skill directly from the repository path once the repo is public:

```bash
hermes skills install whit3rabbit/camoufox-mcp/plugins/camoufox/skills/camoufox
```

For local development, copy `plugins/camoufox/skills/camoufox/` into `~/.hermes/skills/camoufox/`. Hermes skills do not automatically install MCP servers, so configure the `camoufox` MCP server separately using the npx command above.

### Antigravity Skill

Copy `plugins/camoufox/skills/camoufox/` into the desired Antigravity skill scope:

```bash
# Project scope
mkdir -p .agents/skills
cp -R plugins/camoufox/skills/camoufox .agents/skills/camoufox

# Global Antigravity scope
mkdir -p ~/.gemini/config/skills
cp -R plugins/camoufox/skills/camoufox ~/.gemini/config/skills/camoufox

# Antigravity CLI global scope
mkdir -p ~/.gemini/antigravity-cli/skills
cp -R plugins/camoufox/skills/camoufox ~/.gemini/antigravity-cli/skills/camoufox
```

Configure the MCP server in Antigravity separately with the npx command above if the host does not import plugin MCP config.

<details>
<summary>Claude Code (CLI)</summary>

Use the Quick Install command above for the published server. Use `--scope project` when you want Claude Code to create or update a shared `.mcp.json` in the current repository.

```bash
npm install
npm run build
claude mcp add --scope project camoufox-dev -- node dist/index.js
```

Then run `/mcp` in Claude Code and enable `camoufox-dev` if prompted. Claude Code stores project-scoped MCP servers in `.mcp.json`; private local and user scopes are stored elsewhere.

Reference: [Claude Code MCP docs](https://code.claude.com/docs/en/mcp).
</details>

<details>
<summary>Claude Desktop</summary>

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`<br>
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`<br>
**Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Using npx (Recommended)
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

#### Using Docker
```json
{
  "mcpServers": {
    "camoufox": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "followthewhit3rabbit/camoufox-mcp:latest"]
    }
  }
}
```

#### Using Global Installation
```json
{
  "mcpServers": {
    "camoufox": {
      "command": "camoufox-mcp-server"
    }
  }
}
```
</details>

<details>
<summary>Codex CLI and IDE Extension</summary>

Use the Quick Install command above for the published server. Codex does not use `.mcp.json`. It stores MCP servers in `config.toml`, normally `~/.codex/config.toml`, and can also use a project-scoped `.codex/config.toml` in trusted projects.

For local development, add a project or user Codex config entry with an explicit `cwd`:

```toml
[mcp_servers.camoufox-dev]
command = "node"
args = ["dist/index.js"]
cwd = "/absolute/path/to/camoufox-mcp"
```

Run `npm install` and `npm run build` before starting Codex. In the Codex TUI, use `/mcp` to confirm the server is active.

Reference: [Codex MCP docs](https://developers.openai.com/codex/mcp).
</details>

<details>
<summary>opencode</summary>

Use the Quick Install config above for the published server. For local development from this checkout, put this in a project `opencode.json` and run `node dist/index.js` after building:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "camoufox-dev": {
      "type": "local",
      "command": ["node", "dist/index.js"],
      "enabled": true
    }
  }
}
```

If you put the development server in global opencode config, use an absolute path instead of `dist/index.js`.

Reference: [opencode MCP docs](https://opencode.ai/docs/mcp-servers/).
</details>

<details>
<summary>Pi Coding Agent</summary>

Use the Quick Install steps above to install `pi-mcp-adapter` and configure Camoufox in `.mcp.json` or `~/.config/mcp/mcp.json`.

Reference: [Pi MCP Adapter docs](https://pi.dev/packages/pi-mcp-adapter).
</details>

<details>
<summary>VS Code (with Continue extension)</summary>

Add to your `.continue/config.json`:

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
</details>

<details>
<summary>Cursor</summary>

Add to your Cursor settings (Preferences → Features → MCP):

```json
{
  "mcp": {
    "servers": {
      "camoufox": {
        "command": "npx",
        "args": ["-y", "camoufox-mcp-server@latest"]
      }
    }
  }
}
```
</details>

<details>
<summary>Windsurf</summary>

Add to your Windsurf configuration file at `~/.windsurf/mcp.json`:

```json
{
  "servers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"]
    }
  }
}
```
</details>

<details>
<summary>Cline (VS Code Extension)</summary>

Add to VS Code settings.json:

```json
{
  "cline.mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["-y", "camoufox-mcp-server@latest"]
    }
  }
}
```
</details>

## Installation

### Quick Start with npx

The easiest way to use Camoufox MCP Server is with npx (no installation required):

```bash
npx -y camoufox-mcp-server@latest
```

### Docker Installation

Run the server using Docker:

```bash
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest
```

### NPM Installation

Install globally:

```bash
npm install -g camoufox-mcp-server@latest
```

Or add to your project:

```bash
npm install camoufox-mcp-server@latest
```
