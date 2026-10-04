import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, runTool, type ToolContext } from "./tools";
import { checkForSpoilers } from "./guard";
import type { ShowCatalog, Position } from "../lib/catalog";

import { MODELS } from "./config";
const MAX_STEPS = 6;

export function makeClient(apiKey: string) {
  // Bring-your-own-key: the key lives only in this browser and is sent straight to Anthropic.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export interface Turn { role: "user" | "assistant"; content: string; }
export interface AgentResult { text: string; safe: boolean; sources: string[]; }

function systemPrompt(showName: string, p: Position, current?: { title: string; summary: string }) {
  return `You are a spoiler-safe companion for the TV show "${showName}". The viewer has watched up to and including season ${p.season}, episode ${p.episode}${current ? ` ("${current.title}")` : ""}.

Your only knowledge of the show is what your tools return. Treat anything you remember about "${showName}" from training as unknown — it may be from episodes the viewer hasn't seen. Look things up with the tools before answering; prefer search_seen_episodes for questions about people or events.

Rules:
- Answer only from tool results. If they don't cover it, say you can't find it in the episodes watched so far.
- Never foreshadow: no "yet", "for now", "will", "later", "keep an eye on", ominous tone, or confirming/denying guesses about the future.
- Don't name characters, places or events that don't appear in tool results.
- Questions about the future (who dies, who finds out, how it ends): say that as of S${p.season}E${p.episode} it hasn't been shown, and offer what is known so far.
- Be conversational and brief: 2–5 sentences unless asked for a full recap. Mention which episode something happened in when helpful.${current?.summary ? `\n\nFor quick reference, the episode they just finished:\n${current.summary}` : ""}`;
}

export async function ask(
  client: Anthropic, catalog: ShowCatalog, position: Position,
  history: Turn[], question: string, onStatus: (s: string) => void, signal?: AbortSignal,
): Promise<AgentResult> {
  const ctx: ToolContext = { catalog, position, retrieved: new Map() };
  const current = await catalog.getEpisode(position.season, position.episode, position).catch(() => undefined);
  if (current) ctx.retrieved.set(`S${current.season}E${current.number}`, current);

  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];

  let text = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    onStatus(step === 0 ? "Thinking…" : "Looking through the episodes you've seen…");
    const res = await client.messages.create(
      { model: MODELS.agent, max_tokens: 1024, system: systemPrompt(catalog.showName, position, current), tools: TOOLS, messages },
      { signal },
    );
    messages.push({ role: "assistant", content: res.content });
    text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    if (res.stop_reason !== "tool_use") break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      results.push({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input, ctx) });
    }
    messages.push({ role: "user", content: results });
    text = "";
  }
  if (!text) text = "I couldn't put an answer together from the episodes you've seen. Try asking more specifically.";

  onStatus("Checking for spoilers…");
  const safe = await checkForSpoilers(client, [...ctx.retrieved.values()], text, signal);
  return { text, safe, sources: [...ctx.retrieved.keys()] };
}
