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
