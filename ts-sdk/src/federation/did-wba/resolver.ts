/**
 * DID:WBA Document Resolution
 *
 * Resolves `did:wba:<domain>:<path>` DIDs to DID Documents by fetching
 * `https://<domain>/<path>/did.json` over HTTPS.
 */

import type { DIDDocument, DIDVerificationMethod, DIDService } from '../../types';

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
  const parts = rest.split(':');

  if (parts.length < 2) {
    throw new Error(`Invalid did:wba DID: must have at least domain and path, got "${did}"`);
  }

  const domain = parts[0];
  const path = parts.slice(1).join('/');

  if (!domain || !path) {
    throw new Error(`Invalid did:wba DID: domain and path must be non-empty, got "${did}"`);
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
   */
  extractMAPEndpoint(doc: DIDDocument): string | undefined {
    return doc.service?.find(
      (s) => s.type === 'MAPFederationEndpoint'
    )?.serviceEndpoint;
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
