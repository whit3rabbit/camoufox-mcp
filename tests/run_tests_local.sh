#!/bin/bash

set -euo pipefail

cd "$(dirname "$0")/.."

echo "Running all local tests..."
npm run test:local

echo "All local tests passed!"
