#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

#echo "Installing dependencies..."
#npm install -y

echo "Fetching Camoufox browser..."
# Use npx to run the fetch command from the camoufox-js package
npx camoufox fetch

echo "Building the server..."
npm run build

echo "Running local tests..."
python3 test_client.py --mode local

echo "All local tests passed!"