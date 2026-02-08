# Communication Auto-Routing System

## Overview

The God-Agent communication system now features **automatic daemon detection** with **graceful fallback** to CLI mode. This eliminates the need for manual `RUBIX_MODE` configuration and provides a seamless experience across different execution contexts.

## Key Features

✅ **Zero Configuration** - Works automatically without RUBIX_MODE
✅ **Intelligent Detection** - Multiple detection methods with fallbacks
✅ **Graceful Degradation** - Automatically falls back to CLI when daemon unavailable
✅ **Self-Documenting** - Response structure tells Claude exactly what to do
✅ **30-Second Cache** - Efficient detection with minimal overhead

## How It Works

### 1. Daemon Detection

When `god_comms_escalate` is called, the system automatically detects if the God-Agent daemon is running using three methods (in priority order):

#### Method 1: HTTP Health Check (Primary)
- **Target**: `http://localhost:3456/health`
- **Timeout**: 2 seconds
- **Advantage**: Fastest and most reliable
- **Use case**: Daemon running with webhook server

#### Method 2: PID File Validation
- **Location**: `god-agent.pid` in project root
- **Process**: Reads PID → validates process exists
- **Advantage**: Works even if health endpoint unreachable
- **Use case**: Daemon running but webhook server not responding

#### Method 3: Process Existence Check
- **Windows**: `tasklist` with process name filtering
- **Linux/Mac**: `kill -0` signal check
- **Advantage**: System-level verification
- **Use case**: Stale PID file or health check failed

### 2. Automatic Routing

Based on detection results:

**Daemon Detected (any method succeeds)**
```
god_comms_escalate → CommunicationManager → Telegram → Response
```

**No Daemon Detected (all methods fail)**
```
god_comms_escalate → Fallback Response → AskUserQuestion → Response
```

### 3. Caching Strategy

- **Cache Duration**: 30 seconds
- **Cache Key**: Detection timestamp
- **Benefits**:
  - Reduces overhead on repeated calls
  - Prevents excessive health checks
  - Balances freshness with performance

## Usage Examples

### Example 1: Basic Question

```typescript
// Always start with god_comms_escalate
const result = mcp__rubix__god_comms_escalate({
  title: "Choose Authentication Method",
  message: "Which authentication method should we use for the API?",
  type: "decision",
  options: [
    { label: "JWT", description: "JSON Web Tokens for stateless auth" },
    { label: "OAuth2", description: "OAuth 2.0 with external provider" },
    { label: "Session", description: "Server-side session management" }
  ]
});

// Handle response based on mode
if (result.success) {
  // Daemon mode - got response via Telegram
  console.log(`User selected: ${result.response}`);
  const selectedOption = result.selectedOption; // "JWT", "OAuth2", or "Session"
} else if (result.daemonRequired) {
  // CLI mode - fallback to AskUserQuestion
  const cliResponse = AskUserQuestion({
    questions: [{
      question: result.question.message,
      header: result.question.title,
      multiSelect: false,
      options: result.question.options.map(o => ({
        label: o.label,
        description: o.description
      }))
    }]
  });

  const selectedOption = Object.values(cliResponse.answers)[0];
  console.log(`User selected: ${selectedOption}`);
}
```

### Example 2: Multi-Select Question

```typescript
const result = mcp__rubix__god_comms_escalate({
  title: "Select Testing Frameworks",
  message: "Which testing frameworks should we include?",
  type: "decision",
  options: [
    { label: "Jest", description: "Unit testing framework" },
    { label: "Playwright", description: "E2E browser testing" },
    { label: "Vitest", description: "Fast unit tests with Vite" }
  ]
});

if (result.success) {
  // Process Telegram response (comma-separated for multi-select)
  const selections = result.response.split(',').map(s => s.trim());
} else if (result.daemonRequired) {
  // CLI fallback
  const cliResponse = AskUserQuestion({
    questions: [{
      question: result.question.message,
      header: result.question.title,
      multiSelect: true, // Enable multi-select in CLI
      options: result.question.options.map(o => ({
        label: o.label,
        description: o.description
      }))
    }]
  });
}
```

### Example 3: Clarification Question

```typescript
const result = mcp__rubix__god_comms_escalate({
  title: "Database Migration Strategy",
  message: "Should we run database migrations automatically on deployment, or require manual execution?",
  type: "clarification",
  options: [
    { label: "Automatic", description: "Run migrations on deployment" },
    { label: "Manual", description: "Require explicit migration command" }
  ]
});

// Same handling pattern as above
```

## Response Structures

### Success Response (Daemon Mode)

```json
{
  "success": true,
  "response": "JWT",
  "channel": "telegram",
  "selectedOption": "JWT",
  "receivedAt": "2026-01-26T04:15:30.000Z"
}
```

### Fallback Response (CLI Mode)

```json
{
  "success": false,
  "daemonRequired": true,
  "fallbackAction": "ask_user_question",
  "question": {
    "title": "Choose Authentication Method",
    "message": "Which authentication method should we use?",
    "type": "decision",
    "options": [
      { "label": "JWT", "description": "JSON Web Tokens..." },
      { "label": "OAuth2", "description": "OAuth 2.0..." }
    ]
  },
  "instructions": "Daemon not detected. Use AskUserQuestion tool with the above question data.",
  "detectionDetails": {
    "method": "health_check",
    "details": "Health check timeout"
  }
}
```

## Verification & Testing

### Test 1: CLI-Only Mode (Daemon Not Running)

```bash
# Ensure daemon is stopped
# (No daemon process should be running)

# Test via MCP tool call
mcp__rubix__god_comms_escalate({
  title: "Test Question",
  message: "Is the fallback working?",
  type: "decision",
  options: [
    { label: "Yes", description: "Fallback is working" },
    { label: "No", description: "Fallback is not working" }
  ]
})

# Expected: Returns fallback response with daemonRequired: true
# Action: Use returned data with AskUserQuestion
# Result: User answers via CLI, Claude receives response
```

### Test 2: Daemon Mode (Daemon Running)

```bash
# Start the daemon
node dist/launch/all.js

# Test via MCP tool call
mcp__rubix__god_comms_escalate({
  title: "Test Question",
  message: "Is Telegram working?",
  type: "decision",
  options: [
    { label: "Yes", description: "Telegram is working" },
    { label: "No", description: "Telegram is not working" }
  ]
})

# Expected: Question sent via Telegram
# Action: Answer via Telegram bot
# Result: Claude receives Telegram response
```

### Test 3: Detection Accuracy

```bash
# Run the test script
npx tsx test-daemon-detection.ts

# Expected output:
# - Daemon status (running/not running)
# - Detection method used (health_check, pid_file, process_check, none)
# - Cache behavior (30-second TTL)
# - Multiple detection rounds with timing
```

### Test 4: Edge Cases

#### Stale PID File
```bash
# Create stale PID file
echo "99999" > god-agent.pid

# Test detection
npx tsx test-daemon-detection.ts

# Expected: Detection should fail (process doesn't exist)
# Method: pid_file with "Stale PID file" message
```

#### Health Endpoint Unreachable
```bash
# Start daemon but block port 3456
# (Simulate network issue or firewall)

# Test detection
npx tsx test-daemon-detection.ts

# Expected: Falls back to PID file or process check
# Should still detect if daemon is running
```

## Migration Guide

### Before (Manual RUBIX_MODE)

```typescript
// Had to manually set RUBIX_MODE in MCP config
// env: { "RUBIX_MODE": "mcp-only" }

// Then use different tools based on mode
if (process.env.RUBIX_MODE === 'mcp-only') {
  AskUserQuestion({ ... });
} else {
  mcp__rubix__god_comms_escalate({ ... });
}
```

### After (Auto-Routing)

```typescript
// No RUBIX_MODE needed in MCP config
// env: { } // Just API keys

// Always use god_comms_escalate
const result = mcp__rubix__god_comms_escalate({ ... });

// System tells you what to do
if (result.success) {
  // Daemon mode
} else if (result.daemonRequired) {
  // CLI fallback
  AskUserQuestion(result.question);
}
```

## Performance Considerations

### Detection Overhead

- **First call**: ~2 seconds (health check timeout)
- **Cached calls**: <1ms (cache hit)
- **Cache expiry**: 30 seconds
- **Background detection**: Non-blocking

### Optimization Tips

1. **Batch Questions**: If asking multiple questions, use the same session
2. **Cache Warming**: Detection result cached for 30 seconds
3. **Health Endpoint**: Fastest detection method (responds in <10ms when running)

## Troubleshooting

### Issue: Detection Always Returns "Not Running"

**Possible Causes**:
1. Daemon not started (`node dist/launch/all.js`)
2. Health endpoint on different port
3. Firewall blocking localhost:3456
4. PID file missing or incorrect

**Solutions**:
1. Verify daemon is running: `ps aux | grep god-agent`
2. Check health endpoint: `curl http://localhost:3456/health`
3. Check PID file: `cat god-agent.pid`
4. Run detection test: `npx tsx test-daemon-detection.ts`

### Issue: Detection Always Returns "Running" (False Positive)

**Possible Causes**:
1. Stale PID file
2. Different process with same PID
3. Health endpoint responding from old instance

**Solutions**:
1. Clear cache: `DaemonDetector.clearCache()`
2. Delete PID file: `rm god-agent.pid`
3. Restart daemon cleanly

### Issue: Cache Not Expiring

**Possible Causes**:
1. System clock drift
2. Cache TTL too long for use case

**Solutions**:
1. Manually clear cache: `DaemonDetector.clearCache()`
2. Adjust `CACHE_TTL_MS` in DaemonDetector.ts (currently 30s)

## Architecture Details

### File Structure

```
src/
├── utils/
│   └── DaemonDetector.ts          # Detection logic
├── communication/
│   ├── types.ts                   # EscalationFallbackResponse
│   ├── CommunicationManager.ts    # Escalation handler
│   └── index.ts                   # Exports
└── mcp-server.ts                  # handleCommsEscalate

test-daemon-detection.ts           # Test script
```

### Key Classes

**DaemonDetector** (`src/utils/DaemonDetector.ts`)
- Static methods for detection
- Built-in caching (30s TTL)
- Multiple detection methods with fallbacks
- Platform-agnostic (Windows/Linux/Mac)

**EscalationFallbackResponse** (`src/communication/types.ts`)
- Type-safe fallback response structure
- Contains all data needed for AskUserQuestion
- Includes detection details for debugging

**handleCommsEscalate** (`src/mcp-server.ts:10556`)
- Entry point for all escalations
- Calls DaemonDetector.detect()
- Routes based on daemon status
- Returns appropriate response structure

## Best Practices

1. **Always Use god_comms_escalate First**
   - Don't check RUBIX_MODE manually
   - Let the system detect and route automatically

2. **Handle Both Response Types**
   - Check `result.success` for daemon mode
   - Check `result.daemonRequired` for CLI fallback
   - Both paths should lead to the same outcome

3. **Reuse Question Data**
   - The fallback response contains formatted question data
   - Map directly to AskUserQuestion parameters
   - No manual reformatting needed

4. **Trust the Cache**
   - 30-second cache is optimal for most workflows
   - Don't manually clear cache unless debugging
   - Detection is fast enough for real-time use

5. **Provide Clear Options**
   - Label: Short, descriptive (1-5 words)
   - Description: Clear explanation of what happens
   - Both daemon and CLI modes benefit from good UX

## Future Enhancements

Potential improvements for future iterations:

- [ ] WebSocket-based daemon presence (real-time)
- [ ] Daemon health metrics in fallback response
- [ ] Automatic daemon startup on CLI escalation
- [ ] Custom detection methods via configuration
- [ ] Detection result metrics/monitoring
- [ ] Retry logic for transient health check failures

## Summary

The Communication Auto-Routing System provides a **seamless, zero-configuration** experience for asking questions across different execution contexts. By automatically detecting daemon availability and gracefully falling back to CLI mode, it eliminates the need for manual mode configuration while maintaining full functionality in all environments.

**Key Takeaway**: Always use `god_comms_escalate` first, and let the system tell you what to do next.
