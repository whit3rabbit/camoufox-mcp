# Camoufox MCP Server

A Model Context Protocol (MCP) server that provides stealth browser automation capabilities using [Camoufox](https://github.com/daijro/camoufox). This server enables LLMs to interact with web pages while avoiding detection by anti-bot systems.

## Key Features

- **Stealth browsing** - Uses Camoufox's advanced anti-detection techniques
- **CAPTCHA solving** - Built-in support for reCAPTCHA, hCaptcha, and Turnstile
- **GeoIP support** - Realistic IP geolocation
- **Human-like behavior** - Mimics real user interactions
- **Headless operation** - Perfect for automation workflows
- **Docker support** - Easy deployment and isolation

## Requirements

- Docker (recommended for usage)
- MCP-compatible client (Claude Desktop, Cursor, Windsurf, etc.)
- Python 3.9+ (only for development)

## Quick Start with MCP

The Camoufox MCP server communicates via **STDIO** (stdin/stdout) by default, which is the standard transport for MCP servers. This allows seamless integration with AI assistants and IDEs.

### Claude Desktop

Claude Desktop stores its MCP configuration in a JSON file:

**Configuration file location:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

**Setup Steps:**
1. Open Claude Desktop
2. Go to Claude menu → Settings (not the in-app settings)
3. Click "Developer" in the left sidebar
4. Click "Edit Config" to open the configuration file
5. Add the following configuration:

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "/tmp/camoufox-output:/tmp/camoufox-mcp",
        "followthewhit3rabbit/camoufox-mcp:latest",
        "--headless=true",
        "--humanize",
        "--geoip=auto",
        "--captcha-solver"
      ]
    }
  }
}
```

6. Save the file and restart Claude Desktop
7. Look for the hammer/tools icon in the bottom of the chat interface
8. The Camoufox tools should appear in the tools list

### Cursor IDE

**Global Configuration:** `~/.cursor/mcp.json`  
**Project Configuration:** `.cursor/mcp.json` in your project root

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "./camoufox-output:/tmp/camoufox-mcp",
        "followthewhit3rabbit/camoufox-mcp:latest",
        "--headless=true",
        "--humanize",
        "--captcha-solver"
      ]
    }
  }
}
```

### Windsurf IDE

1. Open Windsurf
2. Navigate to the Cascade assistant panel
3. Click the hammer (MCP) icon at the bottom
4. Click "Configure" to open the configuration interface
5. Add the configuration above
6. Save and refresh the MCP panel

### Cline (VS Code Extension)

1. Install Cline extension in VS Code
2. Open the Cline extension panel
3. Click "MCP Servers" → "Configure MCP Servers"
4. Add the configuration above
5. Cline will automatically reload with the server connected

### Claude Code (CLI)

```bash
# Add MCP server with user scope (available across all projects)
claude mcp add camoufox-server -s user -- \
  docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --humanize --captcha-solver

# Check server status
claude mcp status
```

## Configuration Options

### Basic Docker Usage

```bash
# Minimal configuration
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true

# With all stealth features
docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --humanize \
  --geoip=auto \
  --captcha-solver \
  --block-webrtc
```

### Command Line Options

- `--headless` - Run browser in headless mode (values: `true`, `false`, `virtual`)
- `--humanize` - Enable human-like cursor movement (optional: max duration in seconds)
- `--no-humanize` - Disable human-like cursor movement
- `--geoip` - IP address for geolocation or `auto` for auto-detection
- `--no-geoip` - Disable GeoIP features
- `--captcha-solver` - Enable CAPTCHA solving capabilities
- `--proxy` - Proxy server (e.g., `http://user:pass@proxy:8080`)
- `--user-agent` - Custom user agent string
- `--window` - Browser window size (e.g., `1920x1080`)
- `--output-dir` - Directory for screenshots (default: `/tmp/camoufox-mcp`)
- `--debug` - Enable debug logging

### Advanced Options

```bash
# With proxy and custom window size
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --proxy "http://proxy:8080" \
  --window "1920x1080"

# Maximum stealth configuration
docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=virtual \
  --humanize=2.0 \
  --geoip=auto \
  --captcha-solver \
  --block-webrtc \
  --block-images \
  --disable-coop \
  --os=windows \
  --locale=en-US
```

## Testing Your MCP Server

### Using MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the official tool for testing and debugging MCP servers. It provides a web UI to interact with your server's tools.

```bash
# Test the Docker container
npx @modelcontextprotocol/inspector \
  docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --debug

# The Inspector UI will open at http://localhost:6274
```

**Inspector Features:**
- View all available tools and their schemas
- Test tool calls with custom arguments  
- Monitor request/response messages
- Debug communication issues

### Quick Connectivity Test

To verify your MCP server is working correctly:

1. **Check Docker image:**
   ```bash
   docker run --rm followthewhit3rabbit/camoufox-mcp:latest --help
   ```

2. **Test basic tool listing:**
   ```bash
   echo '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}' | \
   docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest
   ```

3. **Check client connection:**
   - In Claude Desktop: Look for the tools icon and verify "camoufox" appears
   - In Cursor/Windsurf: Check the MCP panel shows a green status
   - In CLI: Run `claude mcp status` or your IDE's equivalent

### Common Issues

- **"Server not connected"**: Ensure Docker is running and the image is pulled
- **"No tools available"**: Check the server logs with `--debug` flag
- **"Permission denied"**: Add volume mount permissions or use different output directory

## Available Tools

### Core Browser Tools

- `browser_navigate` - Navigate to URLs with stealth capabilities
- `browser_click` - Click elements with human-like movement
- `browser_type` - Type text with realistic timing
- `browser_wait_for` - Wait for elements or conditions
- `browser_get_content` - Extract page content
- `browser_screenshot` - Capture screenshots
- `browser_execute_js` - Execute JavaScript code
- `browser_set_geolocation` - Set browser location
- `browser_solve_captcha` - Auto-solve CAPTCHAs (requires flag)
- `browser_close` - Close browser and cleanup

## Development & Installation

For development, testing, or contributing to the project:

### Local Development Setup

```bash
# Clone the repository
git clone https://github.com/whit3rabbit/camoufox-mcp
cd camoufox-mcp

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Or install as editable package with dev dependencies
pip install -e ".[dev]"

# Download Camoufox browser
python -m camoufox fetch
```

### Running Locally

```bash
# Run with STDIO (for MCP clients)
python camoufox_mcp_server.py --headless=true --debug

# Run with SSE/HTTP transport (for testing)
python camoufox_mcp_server.py --port 8080 --host localhost --headless=true
```

### Testing with MCP Inspector

```bash
# Test local Python installation
npx @modelcontextprotocol/inspector \
  python /path/to/camoufox_mcp_server.py \
  --headless=true --debug

# Test with environment variables
npx @modelcontextprotocol/inspector \
  -e CAMOUFOX_DEBUG=true \
  python camoufox_mcp_server.py --headless=true
```

### Running Tests

```bash
# Run unit tests
pytest

# Run with coverage
pytest --cov=. --cov-report=xml --cov-report=term-missing -v

# Format code
black .

# Type checking
mypy camoufox_mcp_server.py
```

### Building Docker Image

```bash
# Build locally
docker build -t camoufox-mcp .

# Test the build
docker run -i --rm camoufox-mcp --help

# Multi-architecture build (requires buildx)
./build-multiarch.sh
```

### Docker Compose Development

```bash
# Run development container with source mounting
docker-compose up camoufox-dev

# Run tests in container
docker-compose run camoufox-test

# Run with SSE transport
docker-compose up camoufox-sse
```

## Example Usage

Once configured in your MCP client, you can use natural language to control the browser:

```
"Navigate to https://example.com and take a screenshot"
"Click the login button and fill in the username field with 'testuser'"
"Wait for the page to load and extract all the text content"
"Solve any CAPTCHA that appears on the page"
```

## Architecture

The Camoufox MCP server uses:
- **FastMCP** framework for MCP protocol implementation
- **STDIO transport** for communication with MCP clients
- **Camoufox browser** for stealth automation
- **Async/await** for non-blocking operations

Communication flow:
1. MCP client sends JSON-RPC requests via stdin
2. Server processes requests and controls Camoufox browser
3. Results are returned via stdout as JSON-RPC responses

## Troubleshooting

### Debug Mode

Enable detailed logging to diagnose issues:

```bash
# Docker
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --debug

# View container logs
docker logs <container_id>
```

### Common Solutions

1. **Browser fails to start**
   ```bash
   # Ensure Docker has enough resources
   docker run -i --rm --memory=2g followthewhit3rabbit/camoufox-mcp:latest
   ```

2. **CAPTCHA solver not working**
   ```bash
   # Verify the flag is enabled
   docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
     --captcha-solver --disable-coop
   ```

3. **Connection timeouts**
   ```bash
   # Use a proxy or increase timeouts
   docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
     --proxy "http://proxy:8080"
   ```

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes and add tests
4. Run the test suite (`pytest`)
5. Format code (`black .`)
6. Commit your changes (`git commit -m 'Add amazing feature'`)
7. Push to the branch (`git push origin feature/amazing-feature`)
8. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Camoufox](https://github.com/daijro/camoufox) - The stealth browser engine
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol specification
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector) - Testing tool
- [FastMCP](https://github.com/jlowin/fastmcp) - MCP framework for Python
