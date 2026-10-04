// TVmaze: free, CORS-enabled, no key. Used for show search, the episode skeleton
// (season/episode numbering, titles, air dates), cast photos, and a "trending"
// proxy (TVmaze has no popularity endpoint, so /updates/shows — which shows
// were touched most recently — stands in for it). https://www.tvmaze.com/api
import { withRetry } from "./retry";
import { getCastCache, getTrendingCache, saveCastCache, saveTrendingCache } from "./storage";
const BASE = "https://api.tvmaze.com";

export interface ShowHit { id: number; name: string; premiered?: string; network?: string; image?: string; }
export interface TvEpisode { season: number; number: number; title: string; airdate?: string; summary: string; image?: string; }
export interface TrendingShow extends ShowHit { genres: string[]; rating?: number; }
export interface CastMember { actor: string; character: string; image?: string; }

const stripHtml = (s: string | null | undefined) =>
  (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function searchShows(q: string): Promise<ShowHit[]> {
  const rows: any[] = await withRetry(async () => {
    const r = await fetch(`${BASE}/search/shows?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(`Show search failed (${r.status})`);
    return r.json();
  });
  return rows.map(({ show }) => ({
    id: show.id,
    name: show.name,
    premiered: show.premiered ?? undefined,
    network: show.network?.name ?? show.webChannel?.name ?? undefined,
    image: show.image?.medium ?? undefined,
  }));
}

/** Resolve a fixed list of show names (e.g. for curated mood cards or trending characters) to their ShowHit. */
export async function resolveShowsByTitle(titles: string[]): Promise<Map<string, ShowHit>> {
  const pairs = await Promise.all(titles.map(async (title) => {
    const matches = await searchShows(title).catch(() => []);
    const hit = matches.find((show) => show.name.toLocaleLowerCase() === title.toLocaleLowerCase()) ?? matches[0];
    return hit ? ([title, hit] as const) : null;
  }));
  return new Map(pairs.filter((p): p is readonly [string, ShowHit] => p !== null));
}

async function getShowDetail(id: number): Promise<TrendingShow | null> {
  try {
    const s: any = await withRetry(async () => {
      const r = await fetch(`${BASE}/shows/${id}`);
      if (!r.ok) throw new Error(`Show detail failed (${r.status})`);
      return r.json();
    });
    if (!s.image?.medium) return null; // no artwork — bad fit for a visual rail
    return {
      id: s.id, name: s.name, premiered: s.premiered ?? undefined,
      network: s.network?.name ?? s.webChannel?.name ?? undefined,
      image: s.image.medium, genres: s.genres ?? [], rating: s.rating?.average ?? undefined,
    };
  } catch { return null; }
}

/**
 * A "what's trending" proxy: TVmaze has no popularity/trending endpoint, so this
 * takes the shows most recently touched in their database (actively-airing shows
 * get updated far more often than dormant ones) as the closest free, keyless signal.
 */
export async function getTrendingShows(limit = 18): Promise<TrendingShow[]> {
  const cached = await getTrendingCache().catch(() => undefined);
  if (cached) return cached;
  const updates: Record<string, number> = await withRetry(async () => {
    const r = await fetch(`${BASE}/updates/shows?since=week`);
    if (!r.ok) throw new Error(`Show updates failed (${r.status})`);
    return r.json();
  });
  const ids = Object.entries(updates).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => Number(id));
  const shows = (await Promise.all(ids.map(getShowDetail))).filter((s): s is TrendingShow => Boolean(s));
  void saveTrendingCache(shows).catch(() => undefined);
  return shows;
}

export async function getCast(showId: number): Promise<CastMember[]> {
  const cached = await getCastCache(showId).catch(() => undefined);
  if (cached) return cached;
  const rows: any[] = await withRetry(async () => {
    const r = await fetch(`${BASE}/shows/${showId}/cast`);
    if (!r.ok) throw new Error(`Cast list failed (${r.status})`);
    return r.json();
  });
  const cast = rows.map((row) => ({
    actor: row.person?.name ?? "",
    character: row.character?.name ?? "",
    image: row.character?.image?.medium ?? row.person?.image?.medium ?? undefined,
  }));
  void saveCastCache(showId, cast).catch(() => undefined);
  return cast;
}

export async function getEpisodes(showId: number): Promise<TvEpisode[]> {
  const rows: any[] = await withRetry(async () => {
    const r = await fetch(`${BASE}/shows/${showId}/episodes`);
    if (!r.ok) throw new Error(`Episode list failed (${r.status})`);
    return r.json();
  });
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
