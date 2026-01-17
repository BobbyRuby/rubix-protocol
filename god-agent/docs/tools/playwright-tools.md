# Playwright Tools

Tools for browser automation and visual verification.

## Tool Reference

| Tool | Purpose |
|------|---------|
| [god_pw_launch](#god_pw_launch) | Launch browser |
| [god_pw_close](#god_pw_close) | Close browser |
| [god_pw_navigate](#god_pw_navigate) | Navigate to URL |
| [god_pw_screenshot](#god_pw_screenshot) | Take screenshot |
| [god_pw_action](#god_pw_action) | Perform action |
| [god_pw_assert](#god_pw_assert) | Assert state |
| [god_pw_console](#god_pw_console) | Get console logs |
| [god_pw_verify](#god_pw_verify) | Quick verification |

---

## god_pw_launch

Launch a browser session for verification and testing.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `browser` | enum | No | Browser type (default: chromium) |
| `headless` | boolean | No | Run headless (default: true) |
| `viewport` | object | No | Viewport dimensions |

### Browser Options

| Browser | Description |
|---------|-------------|
| `chromium` | Chromium-based (default) |
| `firefox` | Firefox |
| `webkit` | WebKit (Safari engine) |

### Response

```json
{
  "success": true,
  "sessionId": "sess_abc123...",
  "browser": "chromium",
  "headless": true,
  "viewport": { "width": 1280, "height": 720 }
}
```

### Example

```typescript
// Launch headless browser
const session = await mcp__rubix__god_pw_launch({
  browser: "chromium",
  headless: true
});

// Launch visible browser for debugging
const debugSession = await mcp__rubix__god_pw_launch({
  browser: "chromium",
  headless: false,
  viewport: { width: 1920, height: 1080 }
});
```

---

## god_pw_close

Close a browser session.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Session ID to close |

### Response

```json
{
  "success": true,
  "sessionId": "sess_abc123...",
  "message": "Session closed"
}
```

---

## god_pw_navigate

Navigate to a URL in a browser session.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Browser session ID |
| `url` | string | Yes | URL to navigate to |
| `waitUntil` | enum | No | Navigation complete condition |

### Wait Options

| Option | Description |
|--------|-------------|
| `load` | Wait for load event |
| `domcontentloaded` | Wait for DOMContentLoaded |
| `networkidle` | Wait for network idle |

### Response

```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "status": 200,
  "loadTimeMs": 1250
}
```

### Example

```typescript
await mcp__rubix__god_pw_navigate({
  sessionId: session.sessionId,
  url: "https://example.com",
  waitUntil: "networkidle"
});
```

---

## god_pw_screenshot

Take a screenshot of the current page or element.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Browser session ID |
| `selector` | string | No | Element to screenshot |
| `fullPage` | boolean | No | Capture full page |
| `label` | string | No | Screenshot label |
| `returnBase64` | boolean | No | Return base64 data |

### Response

```json
{
  "success": true,
  "path": "screenshots/screenshot_2024-01-15_100000.png",
  "label": "login-page",
  "dimensions": { "width": 1280, "height": 720 }
}
```

### Example

```typescript
// Full page screenshot
await mcp__rubix__god_pw_screenshot({
  sessionId: session.sessionId,
  fullPage: true,
  label: "full-page"
});

// Element screenshot
await mcp__rubix__god_pw_screenshot({
  sessionId: session.sessionId,
  selector: "#login-form",
  label: "login-form"
});
```

---

## god_pw_action

Perform an action on a page element.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Browser session ID |
| `selector` | string | Yes | CSS selector |
| `action` | enum | Yes | Action to perform |
| `value` | string | No | Value for type/fill/select |
| `key` | string | No | Key for press action |
| `force` | boolean | No | Skip actionability checks |

### Action Types

| Action | Description | Requires |
|--------|-------------|----------|
| `click` | Click element | - |
| `dblclick` | Double-click | - |
| `type` | Type character by character | `value` |
| `fill` | Fill input (replaces content) | `value` |
| `clear` | Clear input field | - |
| `check` | Check checkbox | - |
| `uncheck` | Uncheck checkbox | - |
| `select` | Select dropdown option | `value` |
| `hover` | Hover over element | - |
| `focus` | Focus element | - |
| `press` | Press a key | `key` |

### Response

```json
{
  "success": true,
  "selector": "#login-button",
  "action": "click",
  "elementFound": true
}
```

### Example

```typescript
// Fill a form
await mcp__rubix__god_pw_action({
  sessionId: session.sessionId,
  selector: "#username",
  action: "fill",
  value: "testuser"
});

await mcp__rubix__god_pw_action({
  sessionId: session.sessionId,
  selector: "#password",
  action: "fill",
  value: "password123"
});

// Click submit
await mcp__rubix__god_pw_action({
  sessionId: session.sessionId,
  selector: "#login-button",
  action: "click"
});

// Press Enter key
await mcp__rubix__god_pw_action({
  sessionId: session.sessionId,
  selector: "#search-input",
  action: "press",
  key: "Enter"
});
```

---

## god_pw_assert

Assert element or page state.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Browser session ID |
| `type` | enum | Yes | Assertion type |
| `selector` | string | No | CSS selector |
| `expected` | any | No | Expected value |
| `attribute` | string | No | Attribute name |

### Assertion Types

| Type | Description | Requires |
|------|-------------|----------|
| `visible` | Element is visible | `selector` |
| `hidden` | Element is hidden | `selector` |
| `enabled` | Input is enabled | `selector` |
| `disabled` | Input is disabled | `selector` |
| `checked` | Checkbox is checked | `selector` |
| `unchecked` | Checkbox is unchecked | `selector` |
| `text` | Element has text | `selector`, `expected` |
| `value` | Input has value | `selector`, `expected` |
| `attribute` | Element has attribute | `selector`, `attribute`, `expected` |
| `count` | Element count | `selector`, `expected` |
| `url` | Page URL matches | `expected` |
| `title` | Page title matches | `expected` |

### Response

```json
{
  "success": true,
  "type": "visible",
  "selector": "#success-message",
  "passed": true,
  "actual": true
}
```

### Example

```typescript
// Assert element visible
await mcp__rubix__god_pw_assert({
  sessionId: session.sessionId,
  type: "visible",
  selector: "#welcome-message"
});

// Assert text content
await mcp__rubix__god_pw_assert({
  sessionId: session.sessionId,
  type: "text",
  selector: "#status",
  expected: "Success"
});

// Assert URL
await mcp__rubix__god_pw_assert({
  sessionId: session.sessionId,
  type: "url",
  expected: "https://example.com/dashboard"
});
```

---

## god_pw_console

Get console logs and errors from a browser session.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | Yes | Browser session ID |
| `clear` | boolean | No | Clear logs after returning |

### Response

```json
{
  "success": true,
  "messages": [
    { "type": "log", "text": "App initialized", "timestamp": "..." },
    { "type": "error", "text": "Failed to load resource", "timestamp": "..." }
  ],
  "errors": [
    { "message": "Uncaught TypeError: undefined", "stack": "..." }
  ],
  "errorCount": 1,
  "warningCount": 0
}
```

---

## god_pw_verify

Quick verification workflow for a URL.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | URL to verify |
| `screenshot` | boolean | No | Take screenshot (default: true) |
| `checkConsole` | boolean | No | Check for errors (default: true) |
| `assertVisible` | string[] | No | Selectors that must be visible |

### Response

```json
{
  "success": true,
  "url": "https://example.com",
  "title": "Example Domain",
  "screenshot": "screenshots/verify_2024-01-15.png",
  "consoleErrors": 0,
  "assertions": {
    "passed": 3,
    "failed": 0,
    "results": [
      { "selector": "#header", "passed": true },
      { "selector": "#main", "passed": true },
      { "selector": "#footer", "passed": true }
    ]
  }
}
```

### Example

```typescript
// Quick verification
const result = await mcp__rubix__god_pw_verify({
  url: "http://localhost:3000",
  assertVisible: ["#header", "#login-button", "#footer"]
});

if (result.consoleErrors > 0) {
  console.warn("Page has console errors!");
}

if (result.assertions.failed > 0) {
  console.error("Some elements not visible!");
}
```

---

## Complete Workflow Example

```typescript
// 1. Launch browser
const session = await mcp__rubix__god_pw_launch({
  browser: "chromium",
  headless: true
});

try {
  // 2. Navigate to login page
  await mcp__rubix__god_pw_navigate({
    sessionId: session.sessionId,
    url: "http://localhost:3000/login",
    waitUntil: "networkidle"
  });

  // 3. Fill login form
  await mcp__rubix__god_pw_action({
    sessionId: session.sessionId,
    selector: "#email",
    action: "fill",
    value: "test@example.com"
  });

  await mcp__rubix__god_pw_action({
    sessionId: session.sessionId,
    selector: "#password",
    action: "fill",
    value: "password123"
  });

  // 4. Take screenshot before submit
  await mcp__rubix__god_pw_screenshot({
    sessionId: session.sessionId,
    label: "before-login"
  });

  // 5. Click login
  await mcp__rubix__god_pw_action({
    sessionId: session.sessionId,
    selector: "#login-button",
    action: "click"
  });

  // 6. Assert redirect to dashboard
  await mcp__rubix__god_pw_assert({
    sessionId: session.sessionId,
    type: "url",
    expected: "http://localhost:3000/dashboard"
  });

  // 7. Assert welcome message visible
  await mcp__rubix__god_pw_assert({
    sessionId: session.sessionId,
    type: "visible",
    selector: "#welcome-message"
  });

  // 8. Take final screenshot
  await mcp__rubix__god_pw_screenshot({
    sessionId: session.sessionId,
    label: "after-login"
  });

  // 9. Check for console errors
  const console = await mcp__rubix__god_pw_console({
    sessionId: session.sessionId
  });

  if (console.errorCount > 0) {
    console.warn("Login flow had console errors:", console.errors);
  }

} finally {
  // 10. Always close browser
  await mcp__rubix__god_pw_close({
    sessionId: session.sessionId
  });
}
```

## Next Steps

- [CODEX Tools](codex-tools.md) - Task execution with verification
- [Review Tools](review-tools.md) - Code review
- [Tools Overview](index.md) - All tools
