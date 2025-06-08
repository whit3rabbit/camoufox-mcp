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

- Python 3.9 or newer
- Docker (recommended for deployment)
- MCP-compatible client (VS Code, Cursor, Claude Desktop, etc.)

## Installation

### Option 1: Docker (Recommended)

```bash
# Pull the pre-built image (when available)
docker pull camoufox/mcp-server

# Or build locally
git clone https://github.com/whit3rabbit/camoufox-mcp
cd camoufox-mcp
docker build -t camoufox-mcp .
```

### Option 2: Local Python Installation

```bash
git clone https://github.com/whit3rabbit/camoufox-mcp
cd camoufox-mcp

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Or install as package
pip install -e .
```

## Configuration

### MCP Client Configuration

#### VS Code / Cursor / Windsurf

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm", 
        "camoufox-mcp",
        "--headless",
        "--captcha-solver"
      ]
    }
  }
}
```

#### Claude Desktop

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "camoufox-mcp",
        "--headless"
      ]
    }
  }
}
```

### Local Python Configuration

If running locally without Docker:

```json
{
  "mcpServers": {
    "camoufox": {
      "command": "python",
      "args": [
        "/path/to/camoufox-mcp/camoufox_mcp_server.py",
        "--headless",
        "--captcha-solver"
      ]
    }
  }
}
```

## Command Line Options

```bash
# Basic usage
python camoufox_mcp_server.py --headless

# With CAPTCHA solving
python camoufox_mcp_server.py --headless --captcha-solver

# With proxy
python camoufox_mcp_server.py --headless --proxy "http://proxy:8080"

# Custom viewport
python camoufox_mcp_server.py --headless --viewport "1920x1080"

# SSE server mode
python camoufox_mcp_server.py --port 8080 --host 0.0.0.0

# All options
python camoufox_mcp_server.py \
  --headless \
  --captcha-solver \
  --proxy "http://proxy:8080" \
  --user-agent "Custom User Agent" \
  --viewport "1920x1080" \
  --output-dir "/tmp/camoufox-output" \
  --debug
```

### Available Options

- `--headless` / `--no-headless`: Run browser in headless/headed mode (default: headless)
- `--captcha-solver`: Enable CAPTCHA solving capabilities
- `--proxy`: Proxy server (e.g., `http://proxy:8080`)
- `--user-agent`: Custom user agent string
- `--viewport`: Browser viewport size (e.g., `1920x1080`)
- `--output-dir`: Directory for screenshots and files (default: `/tmp/camoufox-mcp`)
- `--port`: Port for SSE transport (enables HTTP mode)
- `--host`: Host to bind server to (default: `localhost`)
- `--debug`: Enable debug logging

## Available Tools

### Core Browser Tools

#### `browser_navigate`
Navigate to a URL with stealth capabilities.

**Parameters:**
- `url` (string): The URL to navigate to

**Example:**
```json
{
  "name": "browser_navigate",
  "arguments": {
    "url": "https://example.com"
  }
}
```

#### `browser_click`
Click on an element using CSS selector.

**Parameters:**
- `selector` (string): CSS selector for the element

**Example:**
```json
{
  "name": "browser_click", 
  "arguments": {
    "selector": "button.login-btn"
  }
}
```

#### `browser_type`
Type text into an input element.

**Parameters:**
- `selector` (string): CSS selector for the element
- `text` (string): Text to type

**Example:**
```json
{
  "name": "browser_type",
  "arguments": {
    "selector": "input[name='username']",
    "text": "myusername"
  }
}
```

#### `browser_get_content`
Extract text content from the page or specific elements.

**Parameters:**
- `selector` (string, optional): CSS selector (gets full page if not provided)

**Example:**
```json
{
  "name": "browser_get_content",
  "arguments": {
    "selector": ".content"
  }
}
```

#### `browser_screenshot`
Take a screenshot of the current page.

**Parameters:**
- `filename` (string, optional): Custom filename for the screenshot

**Example:**
```json
{
  "name": "browser_screenshot",
  "arguments": {
    "filename": "login_page.png"
  }
}
```

### CAPTCHA Solving Tools

#### `browser_solve_captcha`
Solve CAPTCHAs automatically (requires `--captcha-solver` flag).

**Parameters:**
- `captcha_type` (string, optional): Type of CAPTCHA (`recaptcha`, `hcaptcha`, `turnstile`)

**Example:**
```json
{
  "name": "browser_solve_captcha",
  "arguments": {
    "captcha_type": "recaptcha"
  }
}
```

### Utility Tools

#### `browser_close`
Close the browser and clean up resources.

**Parameters:** None

## Advanced Configuration

### Docker with Custom Options

```bash
# With proxy and CAPTCHA solving
docker run -i --rm camoufox-mcp \
  --headless \
  --captcha-solver \
  --proxy "http://proxy:8080"

# With volume mounting for persistent output
docker run -i --rm \
  -v /host/output:/tmp/camoufox-mcp \
  camoufox-mcp --headless

# Port mapping for SSE server
docker run -i --rm -p 8080:8080 \
  camoufox-mcp --port 8080 --host 0.0.0.0
```

### Environment Variables

The Docker container supports these environment variables:

- `CAMOUFOX_HEADLESS`: Set to `false` to run in headed mode
- `CAMOUFOX_PROXY`: Proxy server URL
- `CAMOUFOX_OUTPUT_DIR`: Output directory path
- `CAMOUFOX_DEBUG`: Set to `true` for debug logging

```bash
docker run -i --rm \
  -e CAMOUFOX_HEADLESS=true \
  -e CAMOUFOX_PROXY=http://proxy:8080 \
  -e CAMOUFOX_DEBUG=true \
  camoufox-mcp
```

## Example Workflows

### Advanced Login with CAPTCHA Solving
```python
# Navigate with stealth and geolocation
await client.call_tool("browser_navigate", {
    "url": "https://accounts.example.com/login",
    "wait_until": "networkidle"
})

# Wait for page to fully load
await client.call_tool("browser_wait_for", {
    "selector": "input[name='username']",
    "state": "visible"
})

# Enter credentials with human-like typing
await client.call_tool("browser_type", {
    "selector": "input[name='username']", 
    "text": "myuser",
    "delay": 120,  # Random delays between keystrokes
    "clear": true
})

await client.call_tool("browser_type", {
    "selector": "input[name='password']", 
    "text": "mypass",
    "delay": 150
})

# Take screenshot before submitting
await client.call_tool("browser_screenshot", {
    "filename": "before_submit.png"
})

# Submit form with human-like click
await client.call_tool("browser_click", {
    "selector": "button[type='submit']"
})

# Automatically solve CAPTCHA if it appears
await client.call_tool("browser_solve_captcha", {
    "captcha_type": "auto",
    "timeout": 60
})

# Verify login success
await client.call_tool("browser_wait_for", {
    "text": "Welcome",
    "timeout": 10000
})
```

### Stealth Data Extraction with Geolocation
```python
# Set specific geolocation for region-locked content
await client.call_tool("browser_set_geolocation", {
    "latitude": 51.5074,  # London
    "longitude": -0.1278,
    "accuracy": 100
})

# Navigate with matched IP geolocation
await client.call_tool("browser_navigate", {
    "url": "https://geo-restricted-site.com/data"
})

# Wait for dynamic content to load
await client.call_tool("browser_wait_for", {
    "selector": "[data-loaded='true']",
    "timeout": 15000
})

# Extract structured data
data = await client.call_tool("browser_get_content", {
    "selector": ".data-table",
    "inner_html": true
})

# Take evidence screenshot
await client.call_tool("browser_screenshot", {
    "filename": "extracted_data.png",
    "selector": ".data-table"
})

# Execute custom JavaScript for advanced extraction
custom_data = await client.call_tool("browser_execute_js", {
    "code": """
    const items = Array.from(document.querySelectorAll('.item'));
    return items.map(item => ({
        title: item.querySelector('.title')?.textContent,
        price: item.querySelector('.price')?.textContent,
        availability: item.querySelector('.stock')?.textContent
    }));
    """,
    "main_world": false  # Use isolated world for safety
})
```

### Advanced Bot Detection Evasion
```python
# Navigate with maximum stealth
await client.call_tool("browser_navigate", {
    "url": "https://bot-detection-test.com"
})

# Human-like interaction patterns
await client.call_tool("browser_execute_js", {
    "code": """
    // Simulate human-like mouse movements
    document.addEventListener('mousemove', () => {
        // Camoufox automatically handles this with --humanize
    });
    """,
    "main_world": true
})

# Interact with elements using realistic delays
await client.call_tool("browser_wait_for", {
    "selector": "#start-test",
    "timeout": 5000
})

await client.call_tool("browser_click", {"selector": "#start-test"})

# Wait with realistic timing
await client.call_tool("browser_wait_for", {
    "text": "Test completed",
    "timeout": 30000
})

# Extract detection results
results = await client.call_tool("browser_get_content", {
    "selector": ".detection-results"
})
```

### File Upload with Stealth
```python
# Navigate to upload page
await client.call_tool("browser_navigate", {
    "url": "https://example.com/upload"
})

# Use JavaScript to simulate file selection (since we can't access local files)
await client.call_tool("browser_execute_js", {
    "code": """
    // Create a file-like object for demonstration
    const file = new File(['test content'], 'test.txt', {type: 'text/plain'});
    const input = document.querySelector('input[type="file"]');
    
    // Simulate file selection
    Object.defineProperty(input, 'files', {
        value: [file],
        writable: false
    });
    
    // Trigger change event
    input.dispatchEvent(new Event('change'));
    """,
    "main_world": true
})

# Continue with form submission
await client.call_tool("browser_click", {
    "selector": "button.upload-btn"
})
```

## Stealth Features

Camoufox includes several anti-detection features:

- **Fingerprint randomization**: Randomizes browser fingerprints
- **WebRTC blocking**: Prevents IP leaks
- **Canvas fingerprint spoofing**: Avoids canvas-based tracking
- **User agent rotation**: Uses realistic user agents
- **Timing humanization**: Mimics human interaction patterns
- **GeoIP consistency**: Matches timezone/language to IP location

## Troubleshooting

### Common Issues

1. **Browser fails to start**
   ```bash
   # Check if running in Docker with proper permissions
   docker run -i --rm --privileged camoufox-mcp
   ```

2. **CAPTCHA solver not working**
   ```bash
   # Ensure captcha-solver flag is enabled
   python camoufox_mcp_server.py --captcha-solver
   ```

3. **Connection timeouts**
   ```bash
   # Use proxy or different network
   python camoufox_mcp_server.py --proxy "http://proxy:8080"
   ```

### Debug Mode

Enable debug logging to troubleshoot issues:

```bash
python camoufox_mcp_server.py --debug
```

### Docker Logs

```bash
# View container logs
docker logs <container_id>

# Run with debug output
docker run -i --rm -e CAMOUFOX_DEBUG=true camoufox-mcp
```

## Development

### Local Development Setup

```bash
git clone https://github.com/yourusername/camoufox-mcp
cd camoufox-mcp

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install in development mode
pip install -e ".[dev]"

# Run tests
pytest

# Format code
black .

# Type checking
mypy .
```

### Building Docker Image

```bash
# Build image
docker build -t camoufox-mcp .

# Test locally
docker run -i --rm camoufox-mcp --help
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Add tests if applicable
5. Run the test suite (`pytest`)
6. Format code (`black .`)
7. Commit your changes (`git commit -m 'Add amazing feature'`)
8. Push to the branch (`git push origin feature/amazing-feature`)
9. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Camoufox](https://github.com/daijro/camoufox) - The stealth browser engine
- [Camoufox-Captcha](https://github.com/techinz/camoufox-captcha) - CAPTCHA solving integration
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol this server implements
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) - Inspiration for the architecture

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/yourusername/camoufox-mcp/issues)
- Discussions: [Community discussions](https://github.com/yourusername/camoufox-mcp/discussions)

## Disclaimer

This tool is for educational and legitimate automation purposes only. Users are responsible for complying with websites' terms of service and applicable laws. The authors are not responsible for any misuse of this software.