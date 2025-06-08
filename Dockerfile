# Multi-stage Docker build for Camoufox MCP Server

# ------------------------------
# Base stage with system dependencies
# ------------------------------
    FROM python:3.11-slim-bullseye AS base

    # Install system dependencies for Camoufox and virtual display
    RUN apt-get update && apt-get install -y \
        # Virtual display for headless operation
        xvfb \
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
    RUN useradd -m -u 1000 camoufox && chown -R camoufox:camoufox /app
    
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
    
    # Download Camoufox browser
    RUN python -m camoufox fetch
    
    # ------------------------------
    # Final runtime stage
    # ------------------------------
    FROM base AS runtime

    # Switch to non-root user
    USER camoufox

    # Copy installed packages from deps stage
    COPY --from=deps --chown=camoufox:camoufox /home/camoufox/.local /home/camoufox/.local
    
    # Add local bin to PATH
    ENV PATH=/home/camoufox/.local/bin:$PATH
    
    # Copy application code
    COPY --chown=camoufox:camoufox camoufox_mcp_server.py .
    
    # Create output directory
    RUN mkdir -p /tmp/camoufox-mcp
    
    # Setup virtual display startup script
    RUN echo '#!/bin/bash' > /app/start-xvfb.sh && \
        echo '# Start virtual display in background if not already running' >> /app/start-xvfb.sh && \
        echo 'if ! pgrep -x "Xvfb" > /dev/null; then' >> /app/start-xvfb.sh && \
        echo '    Xvfb :99 -screen 0 1920x1080x24 -ac &' >> /app/start-xvfb.sh && \
        echo '    export DISPLAY=:99' >> /app/start-xvfb.sh && \
        echo '    sleep 2' >> /app/start-xvfb.sh && \
        echo 'fi' >> /app/start-xvfb.sh && \
        echo 'exec "$@"' >> /app/start-xvfb.sh
    
    # Set permissions for the script and change ownership
    USER root
    RUN chmod +x /app/start-xvfb.sh && chown camoufox:camoufox /app/start-xvfb.sh
    USER camoufox
    
    # Expose port for SSE transport (optional)
    EXPOSE 8080
    
    # Health check
    HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
        CMD python -c "import camoufox; print('Camoufox OK')" || exit 1
    
    # Set entrypoint to handle virtual display
    ENTRYPOINT ["/app/start-xvfb.sh", "python", "camoufox_mcp_server.py"]
    
    # Default arguments - run in headless mode with stealth features
    CMD ["--headless=true", "--humanize", "--geoip=auto", "--block-webrtc"]