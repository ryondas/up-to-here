import { useEffect, useMemo, useState } from "react";
import { getCast, getTrendingShows, resolveShowsByTitle, searchShows, type CastMember, type ShowHit, type TrendingShow } from "../lib/tvmaze";
import { friendlyError } from "../lib/errors";
import { getLibrary, getRecentShows, saveRecentShow, type LibraryEntry } from "../lib/storage";
import { Rail, ShowCard } from "./ShowCard";

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

export function ShowSearch({ onPick }: { onPick: (h: ShowHit, openingQuestion?: string) => Promise<void> }) {
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
      {!hits.length && library.length > 0 && <Rail id="continue-title" title="Continue watching" railClass="suggestion-rail">
        {library.slice(0, 8).map((entry) => <ShowCard key={entry.show.id} variant="suggestion" show={entry.show} title={entry.show.name}
          subtitle={`Resume at S${entry.position.season}E${entry.position.episode}`} onPick={() => { void pick(entry.show); }} />)}
      </Rail>}
      {!hits.length && <Rail id="suggested-title" title="Suggested shows" railClass="suggestion-rail" status={loadingSuggestions ? "Finding something good…" : undefined}>
        {suggested.map((show) => <ShowCard key={show.id} variant="suggestion" show={show} title={show.name} subtitle={show.network} onPick={() => { void pick(show); }} />)}
      </Rail>}
      {!hits.length && moodCards.length > 0 && <Rail id="moods-title" title="Browse by mood" railClass="mood-rail">
        {moodCards.map(({ label, show }) => <ShowCard key={label} variant="mood" show={show} title={label} subtitle={show.name} onPick={() => { void pick(show); }} />)}
      </Rail>}
      {!hits.length && characterCards.length > 0 && <Rail id="characters-title" title="Trending characters" railClass="character-rail">
        {characterCards.map(({ character, show }) => <ShowCard key={character.name} variant="character" show={show} image={characterImages.get(character.name) ?? show.image}
          title={character.name} subtitle={show.name} onPick={() => { void pick(show, `Tell me about ${character.name}`); }} />)}
      </Rail>}
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
