# RUBIX vs Claude-Flow: Comparison & Integration Research

**Date:** 2026-01-17
**Purpose:** Evaluate features RUBIX should borrow from Claude-Flow and integration strategies

---

## Overview

| Project | Philosophy | Architecture |
|---------|------------|--------------|
| **RUBIX** | Single autonomous agent with human escalation | Sequential 6-phase pipeline |
| **Claude-Flow** | Swarm intelligence with 54+ agents | Distributed multi-agent with topologies |

---

## RUBIX Architecture (PhasedExecutor)

```
Phase 1: CONTEXT SCOUT (CLI Opus)  → CTX tokens
Phase 2: ARCHITECT (CLI Opus)      → DES tokens
Phase 3: ENGINEER (API Sonnet)     → PLAN tokens + files
Phase 4: VALIDATOR (API Sonnet)    → VAL tokens
Phase 5: EXECUTOR (Local)          → EXEC tokens
Phase 6: FIX LOOP (Sonnet → Opus)  → Error recovery
```

### Key Components
- **PhasedExecutor.ts** - Main orchestrator (~1080 lines)
- **ClaudeCodeExecutor.ts** - CLI execution with quota/downgrade detection
- **ContextScout.ts** - Codebase analysis
- **ClaudeReasoner.ts** - Design and planning
- **PlanValidator.ts** - Plan review
- **PlanExecutor.ts** - File writing and command execution

### Execution Strategy
- CLI Opus for thinking (Phases 1-2): complex reasoning, MCP access
- API Sonnet for doing (Phases 3-4): fast implementation
- Fix loop escalates: Sonnet → Sonnet+think → Opus → Opus+think

---

## Claude-Flow Architecture

**Source:** https://github.com/ruvnet/claude-flow

### Core Components

```
┌─────────────────────────────────────────────────────────┐
│                     USER LAYER                          │
│         Claude Code (MCP) or CLI interface              │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│                   ROUTING LAYER                         │
│  Q-Learning Router │ Mixture of Experts (8 networks)    │
│  42+ skills │ 17 hooks                                  │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│               SWARM COORDINATION                        │
│  Topologies: mesh, hierarchical, ring, star             │
│  Consensus: Raft, Byzantine, Gossip, CRDT               │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│                  AGENT POOL                             │
│          54+ specialized agents                         │
│  coder, tester, reviewer, architect, security...        │
└─────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────────────────────────────────────┐
│             INTELLIGENCE (RuVector)                     │
│  SONA: self-optimizing (<0.05ms adaptation)             │
│  EWC++: prevents catastrophic forgetting                │
│  HNSW: 150x-12,500x faster retrieval                    │
│  LoRA: 128x memory reduction                            │
└─────────────────────────────────────────────────────────┘
```

### Key Differentiators
- **54+ specialized agents** working in parallel swarms
- **4 swarm topologies** (mesh, hierarchical, ring, star)
- **5 consensus protocols** (Raft, Byzantine, Gossip, CRDT)
- **Multi-provider LLM** support (Claude, GPT, Gemini, Ollama)
- **175+ MCP tools**
- **85% cost savings** through intelligent model tier routing

---

## Feature Comparison

| Aspect | RUBIX | Claude-Flow |
|--------|-------|-------------|
| Execution Model | Sequential 6-phase | Parallel swarm |
| Agent Count | Single (model escalation) | 54+ specialized |
| LLM Providers | Claude only | Multi-provider with failover |
| Human Escalation | 6-channel fallback | Queen-led hierarchy |
| Learning | Sona + EWC++ | SONA + EWC++ (similar) |
| Memory | HNSW + L-Score provenance | HNSW + LoRA compression |
| MCP Tools | ~90 | 175+ |
| Cost Optimization | CLI/API split | Intelligent tier routing |

---

## Features RUBIX Should Borrow

### HIGH PRIORITY

#### 1. Multi-Provider LLM Routing
**Current:** Claude-only (CLI + API)
**Needed:** Failover chain when quota exhausted

```
Claude CLI (Opus)
    ↓ quota exhausted
Claude API (Sonnet)
    ↓ rate limited
OpenAI GPT-4
    ↓ unavailable
Google Gemini
    ↓ unavailable
Local Ollama
```

**Implementation:** Extend ProviderFactory.ts to support OpenAI/Gemini clients

#### 2. Parallel Engineer Phase
**Current:** Phase 3 generates files sequentially
**Needed:** Parallel file generation for multi-file tasks

```
Current:   file1 → file2 → file3 → file4  (serial)

Parallel:  file1 ──┐
           file2 ──┼──→ merge
           file3 ──┤
           file4 ──┘
```

**Implementation:** When `plan.files.length > 3`, spawn parallel workers

#### 3. Cost-Based Model Routing
**Needed:** Select model based on task complexity

```typescript
// Simple: typo, rename → Haiku
// Medium: bug fix, update → Sonnet
// Complex: refactor, feature → Opus
```

### MEDIUM PRIORITY

#### 4. Background Workers
Claude-Flow has 12 auto-triggered worker types:
- File-change watchers
- Dependency monitors
- Security scan triggers

RUBIX has SchedulerDaemon but could expand reactive triggers.

#### 5. Skills Composition
Claude-Flow: 42+ pre-built skills with native composition
RUBIX: Monolithic tool approach

Could benefit from modular skill system.

### LOWER PRIORITY (RUBIX already has similar)

- EWC++ learning (both have)
- HNSW vector search (both have)
- Sona learning engine (both have)
- Memory provenance (RUBIX L-Score may be more sophisticated)

---

## Integration Strategy: RUBIX Using Claude-Flow

### Option A: Claude-Flow as Swarm Backend

RUBIX remains the "brain" but delegates to Claude-Flow for parallel execution:

```
┌─────────────────────────────────────────────────────────┐
│                    RUBIX (God-Agent)                    │
│  Memory + Provenance + Escalation + Human Communication │
└───────────────────────────┬─────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  Single Task │  │  Swarm Task  │  │  Background  │
  │  (RUBIX own) │  │  (delegate)  │  │   Workers    │
  └──────────────┘  └──────┬───────┘  └──────────────┘
                           │
                           ▼
                ┌────────────────────┐
                │    CLAUDE-FLOW     │
                │  (MCP or Process)  │
                └────────────────────┘
```

### Option B: MCP Server Integration

Both running as MCP servers, Claude Code orchestrates:

```json
{
  "mcpServers": {
    "rubix": { "command": "node", "args": ["rubix/dist/mcp-server.js"] },
    "claude-flow": { "command": "npx", "args": ["claude-flow", "mcp"] }
  }
}
```

### Option C: Subprocess Spawning

RUBIX spawns Claude-Flow for swarm tasks:

```typescript
const { stdout } = await execAsync(
  `npx claude-flow swarm --topology mesh --task "${task}"`,
  { timeout: 300000 }
);
```

---

## Recommended Integration Point

**Phase 3 (ENGINEER)** in PhasedExecutor is the ideal delegation point:

```typescript
// In PhasedExecutor.execute()
if (design.files.length > 3 && await this.isClaudeFlowAvailable()) {
  console.log('[PhasedExecutor] Delegating to Claude-Flow swarm...');
  const swarmResult = await this.delegateToClaudeFlow(context, design);
  result.phases.plan = swarmResult;
  // Continue to Phase 4 (Validator)
}
```

---

## Decision Matrix: When to Delegate

| Condition | Use RUBIX | Delegate to Claude-Flow |
|-----------|-----------|------------------------|
| Single file change | ✓ | |
| 2-3 files, sequential deps | ✓ | |
| 4+ files, independent | | ✓ |
| Complex refactoring | | ✓ |
| Bug fix | ✓ | |
| New feature across modules | | ✓ |

---

## Implementation Roadmap

| Phase | Feature | Effort | Priority |
|-------|---------|--------|----------|
| 1 | Add OpenAI/Gemini to ProviderFactory | 2-3 days | HIGH |
| 2 | Cost-based model routing | 1-2 days | HIGH |
| 3 | Claude-Flow detection bridge | 1 day | MEDIUM |
| 4 | Parallel engineer workers | 3-4 days | HIGH |
| 5 | `god_swarm_execute` MCP tool | 2-3 days | MEDIUM |
| 6 | Background worker expansion | 3-4 days | LOW |

---

## Notes

### CodeGenerator.ts Status
CodeGenerator.ts appears to be **legacy code** since RUBIX now uses PhasedExecutor. Consider:
- Removing it entirely
- Or keeping as API-only edge case fallback

PhasedExecutor already has API Sonnet calls built-in (Phases 3-4 + fix loop).

### Shared Technology
Both projects use similar underlying tech:
- EWC++ regularization
- HNSW vector search
- Sona-style learning
- Memory compression

This suggests potential for code sharing or standardization.
