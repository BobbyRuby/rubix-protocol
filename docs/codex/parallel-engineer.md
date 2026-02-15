# Parallel Engineer

**File:** `src/codex/ParallelEngineer.ts` (~350 lines)

Handles high-complexity tasks by parallelizing component engineering. Takes a list of components with dependencies, performs topological sort, groups independent components into batches, and executes batches in parallel.

## Purpose

When PhasedExecutor's Phase 2 (Architect) produces a design with multiple components that have inter-dependencies, the ParallelEngineer orchestrates their generation. Instead of sequential one-at-a-time engineering, independent components run in parallel while respecting dependency order.

## Key Concepts

### Topological Sort

Components are sorted via DFS traversal of the dependency graph. Dependencies are visited before dependents, producing a linear execution order.

```
Input:  [API(deps:[]), Models(deps:[]), Service(deps:[Models]), Controller(deps:[Service, API])]
Sorted: [API, Models, Service, Controller]
```

### Batch Grouping

After sorting, components are grouped into batches where all dependencies within a batch are already completed. Independent components run in the same batch via `Promise.all`.

```
Batch 1: [API, Models]      ← no dependencies, run in parallel
Batch 2: [Service]          ← depends on Models (completed in batch 1)
Batch 3: [Controller]       ← depends on Service and API (both completed)
```

### Dependency Context Injection

Each component's engineer prompt includes the completed source code from its dependencies, so the LLM can generate correct imports and interfaces.

### Circular Dependency Protection

If `getBatches()` produces an empty batch (no components have all deps satisfied), remaining components are forced into a single batch with a warning. This prevents infinite loops.

### Provider-Agnostic Execution

ParallelEngineer accepts an `EngineerProvider` interface, making it backend-agnostic. The provider creates an `EngineerFn` (prompt string in, response string out) that can target Claude, Ollama, or other LLMs.

## Input / Output

**Input:** `ComponentDependency[]` from Phase 2 -- each has `name`, `file`, `dependencies[]`.

**Output:** Merged `PlanOutput` with all `files[]`, `operations[]` (C/M/D per file), `confidence` (0.9 all succeed, 0.6 if any fail), and summary notes.

## Integration with PhasedExecutor

```
Phase 2 (ARCHITECT) → DesignOutput { complexity: 'high', componentDependencies[] }
Phase 3 (ENGINEER)  → complexity === 'high'?
  → ParallelEngineer.executeInOrder(context, design)
  → Returns merged PlanOutput with all component files
```

## File Parsing

Engineer responses must use `<file path="..." action="create|modify|delete">` XML blocks. If no `<file>` blocks are found, falls back to extracting the first markdown code block.

## Usage Example

```typescript
const provider = new ClaudeEngineerProvider(apiKey);
const parallel = new ParallelEngineer(provider);

const plan = await parallel.executeInOrder(contextBundle, designOutput);
// Logs: "[ParallelEngineer] 3 batches to execute"
// Logs: "[ParallelEngineer] Complete: 4 succeeded, 0 failed, 6 total files"
```

## Next Steps

- [Phased Executor](phased-executor.md) - Full 6-phase execution pipeline
- [Self Healer](self-healer.md) - Recovery when components fail
