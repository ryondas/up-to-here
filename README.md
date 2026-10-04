# Up to here

Ask questions about a TV show without spoilers. You pick the last episode you watched; an AI agent answers using only summaries of episodes up to that point.

Fully static frontend (Vite + React + TypeScript). No backend, no server costs: each user brings their own Anthropic API key, which stays in their browser.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # spoiler-gate tests (network mocked)
npm run build    # static site in dist/
```

Deploy `dist/` anywhere static: Vercel, Netlify, Cloudflare Pages, GitHub Pages.

## How it works

```
TVmaze ──► episode skeleton (seasons, numbers, titles)
Wikipedia ─► plot summaries ({{Episode list}} templates)
                     │
              ShowCatalog.getEpisode()   ◄── the spoiler gate: throws for anything
                     │                       past the viewer's position
              agent tools (list / get / search seen episodes)
                     │
              Claude agent loop (tool use)  ──►  answer
                     │
              guard model: is the answer grounded in what the agent read?
                     │
              show answer, or hide it behind "Show it anyway"
```

Three layers keep spoilers out, strongest first:

1. **Code gate** (`src/lib/catalog.ts`). Every tool goes through `getEpisode`, which refuses episodes after the position. Future episode titles are never shown in the UI or given to the model, since titles can spoil too.
2. **Prompt** (`src/agent/agent.ts`). The model is told to ignore its own memory of the show and answer only from tool results. This matters because the model may already know the show; the gate can't stop that, only the prompt and the guard can.
3. **Guard** (`src/agent/guard.ts`). A small, cheap model checks the answer against exactly the summaries the agent read. If it fails or errors, the answer is hidden (fail closed).

Moving your position backward clears the chat, since earlier answers may cover episodes that are now "unwatched".

## Files

| File | Job |
|---|---|
| `src/lib/tvmaze.ts` | Show search + episode list (free, no key, CORS-enabled) |
| `src/lib/wikipedia.ts` | Finds the season page and pulls summaries |
| `src/lib/wikitext.ts` | Parses `{{Episode list}}` templates, strips markup |
| `src/lib/catalog.ts` | Merges both sources, caches per season, enforces the gate |
| `src/agent/tools.ts` | Tool schemas + executors |
| `src/agent/agent.ts` | Tool-use loop, system prompt |
| `src/agent/guard.ts` | Spoiler check |
| `src/agent/config.ts` | Model choices |
| `src/App.tsx` | Key screen, show search, episode track, chat |

## Known gaps / next steps

- **Wikipedia page matching is heuristic.** It tries `Show (season N)`, then a search, then `List of Show episodes`. Shows with disambiguated titles (e.g. *The Office (American TV series)*) may miss and fall back to TVmaze's short blurbs. `ShowCatalog.setOverride(season, pageTitle)` exists for a manual-fix UI that isn't built yet.
- **Summaries are short.** Wikipedia's are a paragraph; enough for "who is this", thin for "explain this scene". Richer sources (fan wiki episode pages, subtitles) bring licensing questions.
- **Mid-episode position** isn't supported; the unit is whole episodes.
- **API keys in the browser.** Fine for BYOK, but advise users to create a dedicated key with a spend limit. If you later want users to sign in instead of pasting a key, you'll need a backend that holds your key and handles billing.
- **Caching.** Wikipedia results are cached per session only. Persisting parsed seasons (IndexedDB, or a tiny shared cache server) would make repeat lookups instant.
- **Attribution.** Wikipedia text is CC BY-SA 4.0; the footer links every page used. Keep that if you change the UI. TVmaze asks for a link back too.
