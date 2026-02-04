---
title: Authentication
parent: Guides
grand_parent: SDK
nav_order: 5
description: "Configure authentication in the SDK"
---

# Authentication
{: .no_toc }

Configure authentication for MAP connections.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Overview

MAP supports multiple authentication methods. The SDK provides built-in support for bearer tokens, API keys, and custom authentication.

---

## Client Authentication

### Bearer Token

```typescript
import { ClientConnection } from "@multi-agent-protocol/sdk";

const client = new ClientConnection(stream, {
  name: "Dashboard",
  auth: {
    method: "bearer",
    credential: "eyJhbGciOiJSUzI1NiIs...",
  },
});

await client.connect();
```

### API Key

```typescript
const client = new ClientConnection(stream, {
  name: "Dashboard",
  auth: {
    method: "api-key",
    credential: "map_abc123_secretkey",
  },
});
```

### No Authentication

For local or development environments:

```typescript
const client = new ClientConnection(stream, {
  name: "LocalClient",
  // No auth property = no authentication
});
```

---

## Agent Authentication

```typescript
import { AgentConnection } from "@multi-agent-protocol/sdk";

const agent = new AgentConnection(stream, {
  name: "WorkerAgent",
  role: "processor",
  auth: {
    method: "bearer",
    credential: "agent-service-token",
  },
});

await agent.connect();
```

---

## Server Authentication Configuration

### Require Authentication

```typescript
import { MAPServer } from "@multi-agent-protocol/sdk/server";

const server = new MAPServer({
  name: "SecureServer",
  auth: {
    required: true,
    methods: ["bearer", "api-key"],

    // Validate credentials
    validate: async (credentials) => {
      if (credentials.method === "bearer") {
        const payload = await verifyJWT(credentials.credential);
        return {
          success: true,
          principal: {
            id: payload.sub,
            claims: payload,
          },
        };
      }

      if (credentials.method === "api-key") {
        const key = await lookupApiKey(credentials.credential);
        if (key) {
          return {
            success: true,
            principal: {
              id: key.ownerId,
              claims: { scope: key.scope },
            },
          };
        }
      }

      return {
        success: false,
        error: { code: "invalid_credentials", message: "Invalid credentials" },
      };
    },
  },
});
```

### Optional Authentication

```typescript
const server = new MAPServer({
  name: "FlexibleServer",
  auth: {
    required: false,  // Allow anonymous connections
    methods: ["bearer", "api-key", "none"],

    validate: async (credentials) => {
      if (credentials.method === "none") {
        return {
          success: true,
          principal: {
            id: "anonymous",
            claims: { role: "guest" },
          },
        };
      }

      // Validate other methods...
    },
  },
});
```

---

## JWT Validation

### Using jsonwebtoken

```typescript
import jwt from "jsonwebtoken";

const server = new MAPServer({
  name: "JWTServer",
  auth: {
    required: true,
    methods: ["bearer"],

    validate: async (credentials) => {
      try {
        const payload = jwt.verify(
          credentials.credential,
          process.env.JWT_SECRET!
        );

        return {
          success: true,
          principal: {
            id: payload.sub as string,
            issuer: payload.iss,
            claims: payload,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: {
            code: "invalid_credentials",
            message: err.message,
          },
        };
      }
    },
  },
});
```

### Using JWKS

```typescript
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://auth.example.com/.well-known/jwks.json")
);

const server = new MAPServer({
  name: "JWKSServer",
  auth: {
    required: true,
    methods: ["bearer"],

    validate: async (credentials) => {
      try {
        const { payload } = await jwtVerify(credentials.credential, JWKS, {
          issuer: "https://auth.example.com",
          audience: "map-server",
        });

        return {
          success: true,
          principal: {
            id: payload.sub!,
            issuer: payload.iss,
            claims: payload,
          },
        };
      } catch (err) {
        return {
          success: false,
          error: {
            code: "invalid_credentials",
            message: "Token validation failed",
          },
        };
      }
    },
  },
});
```

---

## Permission-Based Access

Use authentication claims to control permissions:

```typescript
const server = new MAPServer({
  name: "PermissionServer",
  auth: {
    required: true,
    methods: ["bearer"],
    validate: validateToken,
  },

  middleware: [
    async (method, params, ctx, next) => {
      const { principal } = ctx.session;

      // Check permissions based on claims
      if (method.startsWith("admin/")) {
        if (!principal?.claims?.roles?.includes("admin")) {
          throw new Error("Admin access required");
        }
      }

      if (method === "map/agents/register") {
        if (!principal?.claims?.canRegisterAgents) {
          throw new Error("Agent registration not permitted");
        }
      }

      return next();
    },
  ],
});
```

---

## Token Refresh

### Client-Side Refresh

```typescript
const client = new ClientConnection(stream, {
  name: "Dashboard",
  auth: {
    method: "bearer",
    credential: accessToken,
  },
});

await client.connect();

// When token is about to expire, refresh it
client.updateAuth({
  method: "bearer",
  credential: newAccessToken,
});
```

### Server-Side Expiration Notification

```typescript
const server = new MAPServer({
  name: "TokenServer",
  auth: {
    required: true,
    methods: ["bearer"],

    validate: async (credentials) => {
      const payload = await verifyJWT(credentials.credential);

      return {
        success: true,
        principal: {
          id: payload.sub,
          claims: payload,
        },
        expiresAt: payload.exp * 1000,  // When token expires
      };
    },

    // Notify clients before expiration
    notifyBeforeExpiry: 5 * 60 * 1000,  // 5 minutes
  },
});
```

---

## Connection Flow Examples

### Authenticated Connection

```typescript
// Client
const client = new ClientConnection(stream, {
  name: "SecureClient",
  auth: {
    method: "bearer",
    credential: await getAccessToken(),
  },
});

const result = await client.connect();

if (result.principal) {
  console.log(`Authenticated as: ${result.principal.id}`);
  console.log(`Claims:`, result.principal.claims);
}
```

### Handle Auth Errors

```typescript
try {
  await client.connect();
} catch (error) {
  if (error.code === 1000) {
    // AUTH_REQUIRED
    console.error("Authentication required");
  } else if (error.code === 1001) {
    // AUTH_FAILED
    console.error("Invalid credentials");
  } else if (error.code === 1002) {
    // AUTH_EXPIRED
    console.error("Token expired, please refresh");
  } else if (error.code === 1003) {
    // PERMISSION_DENIED
    console.error("Insufficient permissions");
  }
}
```

---

## Best Practices

1. **Use HTTPS/WSS** - Always use secure transports in production
2. **Short-lived tokens** - Use access tokens with short expiration
3. **Validate on server** - Never trust client-provided claims
4. **Least privilege** - Grant minimum required permissions
5. **Log auth events** - Track authentication for security auditing
6. **Rotate secrets** - Regularly rotate API keys and signing keys

---

## Next Steps

- [Server Setup](./server.html) - Configure server authentication
- [Testing](./testing.html) - Test authenticated connections
