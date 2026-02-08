# /skills — List Available Skills

Show all available custom skills with descriptions and usage guidance.

## Instructions

Display this information:

### Available Skills

| Skill | Description | When to use |
|-------|-------------|-------------|
| `/recall` | Load relevant memories from god-agent | **Mandatory** at session start. Also useful mid-session to recover context. |
| `/scsp` | Store current session progress with quality score | Before ending a productive session. After completing a major milestone. |
| `/stm` | Store last N messages as a memory entry | When a significant decision is made. When discovering a useful pattern. When you want to remember specific context. |
| `/learn-style` | Observe and store user working style preferences | Periodically, or after the user corrects behavior. Stored as always-recall core memory. |
| `/update-cloud` | Deploy god-agent to remote cloud servers via SSH | When you need to push updates to production/dev servers. |
| `/skills` | This list | When you forget what's available. |

### Notes

- Claude can self-invoke these when appropriate (e.g., suggest `/scsp` before a session ends)
- `/recall` is automatically suggested at session start
- Style memories from `/learn-style` are auto-recalled every session via AutoRecall
- Use `/stm 10` to store the last 10 messages (default is 5)
