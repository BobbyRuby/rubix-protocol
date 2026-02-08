#!/bin/bash
# God-Agent Update Script
# Usage: bash scripts/update.sh
# Pulls latest from git, rebuilds, preserves data/
#
# Works whether god-agent is the repo root or a subdirectory.

set -e

# Navigate to god-agent directory (one level up from scripts/)
GOD_AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$GOD_AGENT_DIR"

echo "=== God-Agent Update ==="
echo "Directory: $GOD_AGENT_DIR"

# Find git root (may be god-agent itself or a parent like rubix-protocol)
GIT_ROOT="$(git rev-parse --show-toplevel)"

# Pull at the git root
echo "Pulling latest (git root: $GIT_ROOT)..."
cd "$GIT_ROOT"
git pull origin main

# Return to god-agent dir for build
cd "$GOD_AGENT_DIR"

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
