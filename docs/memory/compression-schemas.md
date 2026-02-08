# Compression Schemas

**File:** `src/memory/CompressionSchemas.ts` (~1070 lines)

The system uses 18 bidirectional compression schemas for efficient token storage.

## Schema Design Philosophy

```
Position0|Position1|Position2|...

Machine knows the schema for the type:
- Position 0 is always NAME/ID
- Position 1 is always TYPE CODE
- Position 2 is always ACTIONS/DETAILS
- etc.

Human decodes via schema:
- Schema tells decoder what each position means
- Decoder reconstructs human-readable form
- No key strings needed - pure positional efficiency
```

## All 18 Compression Schemas

### 1. COMPONENT Schema

**Format:** `name|type|actions|deps|path|lines`

**Example:**
```
TaskExecutor|O|exe.dec.heal|CG.SH|codex/TaskExecutor.ts|1800
```

**Type Codes:**
- `O` = orchestrator
- `F` = facade
- `S` = service
- `M` = manager
- `E` = engine
- `H` = handler

### 2. DEPARTMENT Schema

**Format:** `name|role|actions|agents|phase|path`

**Example:**
```
Researcher|D|ana.map.sca|dep_analyzer.pattern_finder|1|codex/departments/
```

**Role Codes:**
- `D` = discovery
- `G` = design
- `I` = implementation
- `Q` = quality
- `R` = reliability

### 3. MCP_TOOL Schema

**Format:** `name|action|params|returns|uses`

**Example:**
```
god_store|store_mem|content:s.tags:a.importance:n|id.lscore|persist.track
```

**Param Type Codes:**
- `s` = string
- `n` = number
- `b` = boolean
- `a` = array
- `o` = object

### 4. CAPABILITY Schema

**Format:** `name|actions|langs|apis|path`

**Example:**
```
LSP|goto.refs.diag|ts.js|definition().references()|capabilities/
```

### 5. WORKFLOW Schema

**Format:** `name|steps|actors|budget`

**Example:**
```
self_heal|fail.analyze.alt.retry|SH.AF.CG|16K
```

### 6. CONFIG Schema

**Format:** `name|vars|defaults`

**Example:**
```
RUBIX|OPENAI_KEY.ANTHROPIC_KEY.MODEL|opus.5000.16000
```

### 7. ERROR_PATTERN Schema

**Format:** `id|symptom|root|fix|file`

**Example:**
```
I001|cap_no_init|getcap_skip_init|add_await|mcp-server.ts
```

### 8. SUCCESS_PATTERN Schema

**Format:** `name|factors|rate|context`

**Example:**
```
retry_think|ext_budget.alt_approach|85|complex_code
```

### 9. SYSTEM Schema

**Format:** `name|modes|core|storage|embed`

**Example:**
```
god-agent|mcp.cli.daemon|TE.ME.CG|sqlite.hnsw|768
```

**Mode Codes:** mcp, cli, daemon, server, standalone, bot

**Storage Codes:** sqlite, postgres, redis, hnsw, vector

### 10. BUG_FIX Schema

**Format:** `id|status|symptom|root|fix|file|lesson`

**Example:**
```
I001|F|cap_err|no_init|await_init|mcp-server.ts|always_init_mgrs
```

**Status Codes:**
- `F` = fixed
- `O` = open
- `W` = work in progress

### 11. DEV_FEATURE Schema

**Format:** `name|type|purpose|path|exports|wiring`

**Example:**
```
Compression|M|token_efficiency|memory/|encode.decode|MemoryEngine
```

**Type Codes:**
- `M` = module
- `E` = enhancement
- `R` = refactor

### 12. ARCH_INSIGHT Schema

**Format:** `name|type|insight|pattern|rule|comps`

**Example:**
```
async_init|L|mgrs_need_init|lazy_init|always_await|CM.TE
```

**Type Codes:**
- `L` = lesson
- `P` = pattern
- `R` = rule

### 13. CONVERSATION Schema

**Format:** `task_id|department|attempt|model|tools|files|outcome|duration|error|summary`

**Example:**
```
TSK001|engineer|2|S|R3.E2.B1|src/foo.ts.src/bar.ts|S|45000||refactored_auth
```

**Tool Encoding:** `R3.E2.B1` = Read(3), Edit(2), Bash(1)

**Model Codes:** `S` = Sonnet, `O` = Opus

**Outcome Codes:** `S` = Success, `F` = Failed

### 14. CONTEXT_BUNDLE Schema (Phase 1)

**Format:** `CTX|task_id|desc|files:path1,path2|mem:id1.id2|deps:d1.d2|patterns:p1.p2|style`

**Example:**
```
CTX|TSK001|build_auth_system|files:src/auth/,src/types/|mem:abc123.def456|deps:express.jwt|patterns:snake.vitest|style:ts.strict
```

### 15. DESIGN Schema (Phase 2)

**Format:** `DES|comps:c1.c2|models:m1.m2|files:dir1/,dir2/|apis:a1.a2|notes`

**Example:**
```
DES|comps:AuthCtrl.JWTSvc|models:User.Session|files:auth/,types/|apis:login.logout|notes:stateless_jwt
```

### 16. EXEC_PLAN Schema (Phase 3)

**Format:** `PLAN|dept|ops:C:path1,M:path2,D:path3|cmd:c1.c2|conf:0.85|notes`

**Example:**
```
PLAN|eng|C:src/auth/login.ts,M:src/types/user.ts|cmd:npm.test|conf:0.9|notes:add_bcrypt
```

**Operation Codes:**
- `C` = Create
- `M` = Modify
- `D` = Delete

**Department Codes:** eng (engineer), val (validator), gua (guardian)

### 17. VALIDATION Schema (Phase 4)

**Format:** `VAL|approve:1|tests:t1.t2|sec:s1.s2|perf:p1|mods:M:path.change|block:reason`

**Example:**
```
VAL|approve:1|tests:unit.integ|sec:|perf:|mods:|block:
```

**Approve:** `1` = approved, `0` = rejected

**Test Types:** unit, integration, e2e, smoke, regression

**Security Issues:** xss, sqli, csrf, ssrf, injection, auth, secret, hardcoded

**Performance Issues:** n+1, slow, memory, leak, bottleneck, blocking

### 18. GENERIC Schema

Passthrough with filler word removal:

```typescript
// Strips:
- articles (a, an, the)
- pronouns (you, I, we, they, he, she, it)
- pleasantries (please, thanks, thank you)
- hedging (maybe, might, could, would, should)
- intensifiers (basically, actually, really, very, just)
// Collapses whitespace
```

## Helper Functions

```typescript
// Convert name to initials
toInitials("TaskExecutor") → "TE"

// Compress action list
compressActions(["execute", "decompose", "heal"]) → "exe.dec.heal"

// Expand action list
expandActions("exe.dec.heal") → ["execute", "decompose", "heal"]

// Sanitize to snake_case
sanitize("Hello World!", 20) → "hello_world"

// Encode tool usage
encodeToolsUsed([{tool: "Read", count: 3}, {tool: "Edit", count: 2}]) → "R3.E2"

// Decode tool usage
decodeToolsUsed("R3.E2") → [{tool: "Read", count: 3}, {tool: "Edit", count: 2}]
```

## Compression Ratios by Type

| Type | Typical Reduction |
|------|------------------|
| Component | 65-75% |
| Department | 60-70% |
| MCP Tool | 50-65% |
| Capability | 55-70% |
| Workflow | 50-60% |
| Config | 40-55% |
| Error Pattern | 45-60% |
| Success Pattern | 40-55% |
| System | 60-75% |
| Bug Fix | 55-70% |
| Dev Feature | 50-65% |
| Arch Insight | 55-70% |
| Generic | 30-40% |

## Token Savings

```
1 character ≈ 0.25 tokens (average)
Example: 400 chars → 100 chars = 300 chars saved ≈ 75 tokens
```
