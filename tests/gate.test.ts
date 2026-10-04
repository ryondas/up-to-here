// Run: npx tsx tests/gate.test.ts   (mocks the network; checks the spoiler gate)
import assert from "node:assert/strict";
import { ShowCatalog } from "../src/lib/catalog";
import { runTool } from "../src/agent/tools";

const tvmaze = [1, 2, 3].flatMap((s) => [1, 2, 3].map((n) => ({ season: s, number: n, name: `T${s}${n}`, airdate: "", summary: `<p>blurb ${s}-${n}</p>` })));
const listPage = [1, 2, 3].flatMap((s) => [1, 2, 3].map((n) =>
  `{{Episode list |EpisodeNumber=${(s - 1) * 3 + n} |EpisodeNumber2=${n} |Title=T${s}${n} |ShortSummary=Wiki plot ${s}-${n} about [[Krazy-8|Krazy]] secret${s === 3 ? " FINALE TWIST" : ""} }}`)).join("\n");

(globalThis as any).fetch = async (url: string) => {
  const u = new URL(url);
  if (u.host === "api.tvmaze.com") return { ok: true, json: async () => tvmaze };
  const titles = u.searchParams.get("titles");
  if (u.searchParams.get("list") === "search") return { ok: true, json: async () => ({ query: { search: [] } }) };
  if (titles === "List of Demo episodes")
    return { ok: true, json: async () => ({ query: { pages: [{ title: titles, revisions: [{ slots: { main: { content: listPage } } }] }] } }) };
  return { ok: true, json: async () => ({ query: { pages: [{ title: titles, missing: true }] } }) };
};

const cat = await new ShowCatalog(1, "Demo").load();
const pos = { season: 2, episode: 2 };
const ctx = { catalog: cat, position: pos, retrieved: new Map() };

const ok = await runTool("get_episode_summary", { season: 2, episode: 2 }, ctx);
assert.match(ok, /Wiki plot 2-2/);
assert.match(await runTool("get_episode_summary", { season: 2, episode: 3 }, ctx), /^REFUSED/);
assert.match(await runTool("get_episode_summary", { season: 3, episode: 1 }, ctx), /^REFUSED/);
const list = await runTool("list_seen_episodes", {}, ctx);
assert.ok(list.includes("S2E2") && !list.includes("S2E3") && !list.includes("T23"));
const search = await runTool("search_seen_episodes", { query: "secret twist finale" }, ctx);
assert.ok(!search.includes("FINALE"), "search must not reach future seasons");
assert.ok(![...ctx.retrieved.keys()].some((k) => k === "S3E1" || k === "S2E3"));
console.log("gate tests passed");
