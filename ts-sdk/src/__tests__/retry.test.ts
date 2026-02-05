/**
 * Tests for retry utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  calculateDelay,
  withRetry,
  retryable,
  createRetryPolicy,
  sleep,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from "../utils/retry";

describe("Retry utilities", () => {
  describe("DEFAULT_RETRY_POLICY", () => {
    it("should have sensible defaults", () => {
      expect(DEFAULT_RETRY_POLICY.maxRetries).toBe(10);
      expect(DEFAULT_RETRY_POLICY.baseDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_POLICY.maxDelayMs).toBe(30000);
      expect(DEFAULT_RETRY_POLICY.jitter).toBe(true);
    });
  });

  describe("createRetryPolicy", () => {
    it("should return default policy when no options provided", () => {
      const policy = createRetryPolicy();
      expect(policy).toEqual(DEFAULT_RETRY_POLICY);
    });

    it("should merge options with defaults", () => {
      const policy = createRetryPolicy({
        maxRetries: 5,
        baseDelayMs: 500,
      });

      expect(policy.maxRetries).toBe(5);
      expect(policy.baseDelayMs).toBe(500);
      expect(policy.maxDelayMs).toBe(30000); // default
      expect(policy.jitter).toBe(true); // default
    });

    it("should override all defaults when all options provided", () => {
      const customPolicy: RetryPolicy = {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: false,
        isRetryable: () => false,
      };

      const policy = createRetryPolicy(customPolicy);

      expect(policy.maxRetries).toBe(3);
      expect(policy.baseDelayMs).toBe(100);
      expect(policy.maxDelayMs).toBe(1000);
      expect(policy.jitter).toBe(false);
      expect(policy.isRetryable).toBe(customPolicy.isRetryable);
    });
  });

  describe("calculateDelay", () => {
    it("should calculate exponential backoff without jitter", () => {
      const policy: RetryPolicy = {
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: false,
      };

      // attempt 1: 1000 * 2^0 = 1000
      expect(calculateDelay(1, policy)).toBe(1000);
      // attempt 2: 1000 * 2^1 = 2000
      expect(calculateDelay(2, policy)).toBe(2000);
      // attempt 3: 1000 * 2^2 = 4000
      expect(calculateDelay(3, policy)).toBe(4000);
      // attempt 4: 1000 * 2^3 = 8000
      expect(calculateDelay(4, policy)).toBe(8000);
      // attempt 5: 1000 * 2^4 = 16000
      expect(calculateDelay(5, policy)).toBe(16000);
    });

    it("should cap delay at maxDelayMs", () => {
      const policy: RetryPolicy = {
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        jitter: false,
      };

      // attempt 3: 1000 * 2^2 = 4000
      expect(calculateDelay(3, policy)).toBe(4000);
      // attempt 4: 1000 * 2^3 = 8000, but capped at 5000
      expect(calculateDelay(4, policy)).toBe(5000);
      // attempt 10: still capped at 5000
      expect(calculateDelay(10, policy)).toBe(5000);
    });

    it("should add jitter when enabled", () => {
      const policy: RetryPolicy = {
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: true,
      };

      // With jitter, delay is multiplied by random factor between 0.5 and 1.5
      // Base delay for attempt 1 is 1000, so jittered range is [500, 1500)
      const delays = new Set<number>();
      for (let i = 0; i < 100; i++) {
        const delay = calculateDelay(1, policy);
        delays.add(delay);
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThan(1500);
      }

      // Should have some variation (unlikely all 100 are the same)
      expect(delays.size).toBeGreaterThan(1);
    });

    it("should return integer values", () => {
      const policy: RetryPolicy = {
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        jitter: true,
      };

      for (let i = 0; i < 50; i++) {
        const delay = calculateDelay(1, policy);
        expect(Number.isInteger(delay)).toBe(true);
      }
    });
  });

  describe("sleep", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should resolve after specified duration", async () => {
      const promise = sleep(1000);

      // Should not resolve immediately
      let resolved = false;
      promise.then(() => {
        resolved = true;
      });

      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(500);
      expect(resolved).toBe(true);
    });

    it("should accept 0ms duration", async () => {
      const promise = sleep(0);
      await vi.advanceTimersByTimeAsync(0);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe("withRetry", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should return result on first success", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const resultPromise = withRetry(operation, createRetryPolicy({ maxRetries: 3 }));
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it("should retry on failure and succeed eventually", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue("success");

      const policy = createRetryPolicy({
        maxRetries: 5,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: false,
      });

      const resultPromise = withRetry(operation, policy);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe("success");
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it("should throw after exhausting all retries", async () => {
      const error = new Error("persistent failure");
      const operation = vi.fn().mockRejectedValue(error);

      const policy = createRetryPolicy({
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: false,
      });

      // Attach catch handler before running timers to avoid unhandled rejection
      let caughtError: Error | undefined;
      const resultPromise = withRetry(operation, policy).catch((e) => {
        caughtError = e;
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(caughtError?.message).toBe("persistent failure");
      // 1 initial attempt + 3 retries = 4 total attempts
      expect(operation).toHaveBeenCalledTimes(4);
    });

    it("should respect isRetryable function", async () => {
      const retryableError = new Error("retryable");
      const nonRetryableError = new Error("non-retryable");

      const operation = vi
        .fn()
        .mockRejectedValueOnce(retryableError)
        .mockRejectedValue(nonRetryableError);

      const policy = createRetryPolicy({
        maxRetries: 5,
        baseDelayMs: 100,
        jitter: false,
        isRetryable: (err) => err.message === "retryable",
      });

      // Attach catch handler before running timers to avoid unhandled rejection
      let caughtError: Error | undefined;
      const resultPromise = withRetry(operation, policy).catch((e) => {
        caughtError = e;
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(caughtError?.message).toBe("non-retryable");
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it("should call onRetry callback before each retry", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"))
        .mockResolvedValue("success");

      const onRetry = vi.fn();

      const policy = createRetryPolicy({
        maxRetries: 5,
        baseDelayMs: 100,
        maxDelayMs: 1000,
        jitter: false,
      });

      const resultPromise = withRetry(operation, policy, { onRetry });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onRetry).toHaveBeenCalledTimes(2);

      // First retry
      expect(onRetry).toHaveBeenNthCalledWith(1, {
        attempt: 1,
        nextDelayMs: 100,
        lastError: expect.objectContaining({ message: "fail 1" }),
      });

      // Second retry
      expect(onRetry).toHaveBeenNthCalledWith(2, {
        attempt: 2,
        nextDelayMs: 200, // exponential backoff: 100 * 2^1
        lastError: expect.objectContaining({ message: "fail 2" }),
      });
    });

    it("should call onSuccess callback on success", async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error("fail"))
        .mockResolvedValue("success-result");

      const onSuccess = vi.fn();

      const policy = createRetryPolicy({
        maxRetries: 5,
        baseDelayMs: 100,
        jitter: false,
      });

      const resultPromise = withRetry(operation, policy, { onSuccess });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith("success-result", 2); // succeeded on attempt 2
    });

    it("should call onFailure callback when all retries exhausted", async () => {
      const error = new Error("persistent failure");
      const operation = vi.fn().mockRejectedValue(error);

      const onFailure = vi.fn();

      const policy = createRetryPolicy({
        maxRetries: 2,
        baseDelayMs: 100,
        jitter: false,
      });

      // Attach catch handler before running timers to avoid unhandled rejection
      let caughtError: Error | undefined;
      const resultPromise = withRetry(operation, policy, { onFailure }).catch((e) => {
        caughtError = e;
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(caughtError).toBeDefined();
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(error, 3); // 1 initial + 2 retries = 3 total
    });

    it("should not call onFailure on success", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const onFailure = vi.fn();

      const policy = createRetryPolicy({ maxRetries: 3 });

      const resultPromise = withRetry(operation, policy, { onFailure });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(onFailure).not.toHaveBeenCalled();
    });

    it("should use default policy when not provided", async () => {
      const operation = vi.fn().mockResolvedValue("success");

      const resultPromise = withRetry(operation);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe("success");
    });
  });

  describe("retryable", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("should wrap a function with retry logic", async () => {
      let callCount = 0;
      const fn = async (input: string): Promise<string> => {
        callCount++;
        if (callCount < 3) {
          throw new Error("not yet");
        }
        return `result-${input}`;
      };

      const policy = createRetryPolicy({
        maxRetries: 5,
        baseDelayMs: 100,
        jitter: false,
      });

      const retryableFn = retryable(fn, policy);

      const resultPromise = retryableFn("test");
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe("result-test");
      expect(callCount).toBe(3);
    });

    it("should preserve function arguments", async () => {
      const fn = vi.fn().mockResolvedValue("result");

      const policy = createRetryPolicy({ maxRetries: 3 });
      const retryableFn = retryable(fn, policy);

      const resultPromise = retryableFn("arg1", 42, { key: "value" });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(fn).toHaveBeenCalledWith("arg1", 42, { key: "value" });
    });

    it("should use default policy when not provided", async () => {
      const fn = vi.fn().mockResolvedValue("result");

      const retryableFn = retryable(fn);

      const resultPromise = retryableFn();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe("result");
    });

    it("should throw after exhausting retries", async () => {
      const fn = vi.fn().mockRejectedValue(new Error("always fails"));

      const policy = createRetryPolicy({
        maxRetries: 2,
        baseDelayMs: 100,
        jitter: false,
      });

      const retryableFn = retryable(fn, policy);

      // Attach catch handler before running timers to avoid unhandled rejection
      let caughtError: Error | undefined;
      const resultPromise = retryableFn().catch((e) => {
        caughtError = e;
      });
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(caughtError?.message).toBe("always fails");
      expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });
  });
});
