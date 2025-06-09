# Camoufox MCP Server - Testing Summary

## Quick Start

Your Camoufox MCP server is properly structured and should work correctly. It uses FastMCP framework with all the required MCP protocol implementations.

## Testing Options

### 1. MCP Inspector (Recommended)
The official visual testing tool that works with any MCP server:

```bash
npx @modelcontextprotocol/inspector \
  docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true --debug
```

Access the web UI at http://localhost:5173

### 2. Direct Protocol Testing
Test using JSON-RPC commands directly:

```bash
# Initialize
echo '{"jsonrpc": "2.0", "method": "initialize", "params": {"capabilities": {}}, "id": 1}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true

# List tools
echo '{"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 2}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true
```

### 3. Test Scripts (No Dependencies)
We provide test scripts in the `tests/` directory that communicate via STDIO/JSON-RPC:

```bash
# Simple test
python3 tests/test_simple.py --docker

# Comprehensive test  
python3 tests/test_quick.py --docker --full

# With debug output
python3 tests/test_simple.py --docker --debug
```

## MCP Client Library Notes

The MCP ecosystem is evolving rapidly:

1. **FastMCP Integration**: FastMCP is now part of the official MCP SDK (`mcp.server.fastmcp`)
2. **Client API Changes**: The client API structure has changed in recent versions
3. **Docker Advantage**: Using Docker eliminates dependency issues

## Troubleshooting

### Import Errors
If you see import errors when running locally:
```bash
# Install/update MCP SDK
pip install --upgrade mcp

# Or use Docker (recommended)
docker pull followthewhit3rabbit/camoufox-mcp:latest
```

### Server Not Starting
```bash
# Check Docker logs
docker run --rm followthewhit3rabbit/camoufox-mcp:latest --help

# Test with debug mode
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --debug 2>&1
```

### Tools Not Appearing
1. Ensure the server is running: Check with `docker ps`
2. Restart your MCP client (Claude Desktop, Cursor, etc.)
3. Check the configuration file is correctly formatted
4. Use MCP Inspector to verify tools are exposed

## Integration Testing

### Claude Desktop
After configuration:
1. Restart Claude Desktop
2. Look for the hammer/tools icon
3. Verify "camoufox" appears in tools list
4. Test: "Navigate to example.com and take a screenshot"

### Command Line Testing
```bash
# Quick connectivity test
echo '{"jsonrpc": "2.0", "method": "ping", "id": 1}' | \
docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest

# Tool execution test
echo '{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "browser_navigate",
    "arguments": {"url": "https://example.com"}
  },
  "id": 3
}' | docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest --headless=true
```

## Performance Considerations

1. **Container Startup**: First run pulls the image (~500MB)
2. **Browser Launch**: Camoufox initialization takes 2-5 seconds
3. **Memory Usage**: Allocate at least 1GB RAM for the container
4. **Concurrent Operations**: Each browser instance uses separate resources

## Security Notes

1. **Volume Mounts**: Only mount necessary directories
2. **Network Access**: The browser has full internet access
3. **JavaScript Execution**: Be cautious with untrusted code
4. **Proxy Configuration**: Credentials are passed to the browser

## Next Steps

1. Run `python3 test_simple.py --docker` to verify basic functionality
2. Use MCP Inspector for interactive testing
3. Configure your preferred MCP client
4. Test stealth features at https://bot.sannysoft.com
