# Retention Mechanics

Every feature in Sqlotter is built to answer one question from `CLAUDE.md`: *"Does this
give players a reason to come back tomorrow?"* This doc maps the retention system — the
loops that pull a player back the next day, the next Friday, and after every single solve
— to the code that implements them. The through-line is a **single currency, Sparks,
that ties time-pressure, cosmetics, streaks, leaderboards, and community identity into
one economy** where every action feeds the next.

The authoritative sources are `src/shared/gameRules.ts` (scoring), `src/shared/shop.ts`
(sinks), `src/shared/flair.ts` (identity), and the award logic in `POST /api/complete`
(`src/server/routes/api.ts`).

---

## 1. The core economy: Stars pay for moves, Sparks pay for time

The two currencies are deliberately split so a level rewards two *different* skills, and
a player has two reasons to replay it.

**Stars — the move currency.** The HUD never shows bare par. Every level advertises a
move **limit** of `par + buffer`, where `buffer = max(2, ceil(par/2))` (par 5 → limit 8;
`moveLimit`, gameRules.ts:29). Finish within it → 3 stars. Each further buffer-width tier
crossed raises the shown limit and costs a star, down to 0 — but the level still
completes (`calcStars`, gameRules.ts:42). The HUD grows the shown limit live as tiers are
crossed (`currentMoveTier`), so the pressure is visible without ever exposing the raw par.

**Sparks — the time currency, server-authoritative.** On a **first** clear
(`/api/complete`), Sparks are minted as:

| Component | Sparks | Code |
|-----------|-------:|------|
| Base clear | 10 | `10` |
| Speed bonus (full ~under 30 s → 0 by 5 min) | up to +15 | `timeSparksBonus(timeMs)` |
| Under the move limit (3 stars) | +10 | `stars === 3` |
| Matched par (or better) | +10 | `steps <= optimalSteps` |
| Daily puzzle | +15 | `level.isDaily` |
| First to ever solve the level | +30 | `isFirstOverall` |

`timeSparksBonus` (gameRules.ts:69) is `clamp(ceil(15·(1 − t/300000)), 0, 15)` — a smooth
linear melt from full to nothing across five minutes. Because the split exists, a player
who three-stars a level can *still* come back to beat their **time** for more Sparks, and
a player who solved it slowly can come back to beat their **move count** for the star.
One puzzle, two ladders, two return hooks.

Crucially, **Sparks are the hub**: they're earned by playing, spent in the Shop, ranked
on a leaderboard, and — as *lifetime* Sparks — drive the flair tier ladder. Every other
mechanic below plugs into this one number.

---

## 2. The daily loop — streaks

The daily **Sqlot** (`docs/reddit-engagement.md`, `CLAUDE.md` Daily Sqlot System) is the
primary "come back tomorrow" engine. An hourly, idempotent cron posts one fresh puzzle
right after UTC midnight; a uniqueness walk guarantees it's never a re-skin of a campaign
level or an earlier daily.

The retention teeth are in the **streak** (`/api/complete`, api.ts:371):

- On a first daily clear, if the player's `daily:lastDate` is exactly yesterday, the
  streak increments; otherwise it resets to 1.
- Dates are `YYYY-MM-DD`, so a lexical compare is chronological.
- **Back-fill protection:** solving an *older* daily late (a past post played now) does
  **not** reset the streak or rewind `daily:lastDate` — catching up on a missed puzzle can
  never silently break an active run.

A streak is worth protecting precisely because it's fragile-by-one-day but safe against
accidents — the ideal shape for a habit loop. The current streak is broadcast on the
player's flair (`🔥 N`, §5), so the whole subreddit sees who's on a run.

---

## 3. The spend loop — the Shop as a Sparks sink

Earning without spending is a leaky bucket. The Shop (`src/shared/shop.ts` is
authoritative) is the sink that gives Sparks meaning:

- **24 solid Splot colours** on an exponential price ladder (1,000 – 14,000) plus **5
  rare finale effects** (gradient / sparkle / rainbow / opal / golden, 16,000 – 25,000).
- Eyes, mouths, eyebrows, accessories (cap, party hat, horns, top hat), and the
  **Golden Crown** (25,000) which also unlocks the **Royal Slime** flair tier.

Pricing is **server-enforced** (`POST /api/user/buy` re-prices from the catalog; the
client never dictates cost). The exponential ladder means the top cosmetics are
**long-horizon goals** — a rainbow Splot is weeks of dailies away — which is exactly what
sustains retention past the first session. And because the Shop feeds directly into the
next loop (showing the cosmetic off), spending isn't a dead end.

---

## 4. The show-off loop — Fit Check Friday

Cosmetics only retain if other people see them. **Fit Check Friday**
(`docs/reddit-engagement.md` §5, `src/server/core/fitcheck.ts`) closes the loop:
puzzle → Sparks → Shop → **post it** → community votes → Sparks.

- There is always **one live Fit Check thread**, and it **turns over every Thursday**.
  Opening it drops the player straight into the dressing room (Shop), where a Fit Check
  button posts their Splot as an **image** comment (the actual rendered mascot) with an
  optional caption and photo URL for memeability.
- Every Thursday a single idempotent cron crowns the **top-upvoted** fit (+500 Sparks and
  the `👑 Fit W{n}` flair badge), deletes the old thread, and posts a fresh one —
  announcing the champ on it. The community runs the contest; the app just reads the
  upvotes.

This is a **weekly** return hook layered on top of the daily one, and it makes the entire
Sparks→Shop economy socially visible: people buy cosmetics *to show them off*, which sends
them back to earn more Sparks to buy more.

---

## 5. The identity loop — Splotter Flair

`src/shared/flair.ts` renders the player's status as **subreddit user flair**, synced on
every completion by `syncUserFlair` (`src/server/core/flair.ts`):

```
🔥 12 · Mega-Blob · 👑 Fit W27
```

- **Streak** (`🔥 N`) — the daily loop, made public.
- **Tier** — Droplet → Puddle → Blob → Mega-Blob by **lifetime** Sparks (never reduced by
  purchases), plus **Royal Slime** for Golden Crown owners. Lifetime-Sparks-based, so the
  ladder measures *total contribution*, not current wallet.
- **Fit crown** (`👑 Fit W{n}`) — the weekly winner's badge.
- The flair pill's **background is the player's own equipped Splot colour**, so their rank
  literally wears their cosmetics.

`syncUserFlair` is **self-throttling** (it only calls Reddit when the text or colour
actually changed, tracked on the user hash) and **best-effort** (never fails a game
request), so it can run on every single completion without spamming Reddit. Flair turns
every play session into visible, persistent identity in the feed — the strongest
long-term retention primitive Reddit offers, because your standing follows your username
everywhere in the subreddit.

---

## 6. The competition loop — global leaderboards

Three purely global boards (`GET /api/leaderboard/global?type=`):

- **`lb:global:sparks`** — lifetime Sparks earned.
- **`lb:global:moves`** — cumulative moves (efficiency).
- **`lb:global:played`** — total completions (volume).

All three store **negated** scores so a plain ascending `zRange` yields "highest first,
A–Z on ties" in one call (un-negated on read). Sparks are `zAdd`'d on every award, moves
and plays `zIncrBy`'d per completion. Three axes means three kinds of player — the
grinder, the optimizer, the collector — each have a board they can top, which is more
retentive than a single ranking that only the top 1% can move.

---

## 7. The never-lose-progress loop — persistent attempts

Friction kills return visits, so an in-progress attempt is **never** lost. Leaving a
level mid-solve saves the live action log **and** banked time to both the session store
and `wip:{levelId}` on the user hash (`POST /api/progress`), restored on re-entry
(`GET /api/progress/:levelId`) and cleared on completion (`CLAUDE.md`, api.ts). A player
interrupted mid-puzzle comes back to *exactly* where they were — including the clock — so
"I'll finish it later" actually works. Guided lessons and editor previews stay ephemeral
on purpose.

There are **no dead ends** by design: every screen has a reset, no "you're stuck" state
exists, and a 0-star finish still completes and still pays base Sparks. A player is never
punished into quitting.

---

## 8. The one-time-glory loops — First Splat Crown & Splat Cards

Two sharing hooks convert single solves into feed presence and social pressure
(`docs/reddit-engagement.md`):

- **First Splat Crown** — the first-ever solver of a **daily** level can claim a one-time
  **image trophy** comment (the rendered Splot wearing a crown), verified against the
  `level:first-completer` record. Being first is worth +30 Sparks *and* a permanent
  bragging artifact, so racing to the daily early is its own reward.
- **Splat Card** — any solve can be shared as a rendered brag card comment (stats only,
  **never** the move list — a leaked recipe kills the puzzle). Each card is a fresh
  Reddit impression that pulls *other* players into the post.

Both post as **images** through `media.upload` (an image stops the scroll where text
never does), are strictly user-triggered, one-per-level, and always posted by the app
account crediting the player.

---

## 9. The come-back-and-it-paid-you loop — creator royalties

For creators, retention is passive: every **10th distinct player** to clear a community
level earns its author **+5 Sparks** and a flair refresh (api.ts:463; see
`docs/user-creation.md`). A creator has a standing reason to return — their levels are
quietly minting Sparks while they're away, and a popular level is a slow fountain. Paired
with the **Beat the Creator** duel scoreboard (which notifies on milestones), a single
published level keeps pulling its author back for days.

---

## 10. How the loops interlock

```
                 ┌──────────────────── DAILY (streak, +15) ───────────┐
                 ▼                                                     │
   play a level ──▶ Sparks ──▶ Shop cosmetics ──▶ Fit Check Friday ───┤
        │            │  ▲            │                  (+500 weekly)  │
        │            │  │            ▼                                 │
        │            │  └──── creator royalties            Splotter Flair (identity)
        │            │        (published levels pay you)    🔥 streak · tier · 👑
        │            ▼                                                 │
        │      global boards (sparks / moves / played)                │
        ▼                                                             ▼
   First Splat Crown + Splat Card  ──▶ new Reddit impressions ──▶ pull players back
```

No loop is a dead end: **Sparks earned** flow into **cosmetics**, which flow into
**Fit Check** and **flair**, which flow into **more play**; **creating** levels pays
**Sparks** and builds a **duel record**; **being first / fast / efficient** each has its
own reward and its own board. Daily brings you back tomorrow, Fit Check brings you back
Friday, streaks make the gap costly, flair makes your return *visible*, and persistent
attempts make sure the return is frictionless.

That interlock — one currency, many loops, every loop feeding the next, all of it visible
in the Reddit feed — is the "Best Use of Retention Mechanics" story.

---

## Related docs

- `docs/reddit-engagement.md` — Fit Check, First Splat, Splat Cards, flair, duels in depth.
- `docs/user-creation.md` — creator royalties and the Beat the Creator duel.
- `docs/core-gameplay.md` — the move-limit / stars scoring the economy sits on.
- `CLAUDE.md` — the Sparks economy and Daily Sqlot tables (authoritative numbers).
