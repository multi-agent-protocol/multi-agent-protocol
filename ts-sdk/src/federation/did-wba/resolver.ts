/**
 * DID:WBA Document Resolution
 *
 * Resolves `did:wba:<domain>:<path>` DIDs to DID Documents by fetching
 * `https://<domain>/<path>/did.json` over HTTPS.
 */

import type { DIDDocument, DIDVerificationMethod } from '../../types';

/**
 * Options for the DID:WBA resolver.
 */
export interface DIDResolverOptions {
  /** Cache TTL for resolved DID documents in ms (default: 300000 = 5 min) */
  cacheTtlMs?: number;
  /** HTTP fetch timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Custom fetch function (for testing) */
  fetchFn?: typeof globalThis.fetch;
}

/**
 * Parsed components of a did:wba DID.
 */
export interface ParsedDIDWBA {
  /** The domain (e.g., "agents.example.com") */
  domain: string;
  /** The path segments (e.g., "gateway" or "agents/worker-01") */
  path: string;
}

/**
 * Regex patterns for private/reserved IP ranges that should be blocked
 * to prevent SSRF attacks during DID document resolution.
 */
const PRIVATE_IP_PATTERNS = [
  /^127\./, // Loopback (127.0.0.0/8)
  /^10\./, // Private Class A (10.0.0.0/8)
  /^172\.(1[6-9]|2\d|3[0-1])\./, // Private Class B (172.16.0.0/12)
  /^192\.168\./, // Private Class C (192.168.0.0/16)
  /^169\.254\./, // Link-local (169.254.0.0/16, includes AWS metadata)
  /^0\./, // "This" network (0.0.0.0/8)
  /^\[::1\]$/, // IPv6 loopback
  /^\[fc/, // IPv6 unique local
  /^\[fd/, // IPv6 unique local
  /^\[fe80:/, // IPv6 link-local
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal', // GCP metadata
];

/**
 * Check whether a domain/hostname is safe to fetch (i.e., not a private/reserved address).
 * Returns true if the domain appears safe, false if it looks like an internal address.
 */
export function isSafeDomain(domain: string): boolean {
  const lower = domain.toLowerCase();

  // Block known internal hostnames
  if (BLOCKED_HOSTNAMES.includes(lower)) {
    return false;
  }

  // Block IP address patterns (private/reserved ranges)
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(lower)) {
      return false;
    }
  }

  // Block bare IPs that aren't clearly public (must have at least one dot and a letter for a real domain)
  // This catches numeric-only entries like "192.0.2.1" that aren't caught above
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) {
    return false; // Block all raw IPv4 addresses — use domain names for DID resolution
  }

  return true;
}

/**
 * Parse a did:wba DID into its components.
 *
 * @example
 * parseDIDWBA("did:wba:agents.example.com:gateway")
 * // → { domain: "agents.example.com", path: "gateway" }
 *
 * parseDIDWBA("did:wba:example.com:agents:worker-01")
 * // → { domain: "example.com", path: "agents/worker-01" }
 */
export function parseDIDWBA(did: string): ParsedDIDWBA {
  if (!did.startsWith('did:wba:')) {
    throw new Error(`Invalid did:wba DID: must start with "did:wba:", got "${did}"`);
  }

  const rest = did.slice('did:wba:'.length);
  // Split on literal colons first, then decode percent-encoding per segment
  // This preserves the DID delimiter structure while decoding %3A within segments
  // e.g., "example.com%3A8080:path" → ["example.com:8080", "path"]
  const parts = rest.split(':').reduce<string[]>((acc, part) => {
    // If the previous segment ended with a percent-encoded sequence that was split,
    // it means the colon was literal. But per did:wba spec, %3A within a segment
    // means the colon is part of the segment (e.g., domain with port).
    // We decode each part individually.
    const decoded = decodeURIComponent(part);
    acc.push(decoded);
    return acc;
  }, []);

  if (parts.length < 2) {
    throw new Error(`Invalid did:wba DID: must have at least domain and path, got "${did}"`);
  }

  const domain = parts[0];
  const pathSegments = parts.slice(1);

  // Reject empty segments and path traversal
  for (const seg of pathSegments) {
    if (!seg) {
      throw new Error(`Invalid did:wba DID: empty path segment in "${did}"`);
    }
    if (seg === '.' || seg === '..') {
      throw new Error(`Invalid did:wba DID: path traversal not allowed in "${did}"`);
    }
  }

  const path = pathSegments.join('/');

  if (!domain || !path) {
    throw new Error(`Invalid did:wba DID: domain and path must be non-empty, got "${did}"`);
  }

  // SSRF protection: reject private/reserved domains
  if (!isSafeDomain(domain)) {
    throw new Error(`Invalid did:wba DID: domain "${domain}" is not allowed (private/reserved address)`);
  }

  return { domain, path };
}

/**
 * Construct the HTTPS URL for a did:wba DID document.
 *
 * @example
 * didToUrl("did:wba:agents.example.com:gateway")
 * // → "https://agents.example.com/gateway/did.json"
 */
export function didToUrl(did: string): string {
  const { domain, path } = parseDIDWBA(did);
  return `https://${domain}/${path}/did.json`;
}

/**
 * Resolver for did:wba DID Documents.
 *
 * Fetches DID documents over HTTPS and caches them with a configurable TTL.
 */
export class DIDWBAResolver {
  private readonly cacheTtlMs: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly cache: Map<string, { doc: DIDDocument; expiresAt: number }> = new Map();

  constructor(options?: DIDResolverOptions) {
    this.cacheTtlMs = options?.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutes
    this.timeoutMs = options?.timeoutMs ?? 10_000; // 10 seconds
    this.fetchFn = options?.fetchFn ?? globalThis.fetch;
  }

  /**
   * Resolve a did:wba DID to its DID Document.
   *
   * @param did - The DID to resolve (e.g., "did:wba:agents.example.com:gateway")
   * @returns The resolved DID Document
   * @throws Error if resolution fails (network, invalid document, etc.)
   */
  async resolve(did: string): Promise<DIDDocument> {
    // Check cache
    const cached = this.cache.get(did);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.doc;
    }

    const url = didToUrl(did);

    let response: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        response = await this.fetchFn(url, {
          headers: { 'Accept': 'application/json' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      throw new Error(
        `Failed to resolve DID document for ${did}: ${(error as Error).message}`
      );
    }

    if (!response.ok) {
      throw new Error(
        `Failed to resolve DID document for ${did}: HTTP ${response.status} ${response.statusText}`
      );
    }

    let doc: DIDDocument;
    try {
      doc = await response.json() as DIDDocument;
    } catch {
      throw new Error(`Failed to parse DID document for ${did}: invalid JSON`);
    }

    // Basic validation
    if (!doc.id) {
      throw new Error(`Invalid DID document for ${did}: missing "id" field`);
    }
    if (doc.id !== did) {
      throw new Error(
        `DID document mismatch for ${did}: document "id" is "${doc.id}"`
      );
    }

    // Cache the resolved document
    this.cache.set(did, {
      doc,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return doc;
  }

  /**
   * Extract the MAP federation service endpoint from a DID Document.
   *
   * Looks for a service of type "MAPFederationEndpoint".
   * Returns the endpoint URL string, or undefined if not found.
   */
  extractMAPEndpoint(doc: DIDDocument): string | undefined {
    const service = doc.service?.find(
      (s) => s.type === 'MAPFederationEndpoint'
    );
    if (!service) return undefined;
    // serviceEndpoint can be a string or an object — return string URLs only
    return typeof service.serviceEndpoint === 'string'
      ? service.serviceEndpoint
      : undefined;
  }

  /**
   * Extract verification keys referenced by the `authentication` relationship.
   */
  extractVerificationKeys(doc: DIDDocument): DIDVerificationMethod[] {
    if (!doc.verificationMethod || !doc.authentication) {
      return [];
    }

    return doc.authentication
      .map((authRef) => doc.verificationMethod!.find((vm) => vm.id === authRef))
      .filter((vm): vm is DIDVerificationMethod => vm !== undefined);
  }

  /**
   * Clear the resolution cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
