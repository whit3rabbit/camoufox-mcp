# Multi-stage Docker build for Camoufox MCP Server

# ------------------------------
# Base stage with system dependencies
# ------------------------------
    FROM python:3.11-slim-bullseye AS base

    # Install system dependencies for Camoufox and virtual display
    RUN apt-get update && apt-get install -y --no-install-recommends \
        # Virtual display for headless operation
        xvfb \
        xauth \
        procps \
        # Firefox/Camoufox dependencies  
        libgtk-3-0 libx11-xcb1 libasound2 libdbus-glib-1-2 libxt6 libpci3 libxss1 libgconf-2-4 \
        # Additional utilities
        wget gnupg ca-certificates curl \
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
    ENV PATH=/home/camoufox/.local/bin:$PATH
        
    # Copy requirements first for better caching
    COPY --chown=camoufox:camoufox requirements.txt .
        
    # Install Python dependencies
    RUN pip install --user --no-cache-dir -r requirements.txt
    
    # NOTE: Removed 'RUN python -m camoufox fetch' as the preload script handles it.
    
    # Copy application code needed for the preload script
    COPY --chown=camoufox:camoufox camoufox_mcp/ ./camoufox_mcp/
    COPY --chown=camoufox:camoufox scripts/preload_browser.py ./scripts/
    # Also create an __init__.py to make 'scripts' a package
    RUN touch scripts/__init__.py
        
    # Pre-download browser, profile, and addons by running a dummy server instance.
    # Using xvfb-run is much more robust than managing Xvfb manually.
    RUN xvfb-run -a --server-args="-screen 0 1280x1024x24" \
        python -m scripts.preload_browser
    
    # ------------------------------
    # Final runtime stage
    # ------------------------------
    FROM base AS runtime
    
    # Switch to non-root user
    USER camoufox
    
    # Copy installed packages and the warmed-up cache from the deps stage
    COPY --from=deps --chown=camoufox:camoufox /home/camoufox/.local /home/camoufox/.local
    COPY --from=deps --chown=camoufox:camoufox /home/camoufox/.cache /home/camoufox/.cache
        
    # Add local bin to PATH
    ENV PATH=/home/camoufox/.local/bin:$PATH
        
    # Copy only the necessary application code for the final image
    COPY --chown=camoufox:camoufox camoufox_mcp/ ./camoufox_mcp/
    COPY --chown=camoufox:camoufox main.py .
    COPY --chown=camoufox:camoufox docker-entrypoint.sh .
    RUN chmod +x docker-entrypoint.sh
        
    # Ensure output dir exists
    RUN mkdir -p /tmp/camoufox-mcp && chown camoufox:camoufox /tmp/camoufox-mcp
    
    # Expose port for SSE transport (optional)
    EXPOSE 8080
     
    # Health check
    HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
        CMD python -c "import camoufox; print('Camoufox OK')" || exit 1
        
    ENTRYPOINT ["/app/docker-entrypoint.sh"]
    CMD []