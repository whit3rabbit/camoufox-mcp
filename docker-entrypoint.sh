#!/bin/sh
set -e

# Check if the first argument is '--help' or '-h'
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    # If --help or -h, execute the python script directly to show help and exit
    python /app/camoufox_mcp_server.py "$@"
else
    # Otherwise, run the python script with xvfb-run for normal operation
    echo "Starting Camoufox MCP Server with Xvfb..." >&2 # Log to stderr
    exec xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24 -ac -nolisten tcp" python /app/camoufox_mcp_server.py "$@"
fi
