# MAP Visibility & Permission Model

This spec details how MAP controls visibility and permissions at multiple levels: system, client, scope, and agent.

## Design Principles

1. **Layered control**: Permissions are checked at multiple levels, most restrictive wins
2. **Explicit over implicit**: Default to restricted, explicitly grant access
3. **Separation of concerns**: Client permissions vs agent permissions are distinct
4. **Flexibility**: System implementations can choose how strict to be

---

## Visibility Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                     Visibility Stack                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  LAYER 4: Agent Permissions                              │   │
│  │  What can this agent see/do within its allowed scope?   │   │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│  ┌────────────────────────────▼────────────────────────────┐   │
│  │  LAYER 3: Scope Permissions                              │   │
│  │  What's visible within this scope? Who can see it?      │   │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│  ┌────────────────────────────▼────────────────────────────┐   │
│  │  LAYER 2: Client Permissions                             │   │
│  │  What can this client see/do in the system?             │   │
│  └────────────────────────────┬────────────────────────────┘   │
│                               │                                 │
│  ┌────────────────────────────▼────────────────────────────┐   │
│  │  LAYER 1: System Configuration                           │   │
│  │  What does the system expose at all?                    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Evaluation: Check Layer 1 → Layer 2 → Layer 3 → Layer 4
Result: Most restrictive wins (all layers must allow)
```

---

## Layer 1: System Configuration

```typescript
interface MAPSystemConfig {
  exposure: {
    agents: {
      publicByDefault: boolean;
      publicAgents: string[];
      hiddenAgents: string[];
    };
    events: {
      exposedTypes: string[];
      hiddenTypes: string[];
    };
    scopes: {
      publicByDefault: boolean;
      publicScopes: string[];
      hiddenScopes: string[];
    };
  };
  limits: {
    maxConnections: number;
    maxConnectionsPerClient: number;
    maxSubscriptionsPerConnection: number;
  };
  anonymousPermissions: MAPClientPermissions;
}
```

---

## Layer 2: Client Permissions

```typescript
interface MAPClientPermissions {
  visibility: {
    agents: "all" | "none" | { include: string[] } | { roles: string[] };
    scopes: "all" | "none" | { include: string[] };
    events: "all" | "none" | { include: string[] };
    structure: boolean;
  };

  actions: {
    sendMessages: boolean | { to: MAPAddress[]; priorities: string[] };
    registerAgents: boolean | { roles: string[]; maxAgents: number };
    unregisterAgents: boolean | { own: boolean; any: boolean };
    createScopes: boolean;
    deleteScopes: boolean | { own: boolean };
    modifyScopes: boolean | { own: boolean; member: boolean };
    steerAgents: boolean | { agents: string[]; methods: string[] };
    federationConnect: boolean;
  };

  limits: {
    subscriptions: number;
    messagesPerMinute: number;
    agentsRegistered: number;
    scopesCreated: number;
  };
}
```

---

## Layer 3: Scope Permissions

```typescript
interface MAPScopePermissions {
  discoverability: "public" | "members" | "owners";
  messageVisibility: "public" | "members" | "participants";
  joinPolicy: "open" | "invite" | "owner-invite" | "closed";
  sendPolicy: "anyone" | "members" | "owners";
  inheritFrom?: string;
}
```

---

## Layer 4: Agent Permissions

```typescript
interface MAPAgentPermissions {
  canSee: {
    agents: "all" | "hierarchy" | "scoped" | "direct" | { include: string[] };
    scopes: "all" | "member" | { include: string[] };
    structure: "full" | "local" | "none";
  };

  canMessage: {
    agents: "all" | "hierarchy" | "scoped" | { include: string[] };
    scopes: "all" | "member" | { include: string[] };
  };

  acceptsFrom: {
    agents: "all" | "hierarchy" | "scoped" | { include: string[] };
    clients: "all" | "none" | { include: string[] };
    systems: "all" | "none" | { include: string[] };
  };

  capabilities: {
    registerAgents: boolean;
    createScopes: boolean;
    steerAgents: boolean;
  };
}
```

---

## Permission Resolution

```typescript
function canPerformAction(
  client: MAPClient,
  agent: MAPAgent | null,
  action: MAPAction
): boolean {
  // Layer 1: System allows?
  if (!systemAllows(action)) return false;

  // Layer 2: Client permissions allow?
  if (!clientAllows(client, action)) return false;

  // Layer 3: Scope permissions allow?
  if (action.scope && !scopeAllows(action.scope, client, agent, action)) {
    return false;
  }

  // Layer 4: Agent permissions allow?
  if (agent && !agentAllows(agent, action)) {
    return false;
  }

  return true;
}
```

---

## Dynamic Permissions

Permissions can change during runtime:

```typescript
// System can update client permissions
{
  "method": "map/permissions/update",
  "params": {
    "clientId": "client_001",
    "permissions": {
      "actions": {
        "steerAgents": true
      }
    }
  }
}
```

---

## Permission Events

```typescript
type MAPPermissionEvent =
  | { type: "permissions.client.updated"; clientId: string; changes: ... }
  | { type: "permissions.agent.updated"; agentId: string; changes: ... }
  | { type: "permissions.scope.updated"; scopeId: string; changes: ... }
  | { type: "permissions.denied"; action: string; reason: string };
```

---

## Security Considerations

### Principle of Least Privilege

- Default to restricted permissions
- Grant only what's needed
- Regularly audit permission grants

### Permission Escalation Prevention

- Agents cannot grant permissions they don't have
- Clients cannot modify their own permissions
- System enforces capability ceilings

---

## Open Questions

1. **Inheritance**: Should agent permissions inherit from parent by default?
2. **Temporary grants**: Time-limited permission grants?
3. **Delegation**: Can agents delegate their permissions to others?
4. **Groups**: Should there be permission groups/roles for clients?
5. **Revocation**: Immediate revocation or graceful wind-down?
