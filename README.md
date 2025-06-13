# Camoufox MCP Server 🦊

An MCP (Model Context Protocol) server that provides browser automation capabilities using [Camoufox](https://github.com/daijro/camoufox) - a privacy-focused Firefox fork with advanced anti-detection features.

## Features

- 🛡️ **Advanced Anti-Detection**: Rotating OS fingerprints, realistic cursor movements, and browser fingerprint spoofing
- 🔧 **Enhanced Parameters**: Configurable wait strategies, timeouts, viewport dimensions, and more
- 🌐 **Cross-Platform**: Works on Windows, macOS, and Linux (including Docker)
- 📸 **Screenshot Support**: Capture page screenshots alongside HTML content
- 🚀 **Easy Integration**: Compatible with Claude Desktop, VS Code, Cursor, Windsurf, and more

## Requirements

- Node.js 18 or higher (Node.js 20+ recommended for full camoufox CLI support)
- Python 3.x (for running tests)

## Configuration for AI Assistants

<details>
<summary>Claude Code (CLI)</summary>

Run the following command to add the Camoufox MCP server to Claude Code:

```bash
claude mcp add context7 -- npx -y camoufox-mcp-server
```
</details>

<details>
<summary>Claude Desktop</summary>

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`  
**Linux**: `~/.config/Claude/claude_desktop_config.json`

#### Using npx (Recommended)
```json
{
  "mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["camoufox-mcp-server"]
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
      "args": ["run", "-i", "--rm", "ghcr.io/whit3rabbit/camoufox-mcp:latest"]
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
<summary>VS Code (with Continue extension)</summary>

Add to your `.continue/config.json`:

```json
{
  "models": [...],
  "mcpServers": {
    "camoufox": {
      "command": "npx",
      "args": ["camoufox-mcp-server"]
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
        "args": ["camoufox-mcp-server"]
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
      "args": ["camoufox-mcp-server"]
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
      "args": ["camoufox-mcp-server"]
    }
  }
}
```
</details>

## Installation

### Quick Start with npx

The easiest way to use Camoufox MCP Server is with npx (no installation required):

```bash
npx camoufox-mcp-server
```

### Docker Installation

Run the server using Docker:

```bash
docker run -i --rm ghcr.io/whit3rabbit/camoufox-mcp:latest
```

### NPM Installation

Install globally:

```bash
npm install -g camoufox-mcp-server
```

Or add to your project:

```bash
npm install camoufox-mcp-server
```

## Usage

Once configured, the Camoufox MCP server provides a `browse` tool that your AI assistant can use to navigate websites and retrieve content.

### Basic Usage

```
Can you check what's on example.com?
```

The AI will use the browse tool to navigate to the website and retrieve its HTML content.

### Advanced Usage

```
Please visit example.com using a Windows browser with a 1920x1080 viewport and wait for all resources to load. Take a screenshot too.
```

The AI can use advanced parameters like:
- `os`: Spoof operating system (windows, macos, linux)
- `waitStrategy`: How to wait for page load (domcontentloaded, load, networkidle)
- `timeout`: Maximum time to wait (5-300 seconds)
- `viewport`: Custom browser dimensions
- `screenshot`: Capture a screenshot
- `humanize`: Enable realistic mouse movements
- `locale`: Set browser locale (e.g., 'en-US', 'fr-FR')
- `block_webrtc`: Block WebRTC for privacy
- `proxy`: Use a proxy server for requests
- `enable_cache`: Enable browser caching
- `window`: Set fixed window size

### Example with Privacy Options

```
Browse example.com with WebRTC blocked and through a proxy server proxy.example.com:8080
```

### Example with Custom Preferences

```
Visit example.com with a fixed 1280x720 window size and custom Firefox preferences to disable JavaScript
```

## Tool Parameters

The `browse` tool accepts the following parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | required | The URL to navigate to |
| `os` | enum | random | Operating system to spoof: 'windows', 'macos', or 'linux' |
| `waitStrategy` | enum | 'domcontentloaded' | Wait strategy: 'domcontentloaded', 'load', or 'networkidle' |
| `timeout` | number | 60000 | Page load timeout in milliseconds (5000-300000) |
| `humanize` | boolean | true | Enable realistic cursor movements |
| `locale` | string | system default | Browser locale (e.g., 'en-US') |
| `viewport` | object | {width: 1920, height: 1080} | Browser viewport dimensions |
| `screenshot` | boolean | false | Capture a screenshot of the page |
| `block_webrtc` | boolean | false | Block WebRTC entirely for enhanced privacy |
| `proxy` | string/object | none | Proxy configuration (URL string or object with server/username/password) |
| `enable_cache` | boolean | false | Cache pages and requests (uses more memory) |
| `firefox_user_prefs` | object | none | Custom Firefox user preferences |
| `exclude_addons` | array | none | List of default addons to exclude |
| `window` | array | random | Fixed window size [width, height] instead of random |
| `args` | array | none | Additional browser command-line arguments |

## Development

### Building from Source

```bash
# Clone the repository
git clone https://github.com/whit3rabbit/camoufox-mcp.git
cd camoufox-mcp

# Install dependencies
npm install

# Build the TypeScript code
npm run build

# Run locally
npm start
```

### Running Tests

```bash
# Run test suite
npm test

# Run with local server
python3 tests/test_client.py --mode local
```

### Docker Build

```bash
# Build multi-architecture image
./build_docker.sh

# Build for specific architecture
docker build -t camoufox-mcp .
```

## Troubleshooting

### Common Issues

1. **"Camoufox browser not found"**
   - Run `npx camoufox fetch` to download the browser
   - For Docker, the browser is pre-installed

2. **"Cannot find module"**
   - Ensure you've run `npm install` or are using npx
   - For global install: `npm install -g camoufox-mcp-server`

3. **"MCP server not responding"**
   - Check that the server is properly configured in your AI assistant
   - Verify the command path is correct
   - Check logs for error messages

### Debug Mode

To see detailed logs, run the server directly:

```bash
node dist/index.js
```

## Privacy & Security

Camoufox MCP Server uses the Camoufox browser, which includes:
- Fingerprint spoofing to prevent tracking
- Built-in uBlock Origin for ad blocking
- WebGL and WebRTC spoofing
- Canvas fingerprint protection
- Timezone and locale spoofing

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Acknowledgments

- [Camoufox](https://github.com/daijro/camoufox) - The privacy-focused browser engine
- [Model Context Protocol](https://modelcontextprotocol.io) - The MCP specification
- [Anthropic](https://anthropic.com) - For creating the MCP standard

## Support

For issues and feature requests, please use the [GitHub Issues](https://github.com/whit3rabbit/camoufox-mcp/issues) page.