# /stm — Store To Memory

Synthesize recent conversation into a memory entry with user-specified tags and importance.

## Instructions

Follow these steps exactly:

1. **Determine scope.** If the user provided a number N after `/stm`, use the last N messages. Default to the last 5 messages if unspecified.

2. **Synthesize.** Review the specified messages and create a concise memory entry that captures:
   - The core information, decision, or insight
   - Relevant context (why it matters)
   - Any actionable patterns or takeaways

3. **Ask the user for metadata.** Use AskUserQuestion with these questions:
   - "What tags should this memory have?" — Options: "architecture", "bugfix", "pattern", "decision" (user can type custom)
   - "How important is this? (0.0-1.0)" — Options: "1.0 - Critical/always recall", "0.8 - High", "0.5 - Normal", "0.3 - Low"
   - "Quality score for recent queries?" — Options: "0.9 - Very relevant", "0.7 - Helpful", "0.5 - Okay", "Skip"

4. **Store the memory.** Call `god_store` with:
   - `content`: The synthesized text
   - `tags`: User-specified tags
   - `importance`: User-specified importance

5. **Provide learning feedback.** If the user gave a quality score (not "Skip") and there was a recent `god_query` with `_learning.trajectoryId` or `_learning.queryId`, call `god_learn` with that score.

6. **Report.** Show the stored entry summary and confirm tags/importance.
