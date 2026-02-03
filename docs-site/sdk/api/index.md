---
title: API Reference
parent: SDK
nav_order: 2
has_children: true
description: "SDK API reference documentation"
permalink: /sdk/api/
---

# API Reference

Complete API reference for the MAP TypeScript SDK.
{: .fs-6 .fw-300 }

---

## Available References

| Reference | Description |
|:----------|:------------|
| [Server API](./server.html) | MAPServer class and building blocks |
| [Client API](./client.html) | ClientConnection methods and properties |
| [Agent API](./agent.html) | AgentConnection methods and properties |
| [Types](./types.html) | TypeScript type definitions |

---

## Quick Import Reference

```typescript
// Main exports
import {
  ClientConnection,
  AgentConnection,
  GatewayConnection,
} from "@multi-agent-protocol/sdk";

// Server components
import {
  MAPServer,
  EventBusImpl,
  AgentRegistryImpl,
  ScopeManagerImpl,
  SessionManagerImpl,
  SubscriptionManagerImpl,
  MessageRouterImpl,
} from "@multi-agent-protocol/sdk/server";

// Stream utilities
import { createStreamPair } from "@multi-agent-protocol/sdk/stream";

// Types
import type {
  Agent,
  RegisteredAgent,
  Message,
  Event,
  Subscription,
  Scope,
  Session,
  Stream,
} from "@multi-agent-protocol/sdk";
```
