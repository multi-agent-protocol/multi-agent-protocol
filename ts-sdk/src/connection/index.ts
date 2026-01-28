/**
 * MAP Connection Classes
 *
 * Provides role-specific connection classes for different participant types:
 * - ClientConnection: For clients observing and interacting with the system
 * - AgentConnection: For agents performing work in the system
 * - GatewayConnection: For federation between MAP systems
 */

export { BaseConnection, type BaseConnectionOptions, type RequestHandler, type NotificationHandler } from './base';
export { ClientConnection, type ClientConnectionOptions } from './client';
export { AgentConnection, type AgentConnectionOptions, type MessageHandler } from './agent';
export { GatewayConnection, type GatewayConnectionOptions } from './gateway';
