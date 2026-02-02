#!/bin/bash
# God-Agent Update Script
# Usage: bash scripts/update.sh
# Pulls latest from git, rebuilds, preserves data/

set -e

cd "$(dirname "$0")/.."

echo "=== God-Agent Update ==="
echo "Directory: $(pwd)"

# Pull latest
echo "Pulling latest..."
git pull origin main

# Install dependencies
echo "Installing dependencies..."
npm install --production

# Build
echo "Building..."
npm run build

# Copy schema if needed
cp src/storage/schema.sql dist/storage/ 2>/dev/null || true

echo "=== Update complete ==="
echo "Restart MCP server to apply changes."
