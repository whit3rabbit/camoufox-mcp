#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE_NAME="camoufox-mcp-server:latest"
DOCKER_PLATFORM="${DOCKER_PLATFORM:-linux/amd64}"

echo "Building Docker image: ${IMAGE_NAME}"
DOCKER_BUILDKIT=1 docker build --platform "${DOCKER_PLATFORM}" -t "${IMAGE_NAME}" .

echo "Running Docker MCP tests..."
PYTHONDONTWRITEBYTECODE=1 python3 tests/test_client.py --mode docker --image-name "${IMAGE_NAME}" --docker-platform "${DOCKER_PLATFORM}"

echo "All Docker tests passed!"
