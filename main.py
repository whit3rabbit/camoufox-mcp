#!/usr/bin/env python3
"""
Camoufox MCP Server - Main Entry Point
A Model Context Protocol server providing browser automation via Camoufox
"""

import asyncio
import logging
import os
import sys

from camoufox_mcp.cli import parse_args
from camoufox_mcp.cli.args import build_config_from_args
from camoufox_mcp.server import CamoufoxMCPServer


def main():
    """Main entry point"""
    args = parse_args()

    # Setup logging early. Logs from MCP SDK and uvicorn will also use this.
    # For STDIO transport, disable logging to avoid interfering with JSON-RPC communication
    # unless explicitly running in debug mode with HTTP transport
    if args.port:
        # HTTP/SSE mode - normal logging is fine
        log_level = logging.DEBUG if args.debug else logging.INFO
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    else:
        # STDIO mode - always log to stderr to avoid stdout interference
        log_level = logging.DEBUG if args.debug else logging.WARNING
        logging.basicConfig(
            level=log_level,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S',
            stream=sys.stderr  # Explicitly use stderr for STDIO mode
        )
        
        # For STDIO mode, we need to be more aggressive about stdout protection
        # Store the original stdout fd for MCP communication
        os.environ['MCP_ORIGINAL_STDOUT_FD'] = str(sys.stdout.fileno())
    
    # Create logger and log startup
    logger = logging.getLogger(__name__)
    logger.info("Camoufox MCP Server starting...")
    logger.info("Command line args: %s", args)
    
    # Build configuration from command line arguments
    config = build_config_from_args(args)
    logger.info("Configuration built successfully")
    
    # Create and run server
    server = CamoufoxMCPServer(config)
    logger.info("Server instance created")
    
    if args.port:
        logger.info("Running in HTTP/SSE mode on port %s", args.port)
        asyncio.run(server.run_sse())
    else:
        # Use FastMCP's async run method for stdio
        logger.info("Running in STDIO mode")
        asyncio.run(server.run_stdio_async())


if __name__ == "__main__":
    main()