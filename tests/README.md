# Camoufox MCP Server Tests

This directory contains the consolidated test suite for the Camoufox MCP server, organized by test type and complexity.

## Quick Start

Use the main test runner for all testing needs:

```bash
# Quick connectivity check (default)
python3 run_tests.py

# Test Docker container
python3 run_tests.py --docker

# Run all test suites
python3 run_tests.py --all --docker
```

## Test Structure

### Core Test Suites

#### 🔌 Connectivity Tests (`test_connectivity.py`)
- **Purpose**: Basic server communication and startup verification
- **Dependencies**: None (uses only standard library)
- **Speed**: Fast (~10-15 seconds)
- **Use Case**: Quick health checks, CI/CD pipelines

```bash
python3 run_tests.py --connectivity
python3 run_tests.py --connectivity --docker
```

#### 🧪 Unit Tests (`test_unit.py`)
- **Purpose**: Individual component testing with mocked dependencies
- **Dependencies**: pytest (optional), unittest mocks
- **Speed**: Fast (~5-10 seconds)
- **Use Case**: Development, debugging specific components

```bash
python3 run_tests.py --unit
```

#### 🔄 Integration Tests (`test_integration.py`)
- **Purpose**: Full MCP workflow and browser automation testing
- **Dependencies**: Running server, network access
- **Speed**: Moderate (~30-60 seconds)
- **Use Case**: End-to-end verification, release testing

```bash
python3 run_tests.py --integration
python3 run_tests.py --integration --docker
```

### Legacy Test Files (Deprecated)

The following files are maintained for compatibility but superseded by the consolidated structure:

- `test_simple.py` - Basic connectivity (use `--connectivity` instead)
- `test_quick.py` - Fast comprehensive test (use `--integration` instead)  
- `test_comprehensive.py` - Full test suite (use `--all` instead)
- `test_camoufox_mcp.py` - Legacy MCP tests

## Usage Patterns

### Development Workflow
```bash
# During development - quick feedback
python3 run_tests.py --unit

# Before commit - connectivity check
python3 run_tests.py --connectivity

# Before push - full verification
python3 run_tests.py --all
```

### CI/CD Pipeline
```bash
# Stage 1: Quick validation
python3 run_tests.py --connectivity --docker

# Stage 2: Component testing  
python3 run_tests.py --unit

# Stage 3: End-to-end verification
python3 run_tests.py --integration --docker
```

### Troubleshooting
```bash
# Debug connectivity issues
python3 run_tests.py --connectivity --debug

# Test specific components
python3 tests/test_unit.py

# Full diagnostic
python3 run_tests.py --all --debug
```

## Test Results

All tests provide standardized output:

- ✅ **PASSED**: Test completed successfully
- ❌ **FAILED**: Test encountered errors  
- ⏭️ **SKIPPED**: Test was not run
- 📊 **Summary**: Overall pass/fail statistics

### Success Criteria

- **Connectivity**: Server starts and responds to basic MCP commands
- **Unit**: All component tests pass without mocked dependency failures
- **Integration**: Complete browser automation workflows succeed

## Environment Requirements

### Docker Mode (Recommended)
- Docker installed and running
- Access to pull `followthewhit3rabbit/camoufox-mcp:latest`
- ~2GB available disk space

### Local Mode  
- Python 3.8+ with pip
- Dependencies: `pip install -r requirements.txt`
- Camoufox browser: `python -m camoufox fetch`
- ~4GB available disk space
- X11 display (Linux) or compatible windowing system

## Test Configuration

### Command Line Options

All test suites support:
- `--docker`: Use Docker container instead of local server
- `--debug`: Enable verbose debug output
- `--help`: Show usage information

### Environment Variables

- `CAMOUFOX_MCP_TIMEOUT`: Override default timeouts (seconds)
- `CAMOUFOX_MCP_OUTPUT_DIR`: Custom output directory for screenshots/logs

## Troubleshooting

### Common Issues

#### Docker Problems
```bash
# Check Docker daemon
docker ps

# Pull latest image
docker pull followthewhit3rabbit/camoufox-mcp:latest

# Check container logs
docker logs $(docker ps -lq)
```

#### Local Setup Issues
```bash
# Install dependencies
pip install -r requirements.txt

# Download browser
python -m camoufox fetch

# Check Python version
python3 --version  # Should be 3.8+
```

#### Network Issues
- Ensure internet connectivity for browser tests
- Check firewall settings for Docker networking
- Verify DNS resolution for test websites

### Getting Help

1. Run tests with `--debug` for detailed output
2. Check individual test files for specific error patterns
3. Review server logs for browser automation issues
4. Use MCP Inspector for interactive debugging:
   ```bash
   npx @modelcontextprotocol/inspector docker run -i --rm followthewhit3rabbit/camoufox-mcp:latest
   ```

## Contributing

When adding new tests:

1. Choose the appropriate test suite based on scope
2. Use existing patterns for consistency
3. Add proper error handling and cleanup
4. Update this documentation if needed
5. Test both Docker and local modes where applicable

## Legacy Files Reference

For backward compatibility, the following commands remain available:

```bash
# Old style (still works)
python3 tests/test_simple.py --docker
python3 tests/test_quick.py --docker --full
python3 tests/test_comprehensive.py --docker

# New consolidated approach (recommended)
python3 run_tests.py --connectivity --docker
python3 run_tests.py --integration --docker  
python3 run_tests.py --all --docker
```
