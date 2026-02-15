# Multi-Project Examples

## Overview

Real-world examples of using God-Agent with multiple projects simultaneously. These examples demonstrate common workflows, patterns, and best practices.

---

## Example 1: Full-Stack Feature (User Authentication)

### Scenario

Implement user authentication across backend API, web frontend, and mobile app simultaneously.

### Step 1: Define the Feature

```typescript
const authFeature = `
Feature: User Authentication

**Backend API** (Express + JWT):
- POST /api/auth/register - User registration
- POST /api/auth/login - User login
- POST /api/auth/refresh - Refresh token
- GET /api/auth/me - Get current user

**Web Frontend** (React):
- LoginPage component
- RegisterPage component
- Auth context provider
- Protected route wrapper
- Token management

**Mobile App** (React Native):
- LoginScreen
- RegisterScreen
- Auth provider
- Secure token storage
- Biometric authentication

**API Contract**:
POST /api/auth/login
Request: { email: string, password: string }
Response: {
  accessToken: string (15min),
  refreshToken: string (7 days),
  user: { id, email, name, role }
}
`;
```

### Step 2: Implement Backend

```typescript
// Execute backend task
const backendTask = mcp__rubix_backend_api__god_codex_do({
  task: `${authFeature}

Implement the backend authentication system:
1. Create User model with Prisma
2. Implement JWT token generation (access + refresh)
3. Create auth routes with validation
4. Add password hashing with bcrypt
5. Implement middleware for protected routes
6. Add rate limiting for auth endpoints
7. Write integration tests`
});

// Monitor progress
const checkBackendStatus = setInterval(() => {
  const status = mcp__rubix_backend_api__god_codex_status({
    taskId: backendTask.taskId
  });

  console.log(`Backend: ${status.phase} - ${Math.round(status.progress * 100)}%`);

  if (status.status === 'completed') {
    console.log('Backend authentication complete!');
    clearInterval(checkBackendStatus);
  }
}, 5000);
```

### Step 3: Implement Frontend (Parallel)

```typescript
// Execute frontend task (runs in parallel with backend)
const frontendTask = mcp__rubix_frontend__god_codex_do({
  task: `${authFeature}

Implement the frontend authentication:
1. Create AuthContext with React Context API
2. Implement LoginPage and RegisterPage
3. Add form validation with react-hook-form + zod
4. Integrate with API using axios
5. Store tokens in httpOnly cookies
6. Create ProtectedRoute wrapper
7. Add auto-refresh on token expiry
8. Implement logout functionality
9. Write component tests with React Testing Library`
});

// Monitor progress
const checkFrontendStatus = setInterval(() => {
  const status = mcp__rubix_frontend__god_codex_status({
    taskId: frontendTask.taskId
  });

  console.log(`Frontend: ${status.phase} - ${Math.round(status.progress * 100)}%`);

  if (status.status === 'completed') {
    console.log('Frontend authentication complete!');
    clearInterval(checkFrontendStatus);
  }
}, 5000);
```

### Step 4: Implement Mobile (Parallel)

```typescript
// Execute mobile task (also in parallel)
const mobileTask = mcp__rubix_mobile__god_codex_do({
  task: `${authFeature}

Implement the mobile authentication:
1. Create AuthContext with React Context
2. Implement LoginScreen and RegisterScreen
3. Add form validation
4. Integrate with API
5. Store tokens in secure storage (@react-native-async-storage)
6. Add biometric authentication (TouchID/FaceID)
7. Create navigation guards
8. Implement auto-refresh
9. Add offline support with local state
10. Write E2E tests with Detox`
});
```

### Step 5: Store Shared Contract

After tasks complete, store the API contract in all projects for future reference:

```typescript
// Store in backend
mcp__rubix_backend_api__god_store({
  content: `${authFeature}

Implementation Details:
- JWT signing algorithm: RS256
- Access token TTL: 15 minutes
- Refresh token TTL: 7 days
- Password hashing: bcrypt (10 rounds)
- Rate limiting: 5 attempts per 15 minutes`,
  tags: ['authentication', 'api_contract', 'always_recall'],
  importance: 1.0
});

// Store in frontend
mcp__rubix_frontend__god_store({
  content: `${authFeature}

Frontend Implementation:
- Auth state managed by Context API
- Tokens stored in httpOnly cookies
- Auto-refresh 5 minutes before expiry
- Logout clears all auth state`,
  tags: ['authentication', 'implementation'],
  importance: 0.9
});

// Store in mobile
mcp__rubix_mobile__god_store({
  content: `${authFeature}

Mobile Implementation:
- Auth state managed by Context API
- Tokens stored in @react-native-async-storage/async-storage
- Biometric auth on app launch
- Offline mode shows cached user data`,
  tags: ['authentication', 'implementation'],
  importance: 0.9
});
```

---

## Example 2: Microservices Architecture

### Scenario

Work on multiple microservices simultaneously (auth, user, payment, notification services).

### Configuration

```json
{
  "mcpServers": {
    "rubix-auth-svc": {
      "env": {
        "RUBIX_DATA_DIR": "./data/services/auth",
        "RUBIX_PROJECT_ROOT": "D:\\microservices\\auth-service",
        "RUBIX_PROJECT_NAME": "Auth Service"
      }
    },
    "rubix-user-svc": {
      "env": {
        "RUBIX_DATA_DIR": "./data/services/user",
        "RUBIX_PROJECT_ROOT": "D:\\microservices\\user-service",
        "RUBIX_PROJECT_NAME": "User Service"
      }
    },
    "rubix-payment-svc": {
      "env": {
        "RUBIX_DATA_DIR": "./data/services/payment",
        "RUBIX_PROJECT_ROOT": "D:\\microservices\\payment-service",
        "RUBIX_PROJECT_NAME": "Payment Service"
      }
    },
    "rubix-notification-svc": {
      "env": {
        "RUBIX_DATA_DIR": "./data/services/notification",
        "RUBIX_PROJECT_ROOT": "D:\\microservices\\notification-service",
        "RUBIX_PROJECT_NAME": "Notification Service"
      }
    }
  }
}
```

### Workflow: Add Event-Driven Communication

```typescript
// Step 1: Define event schema
const eventSchema = `
Event: user.created
Payload: {
  userId: string,
  email: string,
  name: string,
  createdAt: string
}

Consumers:
- User Service: Create user profile
- Payment Service: Initialize billing account
- Notification Service: Send welcome email
`;

// Step 2: Update Auth Service (emits event)
mcp__rubix_auth_svc__god_codex_do({
  task: `Add event emission after user registration:
${eventSchema}

1. Install @rubix/event-bus library
2. Emit 'user.created' event after successful registration
3. Include retry logic for event publishing
4. Add event logging`
});

// Step 3: Update User Service (consumes event)
mcp__rubix_user_svc__god_codex_do({
  task: `Subscribe to 'user.created' event:
${eventSchema}

1. Add event handler for 'user.created'
2. Create user profile in database
3. Handle idempotency (prevent duplicate creates)
4. Add error handling and dead-letter queue`
});

// Step 4: Update Payment Service (consumes event)
mcp__rubix_payment_svc__god_codex_do({
  task: `Subscribe to 'user.created' event:
${eventSchema}

1. Add event handler for 'user.created'
2. Initialize billing account in Stripe
3. Create payment_customers record
4. Handle Stripe API errors gracefully`
});

// Step 5: Update Notification Service (consumes event)
mcp__rubix_notification_svc__god_codex_do({
  task: `Subscribe to 'user.created' event:
${eventSchema}

1. Add event handler for 'user.created'
2. Send welcome email using SendGrid
3. Queue for retry if email fails
4. Log notification sent event`
});
```

---

## Example 3: Monorepo Package Updates

### Scenario

Update shared packages in a monorepo and propagate changes to dependent apps.

### Configuration

```json
{
  "mcpServers": {
    "rubix-pkg-core": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\packages\\core"
      }
    },
    "rubix-pkg-ui": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\packages\\ui"
      }
    },
    "rubix-app-web": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\apps\\web"
      }
    },
    "rubix-app-admin": {
      "env": {
        "RUBIX_PROJECT_ROOT": "D:\\monorepo\\apps\\admin"
      }
    }
  }
}
```

### Workflow: Add New Utility Function

```typescript
// Step 1: Add utility to @core package
mcp__rubix_pkg_core__god_codex_do({
  task: `Add new utility function to @core/utils:

Function: formatCurrency(amount: number, currency: string): string

Requirements:
- Format numbers as currency (e.g., 1234.56 → "$1,234.56")
- Support USD, EUR, GBP
- Handle edge cases (negative, zero, very large numbers)
- Add JSDoc comments
- Write unit tests`
});

// Step 2: Query core package for new API
setTimeout(() => {
  const coreAPI = mcp__rubix_pkg_core__god_query({
    query: "formatCurrency function usage and API",
    topK: 5
  });

  const apiDocs = coreAPI.results[0].content;

  // Step 3: Update UI package to use new utility
  mcp__rubix_pkg_ui__god_codex_do({
    task: `Update PriceDisplay component to use formatCurrency:

${apiDocs}

1. Import formatCurrency from @core/utils
2. Replace manual formatting logic
3. Update tests
4. Update Storybook stories`
  });

  // Step 4: Update web app
  mcp__rubix_app_web__god_codex_do({
    task: `Update checkout page to use formatCurrency:

${apiDocs}

1. Import formatCurrency from @core/utils
2. Update all price displays
3. Remove old formatting code
4. Test checkout flow`
  });

  // Step 5: Update admin app
  mcp__rubix_app_admin__god_codex_do({
    task: `Update reports to use formatCurrency:

${apiDocs}

1. Import formatCurrency from @core/utils
2. Update revenue reports
3. Update pricing tables
4. Verify all formats match`
  });
}, 10000); // Wait for core task to complete
```

---

## Example 4: Database Schema Changes

### Scenario

Add new database table and update all services that interact with it.

### Workflow

```typescript
// Step 1: Define schema change
const schemaChange = `
New Table: user_preferences

Columns:
- id: UUID (primary key)
- user_id: UUID (foreign key to users.id)
- theme: ENUM('light', 'dark', 'auto')
- language: VARCHAR(10)
- notifications_enabled: BOOLEAN
- created_at: TIMESTAMP
- updated_at: TIMESTAMP

Indexes:
- user_id (unique)
`;

// Step 2: Update backend API
mcp__rubix_backend_api__god_codex_do({
  task: `Add user preferences table and API:

${schemaChange}

1. Create Prisma migration
2. Add UserPreferences model
3. Create GET /api/users/:id/preferences endpoint
4. Create PUT /api/users/:id/preferences endpoint
5. Add validation with zod
6. Write integration tests
7. Update API documentation`
});

// Step 3: Update frontend
mcp__rubix_frontend__god_codex_do({
  task: `Add user preferences UI:

${schemaChange}

1. Create SettingsPage component
2. Add preferences form with validation
3. Integrate with GET/PUT endpoints
4. Add theme switcher
5. Add language selector
6. Persist theme to localStorage as well
7. Write component tests`
});

// Step 4: Update mobile app
mcp__rubix_mobile__god_codex_do({
  task: `Add user preferences screen:

${schemaChange}

1. Create SettingsScreen
2. Add preferences form
3. Integrate with API
4. Apply theme to app
5. Store preferences locally
6. Sync on app launch
7. Write E2E tests`
});

// Step 5: Document the change
setTimeout(() => {
  const apiContract = `
User Preferences API

GET /api/users/:id/preferences
Response: {
  theme: 'light' | 'dark' | 'auto',
  language: string,
  notificationsEnabled: boolean
}

PUT /api/users/:id/preferences
Request: {
  theme?: 'light' | 'dark' | 'auto',
  language?: string,
  notificationsEnabled?: boolean
}
`;

  // Store in all projects
  mcp__rubix_backend_api__god_store({
    content: apiContract,
    tags: ['api_contract', 'user_preferences'],
    importance: 0.9
  });

  mcp__rubix_frontend__god_store({
    content: apiContract,
    tags: ['api_contract', 'user_preferences'],
    importance: 0.9
  });

  mcp__rubix_mobile__god_store({
    content: apiContract,
    tags: ['api_contract', 'user_preferences'],
    importance: 0.9
  });
}, 15000);
```

---

## Example 5: Bug Fix Across Multiple Projects

### Scenario

Fix a bug that affects backend, frontend, and mobile.

### Issue

Date formatting inconsistency causing timezone issues.

### Workflow

```typescript
const bugDescription = `
BUG: Timezone Issues in Date Handling

Problem:
- Backend returns UTC timestamps
- Frontend displays local time incorrectly
- Mobile app shows wrong dates

Root Cause:
- Backend sends: "2024-01-15T10:30:00Z"
- Frontend parses without timezone consideration
- Mobile app uses device timezone inconsistently

Solution:
- Backend: Always include timezone offset
- Frontend: Use date-fns with explicit timezone
- Mobile: Use moment-timezone consistently
`;

// Fix backend
mcp__rubix_backend_api__god_codex_do({
  task: `${bugDescription}

Backend fixes:
1. Update all API responses to include timezone offset
2. Add timezone validation to input
3. Document timezone handling in API docs
4. Add tests for timezone edge cases`
});

// Fix frontend
mcp__rubix_frontend__god_codex_do({
  task: `${bugDescription}

Frontend fixes:
1. Install and configure date-fns-tz
2. Create formatDate utility with timezone support
3. Replace all date formatting code
4. Add timezone display to all dates
5. Test with different timezones
6. Update Storybook with timezone examples`
});

// Fix mobile
mcp__rubix_mobile__god_codex_do({
  task: `${bugDescription}

Mobile fixes:
1. Install moment-timezone
2. Create formatDate utility
3. Replace all date formatting
4. Handle device timezone changes
5. Test with timezone mocking
6. Update E2E tests`
});
```

---

## Example 6: Performance Optimization

### Scenario

Optimize API response times across backend and update frontends to leverage caching.

### Workflow

```typescript
// Step 1: Optimize backend
mcp__rubix_backend_api__god_codex_do({
  task: `Performance optimization for user profile endpoint:

Current: GET /api/users/:id takes ~800ms
Target: < 200ms

Optimizations:
1. Add Redis caching layer (5 min TTL)
2. Optimize database query (add indexes)
3. Implement database connection pooling
4. Add response compression (gzip)
5. Cache user roles/permissions separately
6. Add cache warming for popular profiles
7. Implement cache invalidation on updates
8. Add performance monitoring metrics`
});

// Step 2: Update frontend for cache headers
mcp__rubix_frontend__god_codex_do({
  task: `Update API client to leverage backend caching:

1. Add Cache-Control headers to requests
2. Implement SWR (stale-while-revalidate) strategy
3. Add optimistic updates for user profile
4. Prefetch user data on app load
5. Cache query results with react-query
6. Add loading skeletons for better UX
7. Implement background refresh`
});

// Step 3: Update mobile for caching
mcp__rubix_mobile__god_codex_do({
  task: `Add aggressive caching for mobile:

1. Cache user profiles in AsyncStorage
2. Implement cache-first strategy
3. Add background sync when online
4. Show stale data immediately
5. Refresh in background
6. Add cache expiration logic (24 hours)
7. Handle offline mode gracefully`
});
```

---

## Best Practices from Examples

### 1. Define Contracts First

Always start by defining API contracts, schemas, or interfaces before implementation:

```typescript
const contract = `
API: GET /api/resource/:id
Response: { ... }
Error Codes: 404, 403, 500
`;

// Then implement across all projects
```

### 2. Execute in Parallel

Run independent tasks in parallel for faster completion:

```typescript
// ✅ Good - parallel execution
const backendTask = mcp__rubix_backend_api__god_codex_do({ ... });
const frontendTask = mcp__rubix_frontend__god_codex_do({ ... });
const mobileTask = mcp__rubix_mobile__god_codex_do({ ... });

// ❌ Bad - sequential (slower)
const backendTask = await mcp__rubix_backend_api__god_codex_do({ ... });
// Wait for backend to finish
const frontendTask = await mcp__rubix_frontend__god_codex_do({ ... });
// Wait for frontend to finish
const mobileTask = await mcp__rubix_mobile__god_codex_do({ ... });
```

### 3. Store Shared Knowledge

Store API contracts and important decisions in all relevant projects:

```typescript
// Store in backend
mcp__rubix_backend_api__god_store({ content: contract, ... });

// Store in frontend
mcp__rubix_frontend__god_store({ content: contract, ... });

// Store in mobile
mcp__rubix_mobile__god_store({ content: contract, ... });
```

### 4. Monitor All Tasks

Track progress of all parallel tasks:

```typescript
const tasks = [backendTask, frontendTask, mobileTask];
const instances = [
  'mcp__rubix_backend_api',
  'mcp__rubix_frontend',
  'mcp__rubix_mobile'
];

const interval = setInterval(() => {
  tasks.forEach((task, i) => {
    const status = instances[i] + '__god_codex_status';
    // Check status
  });
}, 5000);
```

### 5. Handle Dependencies

When tasks depend on each other, sequence them properly:

```typescript
// Task B depends on Task A
const taskA = mcp__rubix_backend_api__god_codex_do({ ... });

// Wait for Task A to complete
const checkTaskA = setInterval(() => {
  const status = mcp__rubix_backend_api__god_codex_status({
    taskId: taskA.taskId
  });

  if (status.status === 'completed') {
    clearInterval(checkTaskA);

    // Now start Task B
    const taskB = mcp__rubix_frontend__god_codex_do({ ... });
  }
}, 5000);
```

---

## Next Steps

- [Multi-Project Setup](../getting-started/multi-project-setup.md)
- [CLI Usage Guide](../getting-started/multi-project-cli-usage.md)
