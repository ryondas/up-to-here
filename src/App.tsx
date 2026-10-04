import { useEffect, useMemo, useRef, useState } from "react";
import { getCast, getTrendingShows, resolveShowsByTitle, searchShows, type CastMember, type ShowHit, type TrendingShow } from "./lib/tvmaze";
import { ShowCatalog, type Position } from "./lib/catalog";
import { ask, makeClient, type AgentClient, type Provider, type Turn, type TurnUsage } from "./agent/agent";
import { PRICING } from "./agent/config";
import { friendlyError } from "./lib/errors";
import {
  clearCredentials, clearShowData, exportData, getChat, getLibrary, getProgress, getRecentShows, importData, loadCredentials, saveChat, saveCredentials, saveLibraryEntry, saveProgress, saveRecentShow,
  type Credentials, type LibraryEntry, type StoredChatMessage,
} from "./lib/storage";
import { createProfile, deleteProfile, getActiveProfileId, listProfiles, setActiveProfile, type Profile } from "./lib/profiles";

interface ChatMsg extends Turn, StoredChatMessage { safe?: boolean; revealed?: boolean; sources?: string[]; }

/**
 * Moods either match shows dynamically by TVmaze genre tag (from the trending pool),
 * or — when a mood doesn't map cleanly onto TVmaze's genre vocabulary — stay curated
 * to a fixed show list. See docs/sprint-5-plans.md for why each mood landed where it did.
 */
const MOODS: Array<{ label: string; genres: string[]; minRating?: number } | { label: string; shows: string[] }> = [
  { label: "Tense & twisty", genres: ["Mystery", "Supernatural", "Science-Fiction"] },
  { label: "Bingeable crime", genres: ["Crime"] },
  { label: "Big feelings", shows: ["The Bear", "Fleabag"] },
  { label: "Prestige drama", genres: ["Drama"], minRating: 8.5 },
  { label: "Comfort comedy", genres: ["Comedy"] },
  { label: "Post-apocalyptic", shows: ["The Last of Us", "Yellowjackets"] },
];
const TRENDING_CHARACTERS = [
  { name: "Walter White", show: "Breaking Bad" },
  { name: "Saul Goodman", show: "Better Call Saul" },
  { name: "Carmy Berzatto", show: "The Bear" },
  { name: "Sydney Adamu", show: "The Bear" },
  { name: "Mark Scout", show: "Severance" },
  { name: "Helly Riggs", show: "Severance" },
  { name: "Ellie Williams", show: "The Last of Us" },
  { name: "Joel Miller", show: "The Last of Us" },
  { name: "Kendall Roy", show: "Succession" },
  { name: "Shiv Roy", show: "Succession" },
  { name: "Michael Scott", show: "The Office" },
  { name: "Leslie Knope", show: "Parks and Recreation" },
  { name: "Tony Soprano", show: "The Sopranos" },
  { name: "Eleanor Shellstrop", show: "The Good Place" },
];
const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
};
const pickRandom = <T,>(items: T[]): T | undefined => items[Math.floor(Math.random() * items.length)];

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const client = useMemo<AgentClient | null>(() => credentials?.apiKey ? makeClient(credentials.provider, credentials.apiKey) : null, [credentials]);

  const [catalog, setCatalog] = useState<ShowCatalog | null>(null);
  const [position, setPosition] = useState<Position>({ season: 1, episode: 1 });
  const [storageNotice, setStorageNotice] = useState("");
  const [usage, setUsage] = useState({ agentIn: 0, agentOut: 0, guardIn: 0, guardOut: 0 });
  const [view, setView] = useState<"main" | "apiKey" | "profiles">("main");
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [profiles] = useState<Profile[]>(() => listProfiles());
  const activeProfileId = useMemo(() => getActiveProfileId(), []);
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];
  const importRef = useRef<HTMLInputElement | null>(null);
  const addUsage = (u: TurnUsage) => setUsage((prev) => ({
    agentIn: prev.agentIn + u.agent.input, agentOut: prev.agentOut + u.agent.output,
    guardIn: prev.guardIn + u.guard.input, guardOut: prev.guardOut + u.guard.output,
  }));

  useEffect(() => {
    loadCredentials().then(setCredentials).catch(() => undefined).finally(() => setStorageReady(true));
  }, []);
  useEffect(() => {
    if (catalog) {
      void saveProgress(catalog.showId, position).catch(() => undefined);
      void saveLibraryEntry({ id: catalog.showId, name: catalog.showName, image: catalog.image }, position).catch(() => undefined);
    }
  }, [catalog, position]);

  if (!storageReady) return <main className="narrow"><p className="status">Loading saved data…</p></main>;
  if (view === "profiles") return <ProfilesTab profiles={profiles} activeProfileId={activeProfileId} onBack={() => setView("main")} />;
  if (!client) return <KeyScreen initialProvider={credentials?.provider ?? "anthropic"} profileName={activeProfile.name}
    onSwitchProfile={() => setView("profiles")}
    onSave={async (nextProvider, key, remember) => {
      const next = { provider: nextProvider, apiKey: key };
      if (remember) await saveCredentials(next).catch(() => undefined);
      else await clearCredentials().catch(() => undefined);
      setCredentials(next);
    }} />;
  return (
    <main>
      <header className="top">
        <h1>Up to here</h1>
        <div className="header-actions">
          <button className="link" onClick={() => setView("profiles")} title="Switch or manage profiles">{activeProfile.name}</button>
          <button className="link" title="Only this profile's data" onClick={() => { void exportData().then((backup) => {
            const href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
            const download = document.createElement("a");
            download.href = href; download.download = `up-to-here-${activeProfile.name.toLowerCase().replace(/\s+/g, "-")}-backup.json`; download.click(); URL.revokeObjectURL(href);
            setStorageNotice("Data exported for this profile.");
          }).catch(() => setStorageNotice("Couldn’t export your local data.")); }}>Export data</button>
          <button className="link" title="Only replaces this profile's data — other profiles are untouched" onClick={() => importRef.current?.click()}>Import data</button>
          <input ref={importRef} className="visually-hidden" type="file" accept="application/json" onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            void file.text().then(JSON.parse).then(importData).then(() => window.location.reload()).catch((error: unknown) => {
              setStorageNotice(error instanceof Error ? error.message : "Couldn’t import that file.");
            });
          }} />
          <button className="link" onClick={() => setView((v) => (v === "apiKey" ? "main" : "apiKey"))}>{view === "apiKey" ? "← Back" : "API Key"}</button>
        </div>
      </header>
      {storageNotice && <p className="status">{storageNotice}</p>}
      {view === "apiKey" ? (
        <ApiKeyTab provider={client.provider} apiKey={credentials?.apiKey ?? ""} usage={usage}
          onChangeKey={() => { void clearCredentials().catch(() => undefined); setCredentials(null); }} />
      ) : !catalog ? (
        <ShowSearch onPick={async (hit, openingQuestion) => {
          const c = await new ShowCatalog(hit.id, hit.name, hit.image).load();
          const saved = await getProgress(c.showId).catch(() => undefined);
          const season = saved && c.seasons.includes(saved.season) ? saved.season : c.seasons[0] ?? 1;
          const episode = saved && saved.season === season && saved.episode <= c.episodeCount(season) ? saved.episode : 1;
          setPosition({ season, episode });
          setCatalog(c);
          setPendingQuestion(openingQuestion ?? "");
        }} />
      ) : (
        <>
          <div className="show-row">
            <h2>{catalog.showName}</h2>
            <div className="show-actions">
              <button className="link" onClick={async () => {
                if (!window.confirm(`Clear all saved progress and chat history for "${catalog.showName}"? This can't be undone.`)) return;
                await clearShowData(catalog.showId).catch(() => undefined);
                setCatalog(null);
              }}>Clear this show</button>
              <button className="link" onClick={() => setCatalog(null)}>Pick another show</button>
            </div>
          </div>
          <PositionPicker catalog={catalog} position={position} onChange={setPosition} />
          <Chat key={`${catalog.showId}:${position.season}:${position.episode}`} client={client} catalog={catalog} position={position} onUsage={addUsage}
            initialQuestion={pendingQuestion} onConsumeInitialQuestion={() => setPendingQuestion("")} />
        </>
      )}
    </main>
  );
}

const PROVIDER_LABELS: Record<Provider, string> = { anthropic: "Anthropic (Claude)", openai: "OpenAI (GPT)", gemini: "Google (Gemini)" };

function ApiKeyTab({ provider, apiKey, usage, onChangeKey }: {
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

function ProfilesTab({ profiles, activeProfileId, onBack }: { profiles: Profile[]; activeProfileId: string; onBack: () => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  const switchTo = (id: string) => {
    if (id === activeProfileId) return;
    setActiveProfile(id);
    window.location.reload();
  };
  const add = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setActiveProfile(createProfile(trimmed).id);
    window.location.reload();
  };
  const remove = async (id: string, label: string) => {
    if (!window.confirm(`Delete the profile "${label}" and everything saved under it? This can't be undone.`)) return;
    try { await deleteProfile(id); window.location.reload(); }
    catch (e) { setErr((e as Error).message); }
  };

  return (
    <main className="narrow">
      <h1>Who's this?</h1>
      <p className="lede">Each profile keeps its own progress, chat history, and API key. Switching — or importing a backup — never touches another profile's data.</p>
      <div className="profile-grid">
        {profiles.map((p) => (
          <div key={p.id} className={`profile-card ${p.id === activeProfileId ? "active" : ""}`}>
            <button className="profile-avatar" onClick={() => switchTo(p.id)} aria-label={`Switch to ${p.name}`}>{p.name.slice(0, 1).toUpperCase()}</button>
            <b>{p.name}</b>
            {p.id === activeProfileId && <small className="hint">Current</small>}
            {profiles.length > 1 && <div className="profile-actions">
              <button className="link" onClick={() => { void remove(p.id, p.name); }}>Delete</button>
            </div>}
          </div>
        ))}
      </div>
      {adding ? (
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Profile name" autoFocus />
          <button className="primary" onClick={add}>Add</button>
        </div>
      ) : <button className="link" onClick={() => setAdding(true)}>+ Add profile</button>}
      {err && <p className="status">{err}</p>}
      <button className="link profiles-back" onClick={onBack}>← Back</button>
    </main>
  );
}

function KeyScreen({ initialProvider, profileName, onSwitchProfile, onSave }: {
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

function ShowSearch({ onPick }: { onPick: (h: ShowHit, openingQuestion?: string) => Promise<void> }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ShowHit[]>([]);
  const [suggestions, setSuggestions] = useState<TrendingShow[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [recent, setRecent] = useState<ShowHit[]>([]);
  const [library, setLibrary] = useState<LibraryEntry[]>([]);
  const [curatedShows, setCuratedShows] = useState<Map<string, ShowHit>>(new Map());
  const [characterImages, setCharacterImages] = useState<Map<string, string>>(new Map());
  useEffect(() => { getRecentShows().then(setRecent).catch(() => undefined); }, []);
  useEffect(() => { getLibrary().then(setLibrary).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    getTrendingShows().then((shows) => { if (active) setSuggestions(shows); }).catch(() => undefined).finally(() => { if (active) setLoadingSuggestions(false); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    // Moods/characters that need a specific named show (not whatever's trending this week) resolve separately.
    const titles = [...new Set([
      ...MOODS.flatMap((mood) => "shows" in mood ? mood.shows : []),
      ...TRENDING_CHARACTERS.map((character) => character.show),
    ])];
    resolveShowsByTitle(titles).then((map) => { if (active) setCuratedShows(map); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const suggested = useMemo(() => suggestions.slice(0, 6), [suggestions]);
  const moodCards = useMemo(() => shuffle(MOODS).map((mood) => {
    if ("shows" in mood) {
      const show = mood.shows.map((title) => curatedShows.get(title)).find((s): s is ShowHit => Boolean(s));
      return show ? { label: mood.label, show } : null;
    }
    const pool = suggestions.filter((s) => s.genres.some((g) => mood.genres.includes(g)) && (mood.minRating === undefined || (s.rating ?? 0) >= mood.minRating));
    const show = pickRandom(pool);
    return show ? { label: mood.label, show } : null;
  }).filter((card): card is { label: string; show: ShowHit } => Boolean(card)).slice(0, 6), [suggestions, curatedShows]);
  const characterCards = useMemo(() => shuffle(TRENDING_CHARACTERS).map((character) => ({
    character,
    show: curatedShows.get(character.show),
  })).filter((card): card is { character: typeof TRENDING_CHARACTERS[number]; show: ShowHit } => Boolean(card.show)).slice(0, 6), [curatedShows]);
  useEffect(() => {
    let active = true;
    const showIds = [...new Set(characterCards.map((c) => c.show.id))];
    Promise.all(showIds.map(async (id) => [id, await getCast(id).catch((): CastMember[] => [])] as const)).then((pairs) => {
      if (!active) return;
      const castByShow = new Map(pairs);
      const images = new Map<string, string>();
      characterCards.forEach(({ character, show }) => {
        const match = castByShow.get(show.id)?.find((c) => c.character.toLowerCase() === character.name.toLowerCase());
        if (match?.image) images.set(character.name, match.image);
      });
      setCharacterImages(images);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [characterCards]);
  const go = async (query = q) => {
    if (!query.trim()) return;
    setBusy("Searching…"); setErr("");
    try {
      const results = await searchShows(query);
      setHits(results);
      if (results[0]) setRecent(await saveRecentShow(results[0]));
    } catch (e) { setErr(friendlyError(e, "shows")); } finally { setBusy(""); }
  };
  const pick = async (show: ShowHit, openingQuestion?: string) => {
    setBusy(`Loading ${show.name}…`);
    try {
      setRecent(await saveRecentShow(show));
      await onPick(show, openingQuestion);
    } catch (e) { setErr(friendlyError(e, "shows")); setBusy(""); }
  };
  return (
    <section>
      <label className="field" htmlFor="sq">What are you watching?</label>
      <div className="row">
        <input id="sq" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="Show name" />
        <button className="primary" onClick={() => { void go(); }}>Search</button>
      </div>
      {recent.length > 0 && <div className="recent-pills" aria-label="Recent searches">
        {recent.map((show) => <button key={show.id} className="pill" onClick={() => { void pick(show); }}>{show.name}</button>)}
      </div>}
      <p className="status">{busy || err}</p>
      {!hits.length && library.length > 0 && <section className="suggested" aria-labelledby="continue-title">
        <h2 id="continue-title">Continue watching</h2>
        <div className="suggestion-rail">
          {library.slice(0, 8).map((entry) => <button key={entry.show.id} className="suggestion" onClick={() => { void pick(entry.show); }}>
            {entry.show.image ? <img src={entry.show.image} alt="" /> : <span className="noart" />}
            <span><b>{entry.show.name}</b><small>Resume at S{entry.position.season}E{entry.position.episode}</small></span>
          </button>)}
        </div>
      </section>}
      {!hits.length && <section className="suggested" aria-labelledby="suggested-title">
        <h2 id="suggested-title">Suggested shows</h2>
        {loadingSuggestions ? <p className="status">Finding something good…</p> : <div className="suggestion-rail">
          {suggested.map((show) => <button key={show.id} className="suggestion" onClick={() => { void pick(show); }}>
            {show.image ? <img src={show.image} alt="" /> : <span className="noart" />}
            <span><b>{show.name}</b>{show.network && <small>{show.network}</small>}</span>
          </button>)}
        </div>}
      </section>}
      {!hits.length && moodCards.length > 0 && <section className="suggested" aria-labelledby="moods-title">
        <h2 id="moods-title">Browse by mood</h2>
        <div className="mood-rail">
          {moodCards.map(({ label, show }) => <button key={label} className="mood" onClick={() => { void pick(show); }}>
              {show.image ? <img src={show.image} alt="" /> : <span className="noart" />}
              <span><b>{label}</b><small>{show.name}</small></span>
            </button>)}
        </div>
      </section>}
      {!hits.length && characterCards.length > 0 && <section className="suggested" aria-labelledby="characters-title">
        <h2 id="characters-title">Trending characters</h2>
        <div className="character-rail">
          {characterCards.map(({ character, show }) => <button key={character.name} className="character" onClick={() => { void pick(show, `Tell me about ${character.name}`); }}>
              {characterImages.get(character.name) ?? show.image ? <img src={characterImages.get(character.name) ?? show.image} alt="" /> : <span className="noart" />}
              <span><b>{character.name}</b><small>{show.name}</small></span>
            </button>)}
        </div>
      </section>}
      <ul className="hits">
        {hits.map((h) => (
          <li key={h.id}>
            <button onClick={() => { void pick(h); }}>
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

function Chat({ client, catalog, position, onUsage, initialQuestion, onConsumeInitialQuestion }: {
  client: AgentClient; catalog: ShowCatalog; position: Position; onUsage: (u: TurnUsage) => void;
  initialQuestion?: string; onConsumeInitialQuestion: () => void;
}) {
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
    } catch (e) {
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
        <button className="primary" onClick={send} disabled={!!status || !historyReady}>Ask</button>
      </div>
      <Attribution catalog={catalog} season={position.season} />
    </section>
  );
}

function Attribution({ catalog, season }: { catalog: ShowCatalog; season: number }) {
  const [, forceUpdate] = useState(0);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const pages = [...catalog.sources.values()];
  const wikiPages = pages.filter((p) => p.origin === "wikipedia");
  const fandomPages = pages.filter((p) => p.origin === "fandom");
  const hasSource = catalog.sources.has(season);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    setStatus("Looking up that page…");
    const result = await catalog.setOverride(season, t).catch(() => null);
    if (!result) { setStatus("Couldn’t find episode summaries on that page."); return; }
    setStatus(""); setEditing(false); setTitle("");
    forceUpdate((n) => n + 1); // catalog.sources mutated in place; re-render to pick it up
  };

  return (
    <>
      <p className="attrib">
        Episode data from <a href="https://www.tvmaze.com" target="_blank" rel="noreferrer">TVmaze</a>
        {wikiPages.length > 0 && <> and Wikipedia ({wikiPages.map((p, i) => <span key={p.url}>{i > 0 && ", "}<a href={p.url} target="_blank" rel="noreferrer">{p.pageTitle}</a></span>)}), CC BY-SA 4.0</>}
        {fandomPages.length > 0 && <> and Fandom ({fandomPages.map((p, i) => <span key={p.url}>{i > 0 && ", "}<a href={p.url} target="_blank" rel="noreferrer">{p.pageTitle}</a></span>)}), CC BY-SA 4.0</>}.
        {" "}<button className="link" onClick={() => setEditing((e) => !e)}>{hasSource ? "Wrong page?" : "Missing summaries?"}</button>
      </p>
      {editing && (
        <div className="row override">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()}
            placeholder={`Wikipedia page for season ${season}, e.g. "${catalog.showName} (season ${season})"`} aria-label="Wikipedia page title" />
          <button className="link" onClick={() => { void save(); }}>Use this page</button>
        </div>
      )}
      {status && <p className="status">{status}</p>}
    </>
  );
}
