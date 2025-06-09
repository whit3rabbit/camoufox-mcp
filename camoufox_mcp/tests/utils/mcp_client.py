"""
Reusable MCP client for testing Camoufox MCP Server
Provides a clean interface for JSON-RPC communication over STDIO
"""

import asyncio
import json
import subprocess
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
        self.process: Optional[subprocess.Popen] = None
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
        """Start the MCP server process"""
        if self.debug:
            self.logger.debug(f"Starting MCP server: {' '.join(self.command_args)}")
        
        self.process = subprocess.Popen(
            self.command_args,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0
        )
        
        # Give the server a moment to start
        await asyncio.sleep(0.5)
        
        if self.process.poll() is not None:
            stderr = self.process.stderr.read() if self.process.stderr else ""
            raise RuntimeError(f"Server failed to start. stderr: {stderr}")
    
    async def stop(self):
        """Stop the MCP server process"""
        if self.process:
            try:
                self.process.terminate()
                await asyncio.sleep(0.1)
                if self.process.poll() is None:
                    self.process.kill()
                self.process.wait(timeout=5)
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
        if not self.process:
            raise RuntimeError("Server not started")
        
        self.request_id += 1
        request = {
            "jsonrpc": "2.0",
            "method": method,
            "id": self.request_id
        }
        
        if params is not None:
            request["params"] = params
        
        request_json = json.dumps(request)
        
        if self.debug:
            self.logger.debug(f"Sending request: {request_json}")
        
        # Send request
        self.process.stdin.write(request_json + "\n")
        self.process.stdin.flush()
        
        # Read response with timeout
        try:
            response_line = await asyncio.wait_for(
                self._read_line(),
                timeout=self.timeout
            )
        except asyncio.TimeoutError:
            raise RuntimeError(f"Request timed out after {self.timeout}s")
        
        if not response_line:
            stderr = self.process.stderr.read() if self.process.stderr else ""
            raise RuntimeError(f"No response from server. stderr: {stderr}")
        
        try:
            response = json.loads(response_line)
        except json.JSONDecodeError as e:
            raise RuntimeError(f"Invalid JSON response: {response_line}") from e
        
        if self.debug:
            self.logger.debug(f"Received response: {response}")
        
        if "error" in response:
            error = response["error"]
            raise RuntimeError(f"Server error: {error.get('message', 'Unknown error')}")
        
        return response
    
    async def _read_line(self) -> str:
        """Read a line from the server's stdout"""
        if not self.process or not self.process.stdout:
            return ""
        
        # Use asyncio to read from stdout without blocking
        loop = asyncio.get_event_loop()
        line = await loop.run_in_executor(None, self.process.stdout.readline)
        return line.strip()
    
    async def initialize(self, client_info: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Initialize the MCP session"""
        if client_info is None:
            client_info = {"name": "test-client", "version": "1.0.0"}
        
        params = {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": client_info
        }
        
        return await self.send_request("initialize", params)
    
    async def list_tools(self) -> List[Dict[str, Any]]:
        """List available tools"""
        response = await self.send_request("tools/list")
        return response.get("result", {}).get("tools", [])
    
    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Call a specific tool"""
        params = {"name": name}
        if arguments:
            params["arguments"] = arguments
        
        response = await self.send_request("tools/call", params)
        return response.get("result", {})
    
    async def get_server_info(self) -> Dict[str, Any]:
        """Get server information from initialization response"""
        init_response = await self.initialize()
        return init_response.get("result", {}).get("serverInfo", {})