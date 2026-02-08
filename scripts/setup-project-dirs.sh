#!/bin/bash
#
# Setup Project Data Directories
#
# Creates data directories for each project instance defined in .claude/mcp.json
# Each directory will contain:
#   - god-agent.db (SQLite database)
#   - embeddings/ (HNSW vector indexes)
#   - containment.json (project-specific rules)
#

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  God-Agent Project Directories Setup  ${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Get the script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GOD_AGENT_ROOT="$(dirname "$SCRIPT_DIR")"
DATA_ROOT="$GOD_AGENT_ROOT/data/projects"

# Default projects (if no arguments provided)
DEFAULT_PROJECTS=("backend-api" "frontend" "mobile" "infra" "docs")

# Use provided projects or defaults
if [ $# -eq 0 ]; then
  echo -e "${YELLOW}No projects specified, using defaults:${NC}"
  PROJECTS=("${DEFAULT_PROJECTS[@]}")
else
  PROJECTS=("$@")
fi

echo "Creating directories for projects:"
for project in "${PROJECTS[@]}"; do
  echo "  • $project"
done
echo ""

# Create directories
for project in "${PROJECTS[@]}"; do
  project_dir="$DATA_ROOT/$project"

  if [ -d "$project_dir" ]; then
    echo -e "${YELLOW}⚠️  Directory already exists: $project_dir${NC}"
  else
    mkdir -p "$project_dir"
    echo -e "${GREEN}✅ Created: data/projects/$project${NC}"
  fi
done

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Project directories ready!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Each directory will be populated on first use with:"
echo "  • god-agent.db (SQLite database)"
echo "  • embeddings/ (HNSW vector indexes)"
echo "  • containment.json (project-specific rules)"
echo ""
echo "Next steps:"
echo "  1. Configure .claude/mcp.json (or use scripts/configure-projects.js)"
echo "  2. Restart Claude Code"
echo "  3. Start using your project instances!"
echo ""
