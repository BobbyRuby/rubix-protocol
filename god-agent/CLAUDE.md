# God-Agent Architecture

## Communication Protocol (MANDATORY)

**ALL questions, clarifications, and user interactions MUST go through Telegram via `god_comms_escalate`.**

This is NON-NEGOTIABLE. Do NOT:
- Use AskUserQuestion tool
- Ask questions in text responses
- Wait for user input via CLI

The user monitors Telegram exclusively. Use `god_comms_escalate` for:
- Decisions and approvals
- Clarifications and questions
- Blocked/stuck situations
- Progress updates requiring response

```typescript
// REQUIRED mechanism for user communication
mcp__rubix__god_comms_escalate({
  title: "Question Title",
  message: "Your question here",
  type: "decision",  // decision | clarification | blocked | approval | info
  options: [{ label: "Option A", description: "..." }, ...]
});
```

**This tool must always be allowed in permissions.**

---

## Overview

God-Agent is a **standalone autonomous agent system** - NOT just an MCP server. It has THREE deployment modes:

1. **MCP Server Mode** - Claude Code integration via Model Context Protocol
2. **CLI Mode** - Direct command-line interface
3. **Standalone Service Mode** - Background daemon with Telegram/HTTP interfaces

> "Give it a task. It does the work. Bothers you only when necessary."

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      INTERFACE LAYER                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   MCP Server          CLI              Telegram Bot    HTTP Server  │
│   (mcp-server.ts)     (cli/)           (telegram/)     (webhooks)   │
│        │                │                   │              │        │
│        └────────────────┴───────────────────┴──────────────┘        │
│                                    │                                │
├────────────────────────────────────┼────────────────────────────────┤
│                      CORE SYSTEMS  │                                │
├────────────────────────────────────┼────────────────────────────────┤
│                                    ▼                                │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │                    CODEX (TaskExecutor)                 │       │
│   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐│       │
│   │  │TaskDecomposer│ │CodeGenerator │ │   SelfHealer     ││       │
│   │  └──────────────┘ └──────────────┘ └──────────────────┘│       │
│   │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐│       │
│   │  │EscalationGate│ │  Learning    │ │ CausalDebugger   ││       │
│   │  └──────────────┘ └──────────────┘ └──────────────────┘│       │
│   └─────────────────────────────────────────────────────────┘       │
│                                    │                                │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │                    MemoryEngine                         │       │
│   │  ┌────────────┐ ┌────────────┐ ┌────────────┐          │       │
│   │  │ VectorDB   │ │ Provenance │ │  Causal    │          │       │
│   │  │  (HNSW)    │ │ (L-Score)  │ │ Hypergraph │          │       │
│   │  └────────────┘ └────────────┘ └────────────┘          │       │
│   │  ┌────────────┐ ┌────────────┐ ┌────────────┐          │       │
│   │  │   Sona     │ │TinyDancer  │ │    GNN     │          │       │
│   │  │ (Learning) │ │ (Routing)  │ │(Enhancement│          │       │
│   │  └────────────┘ └────────────┘ └────────────┘          │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │              Communication & Notification               │       │
│   │  ┌──────────────────────────────────────────────────┐  │       │
│   │  │ Fallback Chain: Telegram→Phone→SMS→Slack→Discord │  │       │
│   │  └──────────────────────────────────────────────────┘  │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                     │
│   ┌─────────────────────────────────────────────────────────┐       │
│   │                  Capabilities (10)                      │       │
│   │  LSP | Git | AST | Profiler | Debug | Playwright | etc  │       │
│   └─────────────────────────────────────────────────────────┘       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure (32+ subsystems)

```
src/
├── mcp-server.ts           # MCP protocol entry point (50+ tools)
├── index.ts                # Main exports
│
├── core/                   # Core memory system
│   ├── MemoryEngine.ts     # Unified API facade
│   ├── config.ts           # Configuration loading
│   └── types.ts            # Core type definitions
│
├── codex/                  # Autonomous developer agent (CORE)
│   ├── TaskExecutor.ts     # Main orchestrator (~1800 lines)
│   ├── TaskDecomposer.ts   # Breaks tasks into subtasks
│   ├── CodeGenerator.ts    # Claude API integration
│   ├── SelfHealer.ts       # Failure analysis & recovery
│   ├── EscalationGate.ts   # Human escalation logic
│   ├── LearningIntegration.ts
│   ├── AlternativesFinder.ts
│   ├── CausalDebugger.ts
│   └── types.ts
│
├── cli/                    # Command-line interface
│   ├── index.ts
│   └── commands/           # init, store, query, trace, etc.
│
├── telegram/               # Telegram bot - CAN TRIGGER CODEX
│   ├── TelegramBot.ts      # Bot instance
│   ├── TelegramHandler.ts  # /task command → TaskExecutor
│   └── types.ts
│
├── communication/          # Multi-channel escalation
│   ├── CommunicationManager.ts  # Orchestrates fallback chain
│   ├── channels/           # Phone, SMS, Slack, Discord, Email, Telegram
│   └── server/             # Webhook server (:3456)
│
├── notification/           # Notification system
│   ├── NotificationService.ts
│   ├── SlackNotifier.ts
│   └── DiscordNotifier.ts
│
├── deepwork/               # Focus mode management
│   └── DeepWorkManager.ts
│
├── scheduler/              # Background daemon
│   └── SchedulerDaemon.ts  # Cron, event, file triggers
│
├── capabilities/           # IDE-like powers (10 capabilities)
│   └── CapabilitiesManager.ts
│
├── playwright/             # Browser automation
│   ├── PlaywrightManager.ts
│   └── VerificationService.ts
│
├── learning/               # Sona continuous learning
│   └── SonaEngine.ts       # Trajectory-based, EWC++ regularization
│
├── routing/                # Query routing
│   └── TinyDancer.ts       # Neural router with circuit breakers
│
├── provenance/             # L-Score reliability tracking
│   └── LScoreCalculator.ts
│
├── causal/                 # Hypergraph reasoning (n→m relations)
│   └── CausalMemory.ts
│
├── gnn/                    # Graph neural network enhancement
│   └── EnhancementLayer.ts
│
├── adversarial/            # Shadow search (contradiction finding)
│   └── ShadowSearch.ts
│
├── failure/                # Failure learning
│   └── FailureMemoryService.ts
│
├── review/                 # Code review
│   └── CodeReviewer.ts
│
├── storage/                # SQLite persistence
│   └── SQLiteStorage.ts
│
└── vector/                 # HNSW vector database (768-dim)
    └── VectorDB.ts
```

---

## Entry Points

### 1. MCP Server (Claude Code integration)
```bash
node dist/mcp-server.js
# Configured in .claude/mcp.json
```

### 2. CLI (Direct commands)
```bash
god-agent init              # Initialize database
god-agent query "search"    # Query memory
god-agent store "content"   # Store to memory
god-agent trace <id>        # Trace provenance
god-agent stats             # Memory statistics
```

### 3. Telegram Bot (Standalone - CAN TRIGGER CODEX)
```typescript
// Users can send: /task Build a calculator
const bot = new TelegramBot(config, taskExecutor);
bot.start();  // Independent of MCP
```

### 4. Scheduler Daemon (Background service)
```typescript
const daemon = new SchedulerDaemon(engine);
daemon.start();  // Runs cron jobs, file watchers, event triggers
```

---

## RUBIX Department Head System (NEW)

```
                    ┌─────────────────┐
                    │     CLAUDE      │
                    │  (Head of Ops)  │
                    └────────┬────────┘
                             │
        ┌────────┬───────────┼───────────┬────────┐
        ▼        ▼           ▼           ▼        ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
   │RESEARCHER│ │ARCHITECT│ │ENGINEER │ │VALIDATOR│ │GUARDIAN │
   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘
        │           │           │           │           │
     ┌──┴──┐     ┌──┴──┐     ┌──┴──┐     ┌──┴──┐     ┌──┴──┐
     │█ █ █│     │█ █ █│     │█ █ █│     │█ █ █│     │█ █ █│
     └─────┘     └─────┘     └─────┘     └─────┘     └─────┘
    Sub-agents  Sub-agents  Sub-agents  Sub-agents  Sub-agents
```

### The 5 Departments

| Department | Role | Responsibilities |
|------------|------|------------------|
| **RESEARCHER** | VP of Discovery | Codebase analysis, pattern detection, dependency mapping |
| **ARCHITECT** | VP of Design | Solution structure, interfaces, data models |
| **ENGINEER** | VP of Implementation | Code writing, component building (highest parallelism) |
| **VALIDATOR** | VP of Quality | Unit tests, integration tests, edge cases |
| **GUARDIAN** | VP of Reliability | Security scanning, performance, code review |

### Enable RUBIX Mode

```typescript
// In TaskExecutor
executor.enableRubixMode({
  model: 'claude-sonnet-4-20250514',
  maxSubAgentsPerDepartment: 5,
  codebaseRoot: process.cwd()
});
```

### RUBIX Execution Flow

```
User submits task
    │
    ▼
RubixOrchestrator.execute()
    │
    ▼
Create Plan → Phases with parallel departments
    │
    ▼
Phase 1: RESEARCHER (understand problem)
    │
    ▼
Phase 2: ARCHITECT (design solution)
    │
    ▼
Phase 3: ENGINEER (build code - parallel per file)
    │
    ▼
Phase 4: VALIDATOR + GUARDIAN (verify in parallel)
    │
    ▼
Synthesize Results → Return artifacts
```

---

## Legacy CODEX Execution Flow

```
User submits task (MCP, Telegram, CLI, or API)
    │
    ▼
TaskExecutor.execute()
    │
    ▼
TaskDecomposer → 7 subtask types:
    • research   - Analyze codebase
    • design     - Architecture planning
    • code       - CodeGenerator → Claude API
    • test       - Write/run tests
    • integrate  - Wire components
    • verify     - Playwright verification
    • review     - Code quality check
    │
    ▼
For each subtask (up to 3 attempts):
    │
    ├─► Attempt 1: Standard approach
    │   └─► If fails → SelfHealer analyzes
    │
    ├─► Attempt 2: Alternative + learning suggestions
    │   └─► If fails → Extended thinking enabled
    │
    ├─► Attempt 3: Ultrathink (16K token budget)
    │   └─► If fails → EscalationGate
    │
    └─► Escalation: CommunicationManager
        └─► Fallback: Telegram → Phone → SMS → Slack → Discord → Email
```

---

## Environment Variables

```env
# Required
OPENAI_API_KEY=sk-...           # For embeddings (768-dim)
ANTHROPIC_API_KEY=sk-ant-...    # For RUBIX code generation

# Optional
GOD_AGENT_DATA_DIR=./data       # Database location
RUBIX_MODEL=claude-opus-4-5-20250514  # Claude model
RUBIX_MAX_PARALLEL=5            # Parallel department heads
RUBIX_ULTRATHINK=true           # Extended thinking
RUBIX_THINK_BASE=5000           # Initial thinking budget
RUBIX_THINK_MAX=16000           # Max thinking budget
TELEGRAM_BOT_TOKEN=...          # Telegram integration
```

---

## MCP Configuration

**IMPORTANT: Use PROJECT-LEVEL config at `.claude/mcp.json`. NEVER modify `~/.claude/mcp.json` (global).**

```json
{
  "mcpServers": {
    "rubix": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol\\god-agent",
      "env": {
        "OPENAI_API_KEY": "...",
        "ANTHROPIC_API_KEY": "...",
        "GOD_AGENT_DATA_DIR": "./data"
      }
    }
  }
}
```

---

## Design Principles

1. **Autonomous First** - Decides independently, escalates only when genuinely blocked
2. **Self-Healing** - Analyzes failures, tries alternatives, learns from patterns
3. **Provenance Tracking** - Every entry has L-Score reliability score
4. **Multi-Channel Comms** - 6 channels with automatic fallback (5 min timeout each)
5. **Deep Work Mode** - Batches notifications, minimizes interruptions
6. **IDE-Like Powers** - LSP, Git, AST, profiling built-in

---

## Key Subsystems

### MemoryEngine (Unified Facade)
- Vector semantic search (HNSW, 768-dim embeddings)
- L-Score provenance tracking (reliability scoring)
- Hypergraph causal relations (n→m with TTL)
- Pattern matching and reusable templates
- Shadow search (contradiction/counterargument finding)

### Sona Engine (Continuous Learning)
- Trajectory-based learning from query outcomes
- LoRA-style efficient delta weights
- EWC++ regularization (prevents catastrophic forgetting)
- Auto-prune bad patterns (<40% success rate)
- Auto-boost good patterns (>80% success rate)

### Tiny Dancer (Neural Query Router)
Routes queries to optimal reasoning strategy:
- `PATTERN_MATCH` - Similar historical patterns
- `CAUSAL_FORWARD` - What effects does X cause?
- `CAUSAL_BACKWARD` - What caused X?
- `TEMPORAL_CAUSAL` - Time-based cause-effect chains
- `HYBRID` - Combined pattern + causal
- `DIRECT_RETRIEVAL` - Simple vector search
- `ADVERSARIAL` - Find contradictory evidence

Circuit breaker protection for failing routes.

### Capabilities Manager (10 IDE Powers)
1. **LSP** - Go-to-definition, find-references, diagnostics
2. **Git** - Blame, bisect, history analysis
3. **Static Analysis** - ESLint + TypeScript compiler
4. **AST** - Parse, traverse, safe refactoring
5. **Dependency Graph** - Impact analysis
6. **Doc Mining** - Fetch library documentation
7. **REPL/Debug** - Live code inspection
8. **Profiler** - CPU profiling
9. **Stack Trace Parser** - Error understanding
10. **Database Introspection** - Schema awareness

### CodeGenerator (Claude API)
- Uses `claude-opus-4-5-20250514` by default
- Supports extended thinking (ultrathink)
- Progressive thinking budget: 5K → 10K → 16K tokens
- Parses `<file path="..." action="create|modify">` from responses
- Creates/modifies files in codebase

### Communication Manager
Escalation fallback chain with 5-minute timeout per channel:
1. Telegram (if configured)
2. Phone (CallMe/Twilio/Telnyx)
3. SMS
4. Slack
5. Discord
6. Email

---

## MCP Tools (50+)

### Memory
- `god_store`, `god_query`, `god_edit`, `god_delete`
- `god_trace` (provenance), `god_stats`, `god_checkpoint`

### Causal
- `god_causal`, `god_find_paths`, `god_cleanup_expired`

### Learning
- `god_learn`, `god_learning_stats`, `god_prune_patterns`

### Routing
- `god_route`, `god_route_result`, `god_routing_stats`
- `god_circuit_status`, `god_reset_circuit`

### CODEX
- `god_codex_do`, `god_codex_status`, `god_codex_cancel`
- `god_codex_answer`, `god_codex_decision`, `god_codex_log`

### Deep Work
- `god_deepwork_start`, `god_deepwork_pause`, `god_deepwork_resume`
- `god_deepwork_status`, `god_deepwork_checkpoint`, `god_deepwork_log`

### Playwright
- `god_pw_launch`, `god_pw_navigate`, `god_pw_screenshot`
- `god_pw_action`, `god_pw_assert`, `god_pw_console`, `god_pw_verify`

### Code Review
- `god_review`, `god_quick_review`, `god_security_review`

### Configuration
- `god_config_get`, `god_config_set`, `god_config_load`, `god_config_save`

### Notification
- `god_notify`, `god_notify_slack`, `god_notify_discord`
- `god_notify_preferences`, `god_notify_test`

### Communication
- `god_comms_setup`, `god_comms_escalate`

### Failure Learning
- `god_failure_record`, `god_failure_query`, `god_failure_resolve`

---

## Database Schema

SQLite with 13+ tables:
- `memory_entries` - Core memory storage
- `memory_tags` - Entry tags (many-to-many)
- `provenance` - L-Score and lineage data
- `causal_relations` - Hyperedge relations with TTL
- `pattern_templates` - Reusable patterns
- `scheduled_tasks` - Task definitions
- `task_runs` - Execution history
- `trajectories` - Learning trajectories
- `pattern_weights` - Sona learning weights
- `vector_mappings` - HNSW label mappings

---

## Quick Start

```bash
# Build
npm install
npm run build

# Initialize database
node dist/cli/index.js init

# Run as MCP server (for Claude Code)
node dist/mcp-server.js

# Or run standalone with Telegram
TELEGRAM_BOT_TOKEN=... node dist/telegram/standalone.js
```

---

## Critical Notes

1. **CodeGenerator requires `ANTHROPIC_API_KEY`** - Without it, CODEX reports success but doesn't write files

2. **MCP server reads env at startup** - Restart Claude Code after config changes

3. **Project-level vs Global config** - Always use `.claude/mcp.json` in project root, never modify `~/.claude/mcp.json`

4. **Single task at a time** - CODEX only runs one task; must cancel or wait before submitting another

5. **Async execution** - `god_codex_do` returns immediately; poll with `god_codex_status`

---

## Housekeeping

### Temporary Directory Cleanup

Claude Code creates `tmpclaude-*-cwd` directories during execution. These should auto-cleanup but get left behind when sessions crash or are force-killed.

**IMPORTANT: Always check for and clean up these temp directories:**

```bash
# Clean temp directories
npm run clean:temp

# Or dry-run to see what would be deleted
node scripts/clean-temp.cjs --dry-run
```

The cleanup script is at `scripts/clean-temp.cjs` and scans:
- Project root for `tmpclaude-*-cwd/`
- Subdirectories up to 2 levels deep

These directories are already in `.gitignore` so they won't be committed, but they can accumulate and waste disk space.

**When to clean (PROACTIVE - do automatically):**
- **At session start** - Run cleanup before beginning work
- **Before git commits** - Always clean before committing changes
- **When git status shows `tmpclaude-*` entries** - Clean immediately

**CLAUDE: Run `npm run clean:temp` proactively. Don't wait to be asked.**
