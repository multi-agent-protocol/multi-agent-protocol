/**
 * Retry utilities with exponential backoff
 *
 * Provides configurable retry logic for handling transient failures
 * in network operations like reconnection.
 */

/**
 * Configuration for retry behavior
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts (default: 10) */
  maxRetries: number;
  /** Initial delay in milliseconds (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 30000) */
  maxDelayMs: number;
  /** Add randomness to delay to prevent thundering herd (default: true) */
  jitter: boolean;
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: Error) => boolean;
}

/**
 * Default retry policy with sensible defaults for network operations
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 10,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

/**
 * State passed to retry callbacks
 */
export interface RetryState {
  /** Current attempt number (1-indexed) */
  attempt: number;
  /** Delay before next retry in milliseconds */
  nextDelayMs: number;
  /** The error that caused this retry */
  lastError?: Error;
}

/**
 * Callbacks for monitoring retry progress
 */
export interface RetryCallbacks<T> {
  /** Called before each retry attempt */
  onRetry?: (state: RetryState) => void;
  /** Called on successful completion */
  onSuccess?: (result: T, attempts: number) => void;
  /** Called when all retries are exhausted */
  onFailure?: (error: Error, attempts: number) => void;
}

/**
 * Calculate delay for a retry attempt using exponential backoff.
 *
 * Formula: min(baseDelay * 2^(attempt-1), maxDelay) * jitter
 *
 * @param attempt - Current attempt number (1-indexed)
 * @param policy - Retry policy configuration
 * @returns Delay in milliseconds
 *
 * @example
 * ```typescript
 * // With baseDelay=1000, maxDelay=30000:
 * // Attempt 1: 1000ms
 * // Attempt 2: 2000ms
 * // Attempt 3: 4000ms
 * // Attempt 4: 8000ms
 * // Attempt 5: 16000ms
 * // Attempt 6+: 30000ms (capped)
 * ```
 */
export function calculateDelay(attempt: number, policy: RetryPolicy): number {
  // Exponential backoff: baseDelay * 2^(attempt-1)
  let delay = Math.min(
    policy.baseDelayMs * Math.pow(2, attempt - 1),
    policy.maxDelayMs
  );

  // Add jitter: multiply by random factor between 0.5 and 1.5
  if (policy.jitter) {
    delay = delay * (0.5 + Math.random());
  }

  return Math.floor(delay);
}

/**
 * Execute an async operation with retry logic.
 *
 * Retries the operation on failure using exponential backoff until
 * either it succeeds or the maximum retries are exhausted.
 *
 * @param operation - Async function to execute
 * @param policy - Retry policy (defaults to DEFAULT_RETRY_POLICY)
 * @param callbacks - Optional callbacks for monitoring progress
 * @returns The result of the successful operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5000, jitter: true },
 *   {
 *     onRetry: ({ attempt, nextDelayMs }) => {
 *       console.log(`Retry ${attempt}, waiting ${nextDelayMs}ms`);
 *     },
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  callbacks?: RetryCallbacks<T>
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= policy.maxRetries + 1; attempt++) {
    try {
      const result = await operation();
      callbacks?.onSuccess?.(result, attempt);
      return result;
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const isRetryable = policy.isRetryable?.(lastError) ?? true;
      const hasMoreAttempts = attempt <= policy.maxRetries;

      if (!isRetryable || !hasMoreAttempts) {
        break;
      }

      // Calculate delay and wait
      const delay = calculateDelay(attempt, policy);

      callbacks?.onRetry?.({
        attempt,
        nextDelayMs: delay,
        lastError,
      });

      await sleep(delay);
    }
  }

  callbacks?.onFailure?.(lastError!, policy.maxRetries + 1);
  throw lastError;
}

/**
 * Create a retryable wrapper around an async function.
 *
 * Returns a new function with the same signature that automatically
 * retries on failure according to the policy.
 *
 * @param fn - Async function to wrap
 * @param policy - Retry policy
 * @returns Wrapped function with retry behavior
 *
 * @example
 * ```typescript
 * const fetchWithRetry = retryable(
 *   async (url: string) => fetch(url),
 *   { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5000, jitter: true }
 * );
 *
 * const response = await fetchWithRetry('https://api.example.com');
 * ```
 */
export function retryable<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) => withRetry(() => fn(...args), policy);
}

/**
 * Create a partial retry policy merged with defaults.
 *
 * @param options - Partial policy options to override defaults
 * @returns Complete retry policy
 */
export function createRetryPolicy(
  options: Partial<RetryPolicy> = {}
): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...options };
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
