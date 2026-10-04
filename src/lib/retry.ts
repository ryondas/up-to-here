// Shared retry/backoff for the two free, keyless APIs this app depends on
// (TVmaze, Wikipedia). Only retries transient failures — network errors,
// 429s, 5xx — never a well-formed "not found" response.
const isRetryable = (err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  return /\b(429|5\d\d)\b/.test(message) || /network|failed to fetch/i.test(message);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 400): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts - 1 || !isRetryable(err)) throw err;
      await sleep(baseDelayMs * 2 ** attempt + Math.random() * 150);
    }
  }
  throw lastErr;
}
