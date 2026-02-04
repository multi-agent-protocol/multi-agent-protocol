# Authentication Guide

This guide covers how to add authentication to your MAP server.

## Overview

MAP supports pluggable authentication with built-in support for:

- **Bearer tokens (JWT)** - OAuth2, IdP integration, M2M tokens
- **API keys** - Simple static keys for internal services
- **mTLS** - Mutual TLS via client certificates
- **No auth** - For local/development scenarios

## Quick Start

### Basic JWT Authentication

```typescript
import { MAPServer, JWTAuthenticator } from '@anthropic/multi-agent-protocol/server';

const server = new MAPServer({
  name: 'my-server',
  auth: {
    required: true,
    authenticators: [
      new JWTAuthenticator({
        jwksUrl: 'https://auth.example.com/.well-known/jwks.json',
        issuer: 'https://auth.example.com',
        audience: 'map-server-prod',
      }),
    ],
  },
});
```

### API Key Authentication

```typescript
import { MAPServer, APIKeyAuthenticator } from '@anthropic/multi-agent-protocol/server';

const server = new MAPServer({
  name: 'my-server',
  auth: {
    required: true,
    authenticators: [
      new APIKeyAuthenticator({
        validateKey: async (key) => {
          const record = await db.apiKeys.findByHash(hash(key));
          if (!record || record.revoked) {
            return { valid: false, error: 'Invalid or revoked API key' };
          }
          return {
            valid: true,
            principalId: record.ownerId,
            metadata: { scopes: record.scopes },
          };
        },
      }),
    ],
  },
});
```

### Multiple Auth Methods

```typescript
import {
  MAPServer,
  JWTAuthenticator,
  APIKeyAuthenticator,
  NoAuthAuthenticator,
} from '@anthropic/multi-agent-protocol/server';

const server = new MAPServer({
  auth: {
    required: true,
    authenticators: [
      // Try JWT first
      new JWTAuthenticator({ jwksUrl: '...' }),
      // Fall back to API key
      new APIKeyAuthenticator({ validateKey: async (key) => ... }),
    ],
    // Advertise OAuth2 metadata for clients
    oauth2MetadataUrl: 'https://auth.example.com/.well-known/oauth-authorization-server',
  },
});
```

## Built-in Authenticators

### JWTAuthenticator

Validates JWT bearer tokens using JWKS or static keys.

```typescript
new JWTAuthenticator({
  // JWKS URL for fetching public keys (recommended)
  jwksUrl: 'https://auth.example.com/.well-known/jwks.json',

  // Or provide static JWKS
  jwks: { keys: [...] },

  // Or use a symmetric secret (HS256, for testing only)
  secret: 'your-256-bit-secret',

  // Expected issuer (optional but recommended)
  issuer: 'https://auth.example.com',

  // Expected audience (optional but recommended)
  audience: 'map-server',

  // Custom claims validation
  validateClaims: (claims) => {
    const scopes = claims.scope?.split(' ') ?? [];
    return scopes.includes('map:access');
  },
});
```

### APIKeyAuthenticator

Validates API keys using a custom validator function.

```typescript
new APIKeyAuthenticator({
  validateKey: async (key, context) => {
    // Look up key in database
    const record = await db.apiKeys.findByHash(hash(key));

    if (!record) {
      return { valid: false, error: 'Unknown API key' };
    }

    if (record.revoked) {
      return { valid: false, error: 'API key has been revoked' };
    }

    if (record.expiresAt && record.expiresAt < Date.now()) {
      return { valid: false, error: 'API key has expired' };
    }

    return {
      valid: true,
      principalId: record.ownerId,
      metadata: {
        scopes: record.scopes,
        name: record.name,
      },
    };
  },

  // Optional: transform the credential before validation
  extractKey: (credential) => credential.replace(/^Bearer\s+/i, ''),
});
```

For testing, use the helper function:

```typescript
import { createSimpleAPIKeyAuthenticator } from '@anthropic/multi-agent-protocol/server';

const authenticator = createSimpleAPIKeyAuthenticator({
  'test-key-1': 'user-1',
  'test-key-2': 'user-2',
});
```

### MTLSAuthenticator

Uses client certificates for authentication. TLS must be configured at the transport layer.

```typescript
new MTLSAuthenticator({
  // Optional: restrict to specific certificate fingerprints
  allowedFingerprints: ['sha256:abc123...', 'sha256:def456...'],

  // Optional: restrict to specific issuers
  allowedIssuers: ['CN=MyCA,O=MyOrg'],

  // Optional: custom certificate validation
  validateCertificate: async (cert) => {
    // Check against revocation list
    const isRevoked = await checkCRL(cert.fingerprint);
    if (isRevoked) return 'Certificate has been revoked';
    return true;
  },

  // Optional: custom principal ID extraction
  extractPrincipalId: (subject) => {
    // Parse CN from subject
    const match = subject.match(/CN=([^,]+)/);
    return match ? match[1] : subject;
  },
});
```

### NoAuthAuthenticator

Allows unauthenticated connections. Use for development or trusted local connections.

```typescript
new NoAuthAuthenticator({
  defaultPrincipalId: 'anonymous',
  defaultClaims: { role: 'guest' },
});
```

## Client Authentication

Clients provide credentials in the connect request:

```typescript
const client = await ClientConnection.connect('wss://map.example.com', {
  name: 'my-client',
  auth: {
    method: 'bearer',
    credential: accessToken,
  },
});
```

Or using API key:

```typescript
const client = await ClientConnection.connect('wss://map.example.com', {
  name: 'my-client',
  auth: {
    method: 'api-key',
    credential: process.env.MAP_API_KEY,
  },
});
```

### Auth Negotiation

If the client doesn't know the auth requirements, the server responds with `authRequired`:

```typescript
const client = await ClientConnection.connect('wss://map.example.com', {
  name: 'my-client',
});

// If auth is required, the connect response includes authRequired
if (response.authRequired) {
  console.log('Supported methods:', response.authRequired.methods);
  console.log('OAuth2 metadata:', response.authRequired.oauth2MetadataUrl);

  // Authenticate with appropriate method
  const authResult = await client.call('map/authenticate', {
    method: 'bearer',
    credential: await fetchToken(),
  });
}
```

## Transport-Based Auth Bypass

Skip authentication for trusted transports (e.g., local subprocess agents):

```typescript
const server = new MAPServer({
  auth: {
    required: true,
    authenticators: [...],
    bypassForTransports: {
      stdio: true,      // Skip auth for subprocess agents
      inprocess: true,  // Skip auth for in-memory connections
    },
  },
});
```

## Accessing Principal Information

After authentication, the principal is available on the session:

```typescript
// In a custom handler
async (params, ctx) => {
  const principal = ctx.session.principal;

  if (principal) {
    console.log('User ID:', principal.id);
    console.log('Issuer:', principal.issuer);
    console.log('Claims:', principal.claims);
  }

  // ...
};
```

## Custom Authenticators

Implement the `Authenticator` interface for custom auth methods:

```typescript
import type { Authenticator, AuthContext, AuthCredentials, AuthResult } from '@anthropic/multi-agent-protocol/server';

class MyCustomAuthenticator implements Authenticator {
  readonly methods = ['x-my-custom'] as const;

  async authenticate(
    credentials: AuthCredentials,
    context: AuthContext
  ): Promise<AuthResult> {
    // Validate credentials
    const isValid = await validateMyCustomAuth(credentials.credential);

    if (!isValid) {
      return {
        success: false,
        error: {
          code: 'invalid_credentials',
          message: 'Custom auth validation failed',
        },
      };
    }

    return {
      success: true,
      principal: {
        id: 'user-123',
        claims: { customField: 'value' },
      },
    };
  }

  // Optional: async initialization
  async initialize(): Promise<void> {
    await loadCustomAuthConfig();
  }

  // Optional: cleanup on shutdown
  async shutdown(): Promise<void> {
    await cleanupResources();
  }
}
```

Use custom auth methods with the `x-` prefix:

```typescript
const client = await ClientConnection.connect('wss://map.example.com', {
  auth: {
    method: 'x-my-custom',
    credential: 'custom-credential-data',
    metadata: { extra: 'info' },
  },
});
```

## Security Best Practices

1. **Always use TLS** for remote connections
2. **Use short-lived tokens** (< 1 hour) for M2M auth
3. **Validate audience claims** to prevent token confusion
4. **Rotate credentials** regularly
5. **Hash API keys** before storage
6. **Log auth events** for audit trails
7. **Rate limit** authentication attempts

## Error Handling

Authentication errors use standard error codes:

| Code | Description |
|------|-------------|
| `invalid_credentials` | Credentials are malformed or invalid |
| `expired` | Credentials have expired |
| `insufficient_scope` | Valid credentials but insufficient permissions |
| `method_not_supported` | Requested auth method not supported |
| `auth_required` | No credentials provided but auth is required |

Handle auth errors in clients:

```typescript
try {
  const client = await ClientConnection.connect('wss://map.example.com', {
    auth: { method: 'bearer', credential: token },
  });
} catch (error) {
  if (error.code === 'AUTH_REQUIRED') {
    // Prompt for credentials
  } else if (error.code === 'INVALID_CREDENTIALS') {
    // Token is invalid, refresh and retry
  }
}
```

## Related Documentation

- [Authentication Specification](/docs/09-authentication.md) - Full protocol specification
- [Connection Model](/docs/05-connection-model.md) - Connection lifecycle
- [Permissions Guide](./permissions.md) - Authorization after authentication
