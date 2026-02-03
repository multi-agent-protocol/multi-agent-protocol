---
title: Authentication
parent: Protocol
nav_order: 6
description: "Authentication methods and flows"
---

# Authentication
{: .no_toc }

Authentication methods, negotiation flows, and security considerations.
{: .fs-6 .fw-300 }

## Table of contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Design Principles

1. **Pluggable mechanisms** - Support multiple auth methods with a standard negotiation flow
2. **Sensible defaults** - Built-in support for common methods (bearer tokens, API keys)
3. **Transport-aware** - Acknowledge that some auth happens at transport layer (mTLS)
4. **Optional for local** - No auth overhead for trusted local connections (stdio)
5. **Federation-ready** - Credentials can carry claims for cross-server authentication

---

## Authentication Methods

| Method | Description | Use Case |
|:-------|:------------|:---------|
| `none` | No authentication | Local subprocess agents, development |
| `bearer` | Bearer token (JWT or opaque) | OAuth2, IdP integration, M2M tokens |
| `api-key` | Simple API key | Simple integrations, internal services |
| `mtls` | Mutual TLS (transport layer) | High-security service-to-service |

### Extension Methods

Custom authentication methods use the `x-` prefix:

```
x-custom-auth
x-kerberos
x-saml
```

Servers MUST reject unknown methods without the `x-` prefix.

---

## Wire Protocol

### Server Authentication Capabilities

Servers advertise requirements in the connect response:

```typescript
interface ServerAuthCapabilities {
  /** Supported authentication methods (in preference order) */
  methods: AuthMethod[];

  /** Is authentication required to proceed? */
  required: boolean;

  /** OAuth2 authorization server metadata URL */
  oauth2MetadataUrl?: string;

  /** JWKS URL for local JWT verification */
  jwksUrl?: string;

  /** Realm identifier for this server */
  realm?: string;
}
```

### Client Credentials

```typescript
interface AuthCredentials {
  /** The authentication method being used */
  method: AuthMethod;

  /** The credential value (token, API key, etc.) */
  credential?: string;

  /** Method-specific additional data */
  metadata?: Record<string, unknown>;
}
```

### Authentication Result

```typescript
interface AuthResult {
  success: boolean;

  principal?: {
    id: string;
    issuer?: string;
    claims?: Record<string, unknown>;
  };

  error?: {
    code: AuthErrorCode;
    message: string;
  };
}

type AuthErrorCode =
  | 'invalid_credentials'
  | 'expired'
  | 'insufficient_scope'
  | 'method_not_supported'
  | 'auth_required';
```

---

## Connection Flows

### Flow 1: Auth Provided Upfront (Recommended)

When the client knows the server's auth requirements:

```
Client                                         Server
   │                                              │
   │──── map/connect ────────────────────────────►│
   │     { participantType, auth: { method, credential } }
   │                                              │
   │◄─── connect response ───────────────────────│
   │     { session, principal }                   │
```

```typescript
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "map/connect",
  "params": {
    "protocolVersion": 1,
    "participantType": "client",
    "name": "my-client",
    "auth": {
      "method": "bearer",
      "credential": "eyJhbGciOiJSUzI1NiIs..."
    }
  }
}

// Response (success)
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "session_01ABC",
    "participantId": "client_01XYZ",
    "principal": {
      "id": "user_123",
      "issuer": "https://auth.example.com",
      "claims": { "scope": "read write" }
    }
  }
}
```

### Flow 2: Auth Negotiation

When the client doesn't know auth requirements:

```
Client                                         Server
   │                                              │
   │──── map/connect ────────────────────────────►│
   │     { participantType }                      │
   │                                              │
   │◄─── auth_required response ─────────────────│
   │     { authRequired: { methods, required } }  │
   │                                              │
   │──── map/authenticate ───────────────────────►│
   │     { method, credential }                   │
   │                                              │
   │◄─── auth result ────────────────────────────│
   │     { success, session, principal }          │
```

### Flow 3: No Authentication

For trusted local connections:

```
Client                                         Server
   │                                              │
   │──── map/connect ────────────────────────────►│
   │     { participantType }                      │
   │                                              │
   │◄─── connect response ───────────────────────│
   │     { session }                              │
```

---

## Method-Specific Details

### Bearer Tokens (JWT)

```typescript
// Standard JWT claims used by MAP
interface MAPJWTClaims {
  sub: string;           // Subject (principal ID)
  iss: string;           // Issuer
  aud: string | string[];// Audience (MAP server ID)
  exp: number;           // Expiration
  iat: number;           // Issued at
  nbf?: number;          // Not before

  // MAP-specific claims
  "map:permissions"?: MAPPermissions;
  "map:roles"?: string[];
  "map:scopes"?: string[];
}
```

### API Keys

```typescript
// API key format
interface MAPApiKey {
  prefix: string;        // e.g., "map_"
  keyId: string;         // Key identifier
  secret: string;        // Secret portion

  // Combined format: map_keyId_secret
}

// Header format
Authorization: ApiKey map_abc123_secretxyz
```

### Mutual TLS

Authentication happens at transport layer:

```typescript
interface MTLSAuth {
  method: "mtls";
  metadata: {
    clientCertificate: {
      subject: string;
      issuer: string;
      fingerprint: string;
      validFrom: string;
      validTo: string;
    };
  };
}
```

---

## Token Refresh

### Proactive Refresh

Client refreshes before expiration:

```typescript
{
  "method": "map/authenticate",
  "params": {
    "method": "bearer",
    "credential": "new_access_token",
    "refresh": true
  }
}
```

### Server-Initiated Refresh

Server can request reauthentication:

```typescript
// Server notification
{
  "method": "map/auth.expiring",
  "params": {
    "expiresIn": 300,  // seconds
    "reason": "token_expiring"
  }
}

// Client responds with new credentials
{
  "method": "map/authenticate",
  "params": {
    "method": "bearer",
    "credential": "refreshed_token"
  }
}
```

---

## Federation Authentication

### Trust Establishment

```typescript
interface FederationAuth {
  // Peer identification
  peerId: string;
  peerCertificate?: string;

  // Trust method
  trustMethod: "mtls" | "signed_tokens" | "shared_secret";

  // Token signing for cross-system calls
  tokenSigning?: {
    algorithm: string;
    keyId: string;
  };
}
```

### Cross-System Token Propagation

```typescript
// Message with propagated auth context
{
  "method": "map/federation/send",
  "params": {
    "peerId": "system_beta",
    "message": { ... },
    "authContext": {
      "originalPrincipal": "user_123",
      "originalIssuer": "system_alpha",
      "delegationChain": ["system_alpha"],
      "signature": "..."
    }
  }
}
```

---

## Error Handling

### Authentication Errors

| Code | Error | Recovery |
|:-----|:------|:---------|
| 1000 | AUTH_REQUIRED | Provide credentials |
| 1001 | AUTH_FAILED | Check credentials |
| 1002 | AUTH_EXPIRED | Refresh token |
| 1003 | PERMISSION_DENIED | Request additional scope |

### Error Response

```typescript
{
  "error": {
    "code": 1001,
    "message": "Authentication failed",
    "data": {
      "category": "auth",
      "reason": "invalid_signature",
      "hint": "Token signature verification failed"
    }
  }
}
```

---

## Security Considerations

{: .warning }
> Always use TLS in production environments. Never transmit credentials over unencrypted connections.

### Best Practices

1. **Short-lived tokens** - Use access tokens with short expiration
2. **Secure storage** - Never log or store credentials in plain text
3. **Scope limitation** - Request minimum necessary permissions
4. **Token rotation** - Rotate API keys and refresh tokens regularly
5. **Audit logging** - Log authentication events for security monitoring

---

## Next Steps

- [Permissions](./permissions.html) - 4-layer permission model
- [Federation](./federation.html) - Cross-system authentication
