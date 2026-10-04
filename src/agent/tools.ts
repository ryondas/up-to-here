// Tool definitions + executors. Every executor goes through ShowCatalog.getEpisode,
// which refuses anything past the viewer's position. The spoiler wall lives here,
// in code, not in the prompt.
import type Anthropic from "@anthropic-ai/sdk";
import { ShowCatalog, SpoilerGateError, type Episode, type Position } from "../lib/catalog";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_seen_episodes",
    description: "List every episode the viewer has watched (season, episode number, title). Use this to orient yourself or find which episode covers something.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_episode_summary",
    description: "Get the plot summary of one watched episode. Requests for episodes the viewer hasn't watched are refused.",
    input_schema: {
      type: "object",
      properties: { season: { type: "integer" }, episode: { type: "integer" } },
      required: ["season", "episode"],
    },
  },
  {
    name: "search_seen_episodes",
    description: "Keyword search across summaries of watched episodes only. Good for questions like 'who is X' or 'when did Y happen'. Returns the best-matching episodes with their summaries.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Names or keywords, e.g. 'Krazy-8 basement'" } },
      required: ["query"],
    },
  },
];

export interface ToolContext {
  catalog: ShowCatalog;
  position: Position;
  /** Everything the agent read this turn — handed to the spoiler check afterwards. */
  retrieved: Map<string, Episode>;
}

const key = (e: { season: number; number: number }) => `S${e.season}E${e.number}`;
const fmt = (e: Episode) => `${key(e)} "${e.title}"\n${e.summary || "(no summary available)"}`;

export async function runTool(name: string, input: any, ctx: ToolContext): Promise<string> {
  const { catalog, position, retrieved } = ctx;
  try {
    switch (name) {
      case "list_seen_episodes":
        return catalog.seenSkeleton(position).map((e) => `${key(e)} "${e.title}"`).join("\n");

      case "get_episode_summary": {
        const ep = await catalog.getEpisode(Number(input.season), Number(input.episode), position);
        retrieved.set(key(ep), ep);
        return fmt(ep);
      }

      case "search_seen_episodes": {
        const terms = String(input.query ?? "").toLowerCase().split(/\W+/).filter((t) => t.length > 2);
        const eps = await catalog.getSeenEpisodes(position);
        const scored = eps
          .map((e) => {
            const hay = `${e.title} ${e.summary}`.toLowerCase();
            return { e, score: terms.reduce((s, t) => s + (hay.split(t).length - 1), 0) };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 4);
        if (!scored.length) return "No watched episode mentions those words.";
        scored.forEach(({ e }) => retrieved.set(key(e), e));
        return scored.map(({ e }) => fmt(e)).join("\n\n");
      }
      default:
        return `Unknown tool ${name}`;
    }
  } catch (err) {
    if (err instanceof SpoilerGateError) return "REFUSED: that episode is after where the viewer is. Do not speculate about it.";
    return `Error: ${(err as Error).message}`;
  }
}
