import { useEffect, useMemo, useRef, useState } from "react";
import type { Position, ShowCatalog } from "../lib/catalog";
import { ask, FreeLimitError, isFreeClient, type AgentClient, type Turn, type TurnUsage } from "../agent/agent";
import { FREE_TIER } from "../agent/config";
import { friendlyError } from "../lib/errors";
import { getChat, saveChat, type StoredChatMessage } from "../lib/storage";
import { Attribution } from "./Attribution";

interface ChatMsg extends Turn, StoredChatMessage { safe?: boolean; revealed?: boolean; sources?: string[]; }

/** A couple of generic prompts, plus ones built from names actually in the current episode's summary — never from future ones. */
function buildQuickPrompts(current?: { title: string; summary: string }): string[] {
  const generic = ["What just happened?", "What should I remember?"];
  if (!current) return [...generic, "Who is this again?", "Why is everyone upset?"];
  const STOP_WORDS = new Set(["The", "A", "An", "In", "On", "At", "When", "Why", "How", "After", "Before", "While", "This", "That"]);
  const names = [...new Set((current.summary.match(/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) ?? [])
    .filter((name) => !STOP_WORDS.has(name.split(" ")[0])))].slice(0, 2);
  const specific = names.map((name) => `Who is ${name}?`);
  if (current.title) specific.unshift(`What happened in "${current.title}"?`);
  return [...specific, ...generic].slice(0, 4);
}

export function Chat({ client, catalog, position, onUsage, initialQuestion, onConsumeInitialQuestion, freeRemaining, onFreeRemaining, onAddKey }: {
  client: AgentClient; catalog: ShowCatalog; position: Position; onUsage: (u: TurnUsage) => void;
  initialQuestion?: string; onConsumeInitialQuestion: () => void;
  /** Free questions left today, once the server has said; null before the first free question. */
  freeRemaining: number | null; onFreeRemaining: (remaining: number) => void; onAddKey: () => void;
}) {
  const free = isFreeClient(client);
  const [freeBlocked, setFreeBlocked] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [q, setQ] = useState(() => initialQuestion ?? "");
  const [status, setStatus] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [current, setCurrent] = useState<{ title: string; summary: string } | undefined>();
  const ctl = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    getChat(catalog.showId, position).then((saved) => {
      if (active && saved) setMsgs(saved as ChatMsg[]);
    }).catch(() => undefined).finally(() => { if (active) setHistoryReady(true); });
    return () => { active = false; };
  }, [catalog.showId, position]);

  useEffect(() => {
    if (historyReady && msgs.length > 0) void saveChat(catalog.showId, position, msgs).catch(() => undefined);
  }, [catalog.showId, historyReady, msgs, position]);

  useEffect(() => {
    // Runs once per mount (this component remounts via `key` on every show/position change) —
    // tells the parent its one-shot opening question has been consumed, so a later show opened
    // without a fresh character click doesn't inherit it.
    if (initialQuestion) onConsumeInitialQuestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let active = true;
    catalog.getEpisode(position.season, position.episode, position).then((ep) => { if (active) setCurrent(ep); }).catch(() => undefined);
    return () => { active = false; };
  }, [catalog, position]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const typing = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLSelectElement;
      if (e.key === "/" && !typing) { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "Escape" && status) ctl.current?.abort();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [status]);

  const quickPrompts = useMemo(() => buildQuickPrompts(current), [current]);

  const send = async () => {
    const question = q.trim();
    if (!question || status || !historyReady) return;
    setQ("");
    const history: Turn[] = msgs.filter((m) => m.safe !== false).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    ctl.current = new AbortController();
    try {
      const r = await ask(client, catalog, position, history, question, setStatus, ctl.current.signal);
      const tokens = r.usage.agent.input + r.usage.agent.output + r.usage.guard.input + r.usage.guard.output;
      setMsgs((m) => [...m, { role: "assistant", content: r.text, safe: r.safe, sources: r.sources, tokens }]);
      onUsage(r.usage);
      if (r.freeRemaining !== undefined) onFreeRemaining(r.freeRemaining);
    } catch (e) {
      if (e instanceof FreeLimitError) {
        // Not an answer: drop the question from the chat and put it back in the box for after a key is added.
        setMsgs((m) => m.slice(0, -1));
        setQ(question);
        setFreeBlocked(e.message);
        if (e.remaining !== undefined) onFreeRemaining(e.remaining);
        return;
      }
      const msg = (e as Error).name === "AbortError" ? "Stopped." : friendlyError(e, "chat");
      setMsgs((m) => [...m, { role: "assistant", content: msg, safe: true }]);
    } finally { setStatus(""); }
  };

  const copy = (i: number, content: string) => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopiedIndex(i);
      setTimeout(() => setCopiedIndex((c) => (c === i ? null : c)), 1500);
    }).catch(() => undefined);
  };

  const exportChat = () => {
    const lines = [
      `Up to here — ${catalog.showName}`,
      `Watched through S${position.season}E${position.episode}`,
      "",
      ...msgs.map((m) => m.role === "assistant" && m.safe === false && !m.revealed
        ? "Assistant: [hidden — flagged as a possible spoiler]"
        : `${m.role === "user" ? "You" : "Assistant"}: ${m.content}`),
    ];
    const href = URL.createObjectURL(new Blob([lines.join("\n\n")], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = href; a.download = `up-to-here-${catalog.showName.toLowerCase().replace(/\s+/g, "-")}-chat.txt`; a.click();
    URL.revokeObjectURL(href);
  };

  return (
    <section className="chat">
      {msgs.length > 0 && <button className="link export-chat" onClick={exportChat}>Export this chat</button>}
      {msgs.map((m, i) => (
        <div key={i} className={`msg ${m.role} ${m.safe === false && !m.revealed ? "flagged" : ""}`}>
          {m.role === "assistant" && m.safe === false && !m.revealed ? (
            <div className="flag-msg">
              The spoiler check thinks this answer may hint at something past where you are, so it's hidden.
              <button onClick={() => setMsgs((all) => all.map((x, j) => (j === i ? { ...x, revealed: true } : x)))}>Show it anyway</button>
            </div>
          ) : <p>{m.content}</p>}
          {m.role === "assistant" && (!m.safe ? m.revealed : true) && (
            <div className="msg-actions">
              {m.sources && m.sources.length > 0 && <small className="src">From {m.sources.join(", ")}</small>}
              {m.tokens !== undefined && <small className="src">{m.tokens.toLocaleString()} tokens</small>}
              <button className="link" onClick={() => copy(i, m.content)}>{copiedIndex === i ? "Copied!" : "Copy"}</button>
            </div>
          )}
        </div>
      ))}
      {(status || !historyReady) && <p className="status">{status || "Loading saved chat…"} {status && <button className="link" onClick={() => ctl.current?.abort()}>Stop</button>}</p>}
      <div className="quick-prompts" aria-label="Quick prompts">
        {quickPrompts.map((prompt) => <button key={prompt} onClick={() => setQ(prompt)}>{prompt}</button>)}
      </div>
      <div className="row ask">
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Who is this guy again? Why is she so angry?" aria-label="Your question" title="Press / to focus" />
        <button className="primary" onClick={send} disabled={!!status || !historyReady || (free && freeRemaining === 0)}>Ask</button>
      </div>
      {free && (freeBlocked || freeRemaining === 0 ? (
        <div className="free-limit" role="status">
          <p>{freeBlocked || `You've used today's ${FREE_TIER.questionsPerDay} free questions. Add your own API key to keep asking, or come back tomorrow.`}</p>
          <button className="primary" onClick={onAddKey}>Add your API key</button>
        </div>
      ) : (
        <p className="free-note">
          {freeRemaining === null ? `${FREE_TIER.questionsPerDay} free questions a day` : `${freeRemaining} free question${freeRemaining === 1 ? "" : "s"} left today`}
          {" · "}<button className="link" onClick={onAddKey}>Use your own key</button>
        </p>
      ))}
      <Attribution catalog={catalog} season={position.season} />
    </section>
  );
}
