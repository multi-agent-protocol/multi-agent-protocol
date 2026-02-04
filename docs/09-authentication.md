# MAP Authentication Specification

This specification defines how authentication is negotiated and performed in the Multi-Agent Protocol (MAP). The design prioritizes flexibility while providing interoperable defaults.

## Design Principles

1. **Pluggable mechanisms** - Support multiple auth methods with a standard negotiation flow
2. **Sensible defaults** - Built-in support for common methods (bearer tokens, API keys)
3. **Transport-aware** - Acknowledge that some auth happens at transport layer (mTLS)
4. **Optional for local** - No auth overhead for trusted local connections (stdio)
5. **Federation-ready** - Credentials can carry claims for cross-server authentication

---

## Authentication Methods

MAP defines the following standard authentication methods:

| Method | Description | Use Case |
|--------|-------------|----------|
| `none` | No authentication | Local subprocess agents, development |
| `bearer` | Bearer token (JWT or opaque) | OAuth2, IdP integration, M2M tokens |
| `api-key` | Simple API key | Simple integrations, internal services |
| `mtls` | Mutual TLS (transport layer) | High-security service-to-service |

### Extension Methods

Custom authentication methods MUST use the `x-` prefix:

```
x-custom-auth
x-kerberos
x-saml
```

Servers MUST reject unknown methods that do not use the `x-` prefix.

---

## Wire Protocol

### Server Authentication Capabilities

Servers advertise authentication requirements in the connect response:

```typescript
interface ServerAuthCapabilities {
  /** Supported authentication methods (in preference order) */
  methods: AuthMethod[];

  /** Is authentication required to proceed? */
  required: boolean;

  /** OAuth2 authorization server metadata URL (RFC 8414) */
  oauth2MetadataUrl?: string;

  /** JWKS URL for local JWT verification (RFC 7517) */
  jwksUrl?: string;

  /** Realm identifier for this server */
  realm?: string;
}
```

### Client Authentication Credentials

Clients provide credentials using:

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

Servers respond with:

```typescript
interface AuthResult {
  /** Whether authentication succeeded */
  success: boolean;

  /** Authenticated principal information */
  principal?: {
    /** Unique identifier for this principal */
    id: string;

    /** Token issuer (for federated auth) */
    issuer?: string;

    /** Additional claims from the credential */
    claims?: Record<string, unknown>;
  };

  /** Error details if authentication failed */
  error?: {
    code: AuthErrorCode;
    message: string;
  };
}

type AuthErrorCode =
  | 'invalid_credentials'    // Credentials are malformed or invalid
  | 'expired'                // Credentials have expired
  | 'insufficient_scope'     // Valid credentials but insufficient permissions
  | 'method_not_supported'   // Requested method not supported by server
  | 'auth_required';         // No credentials provided but auth is required
```

---

## Connection Flow

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
   │                                              │
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
    "serverCapabilities": { ... },
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
   │                                              │
```

```typescript
// Initial connect (no auth)
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "map/connect",
  "params": {
    "protocolVersion": 1,
    "participantType": "client",
    "name": "my-client"
  }
}

// Server requires auth
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "authRequired": {
      "methods": ["bearer", "api-key"],
      "required": true,
      "realm": "map-server-prod",
      "oauth2MetadataUrl": "https://auth.example.com/.well-known/oauth-authorization-server"
    }
  }
}

// Client authenticates
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "map/authenticate",
  "params": {
    "method": "bearer",
    "credential": "eyJhbGciOiJSUzI1NiIs..."
  }
}

// Server confirms
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "success": true,
    "sessionId": "session_01ABC",
    "participantId": "client_01XYZ",
    "principal": {
      "id": "user_123",
      "claims": { "scope": "read write" }
    }
  }
}
```

### Flow 3: No Auth Required

For local connections or development:

```typescript
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "map/connect",
  "params": {
    "protocolVersion": 1,
    "participantType": "agent",
    "name": "local-worker",
    "auth": { "method": "none" }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "sessionId": "session_01ABC",
    "participantId": "agent_01XYZ",
    "principal": {
      "id": "anonymous"
    }
  }
}
```

---

## Method-Specific Details

### Bearer Tokens (`bearer`)

Bearer tokens are opaque strings or JWTs. The server is responsible for validation.

**Credential format:** The raw token string

```typescript
{
  "method": "bearer",
  "credential": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**JWT Claims (when using JWT):**

| Claim | Description | Required |
|-------|-------------|----------|
| `sub` | Subject (principal ID) | Yes |
| `iss` | Issuer | Recommended |
| `aud` | Audience (server identifier) | Recommended |
| `exp` | Expiration time | Recommended |
| `iat` | Issued at | Recommended |
| `scope` | Space-separated permission scopes | Optional |
| `map:capabilities` | MAP-specific capabilities | Optional |

**Example JWT payload:**

```json
{
  "sub": "agent_worker_01",
  "iss": "https://auth.example.com",
  "aud": "map-server-prod",
  "exp": 1706227200,
  "iat": 1706223600,
  "scope": "map:read map:write map:agent",
  "map:capabilities": {
    "canSpawn": true,
    "canSend": true
  }
}
```

### API Keys (`api-key`)

Simple static keys for straightforward integrations.

**Credential format:** The API key string

```typescript
{
  "method": "api-key",
  "credential": "map_sk_live_abc123def456..."
}
```

**Security considerations:**
- MUST only be used over TLS
- Keys SHOULD be rotatable without service interruption
- Keys SHOULD have associated metadata (owner, scopes, expiry)

### Mutual TLS (`mtls`)

Authentication is performed at the transport layer via client certificates.

**Credential format:** No credential in the protocol; certificate is validated at transport.

```typescript
{
  "method": "mtls"
  // No credential needed - cert already validated
}
```

**Metadata:** The server MAY extract principal information from the certificate:

```typescript
{
  "method": "mtls",
  "metadata": {
    "cn": "agent-worker-01.example.com",
    "fingerprint": "sha256:abc123..."
  }
}
```

### No Authentication (`none`)

For trusted local connections.

```typescript
{
  "method": "none"
}
```

**When to use:**
- Subprocess agents connected via stdio
- In-process connections
- Development/testing environments
- Behind a trusted proxy that handles auth

**Servers MAY:**
- Reject `none` based on transport type (e.g., require auth for WebSocket)
- Assign a default principal for anonymous connections

---

## Token Refresh

For long-lived connections with expiring tokens:

### Proactive Refresh

Client refreshes before expiration:

```typescript
// Request
{
  "jsonrpc": "2.0",
  "id": 10,
  "method": "map/auth/refresh",
  "params": {
    "credential": "eyJhbGciOiJSUzI1NiIs..."  // New token
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 10,
  "result": {
    "success": true,
    "principal": {
      "id": "user_123",
      "claims": { "exp": 1706230800 }
    }
  }
}
```

### Server-Initiated Expiration Warning

Server notifies client before token expires:

```typescript
// Notification (server → client)
{
  "jsonrpc": "2.0",
  "method": "map/auth/expiring",
  "params": {
    "expiresAt": 1706227200,
    "refreshBefore": 1706226900  // Suggested refresh time
  }
}
```

### Forced Re-authentication

If token expires or is revoked:

```typescript
// Notification (server → client)
{
  "jsonrpc": "2.0",
  "method": "map/auth/revoked",
  "params": {
    "reason": "token_expired",
    "message": "Your session has expired. Please re-authenticate.",
    "gracePeriodMs": 5000  // Time before disconnect
  }
}
```

---

## Federation Authentication

For cross-server authentication in federated deployments:

### Token Requirements

Federated tokens MUST include:

| Claim | Description |
|-------|-------------|
| `iss` | Issuing server's identifier |
| `aud` | Target server(s) - array or string |
| `sub` | Original principal identifier |
| `map:federation` | Federation-specific claims |

**Example federated token:**

```json
{
  "sub": "agent_worker_01",
  "iss": "https://server-a.example.com",
  "aud": ["https://server-b.example.com", "https://server-c.example.com"],
  "exp": 1706227200,
  "map:federation": {
    "originServer": "server-a",
    "delegatedCapabilities": {
      "canSend": true,
      "canQuery": true
    },
    "hopCount": 1,
    "maxHops": 3
  }
}
```

### Trust Establishment

Federated servers MUST:
1. Maintain an allowlist of trusted issuers
2. Verify token signatures against issuer's JWKS
3. Validate audience claims include their own identifier
4. Enforce hop count limits to prevent routing loops

---

## Error Handling

### Authentication Errors

| Error Code | HTTP Equivalent | Description |
|------------|-----------------|-------------|
| `AUTH_REQUIRED` | 401 | Authentication required but not provided |
| `INVALID_CREDENTIALS` | 401 | Credentials invalid or malformed |
| `EXPIRED` | 401 | Credentials have expired |
| `INSUFFICIENT_SCOPE` | 403 | Valid credentials but lacks required permissions |
| `METHOD_NOT_SUPPORTED` | 400 | Requested auth method not supported |

**Error response format:**

```typescript
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,  // MAP error code
    "message": "Authentication failed",
    "data": {
      "authError": {
        "code": "invalid_credentials",
        "message": "JWT signature verification failed"
      },
      "authRequired": {
        "methods": ["bearer", "api-key"],
        "required": true
      }
    }
  }
}
```

---

## Security Considerations

### Transport Security

1. **TLS Required** - All remote connections MUST use TLS 1.2+
2. **Certificate Validation** - Clients MUST validate server certificates
3. **No Downgrade** - Servers SHOULD reject non-TLS connections for auth methods other than `none`

### Token Security

1. **Short Lifetimes** - Bearer tokens SHOULD have lifetimes ≤ 1 hour for M2M
2. **Audience Validation** - Servers MUST validate `aud` claims
3. **Signature Algorithms** - Prefer RS256/ES256; avoid HS256 for distributed systems
4. **Key Rotation** - Servers SHOULD support JWKS key rotation

### API Key Security

1. **Entropy** - Keys MUST have ≥ 256 bits of entropy
2. **Prefix** - Keys SHOULD use identifiable prefixes (e.g., `map_sk_`)
3. **Hashing** - Servers MUST store only hashed keys
4. **Rotation** - Support key rotation without service interruption

### Logging and Audit

1. **No Credential Logging** - Credentials MUST NOT appear in logs
2. **Auth Events** - Log authentication attempts (success/failure) with principal ID
3. **Rate Limiting** - Implement rate limiting on auth endpoints

---

## Implementation Requirements

### Servers MUST

1. Support at least one of: `bearer`, `api-key`, or `none`
2. Advertise supported methods in auth capabilities
3. Return proper error codes for auth failures
4. Validate credentials before establishing session

### Servers SHOULD

1. Support `bearer` tokens with JWT validation
2. Provide JWKS endpoint or reference external JWKS
3. Support token refresh for long-lived connections
4. Implement rate limiting on authentication

### Clients MUST

1. Support providing credentials via `auth` parameter
2. Handle `authRequired` response and provide credentials
3. Handle auth errors gracefully

### Clients SHOULD

1. Implement automatic token refresh before expiration
2. Support credential caching with proper security
3. Handle `map/auth/expiring` notifications

---

## Examples

### Example 1: Production Server with JWT

```typescript
const server = new MAPServer({
  auth: {
    required: true,
    methods: ['bearer'],
    authenticators: [
      new JWTAuthenticator({
        jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
        issuer: 'https://auth.example.com',
        audience: 'map-server-prod'
      })
    ]
  }
});
```

### Example 2: Internal Service with API Keys

```typescript
const server = new MAPServer({
  auth: {
    required: true,
    methods: ['api-key'],
    authenticators: [
      new APIKeyAuthenticator({
        validateKey: async (key) => {
          const record = await db.apiKeys.findByHash(hash(key));
          return {
            valid: !!record && !record.revoked,
            principalId: record?.ownerId,
            metadata: { scopes: record?.scopes }
          };
        }
      })
    ]
  }
});
```

### Example 3: Development Server

```typescript
const server = new MAPServer({
  auth: {
    required: false,
    methods: ['none', 'bearer'],
    authenticators: [
      new NoAuthAuthenticator(),
      new JWTAuthenticator({ /* ... */ })  // Optional for testing
    ]
  }
});
```

### Example 4: Hybrid Production

```typescript
const server = new MAPServer({
  auth: {
    required: true,
    methods: ['bearer', 'api-key', 'mtls'],
    authenticators: [
      new JWTAuthenticator({ /* ... */ }),
      new APIKeyAuthenticator({ /* ... */ }),
      new MTLSAuthenticator({ /* ... */ })
    ]
  }
});
```

---

## Open Questions

1. **Scope standardization** - Should MAP define standard scope strings (e.g., `map:read`, `map:agent:spawn`)?
2. **Principal-to-permissions mapping** - Should the protocol define how claims map to capabilities?
3. **Multi-factor** - Is there a use case for multi-factor auth in agent connections?
4. **Session binding** - Should tokens be bound to specific sessions to prevent replay?
