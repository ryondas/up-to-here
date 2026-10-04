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
    agent: "gemini-3.8-flash",
    guard: "gemini-3.5-flash-lite",
  },
};
