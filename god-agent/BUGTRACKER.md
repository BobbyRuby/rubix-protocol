# God-Agent Bug Tracker

## Fixed Issues

### BUG-001: Task marked "complete" when Claude asks questions instead of generating code
**Status:** FIXED (2026-01-10)

**Symptoms:**
- User sends `/task Create a calculator app`
- Claude responds with clarifying questions (not code)
- CODEX parses 0 files (correct - no `<file>` tags)
- Task marked "completed successfully" with 0 files
- Questions are lost - never sent to user

**Root Cause:**
CodeGenerator.generate() returned `success: false` with 0 files but didn't distinguish between:
1. Actual failure (error occurred)
2. Claude asking clarification questions before proceeding

TaskExecutor treated both as failures, but the task still completed because the subtask didn't have enough retries or the failure wasn't properly propagated.

**Fix Applied:**
1. `CodeGenerator.ts` - Added clarification pattern detection:
   - Patterns: `/clarify/`, `/before I can start/`, `/questions:/`, etc.
   - Returns `error: 'CLARIFICATION_NEEDED'` when detected

2. `TaskExecutor.ts` - Added handling in executeCode() and executeIntegration():
   - Detects `CLARIFICATION_NEEDED` error
   - Creates Escalation with Claude's questions
   - Sends via CommunicationManager to user (Telegram)
   - Waits for user response
   - Returns `CLARIFICATION_RECEIVED` with user's answer
   - executeSubtask adds clarification to context and retries

**Files Modified:**
- `src/codex/CodeGenerator.ts` (lines 137-161)
- `src/codex/TaskExecutor.ts` (lines 815-880, 492-500, 1035-1075)

---

### BUG-002: Telegram sendDocument crash with plain text buffer
**Status:** FIXED (2026-01-10)

**Symptoms:**
- Task completes with large result text (>1000 chars)
- TelegramHandler tries to send result as document
- Crash: `FatalError: EFATAL: Unsupported Buffer file-type`

**Root Cause:**
`node-telegram-bot-api` uses `file-type` package which reads magic bytes to detect file type. Plain text has no magic bytes, causing the crash.

**Fix Applied:**
Added explicit `contentType: 'text/plain; charset=utf-8'` to fileOptions in sendDocument call.

```typescript
await bot.sendDocument(chatId, Buffer.from(summary, 'utf8'), {
  caption: `Task result for: ${taskDescription}`
}, {
  filename: `task_${taskId}_result.txt`,
  contentType: 'text/plain; charset=utf-8'  // Fix
});
```

Also wrapped in try/catch since main message is sent separately.

**Files Modified:**
- `src/telegram/TelegramHandler.ts` (lines 161-172)

---

### BUG-003: Telegram 409 Conflict error - polling conflict
**Status:** FIXED (2026-01-10)

**Symptoms:**
- TelegramBot started for user commands
- CommunicationManager's TelegramChannel also polling same bot token
- Error: `409 Conflict: terminated by other getUpdates request`

**Root Cause:**
Two separate instances polling the same Telegram bot token simultaneously.

**Fix Applied:**
1. Added `sendOnlyMode` to TelegramChannel - disables polling, only sends
2. CommunicationManager.setTelegramBotActive(true) switches TelegramChannel to send-only
3. TelegramBot forwards escalation responses to CommunicationManager via handler.setComms()

**Files Modified:**
- `src/communication/channels/TelegramChannel.ts`
- `src/communication/CommunicationManager.ts`
- `src/telegram/TelegramHandler.ts`
- `src/telegram/TelegramBot.ts`
- `src/launch/telegram.ts`
- `src/launch/all.ts`

---

### BUG-004: Claude API 404 - Invalid model ID
**Status:** FIXED (2026-01-10)

**Symptoms:**
- CODEX fails to generate code
- Error: `404 Not Found`

**Root Cause:**
Model ID `claude-opus-4-5-20250514` doesn't exist.

**Fix Applied:**
Changed to correct model ID: `claude-opus-4-5-20251101`

**Files Modified:**
- `src/core/config.ts` (line 129)
- `src/codex/CodeGenerator.ts`

---

## Known Issues

### ISSUE-001: TaskDecomposer uses rule-based decomposition, not Claude API
**Status:** Known Limitation

The specification instruction to ask clarifying questions is passed through to CodeGenerator, but TaskDecomposer doesn't use Claude API for decomposition. It uses hardcoded rules.

The `buildDecomposePrompt()` method exists but `performDecomposition()` uses rule-based logic instead.

This means clarification questions only work at the CODE GENERATION stage, not during task decomposition.

**Potential Fix:**
Enable Claude API call in TaskDecomposer.decompose() to allow intelligent decomposition and early clarification.

---

## Testing Notes

After fixes, test with:
```
/task Create a calculator app on the D drive
```

Expected behavior:
1. Claude asks clarifying questions
2. Questions sent to Telegram
3. User responds
4. Claude retries with clarification in context
5. Files generated in correct location
