# Force AMD64 platform even on ARM64 hosts
FROM --platform=linux/amd64 node:20-bullseye AS builder

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    build-essential \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (will use AMD64 binaries)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Install camoufox globally (AMD64 version)
RUN npm install -g camoufox@0.1.2

# Fetch the browser (AMD64 version)
RUN camoufox fetch

# Runtime stage - also forced to AMD64
FROM --platform=linux/amd64 node:20-bullseye-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb xauth \
    libgtk-3-0 libx11-xcb1 libxfixes3 libxrandr2 libxtst6 libx11-6 libxcomposite1 \
    libasound2 libdbus-glib-1-2 libpci3 libxss1 libgconf-2-4 libnss3 libatk1.0-0 \
    libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libatspi2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1001 myappuser
USER myappuser
WORKDIR /home/myappuser/app

COPY --from=builder /app/package.json /app/package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder --chown=myappuser:myappuser /app/dist ./dist
COPY --from=builder --chown=myappuser:myappuser /root/.cache/camoufox /home/myappuser/.cache/camoufox

ENTRYPOINT ["xvfb-run", "-a", "--server-args=-screen 0 1280x1024x24", "node", "dist/index.js"]