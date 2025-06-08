#!/bin/bash
set -e

DOCKER_REPO="followthewhit3rabbit/camoufox-mcp"
CAMOUFOX_VERSION="v135.0.1-beta.24"

echo "🚀 Building multi-architecture Camoufox MCP Server"
echo "Repository: $DOCKER_REPO"
echo "Version: $CAMOUFOX_VERSION"
echo

# Check if buildx is available
if ! docker buildx version >/dev/null 2>&1; then
    echo "❌ Docker Buildx not available. Please install Docker Desktop or enable buildx."
    exit 1
fi

# Create builder if it doesn't exist
if ! docker buildx ls | grep -q "multiarch"; then
    echo "📦 Creating multi-architecture builder..."
    docker buildx create --name multiarch --use --bootstrap
else
    echo "📦 Using existing multi-architecture builder..."
    docker buildx use multiarch
fi

# Login to Docker Hub
echo "🔑 Please login to Docker Hub:"
docker login

# Build and push for both architectures
echo "🔨 Building for linux/amd64 and linux/arm64..."
echo "This will take several minutes as it builds for both architectures..."

docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t "$DOCKER_REPO:$CAMOUFOX_VERSION" \
    -t "$DOCKER_REPO:latest" \
    --push \
    .

echo
echo "🎉 Successfully published multi-architecture images!"
echo "  ✅ $DOCKER_REPO:$CAMOUFOX_VERSION"
echo "  ✅ $DOCKER_REPO:latest"
echo
echo "Users can now run:"
echo "  docker pull $DOCKER_REPO:latest"
echo "  (Docker will automatically select the right architecture)"

# Show what we built
echo
echo "📋 Image details:"
docker buildx imagetools inspect "$DOCKER_REPO:latest"