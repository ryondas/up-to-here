// TVmaze: free, CORS-enabled, no key. Used for show search and the episode skeleton
// (season/episode numbering, titles, air dates). https://www.tvmaze.com/api
const BASE = "https://api.tvmaze.com";

export interface ShowHit { id: number; name: string; premiered?: string; network?: string; image?: string; }
export interface TvEpisode { season: number; number: number; title: string; airdate?: string; summary: string; }

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
    }));
}
