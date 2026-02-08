# /learn-style — Learn User Working Style

Analyze the current session to observe and store user working style preferences.

## Instructions

Follow these steps exactly:

1. **Analyze the current session.** Review the conversation and identify patterns in:
   - **Instruction style**: Terse commands vs detailed specs? References to prior context?
   - **Corrections**: What does the user push back on? (over-engineering, verbosity, missing context, wrong assumptions)
   - **Preferences**: File naming, commit message style, communication tone, code style
   - **Workflow**: Plan first vs dive in? Parallel vs sequential? How they handle errors?
   - **Tool usage**: Which tools/skills they prefer? How they interact with the system?

2. **Query existing style memories.** Call `god_query` with query `"user working style preferences"` and filter by tags `['user_style', 'core_memory']`.

3. **Diff observations.** Compare new observations against existing stored style memories. Only keep net-new insights or updates to existing observations. Do NOT store duplicates.

4. **If there are new insights**, store them. Call `god_store` with:
   - `content`: The new style observations, written as clear preference statements (e.g., "User prefers terse instructions and dislikes verbose explanations")
   - `tags`: `['user_style', 'core_memory', 'always_recall']`
   - `importance`: `1.0`

5. **Report.** Show what new style observations were stored (or note that existing observations are already up to date). List the key style traits identified.
