"""
Reusable MCP client for testing Camoufox MCP Server
Provides a clean interface for JSON-RPC communication over STDIO
"""

import asyncio
import json
import logging
from typing import Dict, Any, Optional, List
from contextlib import asynccontextmanager

class MCPTestClient:
    """Test client for MCP servers using STDIO transport"""
    
    def __init__(self, command_args: List[str], timeout: float = 30.0, debug: bool = False):
        """
        Initialize the MCP test client
        
        Args:
            command_args: Command to start the MCP server
            timeout: Default timeout for requests
            debug: Enable debug logging
        """
        self.command_args = command_args
        self.timeout = timeout
        self.debug = debug
        self.process: Optional[asyncio.subprocess.Process] = None  # Use asyncio's Process
        self.request_id = 0
        self.logger = logging.getLogger(__name__)
        
        if debug:
            self.logger.setLevel(logging.DEBUG)
    
    @asynccontextmanager
    async def session(self):
        """Async context manager for MCP server session"""
        await self.start()
        try:
            yield self
        finally:
            await self.stop()
    
    async def start(self):
        """Start the MCP server process using asyncio."""
        if self.debug:
            self.logger.debug(f"Starting MCP server: {' '.join(self.command_args)}")
        
        self.process = await asyncio.create_subprocess_exec(
            *self.command_args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        # Give the server a moment to start and check for immediate errors.
        # Increased delay to ensure server is fully ready, especially for first-time browser downloads
        await asyncio.sleep(5.0)
        
        if self.process.returncode is not None:
            stderr_output = await self.process.stderr.read()
            raise RuntimeError(f"Server failed to start with exit code {self.process.returncode}. stderr: {stderr_output.decode()}")

    async def stop(self):
        """Stop the MCP server process."""
        if self.process and self.process.returncode is None:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5.0)
                self.logger.debug("Server terminated gracefully.")
            except asyncio.TimeoutError:
                self.logger.warning("Server did not terminate gracefully, killing.")
                self.process.kill()
            except Exception as e:
                self.logger.warning(f"Error stopping server: {e}")
            finally:
                self.process = None
    
    async def send_request(self, method: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Send a JSON-RPC request to the server
        
        Args:
            method: The method name
            params: Optional parameters
            
        Returns:
            The response from the server
            
        Raises:
            RuntimeError: If the server is not running or request fails
        """
        if not self.process or not self.process.stdin:
            raise RuntimeError("Server not started")
        
        self.request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "id": self.request_id
        }
        
        if params is not None:
            request["params"] = params
        
        request_json = json.dumps(request) + "\n"
        
        if self.debug:
            self.logger.debug(f"Sending request: {request_json.strip()}")
        
        # Send request
        self.process.stdin.write(request_json.encode('utf-8'))
        await self.process.stdin.drain()
        
        # Read response with timeout
        try:
            response_line = await asyncio.wait_for(
                self._read_line(),
                timeout=self.timeout
            )
        except asyncio.TimeoutError:
            # Check stderr for clues if we time out
            stderr_output = await self.process.stderr.read()
            raise RuntimeError(f"Request timed out after {self.timeout}s. Stderr: {stderr_output.decode()}")
        
        if not response_line:
            stderr_output = await self.process.stderr.read()
            raise RuntimeError(f"No response from server. Stderr: {stderr_output.decode()}")
        
        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON response: {response_line}") from e
        
        if self.debug:
            self.logger.debug(f"Received response: {json.dumps(response, indent=2)}")
        
        if "error" in response:
            error = response["error"]
            raise RuntimeError(f"Server error: {error.get('message', 'Unknown error')}")
        
        return response
    
    async def _read_line(self) -> str:
        """Read a line from the server's stdout asynchronously."""
        if not self.process or not self.process.stdout:
            return ""
        
        line = await self.process.stdout.readline()
        return line.decode('utf-8').strip()
    
    async def initialize(self, client_info: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Initialize the MCP session"""
        if client_info is None:
            client_info = {"name": "test-client", "version": "1.0.0"}
        
        params = {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": client_info
        }
        
        # Use a longer timeout for initialization, especially for Docker
        # Save current timeout and use a longer one for initialization
        original_timeout = self.timeout
        self.timeout = max(120.0, self.timeout)  # At least 120s for initialization
        try:
            response = await self.send_request("initialize", params)
            return response.get("result", {})
        finally:
            self.timeout = original_timeout
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools"""
        response = await self.send_request("tools/list")
        return response.get("result", {}).get("tools", [])
    
    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Call a specific tool"""
        params = {"name": name}
        if arguments is not None:
            params["arguments"] = arguments
        
        response = await self.send_request("tools/call", params)
        return response.get("result", {})
    
    async def get_server_info(self) -> Dict[str, Any]:
        """Get server information from initialization response"""
        init_response = await self.initialize()
        return init_response.get("result", {}).get("serverInfo", {})