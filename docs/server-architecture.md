# Server Architecture — Hono, Redis, and the Verification Discipline

Every other doc in this folder covers a feature end to end (gameplay, UGC, Reddit
engagement…) and cites the server code that backs it. This doc is the orthogonal cut:
the engineering conventions that repeat across **every** route in
`src/server/routes/api.ts` and the rest of `src/server/`, so they only need explaining
once. If you're adding a new endpoint, the patterns below are the ones to copy.

---

## 1. App shape

```
src/server/index.ts          Hono app wiring — the whole surface in one file
  app.route('/api',      api)          ← public, called by the client
  app.route('/internal', internal)     ← menu / forms / triggers / scheduler
    internal.route('/menu',      menu)
    internal.route('/form',      forms)
    internal.route('/triggers',  triggers)
    internal.route('/scheduler', schedulerRoutes)
```

`serve({ fetch: app.fetch, createServer, port: getServerPort() })` hands the whole
Hono app to Devvit's Node runtime — `createServer`/`getServerPort` are Devvit Web's
own glue, not something this app configures. `/api/*` is what `src/client/*` calls
over plain `fetch`; `/internal/*` is Devvit-invoked only (a moderator menu tap, a
cron tick, an install/upgrade trigger) and is declared route-by-route in
`devvit.json` — every new internal endpoint needs an entry there or Devvit will
never call it.

Every route handler is `async (c: Context) => c.json<ResponseType>(...)`. Request/
response shapes live in `src/shared/api.ts` and are never widened with `as` —
`readJsonBody<T>()` wraps `c.req.json()` in a try/catch and returns `null` on
malformed JSON, and every handler checks the parsed fields' actual `typeof` before
trusting them (see §3).

---

## 2. Redis is a hash/sorted-set/string store — there is no Set type

Devvit's `redis` client (`@devvit/web/server`) exposes strings, hashes, and sorted
sets — no native Set. Three recurring idioms fill that gap:

- **A hash as a set, with atomic claims.** `redis.hSetNX(key, field, value)` returns
  `1` only if `field` didn't already exist — that's an atomic compare-and-set, and
  it's how the app implements every "exactly once" rule without a lock:
  - `hSetNX('level:first-completer', levelId, username)` — first solver, ever.
  - `hSetNX('level:crowned', levelId, username)` — one crown claim per level.
  - `hSetNX('carded:{levelId}', username, '1')` — one Splat Card per level per user.
  - `hSetNX('fitcheck:carded:{postId}', username, '1')` — one Fit Check entry per
    thread per user.
  - `hSetNX('creator-titles:{username}', normalizedTitle, levelId)` — one level per
    title per creator (§4 below).
  - `hSetNX('user:{name}', 'done:{levelId}', '1')` — first-completion detector that
    gates every reward path in `/api/complete`.
- **A sorted set as an enumerable registry.** `users:all` (score = join time) and
  `lb:global:solved` (score = distinct levels solved) aren't shown to players — they
  exist so moderator tools (`reset-all-users`, `reset-level-stats`,
  `wipeProgressIfStale`) can enumerate "every player who's ever touched the app"
  without a Redis `SCAN`, which Devvit doesn't expose. `lb:global:solved` is a
  second, internal-only board distinct from the three public ones
  (`GLOBAL_BOARD_KEYS` — sparks/moves/played, see `docs/retention.md` §6); don't
  confuse the two when reading `api.ts`.
- **A cooldown as a self-expiring string.** `redis.set(key, '1', { expiration })`
  writes a rate-limit flag whose own TTL is the cooldown — no separate `expire()`
  call, no cleanup job. Every share/publish endpoint checks its cooldown key first
  and returns 429 if it's still set: `carded:cooldown:{username}`,
  `crown:cooldown:{username}`, `fit:cooldown:{username}`, `create:cooldown:{username}`
  (20s for shares, 30s for publishing — see `docs/reddit-engagement.md` and
  `docs/user-creation.md`).

`SetOptions` on `redis.set()` (`{ nx?, xx?, expiration?: Date }`) is what makes the
cooldown idiom one round trip instead of `set` + `expire`. The same inline-`expiration`
option turns every "write a value with a TTL" call in this codebase into a single
`set()` instead of a `set()` + `expire()` pair — and where a write also has an
*independent* sibling write (the daily level JSON alongside its `daily:{date}`
pointer; the UGC level JSON alongside its cooldown claim and title claim), those go
together in one `Promise.all` too, since neither depends on the other's result.

---

## 3. The verification discipline: never trust the client

Every mutating route re-derives what it can instead of accepting the client's word:

- **The client reports what it *did*, never "I won."** `POST /api/complete` receives
  `{ levelId, timeMs, actions }` and replays `actions` through the exact same
  simulation the client ran (`isValidSolution`, from `src/shared/slimeSim.ts` +
  `gameRules.ts`) before awarding anything. A forged action list, an unknown level
  id, or a run that doesn't end bare is rejected with 400 — see `docs/core-gameplay.md`
  §"Server-side verification".
- **The same replay gates level creation.** `POST /api/level/create` treats the
  submitted `solution` as a claim, not a fact: `verifyLevelIntegrity` + `isValidSolution`
  independently confirm it resolves cleanly, ends bare, and paints something, before
  the level is ever stored or posted (`docs/user-creation.md` §3).
- **Sharing re-verifies the run it's bragging about.** `POST /api/share/card` and
  `POST /api/share/first-splat` both re-run `isValidSolution` (or check the
  server-recorded `level:first-completer` holder) before posting anything — a
  modified client can't manufacture a card or crown for a run that never happened.
- **Prices and ownership are server-side facts.** `POST /api/user/buy` re-prices from
  `src/shared/shop.ts`'s catalog and re-checks the `owned:{itemId}` / `unlocked`
  fields on the user hash; the client's displayed price is cosmetic only.
- **Structural validators guard every stored shape.** `isValidModifier`,
  `isDifficulty`, `isStringArray`, `isRecord` in `api.ts` check the actual runtime
  shape of anything read back from Redis or posted by the client — `parseStoredLevel`
  runs a level through `verifyLevelIntegrity` on every read, so a level stored before
  a rules change (or corrupted) is treated as gone rather than crashing a route.

The payoff of this discipline: nothing server-side ever needs to ask "but what if the
client lied" — it already assumed that and checked anyway.

---

## 4. Two shapes for "does the player own this" — and why both exist

`POST /api/user/buy` and `POST /api/level/create` both need "has this already
happened" answered two different ways, and use two different Redis shapes for it:

- **`owned:{itemId}` / the per-creator title hash** — a per-key atomic claim
  (`hSetNX`), used exactly once, to decide "do I charge Sparks / accept this title"
  under concurrent requests. This is a lock substitute: two simultaneous buys of the
  same item can't both succeed, because only one `hSetNX` call returns `1`.
- **`unlocked` (a JSON array on the user hash)** — the enumerable, client-facing list
  of everything a player owns, returned wholesale by `/api/user/profile` and
  `/api/user/buy`. It's rebuilt by pushing the new item id after the atomic claim
  succeeds, not itself used as the concurrency guard (a `JSON.parse` → mutate →
  `JSON.stringify` round trip isn't atomic).

The same split shows up for level titles: `creator-titles:{username}` is a HASH
keyed by the *normalized* title (`hSetNX` makes the claim atomic and case/space-fold
means "My Level" and "my  level" collide), while the level itself is a separate
`level:{id}` STRING holding the full `LevelData` JSON. Two representations, one for
"is this taken" (cheap, atomic, no payload) and one for "here's everything about it"
(the actual content).

---

## 5. Rollback on a failed Reddit write

An atomic Redis claim happens *before* the Reddit API call it's guarding (posting a
comment, submitting a post) — Redis is fast and reliable, `reddit.*` calls cross the
network and can fail. Every route that claims-then-posts rolls the claim back on a
Reddit failure, so a transient outage costs the player nothing:

```ts
const claimed = await redis.hSetNX(`carded:${levelId}`, username, '1');
if (claimed !== 1) return c.json<Err>({ ... }, 409);   // already posted — not a retry
try {
  await reddit.submitComment({ ... });
} catch {
  await redis.hDel(`carded:${levelId}`, [username]);    // hand the claim back
  return c.json<Err>({ ... }, 502);
}
```

The same shape appears in `/api/share/first-splat` (rolls back `level:crowned`) and
`/api/share/fit` (rolls back `fitcheck:carded:{postId}`). `POST /api/level/create`
additionally sets its *cooldown* claim (`create:cooldown:{username}`) only after
validation passes — an input-validation error (bad title, invalid palette) must never
cost the player their next 30-second publish window, only a real, accepted publish
attempt does.

---

## 6. Best-effort side effects: Reddit writes never fail the game response

Flair sync, duel-comment edits, and creator royalties are all wrapped so a Reddit
hiccup can't turn a successful level completion into an error response:

- `syncUserFlair` / `clearUserFlair` (`src/server/core/flair.ts`) catch everything
  internally and are also **self-throttling** — they read the last-synced
  `text|color` pair off the user hash and skip the `reddit.setUserFlair` call
  entirely when nothing changed, so `/api/complete` can safely call `syncUserFlair`
  on *every* completion without spamming Reddit's flair API.
- `recordDuelResult` / `createDuelComment` (`src/server/core/duel.ts`) never throw —
  a lost comment id just means the scoreboard stops updating, not that the
  completion fails. Duel comment edits are additionally **milestone-gated** (1st/10th/
  25th attempt or matcher, or a new fastest time) so the Reddit edit rate stays far
  under any limit even on a popular level.
- The Fit Check cycle (`runFitCheckCycle`, `src/server/core/fitcheck.ts`) awards
  Sparks and syncs flair *before* attempting the shout-out comment on the new thread —
  if that comment fails, the Sparks the winner already received are not undone; only
  the bonus announcement is missing (logged, not thrown).
- Post creation itself is best-effort in `POST /api/level/create`: if
  `reddit.submitCustomPost` throws, the level is still stored and discoverable via
  `GET /api/levels/community` — it just never gets its own duel post.

The rule of thumb: **anything that touches `reddit.*` for a side effect (flair,
scoreboard, best-effort announcement) is wrapped in try/catch and logs instead of
throwing; anything that's the entire point of the request (posting the Splat Card
itself, publishing the level itself) propagates its failure as a real error status**
so the client can show it and let the player retry.

---

## 7. Idempotent scheduled tasks

Both cron tasks (`daily-puzzle` hourly, `fitcheck-cycle` hourly-on-Thursdays — see
`devvit.json`'s `scheduler` block) are designed to survive being re-fired on a
partial failure:

- **`daily-puzzle`** checks the level store and the Reddit post *separately*
  (`daily:{date}` and `daily-post:{date}` are different keys) — so if the post
  succeeds but a later step throws, the next hourly tick sees the level already
  stored, skips regenerating it, and just retries the post. A whole day is never
  lost to one bad tick.
- **`fitcheck-cycle`** stamps `fitcheck:cycledOn` with today's date only at the very
  end of `runFitCheckCycle` — after the crown, delete, and repost have all
  succeeded. A re-fire on a day that already completed is a fast no-op (single Redis
  read); a re-fire after a mid-cycle failure re-runs the whole cycle, which is safe
  because `postFitCheckThread` always opens a *fresh* thread and the entries hash
  from the (now-deleted) old thread simply isn't consulted again.
- **`on-app-install`** guards its own welcome post the same way: `install:welcomed`
  is checked before `reddit.submitCustomPost` and set right after, so a platform
  retry of the trigger (the post already landed, something later in the handler then
  threw) can't double-post the welcome thread.

The shared idea: **write the durable state (or a "this part is done" marker) as late
as possible, and always check the specific piece you're about to do rather than a
single all-or-nothing flag** — that's what lets "retry the whole handler" be a safe
default reaction to any failure in a serverless environment with no transactions
spanning Redis and the Reddit API.

---

## 8. Reading this codebase's Redis schema

`README.md` §13 is the consolidated key reference; the feature docs
(`docs/reddit-engagement.md`, `docs/user-creation.md`, `docs/retention.md`) explain
*why* each key exists in context. This doc is the one to reach for when the question
is "what Redis pattern should my new endpoint use," not "what does key X hold."

---

## Related docs

- `docs/core-gameplay.md` — the simulation the anti-cheat replay checks run against.
- `docs/user-creation.md` — the fullest worked example of the verification discipline.
- `docs/reddit-engagement.md` — every cooldown/claim key in its product context.
- `README.md` §13 — the full Redis key reference.
