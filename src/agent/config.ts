import type { Provider } from "./agent";

// Swap models here. The agent needs good tool use; the guard just needs to be cheap and fast.
export const MODELS: Record<Provider, { agent: string; guard: string }> = {
  anthropic: {
    agent: "claude-sonnet-5-5",
    guard: "claude-haiku-4-5-20251001",
  },
  openai: {
    agent: "gpt-4.1",
    guard: "gpt-4.1-mini",
  },
  gemini: {
    // Free-tier, function-calling model designed for high-volume agentic work.
    agent: "gemini-3.1-flash-lite",
    guard: "gemini-3.1-flash-lite",
  },
};

/**
 * Free tier: visitors without their own key ask through /api/gemini, which holds the site's
 * Gemini key and enforces the limits. api/gemini.ts must match these (tests/freeTier.test.ts checks).
 */
export const FREE_TIER = { questionsPerDay: 10 };

/**
 * Rough USD-per-1M-token list prices, for the session cost estimate shown in the UI.
 * Approximate and may drift from the provider's current pricing page — treat it as
 * a ballpark, not a bill. Update alongside MODELS if you swap a model above.
 */
export const PRICING: Record<Provider, { agent: { input: number; output: number }; guard: { input: number; output: number } }> = {
  anthropic: { agent: { input: 3, output: 15 }, guard: { input: 0.8, output: 4 } },
  openai: { agent: { input: 2, output: 8 }, guard: { input: 0.4, output: 1.6 } },
  gemini: { agent: { input: 0, output: 0 }, guard: { input: 0, output: 0 } },
};
