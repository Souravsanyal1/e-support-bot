import { logger } from './logger';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  operationName?: string;
}

/**
 * Checks if an error is considered transient and eligible for automatic retry.
 */
function isTransientError(error: unknown): boolean {
  if (!error) return false;

  const err = error as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = err.status || err.statusCode;

  // Rate limiting (429), Server Error (500, 502, 503, 504)
  if (status === 429 || (status !== undefined && status >= 500 && status <= 504)) {
    return true;
  }

  // Network connection blips
  if (
    err.code === 'ECONNRESET' ||
    err.code === 'ETIMEDOUT' ||
    err.code === 'EAI_AGAIN' ||
    err.code === 'ENOTFOUND'
  ) {
    return true;
  }

  const message = (err.message || '').toLowerCase();
  if (
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('overloaded') ||
    message.includes('timeout') ||
    message.includes('temporarily unavailable')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with exponential backoff and jitter for transient errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 8000,
    backoffFactor = 2,
    operationName = 'Operation',
  } = options;

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;

      if (attempt > maxRetries || !isTransientError(error)) {
        throw error;
      }

      // Add full jitter (0 to delay) to prevent thundering herd
      const jitter = Math.random() * delay * 0.5;
      const sleepTime = Math.min(delay + jitter, maxDelayMs);

      logger.warn(
        `${operationName} failed with transient error. Retrying in ${Math.round(sleepTime)}ms (Attempt ${attempt}/${maxRetries})...`,
        { attempt, nextDelayMs: Math.round(sleepTime) }
      );

      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      delay *= backoffFactor;
    }
  }
}
