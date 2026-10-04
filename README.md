# Up to here

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#contributing)

**Ask questions about a TV show without spoilers.** You pick the last episode you watched; an AI agent answers using only summaries of episodes up to that point — nothing later ever reaches the model, the UI, or you.

Fully static frontend (Vite + React + TypeScript). No backend, no server costs: each user brings their own Anthropic, OpenAI, or Google Gemini API key, which stays in their browser and is sent straight to that provider.

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Deploying](#deploying)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)
- [Attribution](#attribution)

## Features

- **Three-layer spoiler defense** — a code gate that structurally refuses future episodes, a system prompt telling the model to ignore its own training knowledge, and a second cheap model that re-checks every answer against only the evidence retrieved, failing closed.
- **Bring your own key** — Anthropic, OpenAI, or Google Gemini. Billed to your own account; no key ever touches a server, because there isn't one.
- **Plot summaries from Wikipedia, with a Fandom fallback** and a manual page-override when the title-matching heuristic guesses wrong.
- **Resilient by default** — transient network/API failures retry with backoff; episode lists, season summaries, cast data, and trending shows all persist in IndexedDB so repeat visits don't re-fetch or re-parse.
- **Session cost tracking** — the Settings page shows your current provider/key and a running token/cost estimate for the session; every chat answer also shows its own token count.
- **Continue watching** — resume any show you've made progress on, sorted by recency, independent of search history.
- **Dynamic discovery** — "Suggested shows" and mood-based browsing pull from what's actually trending on TVmaze (genre-matched where that maps cleanly; curated where it doesn't), plus a trending-characters rail that opens the chat with a question pre-filled.
- **Full data portability** — export/import your entire local dataset as JSON, or export a single chat as a plain-text transcript to share.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

You'll need an API key from whichever provider you choose:

| Provider | Get a key at |
|---|---|
| Anthropic (Claude) | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI (GPT) | [platform.openai.com](https://platform.openai.com) |
| Google (Gemini) | [aistudio.google.com](https://aistudio.google.com) |

The key is stored only in your browser (IndexedDB). Create a dedicated key with a spend limit if your provider supports it.

## Configuration

Model choice per provider lives in [`src/agent/config.ts`](src/agent/config.ts) — one model for the agent loop, a cheaper/faster one for the spoiler guard. Approximate per-token pricing for the session cost estimate lives alongside it; update both together if you swap a model.

## How it works

```
TVmaze ──► episode skeleton (seasons, numbers, titles, cast)
Wikipedia / Fandom ─► plot summaries ({{Episode list}} templates)
                     │
              ShowCatalog.getEpisode()   ◄── the spoiler gate: throws for anything
                     │                       past the viewer's position
              agent tools (list / get / search seen episodes)
                     │
              Claude, GPT, or Gemini agent loop (tool use)  ──►  answer
                     │
              guard model: is the answer grounded in what the agent read?
                     │
              show answer, or hide it behind "Show it anyway"
```

Three layers keep spoilers out, strongest first:

1. **Code gate** ([`src/lib/catalog.ts`](src/lib/catalog.ts)). Every tool goes through `getEpisode`, which refuses episodes after the position. Future episode titles are never shown in the UI or given to the model, since titles can spoil too.
2. **Prompt** ([`src/agent/agent.ts`](src/agent/agent.ts)). The model is told to ignore its own memory of the show and answer only from tool results. This matters because the model may already know the show; the gate can't stop that, only the prompt and the guard can.
3. **Guard** ([`src/agent/guard.ts`](src/agent/guard.ts)). A small, cheap model checks the answer against exactly the summaries the agent read. If it fails or errors, the answer is hidden (fail closed).

Moving your position backward clears the chat, since earlier answers may cover episodes that are now "unwatched".

## Project structure

| File | Job |
|---|---|
| `src/lib/tvmaze.ts` | Show search, episode list, cast, and the trending-shows proxy (free, no key, CORS-enabled) |
| `src/lib/wikipedia.ts` | Finds the season page on Wikipedia and pulls summaries |
| `src/lib/fandom.ts` | Second summary source for seasons Wikipedia doesn't cover |
| `src/lib/wikitext.ts` | Parses `{{Episode list}}` templates, strips markup |
| `src/lib/catalog.ts` | Merges sources, caches per season, enforces the spoiler gate |
| `src/lib/storage.ts` | All IndexedDB persistence — settings, progress, chats, caches |
| `src/lib/retry.ts` | Retry/backoff for transient fetch failures |
| `src/lib/errors.ts` | Turns raw errors into messages a viewer can act on |
| `src/agent/tools.ts` | Tool schemas + executors |
| `src/agent/agent.ts` | Tool-use loop, system prompt, per-call token tracking |
| `src/agent/guard.ts` | Spoiler check |
| `src/agent/config.ts` | Model choices + approximate pricing |
| `src/lib/route.ts` | Hash routes (`#/`, `#/show/:id?s=&e=`, `#/settings`, `#/profiles`) so Back, refresh and links work |
| `src/App.tsx` | App shell: key gate, routes between search, a show, settings and profiles |
| `src/components/` | Header and breadcrumb, settings (data backup, API key, usage), key screen, profiles, show search/discovery, episode track, chat |

## Testing

```bash
npm test         # spoiler-gate tests (network mocked) + route tests
npm run lint      # oxlint
npm run build     # type-checks, then builds the static site to dist/
```

The test suite mocks the network and asserts the gate end-to-end: a tool call for a future episode is refused, search results never include future-episode content, and nothing from a future season is ever retrieved.

## Deploying

```bash
npm run build    # static site in dist/
```

Deploy `dist/` anywhere static: Vercel, Netlify, Cloudflare Pages, GitHub Pages. There's nothing to configure server-side — the app is just files.

Link previews need an absolute `og:image` URL, built from `VITE_SITE_URL` in `.env` (`https://up-to-here.vercel.app`). If you deploy somewhere else, change it there or set a `VITE_SITE_URL` build variable on your host.

## Known limitations

- **Wikipedia/Fandom page matching is heuristic.** It tries a few title patterns, then a search, then falls back. Shows with disambiguated titles (e.g. *The Office (American TV series)*) may miss — use the "Wrong page? / Missing summaries?" link under a show's chat to point it at the right page manually.
- **Summaries are short.** Wikipedia's are a paragraph; enough for "who is this", thin for "explain this scene." Richer sources (fan wiki episode pages, subtitles) bring licensing questions.
- **Mid-episode position** isn't supported; the unit is whole episodes.
- **API keys in the browser.** Fine for BYOK, but if you later want users to sign in instead of pasting a key, you'll need a backend that holds your key and handles billing — which is a different app than this one.
- **"Trending" is a proxy, not real popularity.** TVmaze has no popularity endpoint, so discovery is driven by what was most recently updated in their database. It's a reasonable free, keyless signal, not a ground truth.

## Contributing

Issues and PRs are welcome. A few things worth knowing before you dive in:

- There's no backend and no plan to add one — keep contributions client-only.
- Every new tool the agent can call must go through `ShowCatalog.getEpisode` (or an equivalent gate check) before returning anything. The spoiler gate is a hard architectural rule, not a style preference.
- Run `npm test && npm run lint && npm run build` before opening a PR.
- If you add a dependency on a new external API, confirm it's free, keyless (or BYOK), and CORS-enabled from the browser — this app has no server to proxy requests through.

## License

[MIT](LICENSE)

## Attribution

Episode and cast data from [TVmaze](https://www.tvmaze.com). Plot summaries from Wikipedia and, as a fallback, Fandom — both CC BY-SA 4.0; the app links every page it pulled from in the chat footer. Keep that attribution if you fork the UI.
