# Reddit Engagement — Five Shareability Gimmicks

Sqlotter already has the hard parts of a community game: verified completions with a
known post context (`context.postId` inside `POST /api/complete`), first-ever-completer
detection (`hSetNX level:first-completer`), UGC levels that publish as real Reddit posts,
a daily scheduler, streak tracking, and a cosmetic Shop. What's missing is the layer that
turns those into **visible, braggable, comment-section moments** — the reason a player's
win shows up in someone else's feed.

The five features below are ranked easiest-first. Each builds on code that exists today,
needs no new game mechanics, and targets the hackathon judging axes (hook, UGC,
retention, community identity).

Devvit surface used: `reddit.submitComment` / `reddit.setUserFlair` from
`@devvit/web/server`, `showShareSheet` from `@devvit/web/client`, the existing scheduler,
and Redis. No new permissions beyond what `devvit.json` already grants for posting.

---

## 1. Splat Card — one-tap Wordle-style result comment ✅ IMPLEMENTED

**The gimmick.** After a win, `LevelComplete` shows a "Drop your Splat Card" button.
One tap posts a short brag comment **on the post the player is already in** — the same
viral loop that made Wordle's grid a cultural artifact, but living natively in the
comment section instead of being pasted there.

```
FLAWLESS SPLAT (⌐■‿■) u/splatfan painted “Goggle Band” move-perfect!
"one splash. one pair of goggles. no regrets."
★★★ · 5/5 moves · 0:12 · 6-day streak
^(Splat Card: that recipe can't be beaten, only matched. Play this post and prove you can.)
```

Two hard voice rules (see `KAOMOJI` in `src/server/core/post.ts`):

1. **Kaomoji, never emojis** — same rule as post titles. The card's voice is
   star-tiered so identical cards aren't wallpaper: `(⌐■‿■)` FLAWLESS on par,
   `ヽ(・∀・)ノ` for a clean solve, `╮(ツ)╭` for a scrappy one. Every kaomoji is
   markdown-safe (no `_` `\` `*` `^` `~`), which is why the classic shrug's exact
   spelling isn't used.
2. **The card never prints the move list.** Even behind a spoiler tag, a recipe
   kills the puzzle for everyone who peeks — the stats line (stars, moves vs par,
   time, streak) is the whole tease. Solutions stay secret, period.

Players can prepend their own 60-char caption line.

**Why it works on Reddit.** Comments are the scoreboard. Every card is social proof that
the game is being played, ranks by upvotes, and bait for "beat you by a move" replies.

**Implementation — shipped.**
- `POST /api/share/card` (`src/server/routes/api.ts`): requires login + `context.postId`,
  re-verifies the submitted `actions` with the same `isValidSolution` replay as
  `/api/complete`, then posts via `reddit.submitComment({ id: postId, text })` **as the
  app account** (no impersonation; the card credits `u/{username}` in the text).
- Anti-spam: one card per level per user (`hSetNX carded:{levelId}`) plus a 20-second
  per-user cooldown (`carded:cooldown:{username}`, 429). A failed Reddit submit rolls
  the `hSetNX` claim back so the player can retry.
- Streak line only appears on daily levels (read from `user:{name} daily:streak`); UGC
  titles are flattened to one line before hitting markdown.
- Client: `Game.handleWin()` passes the action sequence to `LevelComplete`, which shows
  a "Splat Card" pixel button (share icon, entrance pop + gold shimmer). States:
  posting (dimmed) → "Posted!" (check icon, disabled) with sparkle burst and toast;
  401 opens Reddit's login prompt via `showLoginPrompt()`; 409 flips straight to
  "Posted!". Types live in `src/shared/api.ts` (`ShareCardRequest`/`Response`).

---

## 2. First Splat Crown — a claimable image trophy for the first solver ✅ IMPLEMENTED

**The gimmick.** The first person ever to solve a level already earns +30 Sparks — but
nobody can *see* it. Now the moment it happens (daily and UGC levels only), the win
screen takes over with a golden trophy card: Splot — in the player's own Shop
cosmetics, wearing the crown accessory for the occasion — presenting the solved slime,
with the player's name, move count, and time. One tap on **Claim Crown** snapshots the
card in-engine and posts it to the post's comments **as an image**, credited to the
player. No emoji-art — a real rendered PNG of the game's own pixel art.

Dailies get a crown race every morning at cron time; every UGC level gets exactly one.
It's a land-grab: log in early, be immortalized in the thread.

**Why it works on Reddit.** It manufactures a race with a permanent, named trophy in
public view — and an image comment stops the scroll in a way text never does. Racing
the clock for a comment shout-out is peak Reddit behavior (see: every "First!" thread
ever — except here it's earned).

**Implementation — shipped (image edition).**
- `/api/complete` now returns `firstSplat: true` when the player holds the level's
  first-solve record (`level:first-completer`) and the crown is still unclaimed —
  replays keep re-offering until it's actually posted. Daily/UGC only, so 160 curated
  levels can't flood the main post with crowns.
- Client (`LevelComplete`): after the win stats land, a dimmed overlay pops the trophy
  card (pixel panel, gold FIRST SPLAT! heading flanked by trophy icons, crowned
  `SplotMascot`, `SlimeRenderer` of the goal slime, `u/name`, stats, SQLOTTER branding
  strip — the card *is* the shared image, so it's signed). Claim → Phaser
  `renderer.snapshotArea` of the card rect → PNG data URI → `POST /api/share/first-splat`.
  Claim/Later buttons sit below the snapshot rect. Same state machine as the Splat
  Card button (busy → Crowned!/Close, 401 login prompt, 409 treated as claimed).
- `POST /api/share/first-splat` (`src/server/routes/api.ts`): verifies login +
  `context.postId`, that the level is daily/UGC, and that the claimant **is** the
  recorded first completer — the client is never trusted. One crown per level ever
  (`hSetNX level:crowned`) + a 20 s per-user cooldown (separate key from the Splat
  Card's, so card-then-crown seconds apart still works). Validates the PNG data URI
  (base64 PNG signature, ≤1.5 M chars), uploads via `media.upload` (needs
  `permissions.media: true` in `devvit.json` — added), and comments with a richtext
  image + caption. Any image failure degrades to a text-only crown comment; a failed
  comment rolls the claim back so the player can retry.
- Content note: the uploaded pixels are client-rendered, so a modified client could
  submit arbitrary imagery. Gated by the verified first-solver check, one-per-level,
  cooldown, and size/signature validation — the same accepted pattern as Reddit's own
  Devvit showcase apps that post user-generated drawings (e.g. Pixelary), with mod
  removal as the backstop.

---

## 3. Splotter Flair — streak & Sparks tiers as subreddit flair ✅ IMPLEMENTED

**The gimmick.** Your Splot status follows you around the subreddit. After each daily
completion or big Sparks milestone, the app sets the player's user flair:

```
🔥 6 · ⚡ 1,240 · Mega-Blob
```

Tier ladder by lifetime Sparks: **Droplet → Puddle → Blob → Mega-Blob → Royal Slime**
(Royal Slime reserved for Golden Crown owners — suddenly the 25,000-Spark crown in the
Shop buys visible status *outside* the game, which is what cosmetics are actually for).

**Why it works on Reddit.** Flair is Reddit's native identity system. A 🔥 23 next to a
username in an unrelated thread is a permanent ad for the game and a streak the player
will not want to break — retention mechanics disguised as vanity.

**Implementation — shipped.**
- Tier thresholds + flair-text builder live in `src/shared/flair.ts` (`FLAIR_TIERS`,
  `flairTierName`, `buildFlairText`): streak segment only when >1 day, Sparks with
  locale separators, tier name, and an optional `👑 Fit W{n}` badge from Fit Check wins.
  Royal Slime keys off owning `acc-crown` (`ROYAL_TIER_ITEM_ID`), so the Shop's detail
  panel shows "Unlocks the Royal Slime flair!" on the unowned crown.
- `src/server/core/flair.ts` — `syncUserFlair(username)`: reads opt-out, streak,
  lifetime Sparks, crown ownership, and fit-crown week from the user hash in one
  `hMGet`, builds the text, and **skips the Reddit call when it matches `flair:last`**
  — self-throttling, so `/api/complete` can await it on every win without spamming
  `reddit.setUserFlair`. Tier ranks on *lifetime* Sparks (`sparks:lifetime`, never
  reduced by Shop purchases; falls back to `max(lifetime, balance)` for accounts that
  predate the field). Everything is try/catch — flair can never fail a game response.
- Opt-out: `flair:optOut` in the user hash, exposed as `flairEnabled` on
  `/api/init` + `/api/user/profile`, toggled via `POST /api/user/flair` (disable also
  clears the current flair). Client control: a settings gear on the MainMenu title bar
  (logged-in players only) opens a popup with the Flair ON/OFF toggle.
- Sync points: every `/api/complete`, buying the Golden Crown (`/api/user/buy`),
  re-enabling via the toggle, and the Fit Check award task.

---

## 4. Beat the Creator — UGC posts as public duels ✅ IMPLEMENTED

**The gimmick.** Reframe every user-created level from "here's my level" into a
challenge with a scoreboard. The auto-generated post title becomes
**"u/maker built this slime in 4 moves. Beat that."**, and the app maintains one
pinned comment on the post:

> (ง•̀ω•́)ง **The Duel so far:** 38 challengers · 12 matched u/maker's 4 moves · fastest
> splat: u/quickdraw (0:09). Splot believes in you.

While nobody has matched the creator, the comment bolds the tension instead
(**nobody** has matched it yet — "The record stands"), and a fresh post opens with
**THE DUEL IS OPEN** and a first-name-on-the-scoreboard dare.

The creator gets a notification-worthy moment every time their level hits a milestone
(first challenger, 10 matchers, someone faster) — which is the real UGC retention hook:
creators come back to check on their levels like they check post karma.

**Why it works on Reddit.** It converts a static UGC post into a live thread with a
reason to return, and flatters both sides of the duel. This is the strongest play for
the "Best Use of User Contributions" prize.

**Implementation — shipped.**
- `src/server/core/duel.ts`: `createDuelComment` posts the scoreboard comment right
  after `submitCustomPost()` in `/api/level/create` (tries to pin it via
  `distinguish(true)`), storing its id at `duel:{levelId}` with a 90-day TTL matching
  the level's own retention. The post title is now the challenge format:
  `u/{maker} built "{title}" in {n} moves — beat that.`
- `recordDuelResult` runs on every UGC completion in `/api/complete`: bumps
  `duel:{levelId}:stats` (attempts / matched / bestTimeMs+bestTimeUser in one hash) and
  edits the comment **only on milestones** — 1st/10th/25th attempt, 1st/10th/25th
  matcher, or a new fastest time — so Reddit writes stay far under any rate limit.
  Both helpers never throw; a lost comment id just means the stats keep counting.
- Comment ids round-trip through Redis as plain strings; `src/server/core/tid.ts`
  provides structural `t1_`/`t3_` type guards (`isCommentId`/`isPostId`) so they narrow
  back to Devvit's template-literal id types without casts.

---

## 5. Fit Check Friday — weekly Splot fashion thread ✅ IMPLEMENTED

**The gimmick.** The Shop already lets players dress Splot (colors, eyes, brows, hats,
crowns) — but only the owner ever sees it. Every Friday the scheduler posts a **Fit
Check** thread, and a "Show off my Splot" button (in the Shop / main menu) posts the
player's current fit as a comment, e.g.:

> **u/fitfan's Splot walked in wearing:** Rainbow body · Cute Eyes · Kiss Mouth · Party Hat (⌐■‿■)
> *(Mega-Blob · 347 levels solved · 12-day streak — upvote the drip.)*

The stats footer leads with the player's flair tier — the fit thread is where the
Sparks economy gets to be socially visible.

Highest-upvoted fit at Sunday midnight wins +500 Sparks and a special flair
(`👑 Fit King/Queen of Week 27`), awarded by a second scheduled task.

**Why it works on Reddit.** It's a recurring community ritual (the retention judges'
favorite phrase), it makes the Sparks economy socially visible — people buy cosmetics
to *show them off*, closing the loop from puzzle → Sparks → Shop → post — and upvote
voting means the community runs the contest itself.

**Implementation — shipped.**
- Two scheduler tasks in `devvit.json` → `src/server/routes/scheduler.ts`:
  `fitcheck-post` (`0 15 * * 5`) submits the ISO-week-labelled thread and stores
  `fitcheck:current`/`fitcheck:week` (idempotent per week if the cron re-fires);
  `fitcheck-award` (`0 0 * * 1`, Sunday midnight UTC) **deletes `fitcheck:current`
  first** (a retry can't double-award), then scans the thread's top-sorted comments for
  the highest-voted *registered* entry, grants +500 Sparks (balance, leaderboard, and
  lifetime), stamps `fitcheck:won` for the `👑 Fit W{n}` flair badge, syncs flair, and
  replies a crowning shout-out on the winning comment.
- `POST /api/share/fit`: no request body — the loadout is read straight from the user
  hash and formatted via the Shop catalog ("Rainbow body · Cute Eyes · Kiss Mouth ·
  Party Hat"), with the levels-solved/streak footer line. 404 when no thread is live,
  one entry per user per thread (`hSetNX fitcheck:carded:{postId}`), 20 s cooldown,
  rollback on a failed submit. Fit comments are posted by the app account, so the
  award task can't use comment authors — the endpoint records
  `fitcheck:comments:{postId}` (commentId → username, 30-day TTL) as the entry
  registry the award scan matches against.
- Client: a "Fit Check" button under the Splot preview in the Shop (both orientations)
  opens a confirm popup, then POSTs; per-status toasts for posted / not-logged-in
  (`showLoginPrompt`) / no-thread-live / already-entered / cooldown.
- Later polish (not required to ship): render a real PNG of the mascot via Phaser
  `snapshot` and `showShareSheet` for off-Reddit sharing.

---

## Suggested build order

| # | Feature | Effort | Prize axis | New endpoints |
|---|---------|--------|-----------|----------------|
| 2 | First Splat Crown ✅ | shipped | Hook, community | `POST /api/share/first-splat` |
| 1 | Splat Card ✅ | shipped | Hook, virality | `POST /api/share/card` |
| 3 | Splotter Flair ✅ | shipped | Retention, identity | `POST /api/user/flair` (+ extends `/api/complete`) |
| 4 | Beat the Creator ✅ | shipped | User contributions | none (extends create/complete) |
| 5 | Fit Check Friday ✅ | shipped | Retention, economy | `POST /api/share/fit` + 2 scheduler tasks |

All five are live. They share the same plumbing (a comment/flair call inside the
completion path), are demoable in a single judging session, and every one of them puts
the game's name in a comment section where non-players will see it.

**Shared guardrails for all five:** every Reddit write is best-effort (`try/catch`,
never fail the game response over a comment), once-per-user-per-context (Redis `hSetNX`
guards), and behind a player-visible action or a milestone — the app should feel like a
hype-man in the thread, never a spam bot.

**Post titles** (`src/server/core/post.ts`): titles are the only surface non-players
ever see in their feed, so none of them are announcements — and **no title or comment
ever carries an emoji** (kaomoji/text glyphs only; `cleanPostTitle` scrubs user text).
The pinned game post dares ("Sqlotter — paint the slime, mind the goggles, beat the
par"), dailies stay minimal ("Sqlot 2026-07-09: The Grumpy Goggle Job"), and UGC posts
open the duel ("u/maker built “…” in 4 moves. Beat that."). The First Splat crown
comment likewise cites the verified first-solve stats ("5 moves, 0:42, before anyone
else on Reddit") from `level:first-stats`, written by `/api/complete`.
