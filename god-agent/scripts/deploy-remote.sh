#!/bin/bash
# God-Agent Remote Deploy
# Usage: bash scripts/deploy-remote.sh user@host /path/to/god-agent [-i keypath]
#
# SSH into remote server, pull latest, rebuild.
# Assumes god-agent repo is already cloned at the given path.
#
# Options:
#   -i keypath    Path to SSH private key (optional)

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: bash scripts/deploy-remote.sh user@host /path/to/god-agent [-i keypath]"
  exit 1
fi

HOST="$1"
REMOTE_PATH="$2"
SSH_OPTS=""

# Check for optional -i keypath argument
KEY=""
if [ "$3" = "-i" ] && [ -n "$4" ]; then
  KEY="$4"
  SSH_OPTS="-i $KEY"
fi

# If key specified, ensure it's in ssh-agent (handles passphrase-protected keys)
if [ -n "$KEY" ]; then
  # Get key fingerprint
  KEY_FP=$(ssh-keygen -lf "$KEY" 2>/dev/null | awk '{print $2}')

  if [ -n "$KEY_FP" ]; then
    # Check if already in agent
    if ! ssh-add -l 2>/dev/null | grep -q "$KEY_FP"; then
      echo "Adding SSH key to agent..."
      ssh-add "$KEY"
    fi
  fi
fi

echo "=== Deploying to ${HOST}:${REMOTE_PATH} ==="
# Find git root on remote (handles god-agent as repo root or subdirectory),
# pull at root, then build from god-agent directory.
ssh $SSH_OPTS "$HOST" bash -c "'
  set -e
  cd ${REMOTE_PATH}
  GIT_ROOT=\$(git rev-parse --show-toplevel)
  echo \"Git root: \$GIT_ROOT\"
  cd \"\$GIT_ROOT\"
  git pull origin main
  cd ${REMOTE_PATH}
  npm install --production
  npm run build
  cp src/storage/schema.sql dist/storage/ 2>/dev/null || true
  echo \"=== Deploy complete ===\"
'"
