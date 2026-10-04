// Second line of defense: a small, cheap model checks the answer is grounded in
// the episodes the agent actually read, and contains no foreshadowing.
import type { Episode } from "../lib/catalog";
import { MODELS } from "./config";
import { askGeminiText, type AgentClient } from "./agent";

export async function checkForSpoilers(
  client: AgentClient, retrieved: Episode[], answer: string, signal?: AbortSignal,
): Promise<boolean> {
  const evidence = retrieved.map((e) => `[S${e.season}E${e.number} "${e.title}"]\n${e.summary}`).join("\n\n");
  const prompt = `A TV viewer has only seen the episodes summarized below. Decide if the ANSWER could spoil anything for them.

<evidence>
${evidence || "(none)"}
</evidence>

<answer>
${answer}
</answer>

Unsafe if the answer: states or implies facts, names, relationships or events not supported by the evidence; hints at or foreshadows future developments ("for now", "yet", "little does he know", ominous framing); or confirms/denies what happens later. Saying something "hasn't been shown yet" is safe. General small talk is safe.

Reply with exactly one word: SAFE or UNSAFE.`;
  try {
    let out: string;
    if (client.provider === "anthropic") {
      out = (await client.client.messages.create({
        model: MODELS.anthropic.guard,
        max_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      }, { signal })).content.map((b) => (b.type === "text" ? b.text : "")).join("");
    } else if (client.provider === "openai") {
      out = (await client.client.chat.completions.create({
        model: MODELS.openai.guard,
        max_completion_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      }, { signal })).choices[0]?.message.content ?? "";
    } else {
      out = await askGeminiText(client.apiKey, MODELS.gemini.guard, prompt, signal);
    }
    return out.includes("SAFE") && !out.includes("UNSAFE");
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return false; // fail closed: hide the answer if the check can't run
  }
}
