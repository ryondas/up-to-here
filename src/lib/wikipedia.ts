// Wikipedia: per-episode plot summaries from {{Episode list}} templates.
// Content is CC BY-SA 4.0 — the UI shows attribution links for every page used.
import { parseEpisodeList, type WikiEpisode } from "./wikitext";
import { withRetry } from "./retry";

const API = "https://en.wikipedia.org/w/api.php";

async function api(params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  return withRetry(async () => {
    const r = await fetch(`${API}?${qs}`);
    if (!r.ok) throw new Error(`Wikipedia request failed (${r.status})`);
    return r.json();
  });
}

/** Fetch raw wikitext for a title (following redirects). Returns null if the page doesn't exist. */
async function getWikitext(title: string): Promise<{ title: string; text: string } | null> {
  const data = await api({
    action: "query", prop: "revisions", rvprop: "content", rvslots: "main",
    redirects: "1", titles: title,
  });
  const page = data?.query?.pages?.[0];
  const text = page?.revisions?.[0]?.slots?.main?.content;
  return page && !page.missing && text ? { title: page.title, text } : null;
}

async function searchTitles(q: string): Promise<string[]> {
  const data = await api({ action: "query", list: "search", srsearch: q, srlimit: "8", srnamespace: "0" });
  return (data?.query?.search ?? []).map((s: any) => s.title as string);
}

export interface SeasonSource { pageTitle: string; url: string; episodes: WikiEpisode[]; origin: "wikipedia" | "fandom"; }

const pageUrl = (t: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;

/**
 * Find summaries for one season. Tries, in order:
 *  1. "{Show} (season N)" / "{Show} season N" pages (most shows with long runs)
 *  2. a search for a page whose title mentions season N
 *  3. "List of {Show} episodes" (short-run shows keep summaries there)
 * Only pages whose templates actually contain summaries are accepted.
 * `overrideTitle` lets the user point at the right page when the heuristic misses.
 */
export async function getSeasonSummaries(
  showName: string, season: number, seasonCount: number, overrideTitle?: string,
): Promise<SeasonSource | null> {
  const tryTitle = async (t: string, filterSeason: boolean): Promise<SeasonSource | null> => {
    const page = await getWikitext(t);
    if (!page) return null;
    let eps = parseEpisodeList(page.text);
    if (filterSeason && seasonCount > 1) eps = splitBySeason(eps, season);
    return eps.length ? { pageTitle: page.title, url: pageUrl(page.title), episodes: eps, origin: "wikipedia" } : null;
  };

  if (overrideTitle) return tryTitle(overrideTitle, false);

  for (const t of [`${showName} (season ${season})`, `${showName} season ${season}`]) {
    const hit = await tryTitle(t, false);
    if (hit) return hit;
  }
  const re = new RegExp(`season ${season}\\b`, "i");
  for (const t of (await searchTitles(`"${showName}" season ${season}`)).filter((t) => re.test(t)).slice(0, 2)) {
    const hit = await tryTitle(t, false);
    if (hit) return hit;
  }
  return tryTitle(`List of ${showName} episodes`, true);
}

/**
 * On a "List of ... episodes" page every season sits on one page. Episode numbers
 * restart at 1 each season (EpisodeNumber2), so split on those resets.
 */
function splitBySeason(eps: WikiEpisode[], season: number): WikiEpisode[] {
  const seasons: WikiEpisode[][] = [];
  for (const e of eps) {
    if (!seasons.length || e.numberInSeason === 1) seasons.push([]);
    seasons[seasons.length - 1].push(e);
  }
  return seasons[season - 1] ?? [];
}
