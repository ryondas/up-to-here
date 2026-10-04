// TVmaze: free, CORS-enabled, no key. Used for show search and the episode skeleton
// (season/episode numbering, titles, air dates). https://www.tvmaze.com/api
const BASE = "https://api.tvmaze.com";

export interface ShowHit { id: number; name: string; premiered?: string; network?: string; image?: string; }
export interface TvEpisode { season: number; number: number; title: string; airdate?: string; summary: string; image?: string; }

const stripHtml = (s: string | null | undefined) =>
  (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function searchShows(q: string): Promise<ShowHit[]> {
  const r = await fetch(`${BASE}/search/shows?q=${encodeURIComponent(q)}`);
  if (!r.ok) throw new Error(`Show search failed (${r.status})`);
  const rows: any[] = await r.json();
  return rows.map(({ show }) => ({
    id: show.id,
    name: show.name,
    premiered: show.premiered ?? undefined,
    network: show.network?.name ?? show.webChannel?.name ?? undefined,
    image: show.image?.medium ?? undefined,
  }));
}

const SUGGESTED_TITLES = [
  "Breaking Bad", "Better Call Saul", "The Bear", "Severance", "The Last of Us", "Succession",
  "The Office", "Parks and Recreation", "The Sopranos", "Yellowjackets", "Fleabag", "The Good Place",
];

const shuffle = <T,>(items: T[]) => {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [next[index], next[swap]] = [next[swap], next[index]];
  }
  return next;
};

/** A small, varied starter rail for the empty search screen. */
export async function getSuggestedShows(): Promise<ShowHit[]> {
  const results = await Promise.all(SUGGESTED_TITLES.map(async (title) => {
    const matches = await searchShows(title);
    return matches.find((show) => show.name.toLocaleLowerCase() === title.toLocaleLowerCase()) ?? matches[0];
  }));
  return shuffle(results.filter((show): show is ShowHit => Boolean(show)));
}

export async function getEpisodes(showId: number): Promise<TvEpisode[]> {
  const r = await fetch(`${BASE}/shows/${showId}/episodes`);
  if (!r.ok) throw new Error(`Episode list failed (${r.status})`);
  const rows: any[] = await r.json();
  return rows
    .filter((e) => typeof e.number === "number") // drop unnumbered specials
    .map((e) => ({
      season: e.season,
      number: e.number,
      title: e.name,
      airdate: e.airdate || undefined,
      summary: stripHtml(e.summary),
      image: e.image?.medium ?? e.image?.original ?? undefined,
    }));
}
