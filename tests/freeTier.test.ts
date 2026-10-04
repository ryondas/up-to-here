// Run: npx tsx tests/freeTier.test.ts   (free-tier limits and the /api/gemini proxy; network mocked)
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FREE_LIMITS, FREE_MODELS, POST, admitFreeCall, memoryStore } from "../api/gemini";
import { FREE_TIER, MODELS } from "../src/agent/config";
import { MAX_STEPS } from "../src/agent/agent";

// The server and client must agree.
assert.equal(FREE_LIMITS.questionsPerVisitor, FREE_TIER.questionsPerDay);
assert.ok(FREE_MODELS.includes(MODELS.gemini.agent) && FREE_MODELS.includes(MODELS.gemini.guard));
assert.ok(FREE_LIMITS.callsPerQuestion >= MAX_STEPS + 1, "a full agent loop plus the spoiler check must fit in one question");

const now = new Date("2026-10-04T12:00:00Z");
const visitor = () => ({ visitorId: randomUUID(), ip: `10.0.0.${Math.floor(Math.random() * 250)}`, now });

{ // Ten questions a day per visitor, then refused with 0 remaining; tomorrow resets.
  const store = memoryStore();
  const v = visitor();
  for (let i = 1; i <= FREE_LIMITS.questionsPerVisitor; i++) {
    const r = await admitFreeCall(store, { ...v, questionId: randomUUID() });
    assert.deepEqual(r, { ok: true, remaining: FREE_LIMITS.questionsPerVisitor - i });
  }
  const over = await admitFreeCall(store, { ...v, questionId: randomUUID() });
  assert.equal(over.ok, false);
  assert.equal(!over.ok && over.code, "free_limit");
  assert.equal(over.remaining, 0);
  const tomorrow = await admitFreeCall(store, { ...v, now: new Date("2026-10-05T00:00:01Z"), questionId: randomUUID() });
  assert.equal(tomorrow.ok, true);
}

{ // Calls within one question don't count as new questions, but are capped.
  const store = memoryStore();
  const v = visitor();
  const questionId = randomUUID();
  for (let i = 0; i < FREE_LIMITS.callsPerQuestion; i++) assert.equal((await admitFreeCall(store, { ...v, questionId })).ok, true);
  const capped = await admitFreeCall(store, { ...v, questionId });
  assert.equal(!capped.ok && capped.code, "question_limit");
  assert.equal((await admitFreeCall(store, { ...v, questionId: randomUUID() })).remaining, FREE_LIMITS.questionsPerVisitor - 2);
}

{ // A refused question stays refused: retrying its id can't slip through as a "later call".
  const store = memoryStore();
  const v = visitor();
  for (let i = 0; i < FREE_LIMITS.questionsPerVisitor; i++) await admitFreeCall(store, { ...v, questionId: randomUUID() });
  const questionId = randomUUID();
  assert.equal((await admitFreeCall(store, { ...v, questionId })).ok, false);
  assert.equal((await admitFreeCall(store, { ...v, questionId })).ok, false);
}

{ // Dropping the cookie (new visitor id each time) still runs into the per-IP limit.
  const store = memoryStore();
  const ip = "203.0.113.7";
  for (let i = 0; i < FREE_LIMITS.questionsPerIp; i++) {
    assert.equal((await admitFreeCall(store, { visitorId: randomUUID(), ip, now, questionId: randomUUID() })).ok, true);
  }
  const over = await admitFreeCall(store, { visitorId: randomUUID(), ip, now, questionId: randomUUID() });
  assert.equal(over.ok, false);
  // ...and those refusals didn't use up the site-wide allowance.
  assert.equal((await admitFreeCall(store, { ...visitor(), questionId: randomUUID() })).ok, true);
}

// The proxy itself: in-memory counters (no VERCEL env), Google mocked.
process.env.GEMINI_API_KEY = "test-site-key-SECRET";
const upstreamCalls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
(globalThis as any).fetch = async (url: string, init: RequestInit) => {
  upstreamCalls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] } }] }), { status: 200 });
};
const call = (init: { body?: unknown; questionId?: string; cookie?: string; origin?: string } = {}) => POST(new Request("https://up-to-here.vercel.app/api/gemini", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Question-Id": init.questionId ?? randomUUID(),
    "X-Real-IP": "198.51.100.1",
    ...(init.cookie ? { Cookie: init.cookie } : {}),
    ...(init.origin ? { Origin: init.origin } : {}),
  },
  body: JSON.stringify(init.body ?? { model: FREE_MODELS[0], request: { contents: [], generationConfig: { maxOutputTokens: 99999 }, extra: "dropped" } }),
}));

{
  const res = await call();
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.ok(!text.includes("SECRET"), "the site key must never reach the browser");
  assert.equal(res.headers.get("X-Free-Questions-Remaining"), String(FREE_LIMITS.questionsPerVisitor - 1));
  const cookie = res.headers.get("Set-Cookie") ?? "";
  assert.match(cookie, /^uth_vid=[0-9a-f-]{36}; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  const sent = upstreamCalls.at(-1)!;
  assert.ok(!sent.url.includes("SECRET"), "key goes in a header, not the URL");
  assert.equal(sent.headers["x-goog-api-key"], process.env.GEMINI_API_KEY);
  assert.equal(sent.body.generationConfig.maxOutputTokens, 1024);
  assert.equal(sent.body.extra, undefined);

  // The returned cookie identifies the visitor next time, so the count continues.
  const again = await call({ cookie: cookie.split(";")[0] });
  assert.equal(again.headers.get("X-Free-Questions-Remaining"), String(FREE_LIMITS.questionsPerVisitor - 2));
  assert.equal(again.headers.get("Set-Cookie"), null);
}

assert.equal((await call({ body: { model: "gemini-3-pro", request: {} } })).status, 400, "only the free models");
assert.equal((await call({ questionId: "nope" })).status, 400, "question id required");
assert.equal((await call({ origin: "https://evil.example" })).status, 403, "cross-site requests refused");

{ // Google rate-limiting the site key is reported as the free tier running out.
  (globalThis as any).fetch = async () => new Response("{}", { status: 429 });
  const res = await call();
  assert.equal(res.status, 429);
  assert.equal((await res.json() as { code: string }).code, "free_limit");
}

{ // Deployed without a key or Redis: fail closed.
  delete process.env.GEMINI_API_KEY;
  assert.equal((await call()).status, 503);
}

console.log("free tier tests passed");
