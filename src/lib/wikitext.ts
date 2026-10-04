// Minimal wikitext helpers for pulling episode summaries out of
// {{Episode list ...}} templates on Wikipedia season/episode-list pages.

export interface WikiEpisode {
  numberInSeason?: number;
  numberOverall?: number;
  title: string;
  summary: string;
}

/** Return the bodies of every top-level {{Episode list ...}} template (including /sublist variants). */
export function findEpisodeTemplates(wikitext: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*Episode list(\/sublist)?\s*\|/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    const start = m.index;
    let depth = 0;
    let i = start;
    for (; i < wikitext.length - 1; i++) {
      if (wikitext[i] === "{" && wikitext[i + 1] === "{") { depth++; i++; }
      else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
        depth--; i++;
        if (depth === 0) break;
      }
    }
    out.push(wikitext.slice(start + 2, i - 1));
    re.lastIndex = i;
  }
  return out;
}

/** Split template params on "|" that are not nested inside {{ }} or [[ ]]. */
export function splitParams(body: string): Record<string, string> {
  const parts: string[] = [];
  let depthCurly = 0, depthSquare = 0, cur = "";
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === "{{") { depthCurly++; cur += two; i++; continue; }
    if (two === "}}") { depthCurly--; cur += two; i++; continue; }
    if (two === "[[") { depthSquare++; cur += two; i++; continue; }
    if (two === "]]") { depthSquare--; cur += two; i++; continue; }
    if (body[i] === "|" && depthCurly === 0 && depthSquare === 0) { parts.push(cur); cur = ""; continue; }
    cur += body[i];
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return params;
}

/** Strip common wikitext markup down to readable plain text. */
export function cleanWikitext(s: string): string {
  let t = s;
  t = t.replace(/<!--[\s\S]*?-->/g, "");
  t = t.replace(/<ref[^>]*\/>/gi, "");
  t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  // Remove templates (repeat to handle nesting from the inside out)
  for (let k = 0; k < 5 && /\{\{[^{}]*\}\}/.test(t); k++) {
    t = t.replace(/\{\{\s*(?:nowrap|small)\s*\|([^{}]*)\}\}/gi, "$1");
    t = t.replace(/\{\{[^{}]*\}\}/g, "");
  }
  t = t.replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "");
  t = t.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1");
  t = t.replace(/\[\[([^\]]*)\]\]/g, "$1");
  t = t.replace(/\[https?:\/\/\S+\s([^\]]*)\]/g, "$1");
  t = t.replace(/'{2,}/g, "");
  t = t.replace(/<br\s*\/?>/gi, " ");
  t = t.replace(/<[^>]+>/g, "");
  t = t.replace(/&nbsp;/g, " ").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&amp;/g, "&");
  return t.replace(/\s+/g, " ").trim();
}

export function parseEpisodeList(wikitext: string): WikiEpisode[] {
  return findEpisodeTemplates(wikitext)
    .map((body) => {
      const p = splitParams(body);
      const summary = cleanWikitext(p["shortsummary"] ?? p["summary"] ?? "");
      const n2 = parseInt(cleanWikitext(p["episodenumber2"] ?? ""), 10);
      const n1 = parseInt(cleanWikitext(p["episodenumber"] ?? ""), 10);
      return {
        numberInSeason: Number.isFinite(n2) ? n2 : undefined,
        numberOverall: Number.isFinite(n1) ? n1 : undefined,
        title: cleanWikitext(p["title"] ?? ""),
        summary,
      };
    })
    .filter((e) => e.summary.length > 0);
}
