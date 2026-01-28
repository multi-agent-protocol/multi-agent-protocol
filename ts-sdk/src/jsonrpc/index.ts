/**
 * JSON-RPC 2.0 utilities for MAP protocol
 */

import type { RequestId, MAPError } from '../types';

/** JSON-RPC version constant */
export const JSONRPC_VERSION = '2.0' as const;

/**
 * Generic JSON-RPC request structure
 */
export interface JsonRpcRequest<TParams = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  method: string;
  params?: TParams;
}

/**
 * Generic JSON-RPC notification structure (no id)
 */
export interface JsonRpcNotification<TParams = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: TParams;
}

/**
 * Generic JSON-RPC success response
 */
export interface JsonRpcSuccessResponse<TResult = unknown> {
  jsonrpc: '2.0';
  id: RequestId;
  result: TResult;
}

/**
 * Generic JSON-RPC error response
 */
export interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: RequestId;
  error: MAPError;
}

/**
 * Any JSON-RPC response
 */
export type JsonRpcResponse<TResult = unknown> =
  | JsonRpcSuccessResponse<TResult>
  | JsonRpcErrorResponse;

/**
 * Any JSON-RPC message
 */
export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

/**
 * Check if a message is a request (has id and method)
 */
export function isRequest(message: unknown): message is JsonRpcRequest {
  return (
    typeof message === 'object' &&
    message !== null &&
    'jsonrpc' in message &&
    message.jsonrpc === '2.0' &&
    'id' in message &&
    'method' in message
  );
}

/**
 * Check if a message is a notification (has method but no id)
 */
export function isNotification(message: unknown): message is JsonRpcNotification {
  return (
    typeof message === 'object' &&
    message !== null &&
    'jsonrpc' in message &&
    message.jsonrpc === '2.0' &&
    'method' in message &&
    !('id' in message)
  );
}

/**
 * Check if a message is a response (has id but no method)
 */
export function isResponse(message: unknown): message is JsonRpcResponse {
  return (
    typeof message === 'object' &&
    message !== null &&
    'jsonrpc' in message &&
    message.jsonrpc === '2.0' &&
    'id' in message &&
    !('method' in message)
  );
}

/**
 * Check if a response is an error response
 */
export function isErrorResponse(
  response: JsonRpcResponse
): response is JsonRpcErrorResponse {
  return 'error' in response;
}

/**
 * Check if a response is a success response
 */
export function isSuccessResponse<T>(
  response: JsonRpcResponse<T>
): response is JsonRpcSuccessResponse<T> {
  return 'result' in response;
}

/**
 * Create a JSON-RPC request
 */
export function createRequest<TParams>(
  id: RequestId,
  method: string,
  params?: TParams
): JsonRpcRequest<TParams> {
  const request: JsonRpcRequest<TParams> = {
    jsonrpc: '2.0',
    id,
    method,
  };
  if (params !== undefined) {
    request.params = params;
  }
  return request;
}

/**
 * Create a JSON-RPC notification
 */
export function createNotification<TParams>(
  method: string,
  params?: TParams
): JsonRpcNotification<TParams> {
  const notification: JsonRpcNotification<TParams> = {
    jsonrpc: '2.0',
    method,
  };
  if (params !== undefined) {
    notification.params = params;
  }
  return notification;
}

/**
 * Create a JSON-RPC success response
 */
export function createSuccessResponse<TResult>(
  id: RequestId,
  result: TResult
): JsonRpcSuccessResponse<TResult> {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Create a JSON-RPC error response
 */
export function createErrorResponse(
  id: RequestId,
  error: MAPError
): JsonRpcErrorResponse {
  return {
    jsonrpc: '2.0',
    id,
    error,
  };
}
