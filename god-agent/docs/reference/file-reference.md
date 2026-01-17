# File Reference

Complete listing of all source files in the god-agent system.

## Directory Structure

```
god-agent/
├── src/
│   ├── core/           # Core memory system
│   ├── codex/          # RUBIX task execution
│   ├── memory/         # Compression & embeddings
│   ├── storage/        # SQLite persistence
│   ├── learning/       # Sona learning engine
│   ├── routing/        # TinyDancer router
│   ├── providers/      # LLM providers
│   ├── capabilities/   # IDE-like powers
│   ├── communication/  # Multi-channel comms
│   ├── notification/   # Notification service
│   ├── playwright/     # Browser automation
│   ├── scheduler/      # Task scheduling
│   ├── deepwork/       # Focus mode
│   ├── cli/            # Command-line interface
│   └── telegram/       # Telegram bot
├── docs/               # Documentation
├── scripts/            # Utility scripts
└── tests/              # Test files
```

---

## Core System

| File | Lines | Purpose |
|------|-------|---------|
| `src/core/MemoryEngine.ts` | ~1100 | Unified API facade for all memory operations |
| `src/core/types.ts` | ~500 | Core type definitions |
| `src/core/config.ts` | ~350 | Configuration loading and validation |
| `src/core/constants.ts` | ~30 | System tags and constants |
| `src/core/errors.ts` | ~50 | Custom error classes |

### MemoryEngine.ts

The central facade providing unified access to:

- Vector storage and search
- Provenance tracking
- Causal relations
- Learning integration
- Routing
- Compression

---

## CODEX System

| File | Lines | Purpose |
|------|-------|---------|
| `src/codex/TaskExecutor.ts` | ~1800 | Main orchestrator for task execution |
| `src/codex/TaskDecomposer.ts` | ~200 | Breaks tasks into subtasks |
| `src/codex/CodeGenerator.ts` | ~500 | Claude API integration for code generation |
| `src/codex/SelfHealer.ts` | ~300 | Failure analysis and recovery |
| `src/codex/EscalationGate.ts` | ~300 | Escalation decision logic |
| `src/codex/LearningIntegration.ts` | ~150 | Pattern learning integration |
| `src/codex/AlternativesFinder.ts` | ~150 | Alternative strategy generation |
| `src/codex/CausalDebugger.ts` | ~150 | Causal debugging assistance |
| `src/codex/WorkingMemoryManager.ts` | ~100 | Active memory management |
| `src/codex/CollaborativePartner.ts` | ~300 | Proactive curiosity system |
| `src/codex/ContainmentManager.ts` | ~400 | Path-based permissions |
| `src/codex/ClaudeCodeExecutor.ts` | ~200 | CLI executor wrapper |
| `src/codex/ContextScout.ts` | ~200 | Context gathering |
| `src/codex/OllamaReasoner.ts` | ~150 | Local LLM fallback |
| `src/codex/PlanningSession.ts` | ~250 | Unlimited planning sessions |
| `src/codex/ConversationSession.ts` | ~150 | Lightweight chat sessions |
| `src/codex/PlanningAgent.ts` | ~200 | Agentic planning |
| `src/codex/PlanValidator.ts` | ~150 | Plan validation |
| `src/codex/PlanExecutor.ts` | ~200 | Plan execution |
| `src/codex/PhasedExecutor.ts` | ~400 | 6-phase tokenized execution |
| `src/codex/TokenRouter.ts` | ~150 | Token budget routing |
| `src/codex/PermissionDetector.ts` | ~100 | Permission detection |
| `src/codex/types.ts` | ~500 | Task and subtask type definitions |
| `src/codex/index.ts` | ~50 | Module exports |

### Key Files

**TaskExecutor.ts** - The main orchestrator:
- Coordinates all CODEX components
- Manages task lifecycle
- Handles retries and escalations
- Integrates with learning system

**CodeGenerator.ts** - Claude API integration:
- Constructs prompts for Claude
- Parses file creation/modification responses
- Manages extended thinking budget
- Handles rate limiting

**SelfHealer.ts** - Failure recovery:
- Analyzes error patterns
- Suggests alternative approaches
- Queries failure memory
- Integrates with learning

---

## Memory System

| File | Lines | Purpose |
|------|-------|---------|
| `src/memory/CompressionSchemas.ts` | ~1070 | 18 compression schemas |
| `src/memory/MemoryCompressor.ts` | ~392 | Schema-based compression |
| `src/memory/LLMCompressor.ts` | ~260 | LLM semantic compression |
| `src/memory/EmbeddingCache.ts` | ~351 | LRU embedding cache |
| `src/memory/AsyncWriteQueue.ts` | ~298 | Non-blocking write operations |
| `src/memory/types.ts` | ~194 | Memory type definitions |
| `src/memory/index.ts` | ~21 | Module exports |

### CompressionSchemas.ts

Defines 18 positional token schemas:

1. COMPONENT
2. DEPARTMENT
3. MCP_TOOL
4. CAPABILITY
5. WORKFLOW
6. CONFIG
7. ERROR_PATTERN
8. SUCCESS_PATTERN
9. SYSTEM
10. BUG_FIX
11. DEV_FEATURE
12. ARCH_INSIGHT
13. CONVERSATION
14. CONTEXT_BUNDLE
15. DESIGN
16. EXEC_PLAN
17. VALIDATION
18. GENERIC

---

## Storage

| File | Lines | Purpose |
|------|-------|---------|
| `src/storage/SQLiteStorage.ts` | ~800 | SQLite persistence layer |

### Database Tables

- `memory_entries` - Core memory storage
- `memory_tags` - Entry tags (many-to-many)
- `provenance` - L-Score and lineage
- `causal_relations` - Hyperedge relations
- `pattern_templates` - Reusable patterns
- `scheduled_tasks` - Task definitions
- `task_runs` - Execution history
- `trajectories` - Learning trajectories
- `pattern_weights` - Sona weights
- `vector_mappings` - HNSW label mappings

---

## Learning System

| File | Lines | Purpose |
|------|-------|---------|
| `src/learning/SonaEngine.ts` | ~250 | Trajectory learning orchestrator |
| `src/learning/TrajectoryStore.ts` | ~150 | Trajectory persistence |
| `src/learning/WeightManager.ts` | ~200 | LoRA-style weight management |
| `src/learning/EWCRegularizer.ts` | ~150 | EWC++ regularization |

---

## Routing System

| File | Lines | Purpose |
|------|-------|---------|
| `src/routing/TinyDancer.ts` | ~400 | Neural query router |
| `src/routing/CircuitBreaker.ts` | ~150 | Failure protection |
| `src/routing/types.ts` | ~50 | Routing type definitions |

---

## Providers

| File | Lines | Purpose |
|------|-------|---------|
| `src/providers/ProviderFactory.ts` | ~150 | Provider factory |
| `src/providers/OllamaClient.ts` | ~200 | Ollama local LLM client |
| `src/providers/types.ts` | ~100 | Provider type definitions |
| `src/providers/index.ts` | ~20 | Module exports |

---

## Capabilities

| File | Lines | Purpose |
|------|-------|---------|
| `src/capabilities/CapabilitiesManager.ts` | ~500 | Capability orchestrator |
| `src/capabilities/LSPManager.ts` | ~300 | Language Server Protocol |
| `src/capabilities/GitManager.ts` | ~250 | Git integration |
| `src/capabilities/ASTManager.ts` | ~200 | Abstract Syntax Tree |
| `src/capabilities/AnalysisManager.ts` | ~200 | Static analysis |
| `src/capabilities/DebugManager.ts` | ~250 | Node.js debugging |
| `src/capabilities/DatabaseManager.ts` | ~150 | Database introspection |
| `src/capabilities/ProfilerManager.ts` | ~150 | CPU profiling |
| `src/capabilities/DocsManager.ts` | ~150 | Documentation |
| `src/capabilities/WolframManager.ts` | ~100 | Wolfram Alpha |

---

## Communication

| File | Lines | Purpose |
|------|-------|---------|
| `src/communication/CommunicationManager.ts` | ~400 | Escalation orchestrator |
| `src/communication/channels/TelegramChannel.ts` | ~150 | Telegram integration |
| `src/communication/channels/PhoneChannel.ts` | ~150 | Phone call integration |
| `src/communication/channels/SMSChannel.ts` | ~100 | SMS integration |
| `src/communication/channels/SlackChannel.ts` | ~100 | Slack integration |
| `src/communication/channels/DiscordChannel.ts` | ~100 | Discord integration |
| `src/communication/channels/EmailChannel.ts` | ~100 | Email integration |
| `src/communication/server/WebhookServer.ts` | ~200 | Response webhook server |

---

## Entry Points

| File | Lines | Purpose |
|------|-------|---------|
| `src/mcp-server.ts` | ~3000 | MCP server with 80+ tools |
| `src/index.ts` | ~50 | Main exports |
| `src/cli/index.ts` | ~200 | CLI commands |
| `src/telegram/TelegramBot.ts` | ~500 | Standalone Telegram bot |
| `src/telegram/standalone.ts` | ~50 | Telegram standalone entry |

---

## Other Systems

### Notification

| File | Lines | Purpose |
|------|-------|---------|
| `src/notification/NotificationService.ts` | ~200 | Notification orchestrator |
| `src/notification/SlackNotifier.ts` | ~100 | Slack notifications |
| `src/notification/DiscordNotifier.ts` | ~100 | Discord notifications |

### Deep Work

| File | Lines | Purpose |
|------|-------|---------|
| `src/deepwork/DeepWorkManager.ts` | ~300 | Focus mode management |

### Scheduler

| File | Lines | Purpose |
|------|-------|---------|
| `src/scheduler/SchedulerDaemon.ts` | ~400 | Task scheduling daemon |

### Playwright

| File | Lines | Purpose |
|------|-------|---------|
| `src/playwright/PlaywrightManager.ts` | ~400 | Browser automation |
| `src/playwright/VerificationService.ts` | ~200 | Visual verification |

---

## Scripts

| File | Purpose |
|------|---------|
| `scripts/clean-temp.cjs` | Clean temporary directories |
| `scripts/bootstrap.ts` | Database initialization |
| `scripts/migrate.ts` | Database migrations |

---

## Total Line Count

| Category | Files | Lines |
|----------|-------|-------|
| Core | 5 | ~2,030 |
| CODEX | 24 | ~7,500 |
| Memory | 7 | ~2,586 |
| Storage | 1 | ~800 |
| Learning | 4 | ~750 |
| Routing | 3 | ~600 |
| Providers | 4 | ~470 |
| Capabilities | 10 | ~2,250 |
| Communication | 8 | ~1,300 |
| Notification | 3 | ~400 |
| Other | 6 | ~1,150 |
| Entry Points | 5 | ~3,800 |
| **Total** | **80+** | **~23,636** |

## Next Steps

- [Environment Variables](environment-variables.md) - Configuration reference
- [Glossary](glossary.md) - Terms and definitions
- [Architecture Overview](../architecture/overview.md) - System design
