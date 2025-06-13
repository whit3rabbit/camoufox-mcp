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
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest
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

### Natural Language Triggers

The AI assistant will automatically use the browse tool when you use phrases like:

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
- "Browse **anonymously**..."
- "Visit **privately**..."
- "Browse in **stealth mode**..."
- "**Hide my IP** while browsing..."
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

The AI will automatically use the browse tool to navigate to websites and retrieve their HTML content.

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

### Example with Performance Optimization

```
Browse news.example.com with images blocked for faster loading and a 10 second timeout
```

### Privacy & Stealth Examples

```
Browse example.com anonymously with maximum privacy and stealth mode
```

```
Visit sensitive-site.com through a proxy to hide my IP address
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
Browse anonymously through proxy 192.168.1.100:8080 with username 'user' and password 'pass' to access restricted content
```

### Cross-Origin & Iframe Interaction

```
Browse iframe-test.example.com with Cross-Origin-Opener-Policy disabled to allow clicking elements in iframes
```

```
Access embedded content on complex-site.com and interact with all iframe elements
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
| `screenshot` | boolean | false | Capture a screenshot of the page (triggers: "screenshot", "image", "capture", "show visually") |
| `block_webrtc` | boolean | true | Block WebRTC entirely for enhanced privacy (triggers: "private", "stealth", "hide IP") |
| `proxy` | string/object | none | Proxy configuration (triggers: "through proxy", "anonymously", "hide IP", "via proxy") |
| `enable_cache` | boolean | false | Cache pages and requests (uses more memory) |
| `firefox_user_prefs` | object | none | Custom Firefox user preferences |
| `exclude_addons` | array | none | List of default addons to exclude |
| `window` | array | random | Fixed window size [width, height] instead of random |
| `args` | array | none | Additional browser command-line arguments |
| `block_images` | boolean | false | Block all images for faster loading (triggers: "fast", "quick", "no images", "text only") |
| `block_webgl` | boolean | false | Block WebGL to prevent fingerprinting (triggers: "maximum privacy", "block tracking") |
| `disable_coop` | boolean | false | Disable Cross-Origin-Opener-Policy for iframe interaction (triggers: "iframe", "embedded content") |
| `geoip` | boolean | true | Auto-detect geolocation based on IP address |
| `headless` | boolean | auto | Run in headless mode (auto-detects best mode if not set) |

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
# Build and publish multi-architecture image
./publish_docker.sh

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