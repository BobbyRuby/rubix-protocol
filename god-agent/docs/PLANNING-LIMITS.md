# Planning Session Limits

## TL;DR

**Planning is unlimited.** You can have 10, 50, 100, or 1000+ rounds of conversation.

---

## Architecture

```
ALL exchanges → saved to memory (unlimited)
                    │
                    ▼
            ┌───────────────────┐
            │ Semantic Search   │ ← Retrieves relevant past context
            └───────────────────┘
                    │
                    ▼
PROMPT = Last 5 exchanges + Top 15 semantic matches + Plan document + Decisions
```

Every exchange is stored to memory. Only a subset appears in the prompt to keep it lean.

---

## The "10" Limits Are Non-Blocking

| What | Location | Purpose |
|------|----------|---------|
| Local exchange cache | `PlanningSession.ts:457` | Just a cache, all exchanges saved to memory |
| Prompt exchanges | `PlanningSession.ts:190` | Only 5 in prompt, but semantic search adds more |
| Plan auto-update | `PlanningSession.ts:204` | Updates plan document every 10 exchanges |

These are **optimization limits**, not session limits.

---

## How Unlimited Works

### 1. Memory Storage
Every user/assistant exchange is stored via `storeExchange()`:
```typescript
await engine.store(content, {
  tags: ['planning', 'exchange', `session:${id}`],
  importance: 0.85,
  parentIds: [lastExchangeId]  // Creates chain
});
```

### 2. Semantic Retrieval
When continuing conversation, relevant past context is retrieved:
```typescript
const relevantContext = await engine.query(userMessage, {
  topK: 15,
  filters: { tags: [`session:${id}`] }
});
```

### 3. Prompt Construction
The prompt includes:
- Last 5 recent exchanges (for immediate continuity)
- Top 15 semantically relevant past exchanges
- Current plan document
- Key decisions made

---

## Tool Use Iterations

The `PlanningAgent` tool use loop is also unlimited:
```typescript
// PlanningAgent.ts:470-506
while (response.stop_reason === 'tool_use') {
  // No max limit - runs until Claude stops using tools
}
```

This allows Claude to read files, search code, fetch docs without hitting an iteration cap.

---

## Key Files

- `src/codex/PlanningSession.ts` - Session management, exchange storage
- `src/codex/PlanningAgent.ts` - Claude interface, tool execution
- `src/core/MemoryEngine.ts` - Semantic storage and retrieval

---

## Summary

| Aspect | Limit |
|--------|-------|
| Conversation rounds | **Unlimited** |
| Tool use iterations | **Unlimited** |
| Memory storage | **Unlimited** (all exchanges saved) |
| Prompt context | Optimized (5 recent + 15 semantic) |
