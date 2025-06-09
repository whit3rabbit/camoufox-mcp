# Multi-stage Docker build for Camoufox MCP Server

# ------------------------------
# Base stage with system dependencies
# ------------------------------
FROM python:3.11-slim-bullseye AS base

# Install system dependencies for Camoufox and virtual display
RUN apt-get update && apt-get install -y \
    # Virtual display for headless operation
    xvfb \
    procps \
    # Firefox/Camoufox dependencies  
    libgtk-3-0 \
    libx11-xcb1 \
    libasound2 \
    libdbus-glib-1-2 \
    libxt6 \
    libpci3 \
    libxss1 \
    libgconf-2-4 \
    # Additional utilities
    wget \
    gnupg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*
    
# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV DISPLAY=:99
    
# Create app directory and non-root user
WORKDIR /app
RUN useradd -m -u 1000 camoufox && \
    chown -R camoufox:camoufox /app && \
    # Create and set permissions for Xvfb socket directory
    mkdir -p /tmp/.X11-unix && \
    chown -R camoufox:camoufox /tmp/.X11-unix && \
    chmod 1777 /tmp/.X11-unix
    
    # ------------------------------
    # Dependencies stage
    # ------------------------------
    FROM base AS deps
    
    # Switch to non-root user for Python installations
    USER camoufox

    # Add local bin to PATH for user-installed executables
    ENV PATH=/home/camoufox/.local/bin:$PATH
    
    # Copy requirements first for better caching
    COPY --chown=camoufox:camoufox requirements.txt .
    
    # Install Python dependencies
    RUN pip install --user --no-cache-dir -r requirements.txt
    
    # Download Camoufox browser and components
    RUN python -m camoufox fetch
    
    # Pre-download browser and addons - make sure cache is in the right location
    # The issue is that cache gets created but not copied to runtime stage
    RUN echo 'import asyncio\n\
import sys\n\
import os\n\
from camoufox.async_api import AsyncCamoufox\n\
\n\
async def preload_browser():\n\
    try:\n\
        print("Pre-downloading Camoufox browser and addons...", file=sys.stderr)\n\
        # Use exact same config as runtime\n\
        async with AsyncCamoufox(\n\
            headless=True,\n\
            block_webrtc=True,\n\
            block_images=False,\n\
            humanize=True\n\
        ) as browser:\n\
            page = await browser.new_page()\n\
            await page.goto("data:text/html,<h1>Preload Complete</h1>", timeout=30000)\n\
            await page.close()\n\
            print("✅ Camoufox pre-download successful", file=sys.stderr)\n\
            \n\
            # Verify cache was created\n\
            cache_dir = os.path.expanduser("~/.cache/camoufox")\n\
            if os.path.exists(cache_dir):\n\
                print(f"Cache verified: {os.listdir(cache_dir)}", file=sys.stderr)\n\
            else:\n\
                print("WARNING: Cache directory not found!", file=sys.stderr)\n\
    except Exception as e:\n\
        print(f"⚠️ Pre-download error: {e}", file=sys.stderr)\n\
\n\
asyncio.run(preload_browser())' > preload.py && \
        Xvfb :99 -screen 0 1280x1024x24 -ac -nolisten tcp > /dev/null 2>&1 & \
        export DISPLAY=:99 && \
        sleep 3 && \
        python preload.py && \
        rm preload.py && \
        pkill -f Xvfb || true
    
    # ------------------------------
    # Final runtime stage
    # ------------------------------
    FROM base AS runtime

    # Switch to non-root user
    USER camoufox

    # Copy installed packages and cache from deps stage
    COPY --from=deps --chown=camoufox:camoufox /home/camoufox/.local /home/camoufox/.local
    COPY --from=deps --chown=camoufox:camoufox /home/camoufox/.cache /home/camoufox/.cache
    
    # Add local bin to PATH
    ENV PATH=/home/camoufox/.local/bin:$PATH
    
    # Copy application code
    COPY --chown=camoufox:camoufox camoufox_mcp/ ./camoufox_mcp/
    COPY --chown=camoufox:camoufox main.py .
    COPY --chown=camoufox:camoufox docker-entrypoint.sh .
    RUN chmod +x docker-entrypoint.sh
    
    # Ensure output dir exists if server writes there by default (can be created by user if needed)
    # RUN mkdir -p /tmp/camoufox-mcp && chown camoufox:camoufox /tmp/camoufox-mcp

    # Expose port for SSE transport (optional)
    EXPOSE 8080
    
    # Health check
    HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
        CMD python -c "import camoufox; print('Camoufox OK')" || exit 1
    
    # Entrypoint to run the server using xvfb-run
    # This allows passing arguments from 'docker run' to the camoufox_mcp_server.py script.
    # xvfb-run handles finding a free display number and starting Xvfb.
    # Server arguments for Xvfb can be specified with --server-args.
    ENTRYPOINT ["/app/docker-entrypoint.sh"]

    # Default command (arguments to ENTRYPOINT).
    # Can be overridden by arguments passed to 'docker run'.
    # For example, 'docker run <image> --help' will pass '--help' to the script.
    CMD []