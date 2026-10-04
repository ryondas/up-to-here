// Second line of defense: a small, cheap model checks the answer is grounded in
// the episodes the agent actually read, and contains no foreshadowing.
import type Anthropic from "@anthropic-ai/sdk";
import type { Episode } from "../lib/catalog";
import { MODELS } from "./config";

export async function checkForSpoilers(
  client: Anthropic, retrieved: Episode[], answer: string, signal?: AbortSignal,
): Promise<boolean> {
  const evidence = retrieved.map((e) => `[S${e.season}E${e.number} "${e.title}"]\n${e.summary}`).join("\n\n");
  try {
    const res = await client.messages.create(
      {
        model: MODELS.guard,
        max_tokens: 50,
        messages: [{
          role: "user",
          content: `A TV viewer has only seen the episodes summarized below. Decide if the ANSWER could spoil anything for them.

<evidence>
${evidence || "(none)"}
</evidence>

<answer>
${answer}
</answer>

Unsafe if the answer: states or implies facts, names, relationships or events not supported by the evidence; hints at or foreshadows future developments ("for now", "yet", "little does he know", ominous framing); or confirms/denies what happens later. Saying something "hasn't been shown yet" is safe. General small talk is safe.

Reply with exactly one word: SAFE or UNSAFE.`,
        }],
      },
      { signal },
    );
    const out = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").toUpperCase();
    return out.includes("SAFE") && !out.includes("UNSAFE");
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return false; // fail closed: hide the answer if the check can't run
  }
}
