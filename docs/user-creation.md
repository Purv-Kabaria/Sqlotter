# User Creation — the Editor, publishing, and Beat the Creator

Sqlotter's user-generated content is not a level *importer* bolted onto a fixed game.
It is the **same toybox the campaign is built from**, handed to the player. Every rule,
every stencil, every colour the curated levels use is available in the Editor, the
creator literally *plays* their level to author it, and the moment they publish it
becomes a real Reddit post with a live scoreboard. This doc traces that pipeline end to
end: authoring (`src/client/scenes/Editor.ts`), validation + storage
(`POST /api/level/create`), discovery (`GET /api/levels/community`), and the
**Beat the Creator** duel that turns every published level into a recurring contest
(`src/server/core/duel.ts`).

---

## 1. The design principle: the goal IS the solution

The whole system rests on one idea from the core game (see `docs/core-gameplay.md`): a
level has **no stored goal state**. The goal pattern is what you get by *replaying* the
author's recorded action list over the level's palette.

```
LevelData.optimalSolution  replayed over  LevelData.palette  ==  the goal pattern
```

This is why creation can be "just play the level." There is no separate paint-the-goal
mode, no pixel editor, no way to author a goal that isn't reachable. The creator taps
paints and stencils exactly as a player would; the recorded sequence is *simultaneously*
the solution, the par, and the goal image. An unsolvable level is structurally
impossible to make — the thing you built is, by construction, the proof it can be
solved.

That single decision is what makes the UGC trustworthy enough to publish automatically
without moderation: the server can independently replay the recording and reject
anything that doesn't hold up (`verifyLevelIntegrity`, `isValidSolution`).

---

## 2. Authoring — `Editor.ts`

### The palette: the full catalog, no training wheels

The Editor exposes **every** modifier the simulation understands — not a curated subset
(`EDITOR_DEFS = [...PAINT_COLORS, ...ALL_MODS]`, Editor.ts:60):

- The canonical **16-colour paint rack** (`standardPaints()` from `slimeSim.ts`), opened
  from a single paint-pot tile so published palettes reference the exact same colour ids
  the campaign uses.
- Every **stencil**: goggles / glasses / belts / pendants in both orientations and both
  thicknesses, monocle goggle variants, plate, cone, scarf, underwear, and all three
  **pumpkin** sizes (opened from one grouped pumpkin tile).
- The three **special mechanics**: the growing **nose**, the reusable **bubble** dip,
  and the one-shot **alpha dip**.

Grouping the paint rack and pumpkin sizes behind single tiles (`GRID_SLOTS`,
Editor.ts:67) is what lets the entire catalog fit on a phone without micro-tiles — the
same grouping the in-game palette uses, so the Editor feels like the game.

### Recording = playing

`applyGoalMod` (Editor.ts:836) is the heart of the Editor, and it deliberately enforces
**every gameplay rule while recording**, because a recording that the sim would refuse
at play time is not a valid solution:

- **The move cap** (`MAX_SOLUTION_STEPS = 60`) — enforced here first, so a level ships
  with a proof it's beatable within the cap.
- **One-time goggles** — a splash that lands on worn goggles breaks them; tapping a
  broken goggle is refused (`before.broken.includes(mod.id)`), just like in play.
- **One alpha dip per level** (`before.spent.includes(mod.id)`).
- **Wear-stacking** (`MAX_WORN = 3`) — a wear that would exceed the limit is refused;
  swapping one pumpkin size for another is a single action, not a stack
  (`isPumpkinSwap`), matching the sim exactly.

Each accepted tap re-renders the live goal preview (`SlimeRenderer.setPattern`), plays
the **same action→sound mapping the Game scene uses** (splash / dip / bubble / pumpkin /
wear / remove), and pops a one-line teaching message ("Goggles on. Breaks off after one
splash!"). The creator isn't filling in a form — they're playing, and the recording
falls out of the play.

`undo()` pops the last action; `reset()` clears the recording; a live **Steps / Diff**
pill (`updateMeta`, difficulty derived from step count via `computeDifficulty`) shows
where the level sits as it grows.

### Decoys — hiding the recipe

A palette that contained *only* the items the solution uses would spell out the answer.
The creator picks a **decoy count (0–3)** with a cycling button (`buildDecoyButton`,
Editor.ts:512). At publish time `buildPalette()` (Editor.ts:1041):

1. takes every distinct def the recording actually used,
2. pads it with up to *N* random unused stencils from `ALL_MODS`, and
3. **shuffles the whole palette** so its order never leaks the solution order.

So a 5-move solution can ship in a palette of 8 tiles, three of them red herrings, in
scrambled order — the player has to *think*, not read.

### Test Play — a real round-trip that never loses work

`testPlay()` (Editor.ts:953) validates the recording, then builds a real `LevelData`
with the id `__preview__` and launches the **Game scene in preview mode** — the creator
plays their own level for real, with no scoring or Reddit writes. Crucially, the whole
draft (title, hint, actions, decoy count) rides along as an `EditorDraft`, so returning
from the preview (whether they win or just tap back) restores the editor to *exactly*
the recording they left. Phaser re-delivers the last scene data on a bare restart, so
`init()` consumes the draft exactly once (`this.sys.settings.data = {}`, Editor.ts:217)
— a later fresh open starts clean instead of resurrecting a stale draft.

### Validation before you can publish

`validateRecording()` (Editor.ts:944) gates both Test Play and Publish on three rules
that make a *goal* well-formed:

- at least one action recorded,
- at least one **splash of paint** (a goal is a painted pattern), and
- **nothing still worn** at the end — goals are bare slimes, because a level can't be
  won with stencils on.

The DOM `<input>` overlays for title and hint (`createOverlayInput`) are positioned over
the canvas and re-mapped on every resize, so the mobile keyboard works natively.

---

## 3. Publishing — `POST /api/level/create`

The client sends the title, difficulty, palette, `optimalSteps`, the recorded `solution`,
and optional hint (Editor.ts:997). The server (`api.ts:1208`) treats the client as
**untrusted** and re-derives everything it can:

### Server-side validation (never trust the client)

- login required (401 for guests),
- title 1–60 chars; difficulty 1–5,
- palette 1–20 modifiers, each structurally valid (`isValidModifier`), **ids unique**,
- solution 1–`MAX_SOLUTION_STEPS` moves with `optimalSteps === solution.length`,
- hint ≤ 160 chars, and then the decisive check:

```ts
if (!verifyLevelIntegrity(candidate) || !isValidSolution(candidate, solution)) reject(400)
```

`verifyLevelIntegrity` (gameRules.ts:80) replays the solution over the palette and
requires that it **resolves cleanly, ends with nothing worn, and actually painted
something**. `isValidSolution` confirms the recording reproduces its own goal. The server
runs the *identical* simulation the client does (`src/shared/slimeSim.ts`, driven by
baked mask bitmaps in `maskData.ts`), so "it worked in the Editor" and "it validates on
the server" are guaranteed to agree. This is what lets publishing be **instant and
unmoderated** without letting a broken or unsolvable level through.

### Every level needs a real, unique name

The title field has no default — the Editor ships with `titleValue = ''`, and
`validateRecording()` refuses both Test Play and Publish with "Give your level a
name!" until the creator types something (Editor.ts:966). Server-side, the title is
re-checked (1–60 chars) and then checked for uniqueness **against that creator's own
other levels only** — a level's name only has to be distinct from the same author's
back catalog, not the whole subreddit's:

```ts
const namesKey = `creator-titles:${username}`;
const titleKey = title.trim().toLowerCase().replace(/\s+/g, ' ');   // case/space-folded
if (await redis.hSetNX(namesKey, titleKey, 'pending') !== 1) {
  return reject(409, 'You already have a level with that name — pick a different one');
}
```

`hSetNX` makes the claim atomic (two simultaneous publishes of the same title from
the same account can't both succeed), and folding case + collapsing whitespace before
hashing means `"My Level"` and `"my  level"` collide as the same name. The claim is
written as a placeholder (`'pending'`) *before* the level id exists, then overwritten
with the real `levelId` once it's minted — see `docs/server-architecture.md` §4 for
why level ownership uses this two-shape pattern (an atomic per-key claim plus a
separate enumerable record) rather than one.

### Publish cooldown — retries can't double-post

`POST /api/level/create` also guards a 30-second per-user cooldown
(`create:cooldown:{username}`), checked *before* any validation runs and set *after*
validation passes — an input-validation error (bad title, invalid palette) never
costs the player their publish window, only an accepted, real publish attempt does.
This exists because the client's own publish request has a 15-second abort timeout
(Editor.ts:1032): a request that's slow but eventually succeeds server-side, followed
by the player retrying after their client gave up, must not mint a second Reddit post
and a second duel comment for what is really one level. Both the title-uniqueness
rejection (409) and the cooldown rejection (429) surface to the player as the plain
error message from the response body (`showFeedback`, Editor.ts:1048) — there's no
special-cased UI for either, just the generic "publish failed, here's why" toast.

### Storage + indexing

- `level:{ugc-<user>-<timestamp>}` → the `LevelData` JSON, with a **90-day TTL** (UGC is
  ephemeral by design; the campaign is permanent).
- The creator's `created` list on their user hash (capped at 50, newest kept).
- `ugc:index` (ZSET by creation time) — the community feed.
- `ugc:titles` (HASH, `levelId → "title␁author"`) — a **search registry** so any
  title/author search is answered by one `hGetAll` instead of fetching hundreds of level
  JSONs. The index self-trims to 500 entries and drops TTL-expired levels lazily on read.

### The level becomes a Reddit post — a *challenge*

On success the server calls `reddit.submitCustomPost` with a title that is a **dare, not
an announcement** (api.ts:1299):

> *u/alice built "The Grumpy Goggle Job" in 5 moves. Beat that.*

The title goes through `cleanPostTitle` (the hard no-emoji rule; the level title is user
text). The post carries `postData: { levelId }` so opening it deep-links straight into
the level. Post creation is best-effort: if Reddit is unavailable, the level still lives
in community discovery — it just doesn't get its own post.

---

## 4. Beat the Creator — every level is a recurring contest

A published level isn't a one-shot; it's an open duel. `createDuelComment`
(`duel.ts:50`) drops one **app-maintained scoreboard comment** on the new post and pins
it (`comment.distinguish(true)` when the app has the rights). Its id lives at
`duel:{levelId}`, its running counters at `duel:{levelId}:stats`, both on the same 90-day
TTL as the level — the whole duel expires as a unit.

The scoreboard speaks in the game's **kaomoji voice** (no emojis, per the product rule)
and escalates:

- **Nobody's answered yet:** *"THE DUEL IS OPEN. u/alice painted this slime in 5 moves
  and left it here as a dare. Be the first challenger…"*
- **Challengers, none matched:** *"5 challengers · **nobody** has matched u/alice's 5
  moves yet · fastest splat: u/bob (0:42). The record stands."*
- **Once matched:** the tension line resolves, and the fastest-splat line keeps updating.

### Milestone-gated updates (respecting Reddit's write budget)

`recordDuelResult` (`duel.ts:71`) runs inside `POST /api/complete` for every UGC clear,
but only **re-edits the comment on milestones** — first challenger, attempt counts of 10
/ 25, matcher milestones of 1 / 10 / 25, or a **new fastest time**. Milestone gating
keeps the Reddit edit rate far below any limit while still producing
notification-worthy moments for the creator ("your level just got its first match").
The creator's own replay is excluded — they can't be challenger #1 on their own board
(`level.authorName === username` early-returns), and duel bookkeeping never throws, so it
can't fail a completion.

### Creator royalties — contribution pays

Community authorship is rewarded on an ongoing basis. Every **10th distinct player** to
clear a community level earns its creator **+5 passive Sparks** and refreshes their flair
(api.ts:463). Counting *first completions only* means nobody can farm it by replaying,
and the creator's own clear contributes at most one play. A popular level becomes a
slow Sparks fountain for whoever made it — the retention loop closes back onto the person
who fed the community (see `docs/retention.md`).

---

## 5. Discovery — the Finder

`GET /api/levels/community` (api.ts:1321) serves the newest-first community feed with an
optional `?q=` search. Search is a case-insensitive substring match on **title OR
creator name**, answered from the `ugc:titles` registry in a single `hGetAll`, so typing
in the finder never fans out into hundreds of level reads. Levels that hit their TTL are
dropped from both indexes lazily as they're encountered, keeping the feed clean without a
sweeper job. On the client the Finder page of `LevelSelect` searches this endpoint live
(DOM search box over the canvas), so a player can hunt for a specific creator or theme.

---

## 6. The whole pipeline at a glance

```
Editor (play your level)
  │  applyGoalMod enforces every sim rule while recording
  │  buildPalette adds decoys + shuffles
  ▼
POST /api/level/create
  │  re-validate (verifyLevelIntegrity + isValidSolution) — untrusted client
  │  store level:{id} (90d TTL) · ugc:index · ugc:titles · user.created
  ▼
reddit.submitCustomPost  ("… Beat that.")   +   createDuelComment (pinned scoreboard)
  ▼
Other players open the post → Game → POST /api/complete
  │  recordDuelResult  → milestone-gated scoreboard edits
  │  every 10th distinct solver → creator +5 Sparks + flair refresh
  ▼
GET /api/levels/community?q=  → Finder discovery
```

Every arrow is real, verified, and already shipped. The player doesn't just *consume* a
daily puzzle — they can **manufacture** puzzles that become Reddit posts, accrue a public
duel record, and pay them Sparks as the community plays them. That is the "Best Use of
User Contributions" story: contribution is a first-class, self-verifying, self-rewarding
loop, not a submission box.

---

## Related docs

- `docs/core-gameplay.md` — the simulation the Editor records against.
- `docs/slime-rendering.md` — how the live goal preview is composited.
- `docs/reddit-engagement.md` — Beat the Creator alongside the other shareability hooks.
- `docs/retention.md` — how creator royalties and duels feed the return loop.
