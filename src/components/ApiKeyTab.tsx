import type { Provider } from "../agent/agent";
import { FREE_TIER, PRICING } from "../agent/config";

const PROVIDER_LABELS: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI (GPT)", gemini: "Google (Gemini)" };

export function ApiKeyTab({ provider, apiKey, usage, freeRemaining, onChangeKey, onRemoveKey }: {
  /** An empty `apiKey` means the free tier. */
  provider: Provider; apiKey: string;
  usage: { agentIn: number; agentOut: number; guardIn: number; guardOut: number };
  freeRemaining: number | null;
  onChangeKey: () => void;
  onRemoveKey: () => void;
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
      {apiKey ? (
        <>
          <p className="field">Provider</p>
          <p>{PROVIDER_LABELS[provider]}</p>
          <p className="field">Key</p>
          <p className="hint">{masked}</p>
          <div className="key-links">
            <button className="link" onClick={onChangeKey}>Change API key</button>
            <button className="link" onClick={onRemoveKey}>Remove key and use the free tier</button>
          </div>
        </>
      ) : (
        <>
          <p>Free tier ({PROVIDER_LABELS.gemini})</p>
          <p className="hint">
            {freeRemaining === null ? `${FREE_TIER.questionsPerDay} free questions a day.` : `${freeRemaining} of ${FREE_TIER.questionsPerDay} free questions left today.`}
            {" "}Free questions go through this site's server to Google.
          </p>
          <button className="secondary" onClick={onChangeKey}>Use your own API key</button>
        </>
      )}

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
