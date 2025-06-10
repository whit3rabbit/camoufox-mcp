# ------------------------------
# Stage 1: The "builder" Stage
# Purpose: Install all dependencies, build the code, and fetch the browser.
# ------------------------------
    FROM node:22-bullseye-slim AS builder

    # Install system dependencies required for native Node.js addons (like sqlite3 for camoufox)
    RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        build-essential \
        && rm -rf /var/lib/apt/lists/*
    
    WORKDIR /app
    
    # Copy package files and install ALL dependencies, including devDependencies for building.
    # This leverages Docker's layer caching.
    COPY package.json package-lock.json ./
    RUN npm install
    
    # Copy the rest of your application's source code
    COPY . .
    
    # Build your TypeScript application
    RUN npm run build
    
    # --- THIS IS THE KEY STEP ---
    # Run the fetch command to download the Camoufox browser, GeoIP database, and default addons.
    # The files will be saved to the cache directory of the current user (root).
    # This ensures the browser is part of the image layer, not downloaded at runtime.
    RUN npx camoufox-js fetch
    
    # ------------------------------
    # Stage 2: The "runtime" Stage
    # Purpose: Create the final, lean image with only what's needed to run the app.
    # ------------------------------
    FROM node:22-bullseye-slim AS runtime
    
    # Install system dependencies required by Firefox and the virtual display (Xvfb)
    RUN apt-get update && apt-get install -y --no-install-recommends \
        # For running in a headless environment with a virtual display
        xvfb \
        # Minimal set of libraries required for headless Firefox to run
        libgtk-3-0 libx11-xcb1 libxfixes3 libxrandr2 libxtst6 libx11-6 libxcomposite1 \
        libasound2 libdbus-glib-1-2 libpci3 libxss1 libgconf-2-4 libnss3 libatk1.0-0 \
        libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libatspi2.0-0 \
        && rm -rf /var/lib/apt/lists/*
    
    # Create a dedicated, non-root user for security
    RUN useradd -m -u 1000 myappuser
    USER myappuser
    WORKDIR /home/myappuser/app
    
    # Copy package files to install only production dependencies
    COPY --from=builder /app/package.json /app/package-lock.json ./
    
    # Install only production dependencies to keep the image small
    RUN npm ci --omit-dev
    
    # Copy the built application code from the builder stage
    COPY --from=builder /app/dist ./dist
    
    # Copy the pre-downloaded Camoufox browser from the builder's cache to our new user's cache.
    # The --chown flag is critical to ensure the new user has permission to access these files.
    COPY --from=builder --chown=myappuser:myappuser /root/.cache/camoufox /home/myappuser/.cache/camoufox
    
    # Expose the port your application listens on (if any).
    # If you are not running a web server, you can remove this line.
    # EXPOSE 3000
    
    # The command to start the application.
    # `xvfb-run` robustly manages the virtual display for Camoufox.
    # It starts Xvfb, sets the DISPLAY env var, and then runs your Node.js app.
    # The '-a' flag automatically finds a free server number.
    ENTRYPOINT ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "node", "dist/index.js"]