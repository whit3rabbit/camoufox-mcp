# Camoufox MCP Server

A Model Context Protocol (MCP) server that provides stealth browser automation capabilities using [Camoufox](https://github.com/daijro/camoufox). This server enables LLMs to interact with web pages while avoiding detection by anti-bot systems.

## Server Status

✅ **The server is properly structured and should be working correctly.** 

The implementation uses FastMCP framework with proper tool registration, error handling, and Docker support. The server correctly implements:
- All required MCP protocol methods (`list_tools`, `call_tool`)
- Comprehensive browser automation tools with stealth capabilities
- Proper async/await patterns for non-blocking operations
- Docker containerization with Xvfb for headless operation
- Multiple transport options (STDIO for MCP clients, SSE/HTTP for testing)

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

For a quick overview and troubleshooting guide, see the [**Testing Summary**](TESTING_SUMMARY.md).

For comprehensive testing procedures, automated test suites, and performance benchmarks, see the [**Complete Testing Guide**](TESTING.md).

### Quick Test Scripts

Tests are located in the `tests/` directory. Run them using:

1. **Simple Test** (basic connectivity check):
```bash
# Test local development server
python3 tests/test_simple.py

# Test Docker container
python3 tests/test_simple.py --docker

# With debug output
python3 tests/test_simple.py --docker --debug
```

2. **Comprehensive Test** (full feature testing):
```bash
# Test local development server
python3 tests/test_quick.py

# Test Docker container
python3 tests/test_quick.py --docker

# Run full test suite
python3 tests/test_quick.py --docker --full

# With debug output
python3 tests/test_quick.py --docker --debug
```

**Features of the test scripts:**
- ✅ Clear progress feedback
- ✅ Timeout handling  
- ✅ Docker startup detection
- ✅ Detailed error messages
- ✅ Debug mode for troubleshooting
- ✅ No external dependencies

**Note**: These test scripts communicate directly with the MCP server via STDIO/JSON-RPC protocol.

#### Alternative Testing Methods
```bash
# This handles startup delays and provides a web UI
npx @modelcontextprotocol/inspector \
  docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --debug
```

#### Option 2: Direct Protocol Test
```bash
# Simple protocol test to verify server is working
echo '{"jsonrpc": "2.0", "method": "initialize", "params": {"clientInfo": {"name": "test", "version": "1.0"}, "capabilities": {}}, "id": 1}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true

# List available tools
echo '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true
```

#### Option 3: Python Test Scripts
```bash
# Basic protocol test
python3 test_mcp_basic.py --docker

# Simple connectivity test  
python3 test_simple.py

# Debug test with detailed output
python3 test_debug.py
```

**Important**: The server may take 30-60 seconds to start on first run as it initializes Camoufox and the virtual display.

### Using MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the official visual testing tool for MCP servers. It provides an interactive web UI to test and debug your server's functionality.

#### Testing with Docker

```bash
# Test the Docker container with MCP Inspector
npx @modelcontextprotocol/inspector \
  docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --debug

# The Inspector UI will open at http://localhost:5173
# The proxy server runs on http://localhost:3000
```

#### Testing Local Development

```bash
# If developing locally, test your Python script directly
npx @modelcontextprotocol/inspector python camoufox_mcp_server.py --headless=true --debug

# Or use the MCP CLI if you have FastMCP installed
mcp dev camoufox_mcp_server.py
```

#### Inspector Features

- **Server Connection Pane**: Select transport type and configure connection
- **Tools Tab**: List all tools, view schemas, test with custom inputs
- **Resources Tab**: View available resources and their metadata
- **Prompts Tab**: Test prompt templates with arguments
- **Notifications Pane**: Monitor server logs and debug messages

### CLI Testing Mode

The Inspector also supports CLI mode for scripting and automation:

```bash
# List available tools
npx @modelcontextprotocol/inspector --cli \
  docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
  --method tools/list

# Call a specific tool
npx @modelcontextprotocol/inspector --cli \
  docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
  --method tools/call \
  --tool-name browser_navigate \
  --tool-arg url=https://example.com
```

### Programmatic Testing with FastMCP Client

Create a test script to verify server functionality:

```python
# test_camoufox_server.py
import asyncio

# Note: For immediate testing without dependencies
# Run: python3 run_tests.py --docker

async def test_server():
    # Test with Docker
    client = Client(
        "docker", 
        "run", "-i", "--rm",
        "-v", "/tmp/camoufox-output:/tmp/camoufox-mcp",
        "followthewhit3rabbit/camoufox-mcp:latest",
        "--headless=true"
    )
    
    async with client:
        # Test connection
        await client.ping()
        print("✅ Server is reachable")
        
        # List tools
        tools = await client.list_tools()
        print(f"✅ Found {len(tools)} tools")
        for tool in tools:
            print(f"   - {tool.name}: {tool.description}")
        
        # Test navigation
        result = await client.call_tool(
            "browser_navigate", 
            {"url": "https://example.com"}
        )
        print(f"✅ Navigation result: {result[0].text}")
        
        # Test screenshot
        result = await client.call_tool(
            "browser_screenshot",
            {"filename": "test.png"}
        )
        print("✅ Screenshot captured")

if __name__ == "__main__":
    asyncio.run(test_server())
```

### Quick Connectivity Tests

#### 1. Docker Health Check
```bash
# Verify Docker image
docker run --rm followthewhit3rabbit/camoufox-mcp:latest --help

# Check server starts correctly
docker run --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true --debug 2>&1 | head -20
```

#### 2. STDIO Protocol Test
```bash
# Test basic MCP communication
echo '{"jsonrpc": "2.0", "method": "initialize", "params": {"capabilities": {}}, "id": 1}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true

# List available tools
echo '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true
```

#### 3. Client Integration Tests

**Claude Desktop**: 
- Restart Claude after configuration
- Click the hammer/tools icon
- Look for "camoufox" in the tools list
- Try: "Navigate to example.com and take a screenshot"

**Cursor/Windsurf**:
- Check MCP panel for green connection status
- Test with: "Use camoufox to navigate to a website"

**Claude Code CLI**:
```bash
# Check server status
claude mcp status

# List available tools
claude mcp list-tools camoufox-server
```

### Performance Testing

```bash
# Test with minimal resources
docker run -i --rm \
  --memory=512m \
  --cpus=0.5 \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --block-images

# Test multiple concurrent operations
for i in {1..5}; do
  echo "Testing instance $i"
  docker run -d --name camoufox-test-$i \
    followthewhit3rabbit/camoufox-mcp:latest \
    --headless=true --port $((8080+$i))
done

# Cleanup
docker stop $(docker ps -q --filter "name=camoufox-test-") && \
docker rm $(docker ps -aq --filter "name=camoufox-test-")
```

### Debugging Common Issues

#### Server Not Connecting
```bash
# Enable verbose logging
docker run -i --rm \
  -e PYTHONUNBUFFERED=1 \
  followthewhit3rabbit/camoufox-mcp:latest \
  --debug --headless=true 2>&1 | tee debug.log

# Check for Xvfb issues
docker run -i --rm --entrypoint /bin/sh \
  followthewhit3rabbit/camoufox-mcp:latest \
  -c "xvfb-run --help"
```

#### Browser Launch Failures
```bash
# Test with virtual display
docker run -i --rm \
  -e DISPLAY=:99 \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=virtual --debug

# Test with more memory
docker run -i --rm \
  --shm-size=2g \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true
```

#### Permission Issues
```bash
# Fix volume permissions
mkdir -p /tmp/camoufox-output
chmod 777 /tmp/camoufox-output

# Run with user mapping
docker run -i --rm \
  --user $(id -u):$(id -g) \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest
```

### Unit Testing

Run the included test suite:

```bash
# Run tests locally
pytest tests/ -v

# Run specific test
pytest tests/test_camoufox_mcp.py -v

# Run tests in Docker
docker-compose run camoufox-test

# Run with coverage
pytest tests/ --cov=camoufox_mcp_server --cov-report=html
```

### Integration Testing Examples

#### Test CAPTCHA Solving
```python
async def test_captcha():
    async with client:
        # Navigate to a page with CAPTCHA
        await client.call_tool("browser_navigate", {
            "url": "https://www.google.com/recaptcha/api2/demo"
        })
        
        # Attempt to solve
        result = await client.call_tool("browser_solve_captcha", {
            "captcha_type": "recaptcha",
            "timeout": 60
        })
        print(f"CAPTCHA result: {result}")
```

#### Test Stealth Features
```python
async def test_stealth():
    async with client:
        # Check fingerprint
        await client.call_tool("browser_navigate", {
            "url": "https://bot.sannysoft.com"
        })
        
        # Take screenshot of results
        await client.call_tool("browser_screenshot", {
            "filename": "stealth_test.png",
            "full_page": True
        })
```

### Monitoring and Logs

```bash
# Stream logs from running container
docker logs -f $(docker ps -q --filter ancestor=followthewhit3rabbit/camoufox-mcp:latest)

# Save logs for analysis
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --debug --headless=true 2>&1 | tee camoufox_debug_$(date +%Y%m%d_%H%M%S).log
```

### Advanced Testing Scenarios

#### Test with Proxy
```bash
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --proxy "http://proxy.example.com:8080" \
  --debug
```

#### Test with Custom User Agent
```bash
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --user-agent "Mozilla/5.0 (Custom Bot 1.0)" \
  --debug
```

#### Test Maximum Stealth Configuration
```bash
docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=virtual \
  --humanize=2.0 \
  --geoip=auto \
  --captcha-solver \
  --block-webrtc \
  --disable-coop \
  --os=windows \
  --locale=en-US \
  --window=1920x1080 \
  --debug
```

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

### Prerequisites

- Python 3.9+ 
- Docker (for containerized testing and deployment)
- Node.js and npm (for MCP Inspector testing)
- Virtual environment (recommended)

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

# Download Camoufox browser
python -m camoufox fetch
```

### Running the Server Locally

```bash
# Run with STDIO (for MCP clients)
python main.py --headless=true --debug

# Run with SSE/HTTP transport (for testing)
python main.py --port 8080 --host localhost --headless=true
```

### Testing

The project includes a comprehensive test suite with both unit and integration tests:

#### Quick Testing

```bash
# Run all unit tests (fast, ~30 seconds)
python run_tests.py unit

# Run integration tests (slower, ~2-3 minutes)  
python run_tests.py integration

# Run all tests
python run_tests.py all

# Run Docker tests (requires Docker)
python run_tests.py docker

# With verbose output and debug logging
python run_tests.py integration -v --debug
```

#### Test Structure

- **Unit Tests** (`camoufox_mcp/tests/unit/`): Fast tests with mocked dependencies
- **Integration Tests** (`camoufox_mcp/tests/integration/`): Full MCP protocol and browser tests
- **Docker Tests**: Container-specific testing scenarios

#### Using pytest Directly

```bash
# Run specific test categories
pytest -m unit                    # Unit tests only
pytest -m integration             # Integration tests only
pytest -m docker                  # Docker tests only

# Run specific test files
pytest camoufox_mcp/tests/unit/test_config.py
pytest camoufox_mcp/tests/integration/test_mcp_protocol.py

# Run with coverage
pytest --cov=camoufox_mcp --cov-report=html
```

#### Legacy Test Scripts (Backward Compatibility)

```bash
# Simple connectivity test
python tests/test_simple.py
python tests/test_simple.py --docker

# Comprehensive functionality test
python tests/test_quick.py --docker --full
```

### Testing with MCP Inspector

```bash
# Test local Python installation
npx @modelcontextprotocol/inspector \
  python main.py \
  --headless=true --debug

# Test Docker container
npx @modelcontextprotocol/inspector \
  docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --debug
```

### Building and Deployment

#### Building Docker Image

```bash
# Build locally
docker build -t camoufox-mcp .

# Test the build
docker run -i --rm camoufox-mcp --help

# Multi-architecture build (requires buildx)
./build-multiarch.sh
```

#### Docker Compose Development

```bash
# Run development container with source mounting
docker-compose up camoufox-dev

# Run tests in container
docker-compose run camoufox-test

# Run with SSE transport
docker-compose up camoufox-sse
```

### Code Quality

```bash
# Format code (if using black)
black camoufox_mcp/ main.py

# Type checking (if using mypy)
mypy camoufox_mcp/ main.py

# Lint code (if using ruff)
ruff check camoufox_mcp/ main.py
```

### Project Structure

The codebase follows a modular architecture:

```
camoufox_mcp/
├── __init__.py
├── config/                     # Configuration classes
├── server/                     # Core server implementation
├── tools/                      # Browser automation tools
├── cli/                        # Command-line interface
└── tests/                      # Test suite
    ├── unit/                   # Unit tests with mocks
    ├── integration/            # Full integration tests
    └── utils/                  # Test utilities
```

### Development Workflow

1. **Setup**: Clone repo, create venv, install dependencies
2. **Development**: Make changes in modular structure
3. **Testing**: Run unit tests during development, integration tests before commits
4. **Docker Testing**: Test containerized version before deployment
5. **Documentation**: Update README and CLAUDE.md as needed

### Debugging

Enable debug logging for development:

```bash
# Local development with debug
python main.py --headless=true --debug

# Docker development with debug
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --debug
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
4. Run the test suite (`pytest tests/`)
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

## Troubleshooting Camoufox-Specific Issues

### MCP Client Library Issues
If you encounter import errors with the MCP client library:
```bash
# Test with our scripts
python3 tests/test_simple.py --docker  # No dependencies required

# Or use MCP Inspector (recommended)
npx @modelcontextprotocol/inspector docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest

# Or test directly with JSON-RPC
echo '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest
```

### Browser Won't Start
```bash
# Test Camoufox installation
docker run --rm --entrypoint python \
  followthewhit3rabbit/camoufox-mcp:latest \
  -c "from camoufox.sync_api import Camoufox; print('Camoufox OK')"

# Check virtual display
docker run --rm --entrypoint /bin/sh \
  followthewhit3rabbit/camoufox-mcp:latest \
  -c "DISPLAY=:99 xvfb-run xdpyinfo"
```

### Stealth Features Not Working
```bash
# Verify humanize is enabled
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
  --humanize --debug 2>&1 | grep -i "humanize"

# Test fingerprint randomization
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
  --os=windows --locale=en-US --debug
```

### CAPTCHA Solver Issues
```bash
# Check if camoufox-captcha is installed
docker run --rm --entrypoint pip \
  followthewhit3rabbit/camoufox-mcp:latest \
  list | grep camoufox-captcha

# Test with COOP disabled (required for some CAPTCHAs)
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest \
  --captcha-solver --disable-coop --debug
```
