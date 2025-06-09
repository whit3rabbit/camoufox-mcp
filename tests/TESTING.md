# Comprehensive Testing Guide for Camoufox MCP Server

This guide provides detailed testing procedures for the Camoufox MCP Server using various tools and methods.

## Table of Contents
- [MCP Inspector Testing](#mcp-inspector-testing)
- [Automated Testing Suite](#automated-testing-suite)
- [Manual Testing Procedures](#manual-testing-procedures)
- [Performance Benchmarks](#performance-benchmarks)
- [Security Testing](#security-testing)

## MCP Inspector Testing

### Basic Setup

The MCP Inspector is the primary tool for interactive testing:

```bash
# Install MCP Inspector globally (one-time setup)
npm install -g @modelcontextprotocol/inspector

# Run inspector with local development server
npx @modelcontextprotocol/inspector python camoufox_mcp_server.py --headless=true

# Run inspector with Docker
npx @modelcontextprotocol/inspector \
  docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true
```

### Testing Each Tool

1. **browser_navigate**
   ```json
   {
     "url": "https://example.com",
     "wait_until": "networkidle"
   }
   ```

2. **browser_screenshot**
   ```json
   {
     "filename": "test_screenshot.png",
     "full_page": true
   }
   ```

3. **browser_click**
   ```json
   {
     "selector": "button.submit",
     "button": "left"
   }
   ```

4. **browser_type**
   ```json
   {
     "selector": "input[name='search']",
     "text": "test query",
     "delay": 100,
     "clear": true
   }
   ```

## Automated Testing Suite

### Unit Test Suite

```python
# tests/test_comprehensive.py
import pytest
import asyncio
from pathlib import Path

# Note: This example shows the test structure. For immediate testing, use:
# python3 tests/test_simple.py --docker

class TestCamoufoxMCP:
    @pytest.fixture
    async def client(self):
        """Create MCP client for testing"""
        client = Client(
            "docker", "run", "-i", "--rm",
            "-v", f"{Path.cwd()}/test-output:/tmp/camoufox-mcp",
            "followthewhit3rabbit/camoufox-mcp:latest",
            "--headless=true", "--debug"
        )
        async with client:
            yield client
    
    @pytest.mark.asyncio
    async def test_navigation(self, client):
        """Test basic navigation"""
        result = await client.call_tool(
            "browser_navigate",
            {"url": "https://httpbin.org/user-agent"}
        )
        assert "Navigated to" in result[0].text
    
    @pytest.mark.asyncio
    async def test_stealth_features(self, client):
        """Test stealth capabilities"""
        # Navigate to bot detection site
        await client.call_tool(
            "browser_navigate",
            {"url": "https://bot.sannysoft.com"}
        )
        
        # Take screenshot
        result = await client.call_tool(
            "browser_screenshot",
            {"filename": "stealth_test.png", "full_page": True}
        )
        assert "Screenshot saved" in result[0].text
    
    @pytest.mark.asyncio
    async def test_javascript_execution(self, client):
        """Test JS execution"""
        await client.call_tool(
            "browser_navigate",
            {"url": "https://example.com"}
        )
        
        result = await client.call_tool(
            "browser_execute_js",
            {"code": "return document.title"}
        )
        assert "Example Domain" in result[0].text
    
    @pytest.mark.asyncio
    async def test_element_interaction(self, client):
        """Test clicking and typing"""
        await client.call_tool(
            "browser_navigate",
            {"url": "https://www.google.com"}
        )
        
        # Type in search box
        await client.call_tool(
            "browser_type",
            {
                "selector": "textarea[name='q']",
                "text": "MCP protocol",
                "delay": 50
            }
        )
        
        # Wait for suggestions
        await client.call_tool(
            "browser_wait_for",
            {"selector": "ul[role='listbox']", "timeout": 5000}
        )

# Run tests
if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
```

### Load Testing

```python
# load_test.py
import asyncio
import time
from mcp import Client

async def stress_test_instance(instance_id: int, num_operations: int):
    """Run stress test on single instance"""
    client = Client(
        "docker", "run", "-i", "--rm",
        "--name", f"camoufox-load-{instance_id}",
        "followthewhit3rabbit/camoufox-mcp:latest",
        "--headless=true", "--block-images"
    )
    
    results = []
    async with client:
        for i in range(num_operations):
            start = time.time()
            try:
                await client.call_tool(
                    "browser_navigate",
                    {"url": f"https://httpbin.org/delay/{i%3}"}
                )
                duration = time.time() - start
                results.append({"success": True, "duration": duration})
            except Exception as e:
                results.append({"success": False, "error": str(e)})
    
    return instance_id, results

async def run_load_test(num_instances: int = 5, operations_per_instance: int = 10):
    """Run parallel load test"""
    print(f"Starting load test: {num_instances} instances, {operations_per_instance} ops each")
    
    tasks = [
        stress_test_instance(i, operations_per_instance)
        for i in range(num_instances)
    ]
    
    results = await asyncio.gather(*tasks)
    
    # Analyze results
    total_ops = sum(len(r[1]) for r in results)
    successful_ops = sum(1 for r in results for op in r[1] if op.get("success"))
    avg_duration = sum(
        op.get("duration", 0) for r in results for op in r[1] if op.get("success")
    ) / (successful_ops or 1)
    
    print(f"\nLoad Test Results:")
    print(f"Total operations: {total_ops}")
    print(f"Successful: {successful_ops} ({successful_ops/total_ops*100:.1f}%)")
    print(f"Average duration: {avg_duration:.2f}s")

if __name__ == "__main__":
    asyncio.run(run_load_test())
```

## Manual Testing Procedures

### 1. CAPTCHA Testing

```bash
# Start server with CAPTCHA solver
docker run -i --rm \
  -v /tmp/camoufox-output:/tmp/camoufox-mcp \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --captcha-solver \
  --disable-coop

# Test with MCP Inspector
# Navigate to: https://www.google.com/recaptcha/api2/demo
# Call browser_solve_captcha tool
```

### 2. Proxy Testing

```bash
# Test with SOCKS5 proxy
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --proxy "socks5://user:pass@proxy:1080"

# Test with HTTP proxy
docker run -i --rm \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --proxy "http://proxy:8080"
```

### 3. Fingerprint Testing

```bash
# Test different OS fingerprints
for os in windows macos linux; do
  echo "Testing $os fingerprint..."
  docker run -i --rm \
    followthewhit3rabbit/camoufox-mcp:latest \
    --headless=true \
    --os=$os \
    --debug 2>&1 | grep -i "fingerprint"
done
```

## Performance Benchmarks

### Memory Usage Test

```bash
#!/bin/bash
# monitor_resources.sh

CONTAINER_NAME="camoufox-perf-test"

# Start container
docker run -d --name $CONTAINER_NAME \
  --memory=1g \
  --cpus=1 \
  followthewhit3rabbit/camoufox-mcp:latest \
  --headless=true \
  --port=8080

# Monitor resources
for i in {1..10}; do
  echo "Measurement $i:"
  docker stats $CONTAINER_NAME --no-stream --format \
    "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"
  
  # Trigger some operations via Inspector
  curl -X POST http://localhost:8080/tools/call \
    -H "Content-Type: application/json" \
    -d '{"tool": "browser_navigate", "arguments": {"url": "https://example.com"}}'
  
  sleep 5
done

# Cleanup
docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME
```

### Response Time Testing

```python
# benchmark_response_times.py
import time
import statistics
import asyncio
from mcp import Client

async def measure_operation_time(client, operation, args):
    """Measure single operation time"""
    start = time.perf_counter()
    await client.call_tool(operation, args)
    return time.perf_counter() - start

async def benchmark_operations():
    """Benchmark different operations"""
    client = Client(
        "docker", "run", "-i", "--rm",
        "followthewhit3rabbit/camoufox-mcp:latest",
        "--headless=true"
    )
    
    operations = [
        ("browser_navigate", {"url": "https://example.com"}),
        ("browser_screenshot", {"filename": "bench.png"}),
        ("browser_execute_js", {"code": "return window.location.href"}),
        ("browser_get_content", {}),
    ]
    
    results = {}
    
    async with client:
        # Warm up
        await client.call_tool("browser_navigate", {"url": "https://example.com"})
        
        # Benchmark each operation
        for op_name, op_args in operations:
            times = []
            for _ in range(5):
                duration = await measure_operation_time(client, op_name, op_args)
                times.append(duration)
            
            results[op_name] = {
                "mean": statistics.mean(times),
                "median": statistics.median(times),
                "stdev": statistics.stdev(times) if len(times) > 1 else 0,
                "min": min(times),
                "max": max(times)
            }
    
    # Print results
    print("\nBenchmark Results (in seconds):")
    print("-" * 60)
    for op, stats in results.items():
        print(f"\n{op}:")
        for stat, value in stats.items():
            print(f"  {stat}: {value:.3f}")

if __name__ == "__main__":
    asyncio.run(benchmark_operations())
```

## Security Testing

### Input Validation

```python
# security_test.py
import asyncio
from mcp import Client

async def test_security_vectors():
    """Test various security vectors"""
    client = Client(
        "docker", "run", "-i", "--rm",
        "followthewhit3rabbit/camoufox-mcp:latest",
        "--headless=true"
    )
    
    security_tests = [
        # XSS attempts
        {
            "name": "XSS in URL",
            "tool": "browser_navigate",
            "args": {"url": "javascript:alert('xss')"}
        },
        # Path traversal
        {
            "name": "Path traversal in screenshot",
            "tool": "browser_screenshot",
            "args": {"filename": "../../../etc/passwd"}
        },
        # Command injection
        {
            "name": "Command injection in JS",
            "tool": "browser_execute_js",
            "args": {"code": "'; exec('rm -rf /'); //"}
        },
        # Resource exhaustion
        {
            "name": "Large selector",
            "tool": "browser_click",
            "args": {"selector": "a" * 10000}
        }
    ]
    
    async with client:
        for test in security_tests:
            print(f"\nTesting: {test['name']}")
            try:
                result = await client.call_tool(test['tool'], test['args'])
                print(f"  Result: {result[0].text[:100]}...")
            except Exception as e:
                print(f"  Blocked/Error: {str(e)}")

if __name__ == "__main__":
    asyncio.run(test_security_vectors())
```

### Container Security Scan

```bash
# Scan for vulnerabilities
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy image followthewhit3rabbit/camoufox-mcp:latest

# Check for sensitive data exposure
docker run --rm followthewhit3rabbit/camoufox-mcp:latest \
  /bin/sh -c "find / -name '*.key' -o -name '*.pem' 2>/dev/null"
```

## Continuous Testing

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Camoufox MCP Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: "3.11"
    
    - name: Install test dependencies
      run: |
        pip install pytest pytest-asyncio mcp
    
    - name: Run unit tests
      run: |
        pytest test_camoufox_mcp.py -v
    
    - name: Test Docker image
      run: |
        docker build -t camoufox-test .
        docker run --rm camoufox-test --help
    
    - name: Run integration tests
      run: |
        # Start server in background
        docker run -d --name test-server \
          -p 8080:8080 \
          camoufox-test \
          --headless=true --port=8080
        
        # Wait for server
        sleep 10
        
        # Run tests
        python test_comprehensive.py
        
        # Cleanup
        docker stop test-server
```

## Debugging Tips

1. **Enable verbose logging**:
   ```bash
   docker run -i --rm \
     -e PYTHONDEBUG=1 \
     -e CAMOUFOX_DEBUG=1 \
     followthewhit3rabbit/camoufox-mcp:latest \
     --debug
   ```

2. **Inspect browser state**:
   ```python
   # Add to your test
   await client.call_tool(
       "browser_execute_js",
       {"code": "return {url: window.location.href, title: document.title, cookies: document.cookie}"}
   )
   ```

3. **Monitor network traffic**:
   ```bash
   docker run -i --rm \
     --cap-add=NET_ADMIN \
     followthewhit3rabbit/camoufox-mcp:latest \
     --debug --headless=true
   ```
