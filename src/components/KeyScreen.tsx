import { useState } from "react";
import type { Provider } from "../agent/agent";

export function KeyScreen({ initialProvider, profileName, onSwitchProfile, onSave }: {
  initialProvider: Provider; profileName: string; onSwitchProfile: () => void;
  onSave: (provider: Provider, key: string, remember: boolean) => Promise<void>;
}) {
  const [k, setK] = useState("");
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [remember, setRemember] = useState(true);
  return (
    <main className="narrow">
      <h1>Up to here</h1>
      <p className="lede">Ask questions about a show without spoilers. It only reads summaries of episodes you've already watched.</p>
      <p className="hint">Setting up <b>{profileName}</b>. <button className="link" onClick={onSwitchProfile}>Not you?</button></p>
      <label className="field" htmlFor="provider">AI provider</label>
      <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI (GPT)</option>
        <option value="gemini">Google (Gemini)</option>
      </select>
      <label className="field" htmlFor="key">Your {provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : "Google Gemini"} API key</label>
      <input id="key" type="password" value={k} onChange={(e) => setK(e.target.value)} placeholder={provider === "anthropic" ? "sk-ant-…" : provider === "openai" ? "sk-…" : "AIza…"} autoComplete="off" />
      <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device</label>
      <p className="hint">Your key stays in this browser and is sent only to {provider === "anthropic" ? "Anthropic" : provider === "openai" ? "OpenAI" : "Google"}. Questions are billed to your API account. Get a key at {provider === "anthropic" ? "console.anthropic.com" : provider === "openai" ? "platform.openai.com" : "aistudio.google.com"}.</p>
      <button className="primary" disabled={!k.trim()} onClick={() => { void onSave(provider, k.trim(), remember); }}>Continue</button>
    </main>
  );
}
