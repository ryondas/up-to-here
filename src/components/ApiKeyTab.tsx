import type { Provider } from "../agent/agent";
import { PRICING } from "../agent/config";

const PROVIDER_LABELS: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI (GPT)", gemini: "Google (Gemini)" };

export function ApiKeyTab({ provider, apiKey, usage, onChangeKey }: {
  provider: Provider; apiKey: string;
  usage: { agentIn: number; agentOut: number; guardIn: number; guardOut: number };
  onChangeKey: () => void;
}) {
  const masked = apiKey.length > 8 ? `${apiKey.slice(0, 4)}••••••••${apiKey.slice(-4)}` : "••••••••";
  const totalTokens = usage.agentIn + usage.agentOut + usage.guardIn + usage.guardOut;
  const answerTokens = usage.agentIn + usage.agentOut;
  const guardTokens = usage.guardIn + usage.guardOut;
  const price = PRICING[provider];
  const cost = (usage.agentIn / 1e6) * price.agent.input + (usage.agentOut / 1e6) * price.agent.output
    + (usage.guardIn / 1e6) * price.guard.input + (usage.guardOut / 1e6) * price.guard.output;
  return (
    <section className="api-key-tab">
      <h2>API key</h2>
      <p className="field">Provider</p>
      <p>{PROVIDER_LABELS[provider]}</p>
      <p className="field">Key</p>
      <p className="hint">{masked}</p>
      <button className="link" onClick={onChangeKey}>Change API key</button>

      <h2>Usage this session</h2>
      {totalTokens > 0 ? (
        <>
          <p className="usage" title="Rough estimate from approximate per-token list prices — check your provider's billing page for the exact amount.">
            ~${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)} · {totalTokens.toLocaleString()} tokens
          </p>
          <p className="hint">{answerTokens.toLocaleString()} answering questions · {guardTokens.toLocaleString()} checking for spoilers</p>
        </>
      ) : <p className="status">No questions asked yet this session.</p>}
    </section>
  );
}
