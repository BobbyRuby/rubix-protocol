# Glossary

Terms and definitions used throughout the RUBIX/god-agent documentation.

---

## A

### AST (Abstract Syntax Tree)
A tree representation of source code structure. Used for code analysis and safe refactoring operations.

### Async Write Queue
Non-blocking queue for database writes that batches operations for efficiency.

---

## B

### Bootstrap
The process of initializing god-agent's self-knowledge by embedding its own architecture into memory.

---

## C

### Causal Relation
A relationship between memory entries indicating cause-and-effect or temporal ordering. Types include: causes, enables, prevents, correlates, precedes, triggers.

### Circuit Breaker
Protection mechanism that suspends failing routes/operations after repeated failures, with automatic recovery testing.

### CODEX
The autonomous task execution system (now called RUBIX). Decomposes tasks, generates code, self-heals, and escalates when blocked.

### Collaborative Partner
Component that provides proactive curiosity, challenges decisions, and enforces confidence gates.

### Compression Schema
Positional token format for efficiently storing different types of information. 18 schemas exist for different data types.

### Containment Manager
Security component that enforces path-based permissions, preventing access to sensitive files.

### Context Bundle
Compressed package of task context including description, files, memory, dependencies, patterns, and style guidelines.

### Curiosity Probe
A question generated during task execution that can be explored for learning. Origins: failure, low_confidence, knowledge_gap, success_confirmation.

---

## D

### Deep Work Mode
Focus mode that batches notifications and minimizes interruptions during task execution. Focus levels: shallow, normal, deep.

### Department Head
In RUBIX mode, one of 5 specialized agents: Researcher, Architect, Engineer, Validator, Guardian.

---

## E

### Embedding
A dense vector representation of text (768 dimensions) used for semantic similarity search.

### Embedding Cache
LRU cache storing computed embeddings to avoid redundant API calls.

### Escalation
The process of requesting human intervention when RUBIX cannot proceed autonomously. Triggered by the EscalationGate.

### Escalation Gate
Component that decides when to escalate vs. make autonomous decisions based on hard rules and context.

### EWC++ (Elastic Weight Consolidation Plus Plus)
Regularization technique that prevents catastrophic forgetting by protecting important weights during learning.

---

## F

### Failure Memory
Specialized memory for storing and learning from failures, enabling pattern recognition and avoidance.

### Fisher Information
Statistical measure of parameter importance used by EWC++ to determine which weights to protect.

---

## G

### GNN (Graph Neural Network)
Enhancement layer that enriches embeddings using graph structure (provenance, causal relations) via message passing.

### god_* Tools
MCP tools exposed by god-agent (80+ total). Named with `god_` prefix for namespacing.

---

## H

### Hard Gate
Strict threshold that blocks execution when credibility or L-Score falls below minimum acceptable levels.

### HNSW (Hierarchical Navigable Small World)
Efficient approximate nearest neighbor search algorithm used for vector similarity search.

### Hyperedge
Causal relation supporting n-to-m connections (multiple sources to multiple targets).

---

## L

### Learning Integration
Component that connects CODEX execution with the Sona learning engine for continuous improvement.

### LoRA (Low-Rank Adaptation)
Efficient weight update technique using delta weights rather than full parameter updates.

### L-Score
Provenance reliability score (0-1) calculated from parent entries. Decays with lineage depth.

### LSP (Language Server Protocol)
Standard protocol for language intelligence features like go-to-definition, find references, and diagnostics.

---

## M

### MCP (Model Context Protocol)
Anthropic's protocol for Claude to interact with external tools and services. god-agent exposes 80+ MCP tools.

### Memory Entry
A stored piece of information with content, tags, importance, source, and provenance tracking.

### MemoryEngine
Central facade providing unified access to all memory operations, learning, routing, and compression.

---

## O

### Ollama
Local LLM server used as fallback for compression and reasoning when Claude API is unavailable.

---

## P

### Pattern Template
Reusable pattern stored in memory that can be applied to similar future tasks.

### Phased Executor
6-phase tokenized execution pipeline: context gathering, planning, implementation, verification, integration, cleanup.

### Playwright
Browser automation library used for visual verification and testing.

### Positional Tokens
Compressed format using fixed positions and delimiters (|, →, .) to encode structured information.

### Probe
See Curiosity Probe.

### Provenance
Information about the origin and reliability of data. Tracked via parent entries and L-Score.

---

## R

### Route
One of 7 reasoning strategies: pattern_match, causal_forward, causal_backward, temporal_causal, hybrid, direct_retrieval, adversarial.

### RUBIX
The autonomous developer agent system (formerly CODEX). Executes tasks through 5 department heads.

---

## S

### Self-Healer
Component that analyzes failures and suggests alternative approaches based on error patterns and past experience.

### Session Permission
Temporary path access granted for the current session, cleared on server restart.

### Shadow Search
Adversarial search that finds contradictory evidence by inverting query embeddings.

### Sona Engine
Trajectory-based learning system that improves retrieval quality from user feedback.

### Subtask
A decomposed unit of work from a larger task. Types: research, design, code, test, integrate, verify, review.

---

## T

### Task Decomposer
Component that breaks high-level tasks into ordered subtasks with dependencies.

### TaskExecutor
Main orchestrator that coordinates all CODEX/RUBIX components for task execution.

### TinyDancer
Neural query router that selects optimal reasoning strategies based on query analysis.

### Token Budget
Maximum tokens allocated for specific operations (thinking, exploration, etc.).

### Trajectory
A record of query execution including query, matches, scores, and optional feedback.

### TTL (Time To Live)
Expiration time for causal relations, allowing temporal correlations to naturally expire.

---

## U

### Ultrathink
Extended thinking mode that allocates additional token budget (up to 16K) for complex reasoning.

---

## V

### Vector DB
HNSW-based vector database storing embeddings for semantic similarity search.

---

## W

### Warn Gate
Threshold that triggers warnings when credibility or L-Score falls below acceptable levels but allows continuation.

### Weight Manager
Component managing LoRA-style delta weights with checkpointing and rollback support.

### Working Memory Manager
Component managing active/relevant memories for current task context.

---

## Abbreviations

| Abbrev | Meaning |
|--------|---------|
| AST | Abstract Syntax Tree |
| CLI | Command Line Interface |
| EWC | Elastic Weight Consolidation |
| GNN | Graph Neural Network |
| HNSW | Hierarchical Navigable Small World |
| LoRA | Low-Rank Adaptation |
| LSP | Language Server Protocol |
| LRU | Least Recently Used |
| MCP | Model Context Protocol |
| TTL | Time To Live |

---

## Compression Abbreviations

| Token | Meaning |
|-------|---------|
| comp | component |
| cfg | configuration |
| fn | function |
| impl | implementation |
| req | request |
| res | response |
| err | error |
| msg | message |
| dept | department |
| cap | capability |
| wf | workflow |

---

## Delimiters

| Symbol | Meaning |
|--------|---------|
| `\|` | Field separator |
| `→` | Flow/sequence/causation |
| `.` | List within field |
| `:` | Key-value pair |

## Next Steps

- [Environment Variables](environment-variables.md) - Configuration reference
- [File Reference](file-reference.md) - Complete file listing
- [Architecture Overview](../architecture/overview.md) - System design
