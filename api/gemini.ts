// Free tier: answers questions with the site's own Gemini key, which never reaches the browser.
// Limits are enforced here, not in the client (anyone can clear browser storage):
// per visitor (anonymous cookie), per IP, and site-wide, each per UTC day.
//
// Env: GEMINI_API_KEY, plus Upstash Redis for the counters (UPSTASH_REDIS_REST_URL/TOKEN, or the
// KV_REST_API_URL/TOKEN names Vercel's Upstash integration sets). Without Redis it fails closed
// when deployed, and uses in-memory counters in local dev.

export const FREE_LIMITS = {
  questionsPerVisitor: 10, // keep in sync with FREE_TIER in src/agent/config.ts
  questionsPerIp: 30, // a few people sharing one network
  questionsSiteWide: Number(process.env.FREE_SITE_QUESTIONS_PER_DAY) || 120, // stay inside the key's Gemini quota
  callsPerQuestion: 8, // MAX_STEPS (6) agent calls + 1 spoiler check, plus one spare
};
/** Models the free tier may call; keep in sync with MODELS.gemini in src/agent/config.ts. */
export const FREE_MODELS = ["gemini-3.1-flash-lite"];
const MAX_BODY_BYTES = 512_000;
const MAX_OUTPUT_TOKENS = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COOKIE = "uth_vid";

export interface CounterStore {
  /** Increments `key` and returns the new value; the key expires `ttlSeconds` after the last write. */
  incr(key: string, ttlSeconds: number): Promise<number>;
  set(key: string, value: number, ttlSeconds: number): Promise<void>;
}

export function memoryStore(): CounterStore {
  const values = new Map<string, number>();
  return {
    async incr(key) { const next = (values.get(key) ?? 0) + 1; values.set(key, next); return next; },
    async set(key, value) { values.set(key, value); },
  };
}

function upstashStore(url: string, token: string): CounterStore {
  const pipeline = async (commands: string[][]) => {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands),
    });
    if (!res.ok) throw new Error(`Upstash request failed (${res.status})`);
    return await res.json() as Array<{ result?: unknown; error?: string }>;
  };
  return {
    async incr(key, ttl) {
      const [incr] = await pipeline([["INCR", key], ["EXPIRE", key, String(ttl)]]);
      if (incr.error) throw new Error(incr.error);
      return Number(incr.result);
    },
    async set(key, value, ttl) { await pipeline([["SET", key, String(value), "EX", String(ttl)]]); },
  };
}

const devStore = memoryStore();
function counterStore(): CounterStore | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  if (url && token) return upstashStore(url, token);
  return process.env.VERCEL ? null : devStore;
}

export type Admission =
  | { ok: true; remaining?: number }
  | { ok: false; code: "free_limit" | "question_limit"; message: string; remaining?: number };

/**
 * Decides whether one Gemini call may use the free key. Questions are counted on their first call;
 * later calls for the same question (tool rounds, the spoiler check) are capped but not counted again.
 */
export async function admitFreeCall(store: CounterStore, { visitorId, ip, questionId, now = new Date() }: {
  visitorId: string; ip: string; questionId: string; now?: Date;
}): Promise<Admission> {
  const day = now.toISOString().slice(0, 10);
  const questionKey = `q:${visitorId}:${questionId}`;
  const calls = await store.incr(questionKey, 60 * 60);
  if (calls > FREE_LIMITS.callsPerQuestion) {
    return { ok: false, code: "question_limit", message: "That question needed too many steps. Try asking it more simply." };
  }
  if (calls > 1) return { ok: true };

  // A new question. Check the narrowest limit first, so one visitor over their allowance
  // can't run up the shared IP and site-wide counts.
  const deny = async (message: string, remaining?: number): Promise<Admission> => {
    await store.set(questionKey, FREE_LIMITS.callsPerQuestion, 60 * 60); // later calls for this question stay refused
    return { ok: false, code: "free_limit", message, remaining };
  };
  const ttl = 2 * 24 * 60 * 60;
  const visitorCount = await store.incr(`v:${day}:${visitorId}`, ttl);
  if (visitorCount > FREE_LIMITS.questionsPerVisitor) {
    return deny(`You've used today's ${FREE_LIMITS.questionsPerVisitor} free questions. Add your own API key to keep asking, or come back tomorrow.`, 0);
  }
  if (await store.incr(`ip:${day}:${ip}`, ttl) > FREE_LIMITS.questionsPerIp) {
    return deny("Free questions from your network are used up for today. Add your own API key to keep asking.");
  }
  if (await store.incr(`site:${day}`, ttl) > FREE_LIMITS.questionsSiteWide) {
    return deny("The free tier has run out of questions for today. Add your own API key to keep asking.");
  }
  return { ok: true, remaining: FREE_LIMITS.questionsPerVisitor - visitorCount };
}

/** Only the fields the app sends; anything else is dropped, and output length is capped. */
function upstreamBody(request: Record<string, unknown>) {
  const { systemInstruction, contents, tools } = request;
  const generationConfig = (request.generationConfig ?? {}) as { maxOutputTokens?: number };
  return {
    systemInstruction, contents, tools,
    generationConfig: { maxOutputTokens: Math.min(Number(generationConfig.maxOutputTokens) || MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS) },
  };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
const failure = (status: number, code: string, message: string, headers?: Record<string, string>) =>
  json(status, { code, error: { message } }, headers);

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.GEMINI_API_KEY;
  const store = counterStore();
  if (!apiKey || !store) return failure(503, "free_unavailable", "The free tier isn't available right now. Add your own API key to keep asking.");

  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return failure(403, "forbidden", "Cross-site requests aren't allowed.");

  const savedId = /(?:^|;\s*)uth_vid=([^;]+)/.exec(request.headers.get("cookie") ?? "")?.[1];
  const visitorId = savedId && UUID.test(savedId) ? savedId : crypto.randomUUID();
  const headers: Record<string, string> = visitorId === savedId ? {} : {
    "Set-Cookie": `${COOKIE}=${visitorId}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=31536000${request.url.startsWith("https:") ? "; Secure" : ""}`,
  };

  const questionId = request.headers.get("x-question-id") ?? "";
  if (!UUID.test(questionId)) return failure(400, "bad_request", "Missing question id.", headers);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return failure(413, "bad_request", "That request is too large.", headers);
  let payload: { model?: unknown; request?: unknown };
  try { payload = JSON.parse(text); } catch { return failure(400, "bad_request", "Invalid JSON.", headers); }
  const model = payload.model;
  if (typeof model !== "string" || !FREE_MODELS.includes(model)) return failure(400, "bad_request", "That model isn't available on the free tier.", headers);
  if (!payload.request || typeof payload.request !== "object") return failure(400, "bad_request", "Missing request.", headers);

  const ip = request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  let admission: Admission;
  try { admission = await admitFreeCall(store, { visitorId, ip, questionId }); }
  catch { return failure(503, "free_unavailable", "The free tier isn't available right now. Add your own API key to keep asking.", headers); }
  if (admission.remaining !== undefined) headers["X-Free-Questions-Remaining"] = String(admission.remaining);
  if (!admission.ok) return failure(429, admission.code, admission.message, headers);

  const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(upstreamBody(payload.request as Record<string, unknown>)),
  });
  // Google rate-limiting the site's key means the free tier is out for now, not a bug in this request.
  if (upstream.status === 429) return failure(429, "free_limit", "The free tier is busy right now. Add your own API key to keep asking.", headers);
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
