# /recall — Load Relevant Memories

Load relevant memories from god-agent memory to enrich session context.

## Usage

- `/recall` — Auto-detect context and load relevant memories
- `/recall <topic>` — Load memories for a specific topic

## Instructions

Follow these steps exactly:

1. **Determine the query.** If the user provided a topic after `/recall`, use that. Otherwise, analyze the current conversation context to determine what topics would be most useful to recall.

2. **Query core memories.** Call `god_query` with:
   - `query`: "core memory always recall user style preferences decisions"
   - `topK`: 10
   - `filters`: `{ "tags": ["always_recall"] }`

3. **Query session history.** Call `god_query` with:
   - `query`: "recent session progress decisions patterns"
   - `topK`: 5
   - `filters`: `{ "tags": ["session"] }`

4. **Query topic-specific memories (if topic provided).** Call `god_query` with:
   - `query`: The user-specified topic or auto-detected context
   - `topK`: 10

5. **Deduplicate and summarize.** Merge results, remove duplicates by entry ID, and organize by category:
   - **Core Preferences**: User style, always-recall items
   - **Recent Sessions**: What was accomplished recently
   - **Relevant Context**: Topic-specific memories

6. **Report.** Display a concise summary of recalled memories, grouped by category. Show entry count and highlight anything particularly relevant to the current work.

7. **Provide learning feedback.** For any queries that returned `_learning.trajectoryId`, note these for later feedback via `god_learn`.
