// Second summary source, tried only when Wikipedia has no usable page for a
// season. Some Fandom wikis mirror Wikipedia's {{Episode list}} template, so
// this reuses the same parser — if a wiki doesn't use that template, this
// simply finds nothing and the caller falls back to TVmaze's blurbs, same as
// before. Fandom content is CC BY-SA 4.0 like Wikipedia; the UI attributes it.
import { parseEpisodeList } from "./wikitext";
import { withRetry } from "./retry";
import type { SeasonSource } from "./wikipedia";

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

async function api(subdomain: string, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params });
  return withRetry(async () => {
    const r = await fetch(`https://${subdomain}.fandom.com/api.php?${qs}`);
    if (!r.ok) throw new Error(`Fandom request failed (${r.status})`);
    return r.json();
  });
}

async function getWikitext(subdomain: string, title: string): Promise<{ title: string; text: string } | null> {
  const data = await api(subdomain, {
    action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: title,
  }).catch(() => null);
  const page = data?.query?.pages?.[0];
  const text = page?.revisions?.[0]?.slots?.main?.content;
  return page && !page.missing && text ? { title: page.title, text } : null;
}

const pageUrl = (subdomain: string, t: string) => `https://${subdomain}.fandom.com/wiki/${encodeURIComponent(t.replace(/ /g, "_"))}`;

export async function getFandomSeasonSummaries(showName: string, season: number): Promise<SeasonSource | null> {
  const subdomain = slugify(showName);
  if (!subdomain) return null;
  for (const t of [`${showName} (season ${season})`, `Season ${season}`, `List of ${showName} episodes`]) {
    const page = await getWikitext(subdomain, t);
    if (!page) continue;
    const episodes = parseEpisodeList(page.text);
    if (episodes.length) return { pageTitle: page.title, url: pageUrl(subdomain, page.title), episodes, origin: "fandom" };
  }
  return null;
}
