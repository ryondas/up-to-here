# Sprint 5 — research & plans (no code yet)

Four items from feedback on sprint 3. Each is researched and planned here;
none are implemented on this branch. Implementation should happen as
separate follow-up branches once these plans are reviewed.

---

## 1. Dedupe "Continue watching" and "Recent searches"

**Current state.** `ShowSearch` (`src/App.tsx`) renders two overlapping rails
on the empty search screen:
- **Continue watching** — from the `library` IndexedDB store, keyed by
  `showId`, updated every time progress is saved. Shows "Resume at S_E_".
- **Recent searches** — from the `recentSearches` store, capped at 6,
  updated on every `pick()` *and* every successful text search. Shows the
  same card style (image + name + network).

In practice almost every "recent search" is also a "continue watching"
entry, because picking a show always saves both. The two rails are visually
identical (same `.suggestion` card), which is what makes them read as
redundant.

**Plan.** Keep "Continue watching" as the primary rail (full-size cards,
progress shown). Replace the "Recent searches" *rail* with a row of small
pills directly under the search input — closer to a browser's recent-search
suggestions than a second content shelf.

- New section, rendered always (not just when `!hits.length`), directly
  below the search `<div className="row">`:
  ```tsx
  {recent.length > 0 && <div className="recent-pills" aria-label="Recent searches">
    {recent.map((show) => <button key={show.id} className="pill" onClick={() => { setQ(show.name); void pick(show); }}>{show.name}</button>)}
  </div>}
  ```
- CSS: reuse the `.quick-prompts button` pill pattern (nowrap, horizontal
  scroll, `border-radius:999px`) rather than inventing a new shape.
- No data-model change — `recentSearches` store and `saveRecentShow` stay
  as-is; only the *rendering* moves.
- Behavior question to confirm before building: clicking a pill currently
  would need to decide between (a) filling the search box only, or
  (b) jumping straight to the show like the old rail did. Recommend (b) —
  matches the one-click behavior users already have today, pills are just a
  more compact presentation of it.

**Risk.** Low. Purely presentational; the underlying store and `pick()` path
are untouched.

---

## 2. Trending character click pre-fills the chat

**Current state.** `TRENDING_CHARACTERS` cards call `pick(show)` — the
character's name is cosmetic only; clicking "Walter White" opens *Breaking
Bad* at whatever position is saved, same as clicking the show directly. The
name clicked on is thrown away.

**Plan.** Thread an optional "opening question" from the character card
through to the chat input.

- `ShowSearch`'s `onPick` prop gains an optional second argument:
  `onPick: (h: ShowHit, openingQuestion?: string) => Promise<void>`.
- Character card's click handler: `pick(show, `Tell me about ${character.name}`)`.
- `pick()` passes it through to `onPick`.
- In `App`, store it in a new `pendingQuestion` state, cleared once
  consumed. Pass it to `<Chat initialQuestion={pendingQuestion} ... />`.
- In `Chat`, seed `q` from `initialQuestion` on mount (`useState(() =>
  initialQuestion ?? "")`), matching how quick-prompts already work — it
  **fills the input, doesn't auto-send**. Consistent with the existing
  quick-prompt UX (user still reviews/edits before hitting Ask), and safer:
  no risk of firing a request before the viewer has even seen the position
  picker.
- No new spoiler-safety work needed — "Tell me about Walter White" is just
  a question like any other; the existing gate/prompt/guard chain handles it
  the same way regardless of where the text came from. Worth noting: if the
  character hasn't appeared yet at the viewer's (possibly previously-saved)
  position, the agent/guard will handle it exactly like any other
  not-yet-seen question — correct by construction, nothing new to build.

**Open question to confirm before building:** should the show open at the
viewer's *last saved* position (today's behavior) or reset to S1E1 when
arriving via a character card, since the premise is "I want to know about
this character" rather than "resume where I left off"? Recommend keeping
today's resume behavior — changing it would be a separate, bigger behavior
change than this request asked for.

**Risk.** Low-medium. Touches the `onPick` signature, which both `ShowSearch`
and `App` already share; the main new surface is `Chat`'s `initialQuestion`
prop and one `useState` initializer.

---

## 3. Free APIs for character/actor profile data (instead of show thumbnails)

Researched live (not from memory) since API availability/terms change.

**Finding — TMDB (The Movie Database) is disqualified for this app.**
TMDB has a genuinely good free tier and strong trending/discovery endpoints,
but **its API does not send `Access-Control-Allow-Origin` and therefore
cannot be called directly from a browser** — confirmed across multiple
threads on TMDB's own forum (e.g. "the TMDB API doesn't include the
'Access-Control-Allow-Origin' header, which blocks CORS requests from
browsers"). Every workaround TMDB's own staff suggest is "put a backend in
front of it." This app's entire premise is *zero backend* (`README.md`:
"No backend, no server costs"), so adopting TMDB would mean standing up a
proxy server — a real architecture change, not a drop-in API swap. Flagging
this clearly because TMDB is the API most people reach for first here, and
it's the wrong pick for this specific project.

**Recommendation — use TVmaze's own `/shows/{id}/cast` endpoint.**
Confirmed free, no key, and (since the app already calls
`api.tvmaze.com` successfully today) already proven CORS-friendly in this
exact codebase — no new dependency, no new BYOK key to ask the user for.
Response shape: an array of `{ person: { name, image }, character: { name,
image } }`. Both the actor and the character can carry a thumbnail. This
directly answers the ask: "Trending characters" can show the character's
*own* artwork (or the actor's headshot) instead of recycling the parent
show's poster for every card.

Implementation sketch (for a follow-up branch, not now):
- `src/lib/tvmaze.ts`: add `getCast(showId): Promise<{ name: string; image?: string; actor: string }[]>` hitting `/shows/{id}/cast`, wrapped in the existing `withRetry`.
- Cache per-show like the episode skeleton (new `castCache` IndexedDB store, same TTL pattern as `episodeCache`).
- `TRENDING_CHARACTERS`' hardcoded list could stay as the *curation* (which characters to feature) while swapping only the *image source* to the matched show's cast entry instead of the show poster — smallest possible change for the ask as literally stated.

**If richer bios are wanted later (optional, bigger lift):** cross-reference
the actor's name against Wikipedia using the `wikipedia.ts` infrastructure
already in this repo (same `origin=*` CORS trick, same CC BY-SA attribution
story already shown in the UI) for a short bio snippet. This avoids a new
dependency and a new license to track, but adds another title-matching
heuristic (same class of fragility as the existing Wikipedia season-page
matching) — scope this separately and only if cast photos alone aren't
enough.

**Explicitly not recommended:** unofficial IMDb scraper/wrapper APIs (seen
during research, e.g. RapidAPI listings) — IMDb has no official free public
API; wrappers around scraped IMDb data carry real ToS and reliability risk
for a product you'd ship.

Sources:
- [TVmaze API](https://www.tvmaze.com/api)
- [TMDB forum — CORS error on fetch](https://www.themoviedb.org/talk/61ef4ca06e938a006bc65662)
- [TMDB forum — Try API CORS policy error](https://www.themoviedb.org/talk/615ee63cc8a2d4008c7fe177)
- [What's the Best Movie Database API? IMDb vs TMDb vs OMDb](https://dev.to/zuplo/whats-the-best-movie-database-api-imdb-vs-tmdb-vs-omdb-b24)

---

## 4. Make "Suggested shows" and "Browse by mood" truly dynamic

**Current state.** Both are hardcoded in `src/App.tsx` / `src/lib/tvmaze.ts`:
`SUGGESTED_TITLES` is a fixed list of 12 show names resolved through
`searchShows()`; `MOODS` is 6 hand-picked `{label, shows: [...]}` mappings.
Neither changes unless someone edits the source.

**Constraint.** TVmaze (the only API this app currently depends on, and the
only one confirmed CORS-friendly without a backend — see §3) has **no
trending/popularity endpoint**. It does expose:
- `/shows` — the full show index, paginated, sortable client-side by
  `rating.average`, but it's thousands of shows; fetching the whole index
  just to sort is too heavy for a static-site, no-backend app.
- `/updates/shows` — a map of `{ showId: lastUpdatedTimestamp }`. Shows
  that are actively airing get touched here far more often than dormant
  ones, so sorting by most-recently-updated is a usable, zero-new-dependency
  proxy for "shows people are currently watching."
- Every show carries a `genres: string[]` field (e.g. `["Drama",
  "Thriller"]`).

**Plan.**
- **Suggested shows**: replace the fixed `SUGGESTED_TITLES` list with: fetch
  `/updates/shows`, take the N most-recently-updated show IDs, fetch each
  via `/shows/{id}` (or batch via existing `searchShows`-style calls), filter
  obviously low-signal entries (missing image, missing rating). Cache the
  result with a short TTL (e.g. 6–12h, shorter than the episode-skeleton TTL
  since "what's currently trending" should actually move) using the same
  `suggestedCache` store already added in sprint 3 — just change what feeds
  it, not the storage mechanism.
- **Browse by mood**: replace the hardcoded `shows: [...]` per mood with a
  `genres: string[]` tag per mood (e.g. "Prestige drama" → `["Drama"]`,
  "Post-apocalyptic" → `["Science-Fiction"]` — TVmaze's actual genre
  vocabulary would need checking against real show data rather than guessed
  here), then pick a matching show from the same recently-updated pool
  fetched for Suggested shows. This keeps mood cards dynamic without a
  second network round-trip per mood.
- Both changes are additive to `src/lib/tvmaze.ts` (new `getTrendingShows()`
  built on `/updates/shows`) — no change to the Wikipedia/Fandom/retry layer.

**Open question to confirm before building:** TVmaze's real genre tag list
needs to be checked against a sample of actual show data before mapping
moods to genres 1:1 — the mood labels are editorial/vibes-based ("Bingeable
crime", "Big feelings") and won't map cleanly onto TVmaze's more literal
genre taxonomy for every mood. Some moods may need a genre *and* a rating
floor, or may not translate well and should stay curated.

**Risk.** Medium. `/updates/shows` returns many thousands of entries;
needs sensible slicing (e.g. take top 50 most-recent, not the whole map)
before resolving each to a full show record, to avoid a slow first paint.
