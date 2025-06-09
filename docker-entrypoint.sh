#!/bin/sh
set -e

# Check if we're being run with specific python commands (allow direct container execution)
if [ "$1" = "python" ] || [ "$1" = "python3" ] || [ "$1" = "/bin/sh" ] || [ "$1" = "sh" ] || [ "$1" = "bash" ]; then
    # Execute the command directly without the entrypoint wrapper
    exec "$@"
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    # If --help or -h, execute the python script directly to show help and exit
    python /app/main.py "$@"
else
    # For STDIO mode (MCP Inspector), we need Xvfb for headless browser operation
    # but we can't use xvfb-run because it interferes with stdin/stdout
    # Instead, start Xvfb in background and set DISPLAY
    
    if echo "$@" | grep -q -- "--debug"; then
        echo "Starting Xvfb for headless browser operation..." >&2
    fi
    
    # Start Xvfb in background on display :99
    Xvfb :99 -screen 0 1280x1024x24 -ac -nolisten tcp > /dev/null 2>&1 &
    XVFB_PID=$!
    
    # Set DISPLAY for the browser
    export DISPLAY=:99
    export PYTHONUNBUFFERED=1
    
    # Function to cleanup Xvfb on exit
    cleanup() {
        if [ -n "$XVFB_PID" ]; then
            kill $XVFB_PID 2>/dev/null || true
        fi
    }
    trap cleanup EXIT INT TERM
    
    # Wait a moment for Xvfb to start
    sleep 1
    
    # Run the server directly without xvfb-run wrapper
    exec python -u /app/main.py "$@"
fi
