# Multi-Project CLI Usage Guide

## Overview

This guide covers **everything you need to know** about using God-Agent with multiple projects via the CLI, from basic operations to advanced workflows.

---

## Table of Contents

1. [Initial Setup](#initial-setup)
2. [Configuration](#configuration)
3. [Basic Operations](#basic-operations)
4. [Project Management](#project-management)
5. [Task Execution](#task-execution)
6. [Memory and Context](#memory-and-context)
7. [Cross-Project Workflows](#cross-project-workflows)
8. [CLI Commands Reference](#cli-commands-reference)
9. [Troubleshooting](#troubleshooting)

---

## Initial Setup

### Step 1: Build God-Agent

Ensure God-Agent is built with the latest multi-project support:

```bash
# Navigate to rubix-protocol directory
cd D:\rubix-protocol

# Install dependencies (if not already done)
npm install

# Build the project
npm run build

# Verify build succeeded
ls dist/mcp-server.js
# Should show: dist/mcp-server.js
```

### Step 2: Verify Prerequisites

Check that all prerequisites are met:

```bash
# Check Node.js version (14+ required)
node --version
# Should show: v14.x.x or higher

# Verify API keys are set
echo $OPENAI_API_KEY      # Unix/Linux/macOS
echo %OPENAI_API_KEY%     # Windows CMD
echo $env:OPENAI_API_KEY  # Windows PowerShell

# Verify Claude Code is installed
claude --version
# Should show Claude Code CLI version
```

### Step 3: Identify Your Projects

List the projects you want to work with:

```bash
# Example project structure
D:\projects\
├── backend-api\          # Backend API (Express + TypeScript)
├── web-frontend\         # Frontend (React + TypeScript)
├── mobile-app\           # Mobile (React Native)
├── infrastructure\       # Infrastructure (Terraform)
└── documentation\        # Docs (MkDocs)
```

---

## Configuration

### Method 1: Interactive Configuration (Recommended)

The easiest way to set up multiple projects:

```bash
cd D:\rubix-protocol

# Run interactive configuration helper
node scripts/configure-projects.js
```

**Interactive Prompts:**

```
╔════════════════════════════════════════════════════╗
║  God-Agent Multi-Project Configuration Helper     ║
╚════════════════════════════════════════════════════╝

How many projects do you want to configure? (1-10): 3

─────────────────────────────────────────────────────
Project 1 of 3:
─────────────────────────────────────────────────────
  Project Path (absolute path): D:\projects\backend-api
  Project Name [backend-api]: Backend API
  Project ID (used in tool names) [backend-api]: backend-api
  Description (optional): Express.js REST API with PostgreSQL

  ✅ Project "Backend API" (backend-api) configured

─────────────────────────────────────────────────────
Project 2 of 3:
─────────────────────────────────────────────────────
  Project Path (absolute path): D:\projects\web-frontend
  Project Name [web-frontend]: Web Frontend
  Project ID (used in tool names) [web-frontend]: frontend
  Description (optional): React SPA with TypeScript

  ✅ Project "Web Frontend" (frontend) configured

─────────────────────────────────────────────────────
Project 3 of 3:
─────────────────────────────────────────────────────
  Project Path (absolute path): D:\projects\mobile-app
  Project Name [mobile-app]: Mobile App
  Project ID (used in tool names) [mobile-app]: mobile
  Description (optional): React Native iOS/Android app

  ✅ Project "Mobile App" (mobile) configured

─────────────────────────────────────────────────────
Summary:
─────────────────────────────────────────────────────
1. Backend API (backend-api)
   Path: D:\projects\backend-api
   Description: Express.js REST API with PostgreSQL

2. Web Frontend (frontend)
   Path: D:\projects\web-frontend
   Description: React SPA with TypeScript

3. Mobile App (mobile)
   Path: D:\projects\mobile-app
   Description: React Native iOS/Android app

Generate configuration? (yes/no) [yes]: yes

📝 Generating configuration...
  ℹ️  Backed up existing config to: mcp.json.backup.1706234567890
  ✅ Configuration written to: D:\rubix-protocol\.claude\mcp.json

📁 Creating data directories...
  ✅ Created: data/projects/backend-api
  ✅ Created: data/projects/frontend
  ✅ Created: data/projects/mobile

╔════════════════════════════════════════════════════╗
║  Configuration Complete!                           ║
╚════════════════════════════════════════════════════╝

Next steps:

1. 🔄 Restart Claude Code to load the new configuration

2. 🎯 Your projects will be available as:

   Backend API:
     mcp__rubix_backend_api__god_codex_do
     mcp__rubix_backend_api__god_query
     mcp__rubix_backend_api__* (all tools)

   Web Frontend:
     mcp__rubix_frontend__god_codex_do
     mcp__rubix_frontend__god_query
     mcp__rubix_frontend__* (all tools)

   Mobile App:
     mcp__rubix_mobile__god_codex_do
     mcp__rubix_mobile__god_query
     mcp__rubix_mobile__* (all tools)

3. 📖 See CLAUDE.md for usage examples

Example usage:

```typescript
// Work on Backend API
mcp__rubix_backend_api__god_codex_do({
  task: "Add a new feature"
});
```
```

### Method 2: Manual Configuration

If you prefer manual configuration:

1. **Create `.claude/mcp.json`:**

```bash
# Create .claude directory if it doesn't exist
mkdir -p .claude

# Create mcp.json
nano .claude/mcp.json
```

2. **Add configuration:**

```json
{
  "mcpServers": {
    "rubix-backend-api": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/backend-api",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API"
      }
    },
    "rubix-frontend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/frontend",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\web-frontend",
        "RUBIX_PROJECT_NAME": "Web Frontend"
      }
    },
    "rubix-mobile": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/mobile",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\mobile-app",
        "RUBIX_PROJECT_NAME": "Mobile App"
      }
    }
  }
}
```

3. **Create data directories:**

```bash
# Unix/Linux/macOS
bash scripts/setup-project-dirs.sh backend-api frontend mobile

# Windows PowerShell
.\scripts\setup-project-dirs.ps1 backend-api frontend mobile

# Or manually
mkdir -p data/projects/backend-api
mkdir -p data/projects/frontend
mkdir -p data/projects/mobile
```

### Step 4: Restart Claude Code

!!! warning "Critical Step"
    Changes to `.claude/mcp.json` only take effect after restarting Claude Code.

```bash
# Close Claude Code completely
# Then reopen it

# In new session, verify instances loaded by checking available tools
```

---

## Basic Operations

### Identifying Available Instances

When Claude Code starts, check what instances are available:

```typescript
// List available MCP tools
// Look for patterns like: mcp__rubix_{project-id}__god_{tool-name}

// Examples:
// mcp__rubix_backend_api__god_query
// mcp__rubix_frontend__god_codex_do
// mcp__rubix_mobile__god_store
```

### Querying Project Information

Get information about a project's current state:

```typescript
// Query backend project context
const backendInfo = mcp__rubix_backend_api__god_query({
  query: "What is this project? What's the tech stack and structure?",
  topK: 10
});

console.log(backendInfo);
// Returns:
// {
//   "success": true,
//   "results": [
//     {
//       "content": "ACTIVE PROJECT: Backend API\n\n**Working Directory**: D:\\projects\\backend-api\n...",
//       "similarity": 1.0,
//       "metadata": { "tags": ["project_context", "always_recall"] }
//     },
//     // ... more results
//   ]
// }
```

### Viewing Project Context

Every project instance has high-priority context stored automatically:

```typescript
// Query project-specific context
const context = mcp__rubix_backend_api__god_query({
  query: "project context configuration",
  filters: {
    tags: ["project_context"]
  },
  topK: 5
});

// Shows:
// - Project name and root directory
// - Data directory location
// - Instance ID
// - Containment rules
```

---

## Project Management

### Adding a New Project

**Option 1: Re-run configuration helper**

```bash
cd D:\rubix-protocol
node scripts/configure-projects.js
```

Enter all projects (including existing ones) again.

**Option 2: Manual addition**

1. Edit `.claude/mcp.json`:

```json
{
  "mcpServers": {
    // ... existing instances ...
    "rubix-docs": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "RUBIX_DATA_DIR": "./data/projects/docs",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\documentation",
        "RUBIX_PROJECT_NAME": "Documentation"
      }
    }
  }
}
```

2. Create data directory:

```bash
mkdir -p data/projects/docs
```

3. Restart Claude Code

### Removing a Project

1. Edit `.claude/mcp.json` and remove the instance
2. Optionally delete data directory:

```bash
rm -rf data/projects/{project-id}
```

3. Restart Claude Code

### Temporarily Disabling a Project

Comment out the instance in `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "rubix-backend-api": { ... },
    // "rubix-frontend": { ... },  // Temporarily disabled
    "rubix-mobile": { ... }
  }
}
```

Restart Claude Code to apply changes.

---

## Task Execution

### Simple Task Execution

Execute a task on a specific project:

```typescript
// Add authentication to backend
const result = mcp__rubix_backend_api__god_codex_do({
  task: "Add JWT authentication middleware to Express routes. Create middleware that validates JWT tokens and attaches user info to request object."
});

// Monitor status
const status = mcp__rubix_backend_api__god_codex_status({
  taskId: result.taskId
});

console.log(status);
// {
//   "taskId": "task-123",
//   "status": "in_progress",
//   "phase": "P3:ENGINEER",
//   "progress": 0.6
// }
```

### Parallel Task Execution

Execute tasks on multiple projects simultaneously:

```typescript
// Start backend task
const backendTask = mcp__rubix_backend_api__god_codex_do({
  task: "Add GET /api/users/:id endpoint with authentication"
});

// Start frontend task (runs in parallel!)
const frontendTask = mcp__rubix_frontend__god_codex_do({
  task: "Create UserProfile component with data fetching"
});

// Start mobile task (also in parallel!)
const mobileTask = mcp__rubix_mobile__god_codex_do({
  task: "Add UserProfileScreen with navigation"
});

// Wait for all to complete
// (Poll each instance's god_codex_status until all are 'completed')
```

### Monitoring Task Progress

```typescript
// Backend task status
const backendStatus = mcp__rubix_backend_api__god_codex_status({
  taskId: backendTask.taskId
});

// Frontend task status
const frontendStatus = mcp__rubix_frontend__god_codex_status({
  taskId: frontendTask.taskId
});

// Mobile task status
const mobileStatus = mcp__rubix_mobile__god_codex_status({
  taskId: mobileTask.taskId
});
```

### Viewing Task Logs

```typescript
// Get backend task logs
const logs = mcp__rubix_backend_api__god_codex_logs({
  taskId: backendTask.taskId,
  limit: 50
});

console.log(logs);
// [
//   { timestamp: "...", level: "info", message: "Starting P1:CONTEXT_SCOUT..." },
//   { timestamp: "...", level: "info", message: "P2:ARCHITECT complete" },
//   // ... more logs
// ]
```

### Canceling Tasks

```typescript
// Cancel backend task
mcp__rubix_backend_api__god_codex_cancel({
  taskId: backendTask.taskId,
  reason: "Requirements changed"
});
```

---

## Memory and Context

### Storing Project Information

Store important context for a project:

```typescript
// Store backend architecture decisions
mcp__rubix_backend_api__god_store({
  content: `Architecture Decisions:

**Framework**: Express.js v4.18 with TypeScript
**Database**: PostgreSQL 15 with Prisma ORM
**Authentication**: JWT with RS256 signing
**API Style**: RESTful with OpenAPI 3.0 spec
**Testing**: Jest + Supertest
**Code Style**: Airbnb ESLint + Prettier

**Project Structure**:
- src/routes/ - API route handlers
- src/middleware/ - Express middleware
- src/services/ - Business logic
- src/models/ - Database models (Prisma)
- src/utils/ - Utility functions
- tests/ - Integration and unit tests`,
  tags: ['architecture', 'project_config', 'always_recall'],
  importance: 1.0
});
```

### Querying Context

```typescript
// Query backend architecture
const arch = mcp__rubix_backend_api__god_query({
  query: "What's the backend architecture and project structure?",
  topK: 10
});

// Query frontend patterns
const patterns = mcp__rubix_frontend__god_query({
  query: "What React patterns and state management are we using?",
  topK: 10
});
```

### Storing Cross-Project Information

Store information relevant to multiple projects:

```typescript
// Store API contract in backend
mcp__rubix_backend_api__god_store({
  content: `API Contract: User Authentication

**Endpoint**: POST /api/auth/login
**Request**:
{
  "email": "user@example.com",
  "password": "securepassword"
}

**Response** (200 OK):
{
  "token": "eyJhbGciOiJSUzI1NiIs...",
  "user": {
    "id": "user-123",
    "email": "user@example.com",
    "name": "John Doe",
    "role": "user"
  }
}

**Error Responses**:
- 401: Invalid credentials
- 400: Validation error
- 429: Too many requests`,
  tags: ['api_contract', 'authentication', 'always_recall'],
  importance: 0.9
});

// Reference the same contract in frontend
mcp__rubix_frontend__god_store({
  content: `Frontend Auth Flow:

Uses API: POST /api/auth/login
Request: { email, password }
Response: { token, user }

Store token in localStorage
Attach to requests via Authorization header
Redirect to /dashboard on success`,
  tags: ['authentication', 'api_usage'],
  importance: 0.8
});
```

---

## Cross-Project Workflows

### Full-Stack Feature Implementation

Implement a feature that spans backend, frontend, and mobile:

```typescript
// Step 1: Define the feature contract
const contract = `
Feature: User Profile Management

**Backend API**:
- GET /api/users/:id - Get user profile
- PUT /api/users/:id - Update user profile
- Response: { id, email, name, avatar, bio, createdAt }

**Frontend**:
- UserProfile component
- ProfileEdit component
- API integration with react-query

**Mobile**:
- UserProfileScreen
- ProfileEditScreen
- API integration with AsyncStorage cache
`;

// Step 2: Implement backend (starts first)
const backendTask = mcp__rubix_backend_api__god_codex_do({
  task: `Implement user profile API endpoints:\n${contract}`
});

// Step 3: Implement frontend (parallel)
const frontendTask = mcp__rubix_frontend__god_codex_do({
  task: `Implement user profile components:\n${contract}`
});

// Step 4: Implement mobile (parallel)
const mobileTask = mcp__rubix_mobile__god_codex_do({
  task: `Implement user profile screens:\n${contract}`
});

// Step 5: Monitor progress
// (Poll each instance until all complete)
```

### Syncing Configuration Across Projects

Keep configuration synchronized:

```typescript
// Step 1: Store environment config in backend
mcp__rubix_backend_api__god_store({
  content: `Environment Variables:
- API_URL=https://api.example.com
- WS_URL=wss://api.example.com
- CDN_URL=https://cdn.example.com`,
  tags: ['config', 'environment'],
  importance: 0.9
});

// Step 2: Query and use in frontend
const config = mcp__rubix_backend_api__god_query({
  query: "environment variables configuration",
  topK: 3
});

// Step 3: Configure frontend
mcp__rubix_frontend__god_codex_do({
  task: `Update .env with:\n${config.results[0].content}`
});

// Step 4: Configure mobile
mcp__rubix_mobile__god_codex_do({
  task: `Update config.ts with:\n${config.results[0].content}`
});
```

---

## CLI Commands Reference

### Configuration Commands

```bash
# Interactive configuration
node scripts/configure-projects.js

# Setup data directories
bash scripts/setup-project-dirs.sh [project-ids...]    # Unix
.\scripts\setup-project-dirs.ps1 [project-ids...]      # Windows

# View current configuration
cat .claude/mcp.json          # Unix
type .claude\mcp.json         # Windows

# Backup configuration
cp .claude/mcp.json .claude/mcp.json.backup
```

### Build Commands

```bash
# Full build
npm run build

# Watch mode (for development)
npm run build -- --watch

# Clean build
npm run clean
npm run build
```

### Verification Commands

```bash
# Check built files
ls dist/mcp-server.js

# Verify data directories
ls -la data/projects/

# Check configuration syntax
cat .claude/mcp.json | jq .    # Requires jq

# Test MCP server directly (debugging)
node dist/mcp-server.js
```

### Data Management

```bash
# List all project data directories
ls -la data/projects/

# View specific project data
ls -la data/projects/backend-api/

# Clear project data (reset memory)
rm -rf data/projects/backend-api/*

# Backup project data
tar -czf backup-backend-api.tar.gz data/projects/backend-api/

# Restore project data
tar -xzf backup-backend-api.tar.gz
```

---

## Troubleshooting

### Instance Not Loading

**Problem**: Tools not appearing after restart

**Debug Steps**:

```bash
# 1. Check .claude/mcp.json exists
ls -la .claude/mcp.json

# 2. Validate JSON syntax
cat .claude/mcp.json | jq .

# 3. Verify paths
cat .claude/mcp.json | jq '.mcpServers[].cwd'
# Should show rubix-protocol directory path

# 4. Check dist/mcp-server.js exists
ls -la dist/mcp-server.js

# 5. Restart Claude Code completely
```

**Solutions**:

1. Fix JSON syntax errors
2. Update `cwd` to correct path
3. Run `npm run build` if dist files missing
4. Fully restart Claude Code (quit and reopen)

### Path Resolution Issues

**Problem**: "Path does not exist" errors

**Debug Steps**:

```bash
# Verify project path exists
test -d "D:\projects\backend-api" && echo "exists" || echo "not found"

# Check permissions
ls -ld "D:\projects\backend-api"
# Should be readable

# Verify absolute path
realpath "D:\projects\backend-api"
```

**Solutions**:

1. Use absolute paths (not relative)
2. Fix path separators (Windows: `\\`, Unix: `/`)
3. Verify path exists before configuring
4. Check read permissions

### Memory Issues

**Problem**: Out of memory or slow performance

**Debug Steps**:

```bash
# Check number of configured instances
cat .claude/mcp.json | jq '.mcpServers | length'

# Monitor memory usage
# Unix/Linux
ps aux | grep "mcp-server"

# Windows
tasklist | findstr "node"
```

**Solutions**:

1. Reduce configured instances (keep 2-5 active)
2. Remove unused instances from config
3. Restart Claude Code to free memory
4. Close other memory-intensive applications

### Cross-Contamination

**Problem**: Getting results from wrong project

**Debug Steps**:

```bash
# Verify each instance has unique data directory
cat .claude/mcp.json | jq '.mcpServers[].env.RUBIX_DATA_DIR'

# Check data directories are separate
ls -la data/projects/
```

**Solutions**:

1. Ensure each instance has unique `RUBIX_DATA_DIR`
2. Clear all data and reconfigure:
   ```bash
   rm -rf data/projects/*
   node scripts/configure-projects.js
   ```
3. Restart Claude Code

---

## Advanced Usage

### Environment-Specific Instances

Configure separate instances for dev/staging/prod:

```json
{
  "mcpServers": {
    "rubix-backend-dev": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/backend-dev",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API (Dev)"
      }
    },
    "rubix-backend-staging": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/backend-staging",
        "RUBIX_PROJECT_ROOT": "D:\\projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API (Staging)"
      }
    }
  }
}
```

### Monorepo Support

Configure instances for monorepo packages:

```json
{
  "mcpServers": {
    "rubix-packages-core": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\packages\\core"
      }
    },
    "rubix-packages-ui": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\packages\\ui"
      }
    },
    "rubix-apps-web": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\apps\\web"
      }
    }
  }
}
```

---

## Next Steps

- [Troubleshooting Guide](./multi-project-troubleshooting.md) - Detailed troubleshooting
- [Manual Configuration](./multi-project-manual-config.md) - Manual setup details
- [Advanced Features](./multi-project-advanced.md) - Advanced patterns
- [Examples](../examples/multi-project-examples.md) - Real-world examples

---

## Quick Reference Card

```bash
# Setup
node scripts/configure-projects.js     # Interactive config
npm run build                          # Build
# Restart Claude Code                   # Apply changes

# Verify
cat .claude/mcp.json                   # View config
ls data/projects/                      # Check data dirs

# Usage Pattern
mcp__rubix_{project-id}__god_{tool}    # Tool naming

# Common Tools
god_codex_do      # Execute task
god_query         # Query memory
god_store         # Store context
god_codex_status  # Check task status
god_codex_logs    # View logs

# Troubleshooting
npm run build                          # Rebuild
rm -rf data/projects/*                 # Clear data
jq . .claude/mcp.json                  # Validate JSON
```
