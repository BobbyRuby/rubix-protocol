# Skill Detector

**File:** `src/codex/SkillDetector.ts` (~430 lines)

Detects programming languages, frameworks, and domain skills needed for a task. Uses detected skills to load relevant polyglot knowledge from memory and core brain. Enables automatic knowledge injection into CODEX execution context.

## Purpose

SkillDetector bridges task descriptions and stored knowledge. Given "Build a Laravel REST API with authentication", it detects `polyglot:laravel`, `polyglot:api`, `polyglot:auth` and queries both local project memory and the shared core brain for relevant patterns, conventions, and best practices. This knowledge is injected into the CODEX prompt before code generation.

## Key Concepts

### Skill Detection

A keyword-to-tag mapping (`SKILL_TAG_MAP`) maps ~80 keywords to polyglot tags:

| Category | Keywords | Tags |
|----------|----------|------|
| Frameworks | laravel, django, rails, nextjs, springboot | `polyglot:laravel`, etc. |
| Languages | javascript, typescript, python, php | `polyglot:javascript`, etc. |
| Patterns | api, rest, database, auth, deploy | `polyglot:api`, `polyglot:auth`, etc. |
| Tools | playwright, jest, eslint, vite, git | `polyglot:playwright`, `polyglot:testing`, etc. |
| 3D/Spatial | three.js, babylon, leaflet, a-frame | `polyglot:threejs`, `polyglot:leaflet`, etc. |

Short keywords (<=3 chars) use word-boundary regex matching to avoid false positives. Longer keywords use simple `includes()`. Regex patterns are cached at module level for performance.

### Multi-Source Knowledge Loading

`loadPolyglotContext()` queries multiple memory engines:

1. **Local memory** - Project-specific patterns and conventions
2. **Core brain** - Cross-project shared knowledge (via `additionalEngines`)

Results are merged, sorted by score, deduplicated, and the top 15 entries are formatted for prompt injection. Each entry is labeled `[Local]` or `[Shared]` for source attribution.

### Context Format and Ranking

Injected into CODEX prompts under `## POLYGLOT KNOWLEDGE (auto-loaded)` with `[Local]` or `[Shared]` labels per entry. Results are ranked by vector similarity score, filtered at `minScore: 0.2`, and truncated at 800 characters per entry.

## Integration with PhasedExecutor

```
Phase 1 (CONTEXT_SCOUT)
  → detectSkills(taskDescription) → ['polyglot:laravel', 'polyglot:auth']
  → loadPolyglotContext(engine, skills, [coreBrainEngine])
  → ContextBundle includes polyglot knowledge
  → Passed to Phase 2 (ARCHITECT) and Phase 3 (ENGINEER) prompts
```

## Usage Example

```typescript
import { detectSkills, loadPolyglotContext } from './SkillDetector.js';

const skills = detectSkills("Add JWT authentication to Express API");
// → ['polyglot:auth', 'polyglot:nodejs', 'polyglot:api']

const context = await loadPolyglotContext(localEngine, skills, [coreBrain]);
// → { context: "## POLYGLOT KNOWLEDGE...", entriesFound: 8, localCount: 3, sharedCount: 5 }
```

## Populating Knowledge

Store polyglot knowledge with appropriate tags:

```typescript
await mcp__rubix__god_store({
  content: "Express JWT auth: use passport-jwt strategy, RS256 for rotation...",
  tags: ['polyglot:nodejs', 'polyglot:auth', 'best_practice'],
  importance: 0.9
});
```

## Next Steps

- [Phased Executor](phased-executor.md) - Phase 1 Context Scout integration
- [Memory System](../architecture/memory-system.md) - Storage and query infrastructure
