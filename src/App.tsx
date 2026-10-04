import { useEffect, useMemo, useRef, useState } from "react";
import { getSuggestedShows, searchShows, type ShowHit } from "./lib/tvmaze";
import { ShowCatalog, type Position } from "./lib/catalog";
import { ask, makeClient, type AgentClient, type Provider, type Turn } from "./agent/agent";
import {
  clearCredentials, getChat, getProgress, getRecentSearches, loadCredentials, saveChat, saveCredentials, saveProgress, saveRecentSearch,
  type Credentials, type StoredChatMessage,
} from "./lib/storage";

interface ChatMsg extends Turn, StoredChatMessage { safe?: boolean; revealed?: boolean; sources?: string[]; }

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const client = useMemo<AgentClient | null>(() => credentials?.apiKey ? makeClient(credentials.provider, credentials.apiKey) : null, [credentials]);

  const [catalog, setCatalog] = useState<ShowCatalog | null>(null);
  const [position, setPosition] = useState<Position>({ season: 1, episode: 1 });

  useEffect(() => {
    loadCredentials().then(setCredentials).catch(() => undefined).finally(() => setStorageReady(true));
  }, []);

  useEffect(() => {
    if (catalog) void saveProgress(catalog.showId, position).catch(() => undefined);
  }, [catalog, position]);

  if (!storageReady) return <main className="narrow"><p className="status">Loading saved data…</p></main>;
  if (!client) return <KeyScreen initialProvider={credentials?.provider ?? "anthropic"} onSave={async (nextProvider, key, remember) => {
    const next = { provider: nextProvider, apiKey: key };
    if (remember) await saveCredentials(next).catch(() => undefined);
    else await clearCredentials().catch(() => undefined);
    setCredentials(next);
  }} />;
  return (
    <main>
      <header className="top">
        <h1>Up to here</h1>
        <button className="link" onClick={() => { void clearCredentials().catch(() => undefined); setCredentials(null); }}>Change API key</button>
      </header>
      {!catalog ? (
        <ShowSearch onPick={async (hit) => {
          const c = await new ShowCatalog(hit.id, hit.name).load();
          const saved = await getProgress(c.showId).catch(() => undefined);
          const season = saved && c.seasons.includes(saved.season) ? saved.season : c.seasons[0] ?? 1;
          const episode = saved && saved.season === season && saved.episode <= c.episodeCount(season) ? saved.episode : 1;
          setPosition({ season, episode });
          setCatalog(c);
        }} />
      ) : (
        <>
          <div className="show-row">
            <h2>{catalog.showName}</h2>
            <button className="link" onClick={() => setCatalog(null)}>Pick another show</button>
          </div>
          <PositionPicker catalog={catalog} position={position} onChange={setPosition} />
          <Chat key={`${catalog.showId}:${position.season}:${position.episode}`} client={client} catalog={catalog} position={position} />
        </>
      )}
    </main>
  );
}

function KeyScreen({ initialProvider, onSave }: { initialProvider: Provider; onSave: (provider: Provider, key: string, remember: boolean) => Promise<void> }) {
  const [k, setK] = useState("");
  const [provider, setProvider] = useState<Provider>(initialProvider);
  const [remember, setRemember] = useState(true);
  return (
    <main className="narrow">
      <h1>Up to here</h1>
      <p className="lede">Ask questions about a show without spoilers. It only reads summaries of episodes you've already watched.</p>
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

function ShowSearch({ onPick }: { onPick: (h: ShowHit) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ShowHit[]>([]);
  const [suggestions, setSuggestions] = useState<ShowHit[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { getRecentSearches().then(setRecent).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    getSuggestedShows().then((shows) => { if (active) setSuggestions(shows); }).catch(() => undefined).finally(() => { if (active) setLoadingSuggestions(false); });
    return () => { active = false; };
  }, []);
  const go = async (query = q) => {
    if (!query.trim()) return;
    setBusy("Searching…"); setErr("");
    try {
      setHits(await searchShows(query));
      setRecent(await saveRecentSearch(query));
    } catch (e) { setErr((e as Error).message); } finally { setBusy(""); }
  };
  return (
    <section>
      <label className="field" htmlFor="sq">What are you watching?</label>
      <div className="row">
        <input id="sq" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="Show name" />
        <button className="primary" onClick={() => { void go(); }}>Search</button>
      </div>
      <p className="status">{busy || err}</p>
      {recent.length > 0 && <div className="recent"><span>Recent</span>{recent.map((query) => <button key={query} className="link" onClick={() => { setQ(query); void go(query); }}>{query}</button>)}</div>}
      {!hits.length && <section className="suggested" aria-labelledby="suggested-title">
        <h2 id="suggested-title">Suggested shows</h2>
        {loadingSuggestions ? <p className="status">Finding something good…</p> : <div className="suggestion-rail">
          {suggestions.map((show) => <button key={show.id} className="suggestion" onClick={async () => {
            setBusy(`Loading ${show.name}…`);
            try { await onPick(show); } catch (e) { setErr((e as Error).message); setBusy(""); }
          }}>
            {show.image ? <img src={show.image} alt="" /> : <span className="noart" />}
            <span><b>{show.name}</b>{show.network && <small>{show.network}</small>}</span>
          </button>)}
        </div>}
      </section>}
      <ul className="hits">
        {hits.map((h) => (
          <li key={h.id}>
            <button onClick={async () => { setBusy(`Loading ${h.name}…`); try { await onPick(h); } catch (e) { setErr((e as Error).message); setBusy(""); } }}>
              {h.image ? <img src={h.image} alt="" /> : <span className="noimg" />}
              <span><b>{h.name}</b><small>{[h.premiered?.slice(0, 4), h.network].filter(Boolean).join(", ")}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PositionPicker({ catalog, position, onChange }: { catalog: ShowCatalog; position: Position; onChange: (p: Position) => void }) {
  const count = catalog.episodeCount(position.season);
  const seenEpisodes = catalog.seenSkeleton(position);
  const seenTitle = seenEpisodes.find((e) => e.season === position.season && e.number === position.episode)?.title;
  const thumbnails = catalog.episodeThumbnails(position.season);
  return (
    <section className="picker">
      <div className="track-head">
        <label>Season{" "}
          <select value={position.season} onChange={(e) => onChange({ season: Number(e.target.value), episode: 1 })}>
            {catalog.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span>Tap the last episode you finished</span>
      </div>
      <div className="track" role="group" aria-label="Episodes">
        {Array.from({ length: count }, (_, i) => i + 1).map((n) => {
          const seen = n <= position.episode;
          const thumbnail = thumbnails.get(n);
          return (
            <button key={n} className={`ep ${seen ? "seen" : "future"} ${n === position.episode ? "current" : ""}`}
              aria-pressed={n === position.episode} aria-label={seen ? `Episode ${n}` : `Episode ${n}, not watched yet`}
              onClick={() => onChange({ season: position.season, episode: n })}>
              {thumbnail && <img src={thumbnail} alt="" />}
              <span>{n}</span>
            </button>
          );
        })}
      </div>
      <p className="ep-title">Watched through S{position.season}E{position.episode}{seenTitle ? `: ${seenTitle}` : ""}</p>
    </section>
  );
}

function Chat({ client, catalog, position }: { client: AgentClient; catalog: ShowCatalog; position: Position }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const ctl = useRef<AbortController | null>(null);

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

  const send = async () => {
    const question = q.trim();
    if (!question || status || !historyReady) return;
    setQ("");
    const history: Turn[] = msgs.filter((m) => m.safe !== false).map(({ role, content }) => ({ role, content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    ctl.current = new AbortController();
    try {
      const r = await ask(client, catalog, position, history, question, setStatus, ctl.current.signal);
      setMsgs((m) => [...m, { role: "assistant", content: r.text, safe: r.safe, sources: r.sources }]);
    } catch (e) {
      const msg = (e as Error).name === "AbortError" ? "Stopped." : `Something went wrong: ${(e as Error).message}`;
      setMsgs((m) => [...m, { role: "assistant", content: msg, safe: true }]);
    } finally { setStatus(""); }
  };

  return (
    <section className="chat">
      {msgs.map((m, i) => (
        <div key={i} className={`msg ${m.role} ${m.safe === false && !m.revealed ? "flagged" : ""}`}>
          {m.role === "assistant" && m.safe === false && !m.revealed ? (
            <div className="flag-msg">
              The spoiler check thinks this answer may hint at something past where you are, so it's hidden.
              <button onClick={() => setMsgs((all) => all.map((x, j) => (j === i ? { ...x, revealed: true } : x)))}>Show it anyway</button>
            </div>
          ) : <p>{m.content}</p>}
          {m.sources && m.sources.length > 0 && (!m.safe ? m.revealed : true) && <small className="src">From {m.sources.join(", ")}</small>}
        </div>
      ))}
      {(status || !historyReady) && <p className="status">{status || "Loading saved chat…"} {status && <button className="link" onClick={() => ctl.current?.abort()}>Stop</button>}</p>}
      <div className="row ask">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Who is this guy again? Why is she so angry?" aria-label="Your question" />
        <button className="primary" onClick={send} disabled={!!status || !historyReady}>Ask</button>
      </div>
      <Attribution catalog={catalog} />
    </section>
  );
}

function Attribution({ catalog }: { catalog: ShowCatalog }) {
  const pages = [...catalog.sources.values()];
  return (
    <p className="attrib">
      Episode data from <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">TVmaze</a>
      {pages.length > 0 && <> and Wikipedia ({pages.map((p, i) => <span key={p.url}>{i > 0 && ", "}<a href={p.url} target="_blank" rel="noreferrer">{p.pageTitle}</a></span>)}), CC BY-SA 4.0</>}.
    </p>
  );
}
