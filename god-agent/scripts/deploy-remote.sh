#!/bin/bash
# God-Agent Remote Deploy
# Usage: bash scripts/deploy-remote.sh user@host /path/to/god-agent
#
# SSH into remote server, pull latest, rebuild.
# Assumes god-agent repo is already cloned at the given path.

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: bash scripts/deploy-remote.sh user@host /path/to/god-agent"
  exit 1
fi

HOST="$1"
REMOTE_PATH="$2"

echo "=== Deploying to ${HOST}:${REMOTE_PATH} ==="
ssh "$HOST" "cd ${REMOTE_PATH} && git pull origin main && npm install --production && npm run build && cp src/storage/schema.sql dist/storage/ 2>/dev/null; echo '=== Deploy complete ==='"
