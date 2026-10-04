// Second line of defense: a small, cheap model checks the answer is grounded in
// the episodes the agent actually read, and contains no foreshadowing.
import type { Episode } from "../lib/catalog";
import { MODELS } from "./config";
import { askGeminiText, type AgentClient, type Usage } from "./agent";

export async function checkForSpoilers(
  client: AgentClient, retrieved: Episode[], answer: string, signal?: AbortSignal, usage?: Usage,
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
      const res = await client.client.messages.create({
        model: MODELS.anthropic.guard,
        max_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      }, { signal });
      if (usage) { usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens; }
      out = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    } else if (client.provider === "openai") {
      const res = await client.client.chat.completions.create({
        model: MODELS.openai.guard,
        max_completion_tokens: 50,
        messages: [{ role: "user", content: prompt }],
      }, { signal });
      if (usage) { usage.input += res.usage?.prompt_tokens ?? 0; usage.output += res.usage?.completion_tokens ?? 0; }
      out = res.choices[0]?.message.content ?? "";
    } else {
      out = await askGeminiText(client.apiKey, MODELS.gemini.guard, prompt, signal, usage);
    }
    return out.includes("SAFE") && !out.includes("UNSAFE");
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return false; // fail closed: hide the answer if the check can't run
  }
}
