# User Story Coherence Improvements - Implementation Plan

## Overview

This document outlines the implementation plan for addressing user story coherence issues identified in the codebase review. The goal is to improve API consistency, developer experience, and documentation.

## Work Items

### 1. Full Auth Flow Refactor
**Priority:** High
**Estimated Effort:** 4-6 hours

#### Goals
- Add `authenticate(credentials)` method to ClientConnection
- Add resume token support with `getResumeToken()` and `reconnect(resumeToken)`
- Add token refresh callback for JWT expiration handling
- Support auto-reconnect with session restoration

#### Files to Modify
- `ts-sdk/src/connection/client.ts` - Add new methods
- `ts-sdk/src/connection/base.ts` - Add reconnection infrastructure
- `ts-sdk/src/types/index.ts` - Add callback types if needed

#### Implementation Steps
1. Add `authenticate(credentials: AuthCredentials): Promise<AuthResult>` method
2. Store resume token from connect response
3. Add `getResumeToken(): string | undefined` method
4. Add `reconnect(resumeToken?: string): Promise<ConnectResult>` method
5. Add `onTokenExpiring` callback option for proactive token refresh
6. Add auto-reconnect logic that uses resume tokens when available

---

### 2. Document Response Shape Patterns
**Priority:** Medium
**Estimated Effort:** 1 hour

#### Goals
- Add clear documentation explaining response shape conventions
- Help developers understand when to expect full entities vs IDs

#### Files to Modify
- `ts-sdk/src/connection/client.ts` - Add JSDoc comments
- `ts-sdk/src/types/index.ts` - Add documentation to response types

#### Pattern to Document
```
CREATE operations → Return full entity (agent, scope, subscription)
ACTION operations → Return reference ID (messageId, subscriptionId for subscribe)
```

---

### 3. Add All Missing Client Methods
**Priority:** High
**Estimated Effort:** 3-4 hours

#### Methods to Add
| Method | Signature | Description |
|--------|-----------|-------------|
| `authenticate` | `(credentials: AuthCredentials) => Promise<AuthResult>` | Authenticate session |
| `getScope` | `(scopeId: string) => Promise<Scope>` | Get single scope |
| `listSessions` | `() => Promise<Session[]>` | List active sessions |
| `loadSession` | `(sessionId: string) => Promise<Session>` | Load session state |
| `closeSession` | `(sessionId: string) => Promise<void>` | Force close session |
| `getStructureGraph` | `() => Promise<StructureGraph>` | Get topology graph |
| `inject` | `(event: MAPEvent) => Promise<void>` | Inject event (testing) |

#### Files to Modify
- `ts-sdk/src/connection/client.ts` - Add methods
- `ts-sdk/src/types/index.ts` - Add any missing types

---

### 4. Remove Deprecated Types
**Priority:** Medium
**Estimated Effort:** 2 hours

#### Types to Remove
1. `AuthParams` - Replace with `AuthCredentials`
2. `agents` field in SubscriptionFilter - Only keep `fromAgents`

#### Files to Modify
- `ts-sdk/src/types/index.ts` - Remove deprecated types
- `ts-sdk/src/server/subscriptions/manager.ts` - Remove `agents` handling
- Any files referencing removed types

#### Migration Steps
1. Search for all usages of deprecated types
2. Update to new types
3. Remove deprecated type definitions
4. Run tests to verify no breakage

---

### 5. Add Server Examples and Guide
**Priority:** Medium
**Estimated Effort:** 2-3 hours

#### Deliverables
1. Update README with server examples
2. Add inline documentation to server exports

#### Examples to Add
1. **Basic MAPServer Setup** - Minimal working server
2. **Custom Authentication** - Adding JWT or API key auth
3. **Custom Handlers** - Extending with application-specific methods
4. **Building Block Composition** - Using individual components

#### Files to Modify
- `ts-sdk/README.md` - Add examples section
- `ts-sdk/src/server/index.ts` - Improve export documentation

---

## Implementation Order

1. **Remove deprecated types** (clean foundation)
2. **Add missing client methods** (includes authenticate)
3. **Full auth flow refactor** (builds on authenticate method)
4. **Document response patterns** (documentation pass)
5. **Add server examples** (final documentation)

## Success Criteria

- [ ] All tests pass (1372+)
- [ ] No TypeScript errors
- [ ] `authenticate()` method works with server auth handlers
- [ ] Resume tokens enable session restoration
- [ ] All 8 missing methods added to ClientConnection
- [ ] No deprecated types in exports
- [ ] README has clear server setup examples

## Notes

- Protocol is unreleased, so breaking changes are acceptable
- Focus on developer experience and discoverability
- Keep backward compatibility where it doesn't conflict with cleanup goals
