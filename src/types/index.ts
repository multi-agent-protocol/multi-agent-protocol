/**
 * Core type definitions for the Multi-Agent Protocol
 */

export type AgentId = string;
export type MessageId = string;
export type SessionId = string;

export interface AgentInfo {
  id: AgentId;
  name: string;
  description?: string;
  capabilities?: string[];
}

export interface Message<T = unknown> {
  id: MessageId;
  from: AgentId;
  to: AgentId | AgentId[];
  timestamp: number;
  payload: T;
}

export interface ProtocolError {
  code: number;
  message: string;
}
