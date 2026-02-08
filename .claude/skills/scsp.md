# /scsp — Store Current Session Progress

Store the current session's progress to god-agent memory with a quality score.

## Instructions

Follow these steps exactly:

1. **Check existing session entries for today.** Call `god_query` with query `"session progress"` and filter by tags `['session', '<YYYY-MM-DD>']` (use today's date). If entries exist, briefly show what was previously stored.

2. **Summarize new progress.** Review the conversation so far and identify:
   - What was accomplished (features, fixes, decisions)
   - Key decisions made and their rationale
   - Patterns discovered or applied
   - Files created or modified

3. **Ask for quality score.** Use AskUserQuestion:
   - Question: "How would you rate this session's productivity?"
   - Options: "0.9 - Excellent", "0.7 - Good", "0.5 - Average", "0.3 - Below average"

4. **Store session progress.** Call `god_session_store` with:
   - `summary`: Concise description of what was accomplished
   - `decisions`: Array of key decisions made
   - `patterns`: Array of patterns discovered or applied
   - `filesChanged`: Array of files modified
   - `tags`: `['session', '<YYYY-MM-DD>']`

5. **Provide learning feedback.** If any `god_query` calls were made during this session that returned `_learning.trajectoryId`, call `god_learn` with the user's quality score for each.

6. **Report.** Show a brief summary of what was stored and the quality score applied.
