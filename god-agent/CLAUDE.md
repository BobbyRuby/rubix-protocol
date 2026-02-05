# God-Agent Architecture

> **PRODUCTION ENVIRONMENT**
>
> This is the **production** instance of God-Agent (`god-agent`).
> - Stable code - test changes in `god-agent-dev` first
> - Production data in `./data`
> - MCP instance: `mcp__rubix__*` points to THIS production build

---

## DIRECTIVE: MEMORY FIRST (START OF EVERY SESSION)

**At the start of every session, invoke `/recall` to load relevant memories before doing anything else.**

This ensures prior context, decisions, patterns, and project knowledge are available from the first interaction. Never skip this step.

---

## DIRECTIVE: PRIMARY PURPOSE

**God-Agent is a development tool for building OTHER software projects.**

- Focus on TARGET project/codebase being developed
- Use memory/capabilities to understand and modify external code
- Apply CODEX for features, bugs, refactoring in user projects
- Store learnings about external projects and patterns
- Do NOT assume tasks are about God-Agent itself unless explicit

---

## DIRECTIVE: MULTI-PROJECT CONTEXT

**God-Agent supports working on multiple projects simultaneously via MCP instance isolation.**

### Architecture: Multi-Instance Design

Each project runs as an independent MCP server instance with:
- ✅ **Isolated memory** - Separate SQLite database per project
- ✅ **Independent containment** - Project-specific write restrictions
- ✅ **Dedicated context** - No cross-contamination between projects
- ✅ **Parallel execution** - All instances can run CODEX tasks simultaneously

### Configuration

**Setup (one-time):**
```bash
# Interactive configuration helper
node scripts/configure-projects.js

# Or manually edit .claude/mcp.json
# See .claude/mcp.json.example for template
```

**Example MCP configuration:**
```json
{
  "mcpServers": {
    "rubix-backend-api": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol\\god-agent",
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/backend-api",
        "RUBIX_PROJECT_ROOT": "D:\\my-projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API"
      }
    },
    "rubix-frontend": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/frontend",
        "RUBIX_PROJECT_ROOT": "D:\\my-projects\\web-app",
        "RUBIX_PROJECT_NAME": "Frontend App"
      }
    }
  }
}
```

### Environment Variables (Per Instance)

- **`RUBIX_PROJECT_ROOT`** - Absolute path to project directory (required)
- **`RUBIX_PROJECT_NAME`** - Human-readable project name (optional)
- **`RUBIX_DATA_DIR`** - Isolated data directory for this instance (required)

### Checking Active Projects

At session start, identify available project instances:

```typescript
// Available MCP servers appear as tool prefixes:
// - mcp__rubix_backend_api__*
// - mcp__rubix_frontend__*
// - mcp__rubix_mobile__*

// Each instance has full access to all God-Agent tools:
// - god_codex_do, god_query, god_store, etc.
```

### Project-Specific Operations

**Always use the correct instance prefix for operations:**

```typescript
// Backend API project
mcp__rubix_backend_api__god_codex_do({
  task: "Add authentication middleware to Express routes"
});

// Frontend project (can run in parallel)
mcp__rubix_frontend__god_codex_do({
  task: "Create login form component with validation"
});

// Infrastructure project
mcp__rubix_infra__god_codex_do({
  task: "Update Terraform config to add new API Gateway"
});
```

### Project Context Queries

Query each project's context independently:

```typescript
// What's the backend API structure?
const backendContext = mcp__rubix_backend_api__god_query({
  query: "What API endpoints exist and how is authentication handled?",
  topK: 10
});

// What components exist in frontend?
const frontendContext = mcp__rubix_frontend__god_query({
  query: "What React components are there and what's the routing structure?",
  topK: 10
});

// Queries are scoped - backend query won't return frontend results
```

### Cross-Project Coordination

When a task involves multiple projects:

1. **Query each project** for relevant context
2. **Execute tasks in parallel** on respective instances
3. **Coordinate changes** by understanding dependencies

**Example: Full-stack feature requiring API + Frontend changes**

```typescript
// Step 1: Add API endpoint (backend instance)
const apiTask = mcp__rubix_backend_api__god_codex_do({
  task: `Add GET /api/users/:id endpoint that returns user profile data.
  Response format: { id, name, email, avatar, createdAt }`
});

// Step 2: Add frontend component (runs in parallel)
const frontendTask = mcp__rubix_frontend__god_codex_do({
  task: `Create UserProfile component that:
  - Fetches data from GET /api/users/:id
  - Displays user name, email, avatar
  - Shows loading state and error handling`
});

// Step 3: After both complete, verify integration
// (Query each instance to understand implementation details)
```

### Instance Isolation Guarantees

**Each instance maintains complete isolation:**

| Aspect | Isolation Level | Details |
|--------|----------------|---------|
| **Memory** | Complete | Separate SQLite DB per instance |
| **Embeddings** | Complete | Independent HNSW indexes |
| **Containment** | Project-scoped | Can only write to project root |
| **Context** | No crosstalk | Queries don't cross projects |
| **Task execution** | Independent | Separate CODEX task queues |
| **Learning** | Project-specific | SONA/MemRL per instance |

**What this means:**
- ❌ **Cannot** query backend context from frontend instance
- ❌ **Cannot** write frontend files from backend instance
- ❌ **Cannot** access backend memory from frontend queries
- ✅ **Can** run tasks on all instances simultaneously
- ✅ **Can** coordinate by manually sharing information
- ✅ **Can** use shared learnings via core brain (see below)

---

### Shared Knowledge Base (Core Brain)

**NEW:** God-Agent supports a shared "core brain" that accumulates cross-project knowledge automatically.

#### Architecture

Projects can optionally connect to a shared memory instance:

```
┌──────────────────┐     ┌──────────────────┐
│  Backend API     │────▶│   Core Brain     │
│  (Project Memory)│     │ (Shared Memory)  │
└──────────────────┘     └──────────────────┘
                                   ▲
┌──────────────────┐              │
│  Frontend App    │──────────────┘
│  (Project Memory)│
└──────────────────┘

Each project:
- Queries LOCAL memory first (project-specific patterns)
- Automatically queries CORE BRAIN for skills/technologies
- Benefits from accumulated wisdom across all projects
```

#### Configuration

**Step 1: Create a core brain instance**

```json
{
  "mcpServers": {
    "rubix-core-brain": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol\\god-agent",
      "env": {
        "RUBIX_DATA_DIR": "./data/core-brain",
        "RUBIX_PROJECT_ROOT": "D:\\rubix-protocol\\god-agent",
        "RUBIX_PROJECT_NAME": "Rubix Core Brain"
      }
    }
  }
}
```

**Step 2: Configure projects to use the core brain**

```json
{
  "mcpServers": {
    "rubix-backend-api": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/backend-api",
        "RUBIX_PROJECT_ROOT": "D:\\my-projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API",
        "RUBIX_CORE_BRAIN_DATA_DIR": "./data/core-brain"
      }
    },
    "rubix-frontend": {
      "env": {
        "RUBIX_DATA_DIR": "./data/projects/frontend",
        "RUBIX_PROJECT_ROOT": "D:\\my-projects\\web-app",
        "RUBIX_PROJECT_NAME": "Frontend App",
        "RUBIX_CORE_BRAIN_DATA_DIR": "./data/core-brain"
      }
    }
  }
}
```

**Key Points:**
- `RUBIX_CORE_BRAIN_DATA_DIR` points to the core brain's data directory
- Each project instance can read from the shared brain
- Core brain is optional - graceful degradation if unavailable

#### How It Works

**Automatic skill-based knowledge injection:**

```typescript
// User request: "Add Laravel authentication middleware"

// System automatically:
// 1. Detects skills: ['polyglot:laravel', 'polyglot:auth']
// 2. Queries local memory for project patterns
// 3. Queries core brain for Laravel + auth patterns
// 4. Merges and ranks by relevance (L-Score)
// 5. Injects top 15 patterns into CODEX execution
```

**Logs show source attribution:**

```
[PhasedExecutor] Detected skills: polyglot:laravel, polyglot:auth
[PhasedExecutor] Core brain available - querying shared knowledge
[SkillDetector] Loaded 12 polyglot entries (5 local, 7 shared, 3842 chars)
```

**Context includes source labels:**

```markdown
## POLYGLOT KNOWLEDGE (auto-loaded)

### [Local] polyglot:laravel, polyglot:auth
[Project-specific authentication implementation patterns...]

### [Shared] polyglot:laravel, polyglot:auth
[Cross-project Laravel authentication best practices...]
```

#### Populating the Core Brain

**Store cross-project knowledge with polyglot tags:**

```typescript
// Store to core brain instance
mcp__rubix_core_brain__god_store({
  content: `Laravel Authentication Best Practices:
  - Use service layer for business logic
  - Middleware for route protection
  - JWT tokens for stateless auth
  - Hash passwords with bcrypt
  - Implement rate limiting`,
  tags: ['polyglot:laravel', 'polyglot:auth', 'best_practice'],
  importance: 0.9
});

// Store framework patterns
mcp__rubix_core_brain__god_store({
  content: `React Component Patterns:
  - Use hooks for state management
  - Extract custom hooks for reusable logic
  - Memoize expensive computations
  - Use React.lazy for code splitting`,
  tags: ['polyglot:react', 'polyglot:patterns', 'best_practice'],
  importance: 0.9
});
```

**Automatic learning:** Projects automatically learn patterns during execution and can store them to core brain.

#### Benefits

1. **Knowledge Accumulation** - Skills learned on one project benefit all projects
2. **Consistency** - Shared patterns ensure consistent approaches
3. **Efficiency** - No need to re-learn common patterns per project
4. **Zero Configuration** - Works automatically once `RUBIX_CORE_BRAIN_DATA_DIR` is set
5. **Graceful Degradation** - Projects work normally if core brain unavailable

#### Advanced: Multiple Core Brains

You can configure different core brains for different domains:

```bash
# Backend-specific shared knowledge
RUBIX_CORE_BRAIN_DATA_DIR="./data/core-brain-backend"

# Frontend-specific shared knowledge
RUBIX_CORE_BRAIN_DATA_DIR="./data/core-brain-frontend"

# General engineering knowledge
RUBIX_CORE_BRAIN_DATA_DIR="./data/core-brain-general"
```

---

### Best Practices

**1. Start by identifying the relevant project:**
```typescript
// Wrong: Assume single project
god_codex_do({ task: "Add feature" });  // Which project?

// Right: Specify the instance
mcp__rubix_backend_api__god_codex_do({ task: "Add feature" });
```

**2. Query project context before making changes:**
```typescript
// Understand the project first
const context = mcp__rubix_backend_api__god_query({
  query: "What's the current architecture and coding patterns?",
  topK: 15
});

// Then make informed changes
mcp__rubix_backend_api__god_codex_do({
  task: "Add feature following the existing patterns"
});
```

**3. For cross-project features, coordinate explicitly:**
```typescript
// Bad: Assume projects know about each other
mcp__rubix_frontend__god_codex_do({
  task: "Call the new API endpoint"  // What endpoint? What format?
});

// Good: Share the contract explicitly
const apiContract = `
API Endpoint: POST /api/auth/login
Request: { email: string, password: string }
Response: { token: string, user: { id, name, email } }
`;

mcp__rubix_frontend__god_codex_do({
  task: `Implement login form using this API contract:\n${apiContract}`
});
```

**4. Use high-priority memory for project configuration:**
```typescript
// Store project-specific conventions
mcp__rubix_backend_api__god_store({
  content: `Project Conventions:
- Use Express.js with TypeScript
- All routes in src/routes/
- Authentication via JWT middleware
- Tests with Jest`,
  tags: ['project_config', 'always_recall'],
  importance: 1.0
});
```

### Troubleshooting

**Problem**: Tool not found or undefined
**Solution**: Check that:
1. `.claude/mcp.json` is configured correctly
2. Claude Code has been restarted after config changes
3. You're using the correct instance name (check available tools)

**Problem**: Operation outside allowed paths
**Solution**: The project root is enforced by ContainmentManager. If you need to write outside the project root:
```typescript
mcp__rubix_backend_api__god_containment_add_rule({
  pattern: "/path/to/shared/lib/**",
  permission: "write",
  reason: "Access shared utility library"
});
```

**Problem**: Context not found in queries
**Solution**: Verify you're querying the correct instance. Each instance has its own isolated memory.

### Resource Usage

**Per instance (approximate):**
- Idle: ~20MB RAM
- Active (running task): ~100-200MB RAM
- 5 instances idle: ~100MB total
- 5 instances active: ~500MB-1GB total

**Recommendation**: Configure only the projects you actively work on (2-5 typically).

---

## DIRECTIVE: COMMUNICATION PROTOCOL (MANDATORY)

**ALWAYS use `god_comms_escalate` for questions/clarifications.**

The system automatically detects execution context and routes appropriately:
- **Daemon running** → Telegram escalation
- **Daemon not running** → CLI fallback via AskUserQuestion

### Universal Usage Pattern

```typescript
// Step 1: Always try god_comms_escalate first
const result = mcp__rubix__god_comms_escalate({
  title: "Question Title",
  message: "Your question here",
  type: "decision",  // decision|clarification|blocked|approval
  options: [{ label: "Option A", description: "..." }, ...]
});

// Step 2: Check response and adapt
if (result.success) {
  // Got response via Telegram daemon
  const answer = result.response;
  // Continue with answer
} else if (result.daemonRequired) {
  // Auto-fallback to CLI mode
  const cliResponse = AskUserQuestion({
    questions: [{
      question: result.question.message,
      header: result.question.title,
      multiSelect: false,
      options: result.question.options?.map(o => ({
        label: o.label,
        description: o.description
      })) || []
    }]
  });
  // Use cliResponse.answers
}
```

### How It Works

1. **Daemon Detection**: System checks if God-Agent daemon is running using:
   - HTTP health check (localhost:3456/health)
   - PID file validation
   - Process existence check

2. **Automatic Routing**:
   - **Daemon detected** → `god_comms_escalate` sends question via Telegram and waits for response
   - **No daemon** → `god_comms_escalate` returns fallback response with `daemonRequired: true`

3. **Seamless Fallback**: When daemon not detected, the fallback response contains all question data needed for `AskUserQuestion`, making it trivial to adapt.

### Benefits

✅ **Zero configuration** - No RUBIX_MODE needed
✅ **Single protocol** - Always start with `god_comms_escalate`
✅ **Graceful degradation** - Automatically falls back to CLI
✅ **Self-documenting** - Response tells you exactly what to do
✅ **Works everywhere** - Daemon or CLI, same code pattern

### Optional: RUBIX_MODE Override

Users can still set `RUBIX_MODE=daemon` or `RUBIX_MODE=mcp-only` to force a specific mode, but it's no longer required for normal operation.

---

## DIRECTIVE: SESSION LEARNING (MANDATORY)

**Store significant outcomes during and after sessions using `god_session_store` or `god_store`.**

### What to store:
- Architecture decisions and their rationale
- Bug root causes and fixes applied
- Patterns discovered (coding patterns, project conventions, failure modes)
- Cross-project insights (e.g., "this API contract works well")
- Configuration or environment quirks

### What NOT to store:
- Routine file reads or minor edits
- Obvious/trivial facts
- Duplicate information already in memory

### How:
```typescript
// After significant work in a session
god_session_store({
  summary: "Implemented JWT auth for backend API using passport-jwt",
  decisions: ["Used RS256 over HS256 for key rotation support"],
  patterns: ["Middleware chain: rateLimit → authenticate → authorize → handler"],
  filesChanged: ["src/middleware/auth.ts", "src/routes/api.ts"],
  tags: ["auth", "jwt"]
});
```

### Feedback loop:
- `god_query` now returns `_learning.trajectoryId` and `_learning.queryId`
- Call `god_learn` with these IDs after evaluating query usefulness
- Storing via `god_store` after a query automatically provides positive feedback
- PhasedExecutor (codex) provides automatic feedback after every task

---

## DIRECTIVE: EASY DEPLOYMENT

**Update god-agent on any machine:**
```bash
npm run update              # Local: git pull + rebuild
bash scripts/update.sh      # Same thing, explicit

# Remote server
bash scripts/deploy-remote.sh user@host /path/to/god-agent
```

---

## DIRECTIVE: HOUSEKEEPING

**Clean temp directories proactively:**
```bash
npm run clean:temp                    # Clean tmpclaude-*-cwd dirs
node scripts/clean-temp.cjs --dry-run # Preview
```

Run automatically:
- At session start
- Before git commits
- When git status shows `tmpclaude-*`

---

## DIRECTIVE: CRITICAL NOTES

1. `ANTHROPIC_API_KEY` required for CodeGenerator file writes
2. MCP server reads env at startup → restart Claude Code after config changes
3. Always use `.claude/mcp.json` (project) → NEVER `~/.claude/mcp.json` (global)
4. Single CODEX task at a time → cancel or wait before new submission
5. `god_codex_do` async → poll with `god_codex_status`

---

## ARCHITECTURE

```
INTERFACES: MCP(mcp-server.ts)|CLI(cli/)|Telegram(telegram/)|HTTP(webhooks:3456)
     │
CORE─┼─►CODEX[PhasedExecutor,ParallelEngineer,TaskExecutor,SelfHealer,EscalationGate]
     │
     ├─►MEMORY[MemoryEngine→storage,vectorDb,embeddings,provenance,causal,patterns,
     │         shadowSearch,sona,memrl,gnn,router,queryCache]
     │
     ├─►COMMS[Fallback:Telegram→Phone→SMS→Slack→Discord→Email(5min/channel)]
     │
     └─►CAPABILITIES[10:LSP,Git,AST,Profiler,Debug,Playwright,StaticAnalysis,
                     DepGraph,DocMining,DBIntrospection]
```

**Modes:** MCP Server | CLI | Standalone Service (daemon+Telegram+HTTP)

---

## REPO STRUCTURE

```
god-agent/src/ [242 TS files, 32 subsystems]
├─ mcp-server.ts [50+ tools, StdioTransport, Zod validation]
├─ index.ts [478L, 32 export categories]
├─ core/ [MemoryEngine facade ~1418L, types ~324L, config, errors]
├─ storage/ [SQLite 15 tables, WAL mode, schema.sql]
├─ vector/ [HNSW 768d, OpenAI text-embedding-3-small]
├─ codex/ [PhasedExecutor ~1791L, ParallelEngineer ~320L, SelfHealer ~985L]
├─ learning/ [Sona, MemRL ~373L, trajectories]
├─ curiosity/ [AutonomousDiscovery ~436L, probes, budget]
├─ distillation/ [MemoryDistillation ~1263L, weekly]
├─ capabilities/ [10 IDE powers]
├─ playwright/ [browser automation, verification]
├─ scheduler/ [cron, events, daemon]
├─ communication/ [CommunicationManager, 6 channels]
├─ notification/ [Slack, Discord]
├─ deepwork/ [DeepWorkManager]
├─ routing/ [TinyDancer, CircuitBreaker]
├─ provenance/ [LScoreCalculator]
├─ causal/ [CausalMemory, Hypergraph]
├─ gnn/ [EnhancementLayer]
├─ adversarial/ [ShadowSearch]
├─ failure/ [FailureMemoryService]
├─ review/ [CodeReviewer]
└─ telegram/ [TelegramBot, Handler, strict session modes]
```

---

## TYPES (core/types.ts)

```
MemoryEntry{id,content,embedding?,metadata,provenance,created,updated}
MemorySource: USER_INPUT|AGENT_INFERENCE|TOOL_OUTPUT|SYSTEM|EXTERNAL
ProvenanceInfo{parentIds[],lineageDepth,confidence,relevance,lScore?}
CausalRelation{id,type,src[],tgt[],strength,ttl?,expiresAt?}
  type: causes|enables|prevents|correlates|precedes|triggers
QueryOptions{topK?,minScore?,filters?,includeProvenance?,traceDepth?}
QueryFilters{sources?,tags?,tagMatchAll?,dateRange?,minImportance?,session?,agent?}

HNSWConfig{maxElements:100K,efConstruction:200,efSearch:100,M:16,space:cosine}
EmbeddingConfig{provider:openai,model:text-embedding-3-small,dims:768,batch:100}
LScoreConfig{depthDecay:0.9,minScore:0.01,threshold:0.3,enforce:true}

CodexLLMConfig{
  apiKey?,model:claude-opus-4-5,maxTokens:8192,
  extendedThinking{enabled,baseBudget:5000,increment:5000,max:16000,enableOnAttempt:2},
  executionMode:cli-first|api-only|cli-only,
  engineerProvider:claude|ollama,
  ollamaEndpoint?,ollamaModel:qwen3-coder:480b-cloud,ollamaTimeout:120000
}
```

---

## MEMORY ENGINE (core/MemoryEngine.ts)

```
FACADE→[storage,vectorDb,embeddings,provenance,causal,patterns,shadowSearch,
        sona,memrl,gnn,router,queryCache]

STORE: content,opts→calcLScore(parents)→enforceThreshold→createEntry→
       sqlInsert[memory_entries,tags,provenance,links]→queueEmbed→checkFlush(10+)

QUERY: text,opts→checkCache(LRU100/60s)→flushPending→tagPreFilter(SQL)→
       genEmbed(OpenAI)→vectorSearch(HNSW,5*topK)→
       [memrl?→PhaseA(delta)→PhaseB(composite)|simpleRank]→
       applyFilters→incProvenance→cacheResult

MEMRL_2PHASE:
  PhaseA: filter(sim>=delta)
  PhaseB: score=(1-λ)*sim_norm+λ*Q_norm
  Q_UPDATE: Q_new=Q_old+α*(reward-Q_old)

CAUSAL:
  addRelation(src[],tgt[],type,strength,ttl?)→hyperedge
  traverse(entry,dir,maxDepth)→DFS/BFS
  findPaths(src,tgt)→shortest
  cleanupExpired()→TTL check

PROVENANCE:
  root→LScore=1.0 | derived→aggregate(parents)*depthDecay | threshold(0.3)→reject
```

---

## STORAGE (SQLite 15 tables)

```
memory_entries{id,content,source,importance,session,agent,context,created,updated,
  pending_embedding,q_value,q_update_count,last_q_update}
memory_tags{entry_id,tag} PK(entry,tag)
provenance{entry_id,lineage_depth,confidence,relevance,l_score}
provenance_links{entry_id,parent_id}
causal_relations{id,type,strength,metadata,created,ttl,expires_at}
causal_sources{relation_id,entry_id}
causal_targets{relation_id,entry_id}
pattern_templates{id,name,pattern,slots[JSON],priority,created}
pattern_stats{pattern_id,uses,successes,failures}
vector_mappings{entry_id,label,access_count,last_accessed,compression_tier}
system_metadata{key,value}
scheduled_tasks{id,name,prompt,trigger[JSON],context_ids,context_query,
  priority,status,last_run,next_run,created,updated}
task_runs{id,task_id,started,completed,duration,result,error}
event_queue{id,event_name,payload[JSON],created}
memrl_queries{id,query_text,query_embed,entry_ids,similarities,q_values,
  delta,lambda,created,feedback_given}
```

---

## PHASED EXECUTOR (codex/PhasedExecutor.ts)

```
6_PHASE_EXECUTION:
  P1:CONTEXT_SCOUT(Sonnet)→ContextBundle{polyglot,patterns}
  P2:ARCHITECT(Opus always)→Design{complexity,componentDeps[]}
  P3:ENGINEER(complexity-routed):
    low/med→single(Haiku/Sonnet)
    high→ParallelEngineer(topoSort,batches)
  P4a:CODE_REVIEWER→OWASP scan→SecurityFinding[]
  P5:EXECUTOR→writeFiles(before validation for fix loop)
  P5a:POST_AUDIT→Guardian audit→rollback?
  P4:VALIDATOR(complexity-model)→blockers[],requiredMods[]
  P6:FIX_LOOP(5-tier):
    T1:Sonnet(std)→T2:Sonnet(alt)→T3:Sonnet+think(8K)→
    T4:Opus(fresh)→T5:Opus+think(16K)→exhausted?→escalate

GUARDRAILS:
  before_exec→CollaborativePartner.identifyKnowledgeGaps()→critical?→escalate
  after_architect→CollaborativePartner.assessApproach()→shadowSearch
    →HARD_GATE(cred<0.3)→require override
  before_write→ContainmentManager.checkPermission(path,write)
  after_write→CodeReviewer.review(files,'security')→critical?→blocker
  post_exec→PostExecGuardian.audit()→critical?→rollback

MODEL_ROUTING: ModelSelector(complexity)→Haiku(low)|Sonnet(med)|Opus(high)
FALLBACK: Ollama→Claude
```

---

## PARALLEL ENGINEER (codex/ParallelEngineer.ts)

```
HIGH_COMPLEXITY:
  input:components[]{name,deps[]}→topoSort(DFS)→getBatches(group independent)→
  forEach batch: gatherOutputs(completedOutputs,deps)→Promise.all(engineerFn)→
  track completedOutputs[name]=output→merge PlanOutput

PROVIDER_AGNOSTIC: EngineerProvider.createEngineer()→EngineerFn
CIRCULAR_PROTECT: batch.length===0→add remaining as single batch+warn
```

---

## SELF HEALER (codex/SelfHealer.ts)

```
ANALYZE:
  classifyError(err,consoleErrs)→ErrorPattern{type,isTransient,strategy}
  queryFailureMemory→{similar[],avoidances[],recommended[]}
  performEnhancedAnalysis→CapMgr[parseStackTrace,getStackContext,gitRecentChanges,getDiagnostics]
  applyLessons(ReflexionService)
  generateReflection()[async,non-block]
  isFundamentalBlocker(pattern,prevAttempts)→same_type2+|integration2+?
  selectStrategy→generateHealing→recordFailure
  →HealingAnalysis{isFundamental,reason,newApproach,contextNeeded[],actions[],similar[]}

ERROR_TYPES: syntax|type|runtime|test|integration|timeout|unknown
STRATEGIES: retry_with_context|simplify_approach|try_alternative|gather_more_context|
            break_into_smaller_steps|escalate

HEALING_RECORD:
  recordSuccessfulHealing→store+causalLink(failure→resolution)+sonaFeedback(0.8)
  recordResolutionWithCause→chain:failure→rootCause→fix(CAUSES relations)
```

---

## LEARNING SYSTEMS

### SONA (learning/SonaEngine.ts)
```
TRAJECTORY_LEARNING:
  createTrajectory(query,matchedIds,matchScores)
  provideFeedback(trajectoryId,quality:0-1)→
    forEach pattern: gradient=(quality-0.5)*matchScore*learningRate
    Q_new=Q_old+EWC_reg(gradient), importance+=|gradient|
    checkDrift()→critical?→rollback

CONFIG: learningRate:0.01,lambda:0.5(EWC),driftThreshold:0.3,criticalDrift:0.5,
        minUsesForUpdate:3,pruneThreshold:0.4,pruneMinUses:100,
        boostMultiplier:1.2,boostThreshold:0.8

OPS: autoPrune(<40%),autoBoost(>80%),checkDrift(),checkpoint(),rollback()
```

### MEMRL (learning/memrl/MemRLEngine.ts)
```
TWO_PHASE:
  PhaseA: filter(sim>=delta)→candidates[]
  PhaseB: score=(1-λ)*sim_norm+λ*Q_norm (z-score norm)
  Q_UPDATE: Q_new=Q_old+α*(reward-Q_old)

STATE: processVectorResults→PhaseA→resolveLabels→batchFetchQ→PhaseB→storeQuery
       provideFeedback(queryId,rewards)→Q updates→calcDrift
```

### AUTONOMOUS DISCOVERY (curiosity/AutonomousDiscoveryEngine.ts)
```
CYCLE(Mon/Wed/Fri):
  canExplore()?→getSlotType(3:1 high:mod)→selectProbe→markExploring→
  explore(100K cap): webKeywords?→webExplore(Playwright→Claude)|textExplore(Claude)
  →recordResult→incCycle

PROBE_PRIORITY: failure:1.0|low_confidence:0.7|knowledge_gap:0.5|success_confirm:0.2
                priority=baseWeight+novelty*0.3+(1-conf)*0.2

BUDGET: tokensPerProbe:100K,probesPerWeek:5,highPriorityRatio:3,resetDay:0(Sun)
```

### MEMORY DISTILLATION (distillation/MemoryDistillationService.ts)
```
WEEKLY:
  extractSuccessPatterns→findSuccess(since)→cluster(min3)→genInsight(Claude)→store
  extractFailureFixChains→findChains(causal)→genInsight→store
  extractCrossDomain→findPatterns→groupByDomain→genInsight(pairs)→store

INSIGHT_TYPES: success_pattern|failure_fix|cross_domain|contradiction|consolidation
STORAGE: MemoryEntry+tags['distilled_insight','type:X']+causalLinks+sonaWeights(conf>=0.8)
SCHEDULE: cron(Sun 3am),interval(60min check),~20K tokens/run
```

### REFLEXION SERVICE
```
generate(failureId,taskDesc,subtaskDesc,prevAttempts[])→
  Claude→"why did X fail"→Reflection{rootCause,lessons[],recommendedApproach}
query(error)→semantic search past reflections

ROOT_CAUSE_CATS: missing_context|wrong_approach|external_dependency|
                 integration_mismatch|incomplete_spec|environment_issue
```

---

## TINY DANCER (routing/TinyDancer.ts)

```
ROUTES: PATTERN_MATCH|CAUSAL_FORWARD|CAUSAL_BACKWARD|TEMPORAL_CAUSAL|
        HYBRID|DIRECT_RETRIEVAL|ADVERSARIAL

CIRCUIT_BREAKER: track failures per route→open circuit on threshold→fallback
```

---

## TELEGRAM BOT

```
SESSION_MODES (strict enforcement):
  conversation: /conversation → free chat, /rubixallize→plan
  plan: /plan <desc> → planning with Claude
  task: /task <desc> → immediate exec (transient)

TRANSITIONS:
  NONE→/conversation→CHAT→/rubixallize→PLAN
  NONE→/plan→PLAN
  NONE→/task→TASK→(completes)→NONE
  ANY→/exit→NONE

CMDS: /start,/help,/task,/plan,/conversation,/rubixallize,/execute,/resume,/exit
WHITELIST: task|status|cancel|help|list
FLOW: polling→TelegramHandler.handleMessage()→CommandParser→route→TaskExecutor
```

---

## MCP TOOLS (50+)

```
mem: god_store,god_query,god_edit,god_delete,god_trace,god_stats,god_checkpoint
causal: god_causal,god_find_paths,god_cleanup_expired
learn: god_learn,god_learning_stats,god_prune_patterns
shadow: god_shadow_search
route: god_route,god_route_result,god_routing_stats,god_circuit_status,god_reset_circuit
enhance: god_enhance,god_enhance_batch,god_gnn_stats,god_clear_gnn_cache
schedule: god_schedule,god_trigger,god_tasks,god_pause,god_resume,god_cancel
pw: god_pw_launch,god_pw_navigate,god_pw_screenshot,god_pw_action,god_pw_assert,
    god_pw_console,god_pw_verify
codex: god_codex_do,god_codex_status,god_codex_answer,god_codex_decision,
       god_codex_cancel,god_codex_log,god_codex_estimate,god_codex_wait,god_codex_logs
cfg: god_config_get,god_config_set,god_config_load,god_config_save,god_config_reset
comms: god_comms_setup,god_comms_escalate
notify: god_notify,god_notify_slack,god_notify_discord,god_notify_preferences,
        god_notify_test,god_notify_history
deepwork: god_deepwork_start,god_deepwork_pause,god_deepwork_resume,
          god_deepwork_status,god_deepwork_log,god_deepwork_checkpoint
failure: god_failure_record,god_failure_query,god_failure_resolve,god_failure_stats
reflexion: god_reflexion_query,god_reflexion_generate,god_reflexion_stats
review: god_review,god_quick_review,god_security_review,god_review_config
guardian: god_guardian_audit
curiosity: god_curiosity_list,god_curiosity_explore,god_curiosity_web_explore,
           god_budget_status,god_budget_history
compression: god_store_compressed,god_query_expanded,god_self_query,god_compression_stats,
             god_bootstrap_status,god_recompress_all
autorecall: god_autorecall_config,god_autorecall_status
capabilities: god_capabilities_status,god_ollama_status
lsp: god_lsp_start,god_lsp_stop,god_lsp_available,god_lsp_definition,
     god_lsp_references,god_lsp_diagnostics,god_lsp_symbols
git: god_git_blame,god_git_bisect,god_git_history,god_git_diff,god_git_branches
ast: god_ast_parse,god_ast_query,god_ast_refactor,god_ast_symbols
analyze: god_analyze_lint,god_analyze_types,god_analyze_deps,god_analyze_impact
debug: god_debug_start,god_debug_stop,god_debug_breakpoint,god_debug_step,god_debug_eval
profile: god_profile_start,god_profile_stop,god_profile_hotspots
stack: god_stack_parse,god_stack_context
db: god_db_schema,god_db_types
docs: god_docs_fetch,god_docs_search
wolfram: god_wolfram_query,god_wolfram_calculate,god_wolfram_solve,god_wolfram_convert
agent: god_agent_card
partner: god_partner_config,god_partner_challenge,god_partner_status
containment: god_containment_check,god_containment_config,god_containment_add_rule,
             god_containment_remove_rule,god_containment_status,god_containment_session
distill: god_distill,god_distillation_stats,god_distillation_config,god_distillation_query
```

---

## ENV VARS

```
# Required
OPENAI_API_KEY=sk-...           # Embeddings (768d)
ANTHROPIC_API_KEY=sk-ant-...    # Claude code gen

# Optional (Global)
RUBIX_DATA_DIR=./data           # Data directory (overridden per-instance in multi-project mode)
RUBIX_MODE=auto                 # Optional override: 'mcp-only' | 'daemon' | 'auto' (default)
                                # System auto-detects daemon at runtime (health check + PID)
                                # Set only if you need to force a specific mode
RUBIX_MODEL=claude-opus-4-5-20250514
RUBIX_MAX_PARALLEL=5
RUBIX_ULTRATHINK=true
RUBIX_THINK_BASE=5000
RUBIX_THINK_MAX=16000
TELEGRAM_BOT_TOKEN=...

# Multi-Project Support (Per MCP Instance)
RUBIX_PROJECT_ROOT=D:\path\to\project   # Absolute path to project directory
RUBIX_PROJECT_NAME=My Project           # Human-readable project name
RUBIX_CORE_BRAIN_DATA_DIR=./data/core-brain  # Optional: Path to shared knowledge base
                                             # Enables automatic cross-project learning
                                             # Projects query local + core brain for skills
# Each instance in .claude/mcp.json sets these independently
```

---

## MCP CONFIG

**Project-level only: `.claude/mcp.json`**

### Single Project (Simple)

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
        "RUBIX_DATA_DIR": "./data"
      }
    }
  }
}
```

### Multi-Project (Recommended)

```json
{
  "mcpServers": {
    "rubix-backend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol\\god-agent",
      "env": {
        "OPENAI_API_KEY": "...",
        "ANTHROPIC_API_KEY": "...",
        "RUBIX_DATA_DIR": "./data/projects/backend",
        "RUBIX_PROJECT_ROOT": "D:\\my-projects\\backend-api",
        "RUBIX_PROJECT_NAME": "Backend API"
      }
    },
    "rubix-frontend": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "cwd": "D:\\rubix-protocol\\god-agent",
      "env": {
        "OPENAI_API_KEY": "...",
        "ANTHROPIC_API_KEY": "...",
        "RUBIX_DATA_DIR": "./data/projects/frontend",
        "RUBIX_PROJECT_ROOT": "D:\\my-projects\\web-app",
        "RUBIX_PROJECT_NAME": "Frontend App"
      }
    }
  }
}
```

**Setup Helper**: Run `node scripts/configure-projects.js` for interactive configuration.
**See Also**: `.claude/mcp.json.example` for complete template with 5 projects.

---

## QUICK START

```bash
npm install && npm run build
node dist/cli/index.js init
node dist/mcp-server.js                              # MCP mode
TELEGRAM_BOT_TOKEN=... node dist/telegram/standalone.js  # Standalone
```

---

## DESIGN PRINCIPLES

1. **Memory First** - Always query memory (`god_query`/`god_query_expanded`) before starting any task. Prior context, patterns, and decisions inform every action
2. **Autonomous First** - Decides independently, escalates only when blocked
3. **Self-Healing** - Analyzes failures, tries alternatives, learns
4. **Provenance** - Every entry has L-Score reliability
5. **Multi-Channel** - 6 channels, 5min timeout each, auto-fallback
6. **Deep Work** - Batches notifications, minimizes interruptions
7. **IDE Powers** - LSP, Git, AST, profiling built-in

---

## DIRECTIVE: SKILLS AWARENESS

Available skills (invoke or suggest proactively):
- `/recall` — Load memories at session start (MANDATORY)
- `/scsp` — Store session progress. Suggest before long sessions end.
- `/stm` — Store specific messages as memory. Suggest when significant decisions are made.
- `/learn-style` — Learn user preferences. Run periodically or when corrected.
- `/skills` — List all skills.

Self-invoke `/scsp` when:
- Session has been productive (multiple changes made)
- User says goodbye or seems to be wrapping up
- Major milestone completed
