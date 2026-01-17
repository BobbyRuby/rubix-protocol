# Reference

Complete reference documentation for RUBIX/god-agent.

## Reference Documents

| Document | Description |
|----------|-------------|
| [Environment Variables](environment-variables.md) | All configuration variables |
| [File Reference](file-reference.md) | Complete source file listing |
| [Glossary](glossary.md) | Terms and definitions |

---

## Quick Links

### Configuration

- [Required API Keys](environment-variables.md#api-keys)
- [Memory Settings](environment-variables.md#memory-system)
- [RUBIX Settings](environment-variables.md#rubix-codex)
- [Communication](environment-variables.md#communication)

### Source Code

- [Core System](file-reference.md#core-system)
- [CODEX System](file-reference.md#codex-system)
- [Memory System](file-reference.md#memory-system)
- [Learning System](file-reference.md#learning-system)

### Terminology

- [CODEX/RUBIX](glossary.md#codex)
- [L-Score](glossary.md#l-score)
- [Sona Engine](glossary.md#sona-engine)
- [TinyDancer](glossary.md#tinydancer)

---

## MCP Tool Count

| Category | Tools |
|----------|-------|
| Memory | 10 |
| Causal | 4 |
| Learning/Routing | 12 |
| Scheduler | 7 |
| Playwright | 8 |
| CODEX | 7 |
| Partner | 3 |
| Containment | 6 |
| Capabilities | 40+ |
| Review | 4 |
| Notification | 6 |
| Deep Work | 6 |
| Config | 5 |
| Failure | 4 |
| Communication | 2 |
| Curiosity | 4 |
| **Total** | **128+** |

---

## Database Schema Summary

| Table | Purpose |
|-------|---------|
| `memory_entries` | Core memory storage |
| `memory_tags` | Entry tags |
| `provenance` | L-Score tracking |
| `causal_relations` | Hyperedge relations |
| `pattern_templates` | Reusable patterns |
| `scheduled_tasks` | Task definitions |
| `task_runs` | Execution history |
| `trajectories` | Learning trajectories |
| `pattern_weights` | Sona weights |
| `vector_mappings` | HNSW mappings |

---

## Compression Schemas

| # | Schema | Format |
|---|--------|--------|
| 1 | COMPONENT | `name\|type\|actions\|deps\|path\|lines` |
| 2 | DEPARTMENT | `name\|role\|actions\|agents\|phase\|path` |
| 3 | MCP_TOOL | `name\|action\|params\|returns\|uses` |
| 4 | CAPABILITY | `name\|actions\|langs\|apis\|path` |
| 5 | WORKFLOW | `name\|steps\|actors\|budget` |
| 6 | CONFIG | `name\|vars\|defaults` |
| 7 | ERROR_PATTERN | `id\|symptom\|root\|fix\|file` |
| 8 | SUCCESS_PATTERN | `name\|factors\|rate\|context` |
| 9 | SYSTEM | `name\|modes\|core\|storage\|embed` |
| 10 | BUG_FIX | `id\|status\|symptom\|root\|fix\|file\|lesson` |
| 11 | DEV_FEATURE | `name\|type\|purpose\|path\|exports\|wiring` |
| 12 | ARCH_INSIGHT | `name\|type\|insight\|pattern\|rule\|comps` |
| 13 | CONVERSATION | `task_id\|dept\|attempt\|model\|tools\|files\|outcome\|duration\|error\|summary` |
| 14 | CONTEXT_BUNDLE | `CTX\|task_id\|desc\|files\|mem\|deps\|patterns\|style` |
| 15 | DESIGN | `DES\|comps\|models\|files\|apis\|notes` |
| 16 | EXEC_PLAN | `PLAN\|dept\|ops\|cmd\|conf\|notes` |
| 17 | VALIDATION | `VAL\|approve\|tests\|sec\|perf\|mods\|block` |
| 18 | GENERIC | Filler word removal |

---

## Routing Strategies

| Route | Description | Use When |
|-------|-------------|----------|
| `pattern_match` | Find similar patterns | Historical context |
| `causal_forward` | What does X cause? | Impact analysis |
| `causal_backward` | What caused X? | Root cause |
| `temporal_causal` | Time-based chains | Event sequences |
| `hybrid` | Pattern + causal | Complex queries |
| `direct_retrieval` | Simple vector search | Basic lookup |
| `adversarial` | Find contradictions | Risk assessment |

---

## Escalation Rules

### Hard Rules (Must Escalate)

1. Critical spec ambiguity
2. Max attempts exceeded (default: 3)
3. High impact irreversible action
4. Security-sensitive changes
5. Breaking API changes

### Autonomous Decisions

1. Minor ambiguity (can assume)
2. Known error pattern
3. Dependency minor versions
4. Code formatting
5. Variable naming

## Next Steps

- [Tools Overview](../tools/index.md) - Complete tool reference
- [Architecture](../architecture/overview.md) - System design
- [Getting Started](../getting-started/quick-start.md) - Setup guide
