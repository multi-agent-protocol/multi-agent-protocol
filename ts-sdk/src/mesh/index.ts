/**
 * Mesh Module - Decentralized P2P MAP peers
 *
 * This module provides MAPMeshPeer for creating decentralized mesh networks
 * where each peer runs its own MapServer and can connect to other peers
 * for agent discovery, messaging, and git synchronization.
 *
 * Requires `agentic-mesh` as an optional peer dependency.
 *
 * @module
 */

// Main class
export { MAPMeshPeer } from './peer';

// Types
export type {
  // Configuration
  MAPMeshPeerConfig,
  MeshGitConfig,
  MeshMapServerConfig,
  // Transport
  PeerEndpoint,
  TransportAdapter,
  // Agents
  CreateAgentConfig,
  LocalAgent,
  SendResult,
  // Scopes
  CreateScopeConfig,
  // Git sync
  GitSyncService,
  GitSyncClient,
  SyncOptions,
  SyncResult,
  PullOptions,
  PushOptions,
  CloneOptions,
  // Events
  MeshEventSubscription,
  MAPMeshPeerEvents,
} from './types';
