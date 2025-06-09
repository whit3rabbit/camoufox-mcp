# Camoufox MCP Server Test Suite

This directory contains comprehensive tests for the Camoufox MCP Server, organized into two main categories: **unit tests** and **integration tests**.

## Test Structure

```
camoufox_mcp/tests/
├── __init__.py
├── conftest.py                 # Pytest configuration & fixtures
├── unit/                       # Fast unit tests with mocked dependencies
│   ├── test_config.py          # Configuration classes
│   ├── test_navigation_tools.py # Navigation tools
│   ├── test_interaction_tools.py # Interaction tools
│   ├── test_content_tools.py    # Content tools
│   ├── test_javascript_tools.py # JavaScript tools
│   ├── test_geolocation_tools.py # Geolocation tools
│   ├── test_browser_mgmt_tools.py # Browser management
│   └── test_captcha_tools.py    # CAPTCHA tools
├── integration/                # Full integration tests with real browser
│   ├── test_mcp_protocol.py     # MCP protocol compliance
│   ├── test_browser_automation.py # Browser functionality
│   └── test_docker.py           # Docker integration
└── utils/                      # Shared testing utilities
    ├── mcp_client.py           # Reusable MCP client
    └── fixtures.py             # Shared fixtures
```

## Quick Start

### Prerequisites

```bash
# Install test dependencies
pip install pytest pytest-asyncio

# Install Camoufox MCP Server dependencies
pip install -r requirements.txt

# Download Camoufox browser (for integration tests)
python -m camoufox fetch
```

### Running Tests

```bash
# Run all unit tests (fast, ~30 seconds)
python run_tests_new.py unit

# Run integration tests (slower, ~2-3 minutes)
python run_tests_new.py integration

# Run all tests
python run_tests_new.py all

# Run Docker tests (requires Docker)
python run_tests_new.py docker

# Run with Docker for all applicable tests
python run_tests_new.py all --docker

# Verbose output
python run_tests_new.py unit -v

# Debug logging
python run_tests_new.py integration --debug
```

### Using pytest directly

```bash
# Run unit tests only
pytest -m unit camoufox_mcp/tests/unit/

# Run integration tests
pytest -m integration camoufox_mcp/tests/integration/

# Run specific test file
pytest camoufox_mcp/tests/unit/test_navigation_tools.py

# Run specific test method
pytest camoufox_mcp/tests/unit/test_config.py::TestCamoufoxConfig::test_default_values

# Run with coverage
pytest --cov=camoufox_mcp camoufox_mcp/tests/unit/
```

## Test Types

### Unit Tests (`unit/`)

- **Purpose**: Test individual components in isolation
- **Speed**: Very fast (~30 seconds for full suite)
- **Dependencies**: Mocked browser interactions
- **Coverage**: All tool classes, configuration, error handling

**Key Features**:
- Mock browser, page, and element objects
- Test all success and error scenarios
- Validate input/output formats
- Test edge cases and error conditions

**Example**:
```python
@pytest.mark.asyncio
async def test_navigate_success(self, navigation_tools, mock_page):
    """Test successful navigation"""
    mock_page.title.return_value = "Test Page"
    mock_page.url = "https://example.com"
    
    result = await navigation_tools.navigate("https://example.com")
    
    assert not result.isError
    assert "✅ Navigated to: https://example.com" in result.content[0].text
```

### Integration Tests (`integration/`)

- **Purpose**: Test end-to-end functionality with real browser
- **Speed**: Moderate (~2-3 minutes for full suite)
- **Dependencies**: Real Camoufox browser instance
- **Coverage**: MCP protocol compliance, browser automation

**Key Features**:
- Real browser automation
- MCP protocol validation
- Complex interaction workflows
- Docker container testing

**Example**:
```python
@pytest.mark.asyncio
async def test_browser_automation_workflow(self, mcp_client):
    """Test complete browser automation workflow"""
    await mcp_client.initialize()
    
    # Navigate
    await mcp_client.call_tool("browser_navigate", {"url": test_url})
    
    # Interact
    await mcp_client.call_tool("browser_click", {"selector": "#button"})
    
    # Verify
    result = await mcp_client.call_tool("browser_get_content")
    assert "expected content" in result["content"][0]["text"]
```

### Docker Tests (`integration/test_docker.py`)

- **Purpose**: Test server running in Docker containers
- **Speed**: Slower (~3-5 minutes, includes container startup)
- **Dependencies**: Docker daemon, container image
- **Coverage**: Docker environment, headless operation

## Test Utilities

### MCPTestClient (`utils/mcp_client.py`)

Reusable client for testing MCP servers over STDIO:

```python
async with MCPTestClient(["python", "main.py", "--headless=true"]) as client:
    await client.initialize()
    tools = await client.list_tools()
    result = await client.call_tool("browser_navigate", {"url": "https://example.com"})
```

### Fixtures (`conftest.py`)

- `test_config`: Configuration for unit tests
- `mock_browser`: Mock browser instance
- `mock_page`: Mock page instance  
- `mock_element`: Mock element instance
- `server_with_mock_browser`: Server with mocked dependencies
- `integration_config`: Configuration for integration tests

## Test Markers

Use pytest markers to run specific test categories:

```bash
# Run only unit tests
pytest -m unit

# Run only integration tests
pytest -m integration

# Run only Docker tests
pytest -m docker

# Run slow tests
pytest -m slow
```

## Configuration

### pytest.ini

The pytest configuration includes:
- Test discovery patterns
- Async test support
- Logging configuration
- Coverage settings
- Custom markers

### Environment Variables

- `DEBUG=true`: Enable debug logging
- `DOCKER=true`: Use Docker for applicable tests
- `HEADLESS=false`: Run browser in non-headless mode (integration tests)

## Development Workflow

### Adding New Tests

1. **Unit Tests**: Add to appropriate `unit/test_*.py` file
2. **Integration Tests**: Add to `integration/test_*.py` files
3. **Mock Dependencies**: Use fixtures from `conftest.py`
4. **Test Real Functionality**: Use `MCPTestClient` for integration

### Test Development Tips

1. **Start with Unit Tests**: Mock dependencies for fast iteration
2. **Use Integration Tests**: Verify real-world functionality
3. **Test Error Cases**: Include error scenarios and edge cases
4. **Check Coverage**: Ensure all code paths are tested

### Debugging Tests

```bash
# Run with debug logging
pytest --log-cli-level=DEBUG test_file.py

# Run single test with verbose output
pytest -v -s test_file.py::test_method

# Use pdb for debugging
pytest --pdb test_file.py::test_method
```

## Continuous Integration

The test suite is designed for CI/CD environments:

- **Fast feedback**: Unit tests complete in ~30 seconds
- **Comprehensive coverage**: Integration tests validate real functionality
- **Docker support**: Tests work in containerized environments
- **Parallel execution**: Tests can run in parallel for speed

### GitHub Actions Example

```yaml
- name: Run Unit Tests
  run: python run_tests_new.py unit

- name: Run Integration Tests
  run: python run_tests_new.py integration

- name: Run Docker Tests
  run: python run_tests_new.py docker
```

## Troubleshooting

### Common Issues

1. **Browser startup timeout**: Increase timeout in integration tests
2. **Docker not available**: Install Docker for Docker tests
3. **Import errors**: Ensure all dependencies are installed
4. **Async test issues**: Check pytest-asyncio configuration

### Performance Tips

1. **Use unit tests for development**: Much faster than integration tests
2. **Run specific test files**: Target the area you're working on
3. **Use Docker tests sparingly**: Only when testing Docker-specific functionality
4. **Parallel execution**: Use `pytest -n auto` with pytest-xdist for speed

## Contributing

When adding new functionality:

1. Add unit tests for the new code
2. Add integration tests for end-to-end workflows
3. Update test documentation
4. Ensure all tests pass locally before submitting PR