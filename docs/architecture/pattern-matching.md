# Pattern Matching System

**File:** `src/pattern/PatternMatcher.ts` (~435 lines)

Template-based pattern matching for structured information extraction from text. Patterns have named slots that get filled with context. Tracks usage statistics to prioritize effective patterns and prune underperformers.

## Purpose

PatternMatcher registers reusable templates with slot placeholders (e.g., `"User {name} wants to {action}"`), compiles them to regex, and matches incoming text against all registered patterns. Results are ranked by priority and confidence. Usage tracking enables the system to learn which patterns are effective over time.

## Key Concepts

### PatternTemplate

```typescript
interface PatternTemplate {
  id: string;
  name: string;
  pattern: string;          // e.g., "User {name} wants to {action}"
  slots: PatternSlot[];     // Typed placeholders
  priority: number;         // Higher = matched first
  createdAt: Date;
}
```

### Slot Types

| Type | Regex | Example Match |
|------|-------|---------------|
| `text` | `[\w\s]+?` | Words and spaces |
| `entity` | `[A-Z][a-z]+` | Capitalized names |
| `date` | Date formats | `2024-01-15`, `Jan 15, 2024` |
| `number` | `-?\d+(\.\d+)?` | `42`, `-3.14` |
| `any` | `.+?` | Anything (non-greedy) |

### PatternMatch

Results include: `templateId`/`templateName`, `confidence` (coverage ratio + priority bonus), `bindings` (extracted slot values), and `matchedText` with position indices.

### Usage Statistics and Pruning

Each pattern tracks `useCount`, `successCount`, `successRate`, `lastUsedAt` in the `pattern_stats` table. Call `recordUse(patternId, success)` after using a match result. Patterns with success rate below `pruneThreshold` (0.4) and minimum `pruneMinUses` (100) are pruned automatically.

## Configuration

```typescript
interface PatternMatcherConfig {
  caseSensitive: boolean;  // Regex flags
  minConfidence: number;   // Filter low-quality matches
  maxMatches: number;      // Limit results per query
  pruneThreshold?: number; // Success rate cutoff (0.4)
  pruneMinUses?: number;   // Min uses before pruning (100)
}
```

## Usage Example

```typescript
// Register, match, and record outcome
const template = matcher.registerTemplate('deploy_request',
  'Deploy {service} to {environment}',
  [{ name: 'service', type: 'text', required: true },
   { name: 'environment', type: 'text', required: true }], 5);

const matches = matcher.match('Deploy auth-api to production');
// → [{ bindings: { service: 'auth-api', environment: 'production' }, confidence: 0.92 }]
matcher.recordMatchUse(matches[0], true);
```

## Storage

Persisted in SQLite tables `pattern_templates` and `pattern_stats`. MemoryEngine exposes `matchPatterns(text)` and `getPatternMatcher()` as facade methods.

## Next Steps

- [Memory System](memory-system.md) - MemoryEngine facade integration
- [Learning System](learning-system.md) - Sona/MemRL quality tracking
