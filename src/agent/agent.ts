import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { TOOLS, runTool, type ToolContext } from "./tools";
import { checkForSpoilers } from "./guard";
import type { ShowCatalog, Position } from "../lib/catalog";

import { MODELS } from "./config";
export const MAX_STEPS = 6;

export type Provider = "anthropic" | "openai" | "gemini";
export type AgentClient =
  | { provider: "anthropic"; client: Anthropic }
  | { provider: "openai"; client: OpenAI }
  /** `apiKey: null` is the free tier: calls go through /api/gemini, which holds the site's key. */
  | { provider: "gemini"; apiKey: string | null; free?: FreeQuestion };
type GeminiClient = Extract<AgentClient, { provider: "gemini" }>;
/** One free-tier question. The server counts questions by id, not individual calls. */
interface FreeQuestion { id: string; remaining?: number }

export function makeClient(provider: Provider, apiKey: string): AgentClient {
  // Bring-your-own-key: the key lives only in this browser and is sent straight to the selected provider.
  if (provider === "anthropic") return { provider, client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }) };
  if (provider === "openai") return { provider, client: new OpenAI({ apiKey, dangerouslyAllowBrowser: true }) };
  return { provider, apiKey };
}

export const makeFreeClient = (): AgentClient => ({ provider: "gemini", apiKey: null });
export const isFreeClient = (client: AgentClient) => client.provider === "gemini" && client.apiKey === null;

/** The free tier is used up (or unavailable); the viewer needs their own key to keep asking. */
export class FreeLimitError extends Error {
  name = "FreeLimitError";
  /** Free questions left today, when the server said (0 once this viewer's allowance is used up). */
  readonly remaining?: number;
  constructor(message: string, remaining?: number) { super(message); this.remaining = remaining; }
}

export interface Turn { role: "user" | "assistant"; content: string; }
export interface Usage { input: number; output: number; }
export interface TurnUsage { agent: Usage; guard: Usage; }
export interface AgentResult {
  text: string; safe: boolean; sources: string[]; usage: TurnUsage;
  /** Free questions left today, when this question used the free tier. */
  freeRemaining?: number;
}

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
  baseClient: AgentClient, catalog: ShowCatalog, position: Position,
  history: Turn[], question: string, onStatus: (s: string) => void, signal?: AbortSignal,
): Promise<AgentResult> {
  const client: AgentClient = isFreeClient(baseClient) ? { provider: "gemini", apiKey: null, free: { id: crypto.randomUUID() } } : baseClient;
  const ctx: ToolContext = { catalog, position, retrieved: new Map() };
  const current = await catalog.getEpisode(position.season, position.episode, position).catch(() => undefined);
  if (current) ctx.retrieved.set(`S${current.season}E${current.number}`, current);

  const prompt = systemPrompt(catalog.showName, position, current);
  const agentUsage: Usage = { input: 0, output: 0 };
  const guardUsage: Usage = { input: 0, output: 0 };
  let text: string;
  if (client.provider === "anthropic") text = await askAnthropic(client.client, prompt, history, question, ctx, onStatus, signal, agentUsage);
  else if (client.provider === "openai") text = await askOpenAI(client.client, prompt, history, question, ctx, onStatus, signal, agentUsage);
  else text = await askGemini(client, prompt, history, question, ctx, onStatus, signal, agentUsage);
  if (!text) text = "I couldn't put an answer together from the episodes you've seen. Try asking more specifically.";

  onStatus("Checking for spoilers…");
  const safe = await checkForSpoilers(client, [...ctx.retrieved.values()], text, signal, guardUsage);
  const freeRemaining = client.provider === "gemini" ? client.free?.remaining : undefined;
  return { text, safe, sources: [...ctx.retrieved.keys()], usage: { agent: agentUsage, guard: guardUsage }, freeRemaining };
}

async function askAnthropic(
  client: Anthropic, system: string, history: Turn[], question: string, ctx: ToolContext,
  onStatus: (s: string) => void, signal: AbortSignal | undefined, usage: Usage,
): Promise<string> {
  const messages: Anthropic.MessageParam[] = [
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
  let text = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    onStatus(step === 0 ? "Thinking…" : "Looking through the episodes you've seen…");
    const res = await client.messages.create(
      { model: MODELS.anthropic.agent, max_tokens: 1024, system, tools: TOOLS, messages },
      { signal },
    );
    usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
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
  return text;
}

async function askOpenAI(
  client: OpenAI, system: string, history: Turn[], question: string, ctx: ToolContext,
  onStatus: (s: string) => void, signal: AbortSignal | undefined, usage: Usage,
): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...history.map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: question },
  ];
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = TOOLS.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  }));
  let text = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    onStatus(step === 0 ? "Thinking…" : "Looking through the episodes you've seen…");
    const res = await client.chat.completions.create({
      model: MODELS.openai.agent,
      max_completion_tokens: 1024,
      messages,
      tools,
    }, { signal });
    usage.input += res.usage?.prompt_tokens ?? 0; usage.output += res.usage?.completion_tokens ?? 0;
    const message = res.choices[0]?.message;
    if (!message) throw new Error("OpenAI returned no completion.");
    messages.push(message);
    const calls = message.tool_calls ?? [];
    if (!calls.length) return message.content?.trim() ?? "";

    for (const call of calls) {
      if (call.type !== "function") continue;
      let input: unknown = {};
      try { input = JSON.parse(call.function.arguments); } catch { input = {}; }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: await runTool(call.function.name, input, ctx),
      });
    }
  }
  return text;
}

type GeminiContent = { role: "user" | "model"; parts: Array<Record<string, unknown>> };
type GeminiResponse = {
  candidates?: Array<{ content?: GeminiContent }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

async function askGemini(
  client: GeminiClient, system: string, history: Turn[], question: string, ctx: ToolContext,
  onStatus: (s: string) => void, signal: AbortSignal | undefined, usage: Usage,
): Promise<string> {
  const contents: GeminiContent[] = [
    ...history.map((turn) => ({ role: turn.role === "assistant" ? "model" as const : "user" as const, parts: [{ text: turn.content }] })),
    { role: "user", parts: [{ text: question }] },
  ];
  const tools = [{ functionDeclarations: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.input_schema })) }];
  for (let step = 0; step < MAX_STEPS; step++) {
    onStatus(step === 0 ? "Thinking…" : "Looking through the episodes you've seen…");
    const res = await callGemini(client, MODELS.gemini.agent, {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools,
      generationConfig: { maxOutputTokens: 1024 },
    }, signal);
    usage.input += res.usageMetadata?.promptTokenCount ?? 0; usage.output += res.usageMetadata?.candidatesTokenCount ?? 0;
    const content = res.candidates?.[0]?.content;
    if (!content) throw new Error(res.error?.message || "Gemini returned no completion.");
    contents.push(content);
    const calls = content.parts.flatMap((part) => {
      const call = part.functionCall as { name?: string; args?: unknown } | undefined;
      return call?.name ? [call] : [];
    });
    if (!calls.length) return content.parts.map((part) => typeof part.text === "string" ? part.text : "").join("\n").trim();

    const responses = await Promise.all(calls.map(async (call) => ({
      functionResponse: {
        name: call.name,
        response: { result: await runTool(call.name!, call.args ?? {}, ctx) },
      },
    })));
    contents.push({ role: "user", parts: responses });
  }
  return "";
}

export async function askGeminiText(client: GeminiClient, model: string, prompt: string, signal?: AbortSignal, usage?: Usage): Promise<string> {
  const res = await callGemini(client, model, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 50 },
  }, signal);
  if (usage) { usage.input += res.usageMetadata?.promptTokenCount ?? 0; usage.output += res.usageMetadata?.candidatesTokenCount ?? 0; }
  return res.candidates?.[0]?.content?.parts.map((part) => typeof part.text === "string" ? part.text : "").join("") ?? "";
}

async function callGemini(client: GeminiClient, model: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<GeminiResponse> {
  const res = client.apiKey !== null
    ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(client.apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    })
    : await fetch("/api/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Question-Id": client.free?.id ?? "" },
      body: JSON.stringify({ model, request: body }),
      signal,
    });
  const remaining = res.headers.get("X-Free-Questions-Remaining");
  if (client.free && remaining !== null) client.free.remaining = Number(remaining);
  const data = await res.json().catch(() => ({})) as GeminiResponse & { code?: string };
  if (!res.ok) {
    if (data.code === "free_limit" || data.code === "free_unavailable") throw new FreeLimitError(data.error?.message || "The free tier is used up for now.", remaining === null ? undefined : Number(remaining));
    throw new Error(data.error?.message || `Gemini request failed (${res.status}).`);
  }
  return data;
}
