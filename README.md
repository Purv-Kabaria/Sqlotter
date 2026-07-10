# Sqlotter — The Slime Stencil-Painting Puzzle

> A Factory-Balls-style puzzle game that lives in Reddit's feed, built on Devvit Web.
> Every level shows a **goal pattern** — a bare slime painted in zones of color — and
> you reproduce it by wearing accessories as **paint stencils** in the right order.
> Solve the campaign, race the community on the daily **Sqlot**, build your own levels,
> and dress up Splot, the resident mascot.

**Elevator pitch:** "Wordle's daily ritual meets Factory Balls' paint-and-mask logic,
running natively inside Reddit posts."

---

## Table of Contents

1. [How to Play](#1-how-to-play)
2. [The Simulation](#2-the-simulation)
3. [Modifier Catalog](#3-modifier-catalog)
4. [Level Sources](#4-level-sources)
5. [The Daily Sqlot](#5-the-daily-sqlot)
6. [Community Levels](#6-community-levels)
7. [Reddit Engagement Features](#7-reddit-engagement-features)
8. [Sparks, Stars & the Shop](#8-sparks-stars--the-shop)
9. [Leaderboards](#9-leaderboards)
10. [Screens & Navigation](#10-screens--navigation)
11. [Technical Architecture](#11-technical-architecture)
12. [API Reference](#12-api-reference)
13. [Redis Schema](#13-redis-schema)
14. [Development](#14-development)
15. [Deployment](#15-deployment)
16. [Hackathon Context](#16-hackathon-context)
17. [Further Docs](#17-further-docs)

---

## 1. How to Play

Each level gives you:

| Element | Description |
|---------|-------------|
| **Goal pattern** | A BARE slime painted in zones of color — never shown wearing anything |
| **Your slime** | Starts bare and white |
| **Palette** | The level's tools: paint pots and wearable stencils (plus the always-available standards) |
| **Par** | The level's optimal step count — the 3-star target |

Two kinds of taps:

- **Paint** splashes a color over every part of the slime that isn't protected.
- **Stencils** (goggles, glasses, belts, pendants, pumpkins, underwear, plate, cone,
  scarf, nose) are worn ON the slime and protect whatever they cover from paint.
  Tapping a worn stencil takes it off again.

Every logged tap — wearing, removing, painting, even **Reset** — costs one step, and
**order is the whole puzzle**: which stencils are on when each coat lands decides the
pattern. You win the moment your painted pattern matches the goal **and nothing is
worn** (goals are bare, so everything must come off).

The canonical 5-step example:

```
pumpkin-25 on → paint green → goggles on → paint red → pumpkin-25 off
```

Result: a white cap (pumpkin-protected the whole time), a green goggle-shaped band
across the eyes (protected during the red coat), red everywhere else. The goggles cost
nothing to remove — the red splash snapped them off by itself, because…

**Goggles are one-time use.** Any splash that lands on worn goggles knocks them off
*broken* (automatic, free, not logged). Broken goggles refuse to be worn again until a
reset. Glasses cover nearly the same bands but survive splashes — the goggle economy
(which single splash each pair is spent on) is the game's signature twist.

There are no dead ends: everything is removable, Reset is always available (it costs a
step and restores broken goggles), and every level ships with a provably valid solution.

---

## 2. The Simulation

The whole game runs on one shared, dependency-free simulation —
`src/shared/slimeSim.ts` — imported by the client (to play), the server (to verify),
and the renderer (to draw). The rules can never fork.

The slime is a **64×64 cell grid**. `BODY_MASK` marks body cells and
`MASK_BITMAPS[maskId]` marks each stencil's coverage — both baked from the real PNG
alpha channels (threshold ≥ 100) by `scripts/generate_masks.py` into
`src/shared/maskData.ts`, so sim geometry and on-screen art agree by construction.

```typescript
type SimState = {
  grid:   Uint8Array;  // per-cell index into colors
  alpha:  Uint8Array;  // per-cell opacity: opaque | dipped (75%)
  colors: string[];    // colors[0] = '#FFFFFF' (unpainted)
  worn:   string[];    // mask ids currently worn, in wear order
  broken: string[];    // goggles broken this run (a splash landed on them)
  spent:  string[];    // one-shot action ids used this run (alpha dip)
};
```

Action rules (`applySimAction`):

| Action | Effect | Step |
|--------|--------|------|
| paint | every exposed body cell ← this color at full opacity; then splash side effects | 1 |
| alpha dip | every exposed cell → 75% opacity ("dipped"); splash side effects; **one dip per run** — a second tap is refused | 1 |
| bubble | dips only exposed cells inside the bubble's inner circle; **reusable**, and gentle (no splash side effects) | 1 |
| stencil, not worn | put it on (max 3 worn at once; one pumpkin at a time) | 1 |
| stencil, worn | take it off | 1 |
| nose tap | wear it small / take it off (whatever size it grew to) | 1 |
| reset | clear everything (grid, worn, broken, spent) — clock and step count keep running | 1 |
| refused tap | broken goggles, spent dip, or a wear the stacking rules forbid — not logged; replays containing one are invalid | 0 |

**Splash side effects** (color paint and alpha dip, not the bubble): every worn pair of
goggles snaps off into `broken`, and a worn nose grows one size — small → medium → big,
and a splash on a big nose knocks it off (re-wearable small again).

Dipping is idempotent (dipped stays 75%, never compounds), and a fresh color splash
makes a cell opaque again. A dipped cell displays its color composited at 75% over
white, so a dip on unpainted white is still white.

**Win check** (`isCleanMatch`): every body cell displays the same effective color
(hue + dip state) as the goal replay, and `worn` is empty.

**The goal IS a replay.** `LevelData` stores no goal state — `optimalSolution` (an
action-id list) replayed over the level's palette *produces* the goal pattern. It is
also the par. Action ids resolve against the palette **plus the standard catalog**
(`resolveActionDef`): the 16-color paint rack (`PAINT_COLORS_16`) and all three pumpkin
sizes are always available to every level.

**Server-side verification (anti-cheat).** The client reports what it *did*, never
"I won". `POST /api/complete` replays the submitted action list through the same sim
and requires a clean match against the level's own solution replay; forged sequences
are rejected. The same check guards level creation, so every published level is
provably solvable.

---

## 3. Modifier Catalog

26 tools plus the paint rack. `h-`/`v-` prefixes are orientation: `horizontal-*`
assets run left-right, `vertical-*` top-to-bottom, so one item family yields two
pattern shapes.

### Paint (always available)

The 16-color rack: Red, Orange, Yellow, Green, Lime, Teal, Sky, Blue, Navy, Purple,
Magenta, Pink, Maroon, Olive, Gray, Black. A level's palette lists which pots it
*suggests*, but the color picker always offers all 16.

### Stencils

| Family | Variants | Coverage (approx. % of body) | Notes |
|--------|----------|------------------------------|-------|
| Goggles | h-thick, h-thin, h-mono, v-thick, v-thin, v-mono | 16–24% eye band | **break after protecting one splash** |
| Glasses | h-thick, h-thin, v-thick, v-thin | 16–24% eye band | splash-proof twins of the goggles — and great decoys |
| Belt | h-thick, h-thin, v-thick, v-thin | 15–34% middle band/column | |
| Pendant | h, v | ~19% chest charm | |
| Pumpkin | 25, 50, 75 | ~17% / ~48% / ~92% from the top down | all three sizes always available; **one pumpkin at a time** — tapping another size swaps it in a single move |
| Underwear | — | ~27% hips | |
| Plate | — | large dish shape | |
| Cone | — | inverted-triangle cone shape | |
| Scarf | left / right | wrap-around band | one coverage mask; the variant mirrors the art and the palette tile's arrow shows the direction |

**Wear-stacking rules** (`MAX_WORN`): Splot wears at most **3 stencils at once**.
Pumpkins are full head-covers — only one fits, and tapping a different size while
one is worn swaps it in place as a single move. A wear past the 3-stencil limit
is refused — nothing is logged, no step is spent, and a cross icon pops above the
refused palette tile. Within those limits any combination can be worn
simultaneously. The puzzle is ordering plus the outfit and goggle economy.

### Specials

| Tool | Behavior |
|------|----------|
| **Nose** | Worn small; every splash grows it one size (small → medium → big); a splash on big knocks it off. Each size masks a different area — a growing stencil you steer with your coats. |
| **Alpha dip** | One-shot translucency: everything exposed drops to 75% opacity. Counts as a splash (breaks goggles, grows the nose). One dip per run. |
| **Bubble** | Reusable soft dip that only affects its inner circle — the outer ring keeps full color. Not a splash: goggles and noses are safe. |

---

## 4. Level Sources

### Campaign: 25 worlds, 400 levels

`src/shared/curatedLevels.ts` builds the whole campaign deterministically from a fixed
seed — identical on client and server, no build step, generated lazily on first access
so it never blocks boot. `LEVELS_VERSION` stamps the set; the app-upgrade trigger
wipes level progress when it changes.

- **World 0 — Splash Course**: 5 hand-authored, **step-by-step guided** lessons
  that together cover **every rule in the game**. Each lesson ships a per-step
  coach script (`LevelData.guide`): the next tile glows gold, a coach panel
  narrates every move (`STEP n/m`), off-script taps are nudged back for free,
  and deliberately invited rule-breaks (Full Outfit dares you to wear a 4th
  thing) hit the real refusal. The five: First Splash (paint, last coat wins,
  stencils protect, finish bare), Full Outfit (stacking + the 3-at-once limit +
  white counts as a color), Fragile & Tough (goggles break on a splash, glasses
  don't), Pumpkin Parfait (one pumpkin at a time — tap another size to swap),
  Grand Finale (the growing nose, the one-shot alpha dip, the reusable bubble).
  **The course is optional**: lessons never lock, World 1 is never gated behind
  them, the coach panel carries a standing Skip button, and the course page ends
  in a "Skip to World 1" tile. The home page's "?" button runs all five lessons
  as a walkthrough. Every palette tile also carries a hover/long-press tooltip
  explaining what the tool does.
- **Worlds 1–10**: the main ramp — Splat School → Dress-Up Dell → Goggle Grove →
  Pumpkin Patch → Two-Tone Tarn → Layer Lagoon → Decoy Dunes → Trap Tundra →
  Expert Estuary → Master Marsh.
- **Worlds 11–21 (specialists)**: each spotlights one toy at expert budgets —
  Monocle Mire, Ring Reef, Nose Nebula, Scarf Summit, Stacked Shallows, Bubble Bog,
  Mirage Meadow, Fade Fjord, Vertigo Vale, Snare Strait, Gauntlet Gulch.
- **Worlds 22–24 (finale)**: mechanic-dense closers — Bullseye Bay, Opacity Ocean,
  Splotter's Sanctum.

Three mechanisms keep 400 levels varied and fair:

1. **Structural uniqueness** — every accepted goal's `structureKey` (the pattern
   majority-downsampled to 16×16 blocks, colors relabeled) must be new across the
   whole set. Recolors and near-twins are rejected: every goal is a genuinely
   different shape.
2. **Ramped budgets** — each world interpolates stencil/paint/decoy counts from a
   floor to a ceiling across its 16 slots.
3. **Within-world sort** — recipes are ordered by difficulty score before ids are
   assigned, so the felt ramp is monotonic.

### Daily

See [The Daily Sqlot](#5-the-daily-sqlot).

### Community

See [Community Levels](#6-community-levels).

---

## 5. The Daily Sqlot

A daily level is a **Sqlot** — the game's Wordle-style ritual.

- **Deterministic**: `generateDailyLevel(date)` seeds the generator from the date;
  the level id is `daily-YYYY-MM-DD`. Client and server derive the identical level.
- **Hard on purpose**: weekdays tier 4, weekends tier 5 — easy lives in the Splash
  Course; the Sqlot is the competitive ritual. Some days feature a spotlight mechanic
  (nose / alpha / bubble) when it clears the difficulty bar.
- **Quirky named**: every Sqlot draws a deterministic title from its date seed —
  "The Grumpy Goggle Job" — used in the level, the post title, and every Splat Card
  that quotes it.
- **Never a rerun**: from the daily epoch onward, each Sqlot is generated against the
  shape/recipe keys of the **entire campaign plus every prior Sqlot** — a daily is
  never a re-skin of a campaign level or an earlier daily.
- **Posted automatically**: the `daily-puzzle` scheduler task runs hourly and is
  idempotent per piece (level store and Reddit post checked separately), so the post
  lands right after UTC midnight and transient failures retry within the hour. Post
  titles stay minimal, no emojis: `Sqlot 2026-07-09: The Grumpy Goggle Job`.
- **Resilient**: `GET /api/daily` self-heals by generating today's Sqlot on demand if
  the cron hasn't stored it yet, falling back to a curated rotation only as a last
  resort.
- **Streaks**: consecutive-day Sqlot completions increment `daily:streak` (solving an
  old Sqlot late never resets an active streak), which feeds the Splotter Flair.

---

## 6. Community Levels

The **Editor** records the creator *playing* the pattern: every tap appends to the
action list, which becomes both the goal and the reference solution. Creators get the
full stencil catalog and the 16-color rack, pick 0–3 decoys to pad the published
palette, and can attach a hint.

Recordings are capped at `MAX_SOLUTION_STEPS` (60 — a roomy anti-abuse bound, not a
design cap), enforced while recording and re-verified server-side — so **every
published level is provably solvable**, and the recording's length is its advertised
par. Publishing requires the recording to end bare with paint on the slime. The server
stores the level (90-day TTL), indexes it for search, and posts a **Beat the Creator**
challenge post to the subreddit.

Discovery: the **Find** button (home page) opens the level finder — search community
levels by title or creator (`GET /api/levels/community?q=`), browse the newest, or
jump to any campaign level.

---

## 7. Reddit Engagement Features

All five shipped (see `docs/reddit-engagement.md` for design rationale):

| Feature | What it does |
|---------|--------------|
| **Splat Card** | One-tap brag comment on the post you just played — star meter, moves vs par, time, streak, an optional image snapshot and player caption. Kaomoji voice (`(⌐■‿■)` / `ヽ(・∀・)ノ` / `╮(ツ)╭` by star tier), never emojis, and it **never reveals the moves** — solutions stay secret. The Wordle loop, native to the comment section. |
| **First Splat Crown** | The first-ever solver of a Sqlot can claim a one-time 👑 trophy comment (image card or text). Stored per level; claimed forever. |
| **Splotter Flair** | Auto-synced subreddit flair showing streak 🔥 and lifetime-Sparks tier; opt-out per player. |
| **Beat the Creator** | Every published community level is a public duel post: the creator's par is the challenge. |
| **Fit Check Friday** | Weekly scheduler posts a fashion thread (Fri 15:00 UTC); players one-tap comment their current Splot loadout; Monday's cron crowns a winner. |

---

## 8. Sparks, Stars & the Shop

**Stars** (`calcStars`): steps ≤ par → ★★★ · ≤ 2×par → ★★ · else ★.

**Sparks** are awarded server-side on a player's **first completion** of each level:

| Event | Sparks |
|-------|--------|
| Complete a level | 10 |
| … at par (3★) | +20 |
| … a Sqlot (daily) | +15 |
| … first on Reddit to solve it | +30 |

**The Shop** customizes Splot (cosmetic only — never gameplay):

| Category | Range |
|----------|-------|
| Colors — 24 solids on an exponential ladder | 1,000 → 14,000 |
| Colors — 5 rare finale effects (Aurora Gradient, Silver Sparkle, Rainbow, Opal Shimmer, Golden) | 16,000 → 25,000 |
| Eyes | 125 – 300 |
| Mouths | 100 – 225 |
| Eyebrows | 110 – 190 |
| Accessories (cap, party hat, horns, top hat) | 150 – 375 |
| Golden Crown | 25,000 |

Prices live in `src/shared/shop.ts`; the server is authoritative for purchases and
equips (ownership checked, prices never trusted from the client).

---

## 9. Leaderboards

Purely global, three tabs (`GET /api/leaderboard/global?type=`):

| Board | Metric |
|-------|--------|
| `sparks` | Lifetime Sparks (purchases never reduce it) |
| `moves` | Cumulative moves across all completions |
| `played` | Total completions |

Scores are stored negated so a plain ascending range yields "highest first, A-Z on
ties". Every player who has ever opened the game is seeded onto the boards, and the
current player's row is always shown.

---

## 10. Screens & Navigation

One Phaser scene per file under `src/client/scenes/`:

| Scene | Purpose |
|-------|---------|
| `Boot` → `Preloader` | Minimal boot, then full asset load with progress bar |
| `MainMenu` | Splot + Play / Daily Sqlot / Create / Find / Shop / Ranking |
| `LevelSelect` | World pager (16-level grids) + the level finder page |
| `Game` | The puzzle: goal card, your slime, palette, HUD (steps vs par, timer, reset) |
| `LevelComplete` | Stars, Sparks, streak, Splat Card / First Splat Crown sharing |
| `Editor` | Record-your-solution level creation, test mode, publish |
| `Leaderboard` | Global boards |
| `Shop` | Splot customization |
| `GameOver` | Error fallback |

```
Splash (inline post view — plain HTML/CSS, no Phaser)
  └─ [Play Now] → requestExpandedMode('game')

MainMenu
  ├─ Play        → LevelSelect (worlds)
  ├─ Daily Sqlot → Game (levelId: 'daily')
  ├─ Create      → Editor ── Test → Game (preview) ── Publish → Reddit post
  ├─ Find        → LevelSelect (finder page)
  ├─ Shop        → Shop
  └─ Ranking     → Leaderboard

Game ── Win → LevelComplete ── Next → Game (next level)
```

Every scene uses `Phaser.Scale.RESIZE` with a resize handler and is verified from
280×480 phones up to desktop. Reference resolution 1024×768, scale factor
`min(w/1024, h/768, 1)`.

---

## 11. Technical Architecture

| Layer | Technology |
|-------|-----------|
| Game engine | Phaser 4 (`phaser@4.2.0`) |
| Bundler | Vite 8 + `@devvit/start/vite` |
| Server | Hono on Node 22 (`@devvit/web` serverless) |
| Platform | Devvit Web 0.13.x |
| Language | TypeScript 6, strict |
| Persistence | Redis via `@devvit/web/server` |
| Scheduling | Devvit cron scheduler |

```
src/
  client/          ← runs in the Reddit iframe
    splash.ts      ← inline feed view (tiny, no Phaser)
    game.ts        ← expanded Phaser game entry
    scenes/        ← one file per scene
    components/    ← SlimeRenderer, SplotMascot, PixelUI (9-slice)
    engine/        ← LevelEngine: per-attempt session (steps, timer, action log)
  server/
    index.ts       ← Hono app wiring
    routes/        ← api.ts, menu.ts, triggers.ts, scheduler.ts
    core/          ← post titles, flair, duels
  shared/          ← client+server, zero runtime deps
    slimeSim.ts    ← THE simulation (grid, actions, win check)
    maskData.ts    ← baked 64×64 bitmaps (generated, do not hand-edit)
    gameRules.ts   ← stars, level integrity, solution verification
    curatedLevels.ts ← 25-world campaign generator
    levelData.ts   ← daily Sqlot generator
    shop.ts        ← catalog + prices
    types.ts, api.ts ← domain + API contract types
public/assets/     ← all sprites (see docs/assets.md)
devvit.json        ← entrypoints, menu items, triggers, scheduler tasks
```

**Entry points** (`devvit.json`): `splash.html` inline in the feed;
`game.html` expanded. Client → server is plain `fetch('/api/...')`.

Rendering: `SlimeRenderer.setPattern(palette, actions)` replays the action list and
composites the pattern on a per-instance canvas texture using the real PNGs — white
body, per-coat tinted stamps with the then-worn stencils punched out, gloss overlay —
so what the player sees is exactly what the win check judges. Details in
`docs/slime-rendering.md`.

---

## 12. API Reference

Request/response types live in `src/shared/api.ts`.

### Game

| Route | Purpose |
|-------|---------|
| `GET /api/init` | postId, username, sparks, streak, equipped items, completed levels |
| `GET /api/daily` | today's Sqlot (self-healing) |
| `GET /api/levels/list` | curated campaign |
| `GET /api/level/:id` | one level (curated id, `daily-*`, or `ugc-*`) |
| `POST /api/complete` | `{ levelId, timeMs, actions }` → verified rewards, stars, streak, crown eligibility |

### Community & sharing

| Route | Purpose |
|-------|---------|
| `POST /api/level/create` | publish a UGC level (re-verifies the recording) |
| `GET /api/levels/community?q=` | search/browse community levels |
| `POST /api/share/card` | post a Splat Card comment (server re-verifies the run) |
| `POST /api/share/first-splat` | claim the First Splat Crown |
| `POST /api/share/fit` | comment your loadout on the live Fit Check thread |

### Profile & shop

| Route | Purpose |
|-------|---------|
| `GET /api/user/profile` | profile, stars per level, flair pref |
| `POST /api/user/buy` | buy a shop item (server-priced) |
| `POST /api/user/equip` | equip an owned item |
| `POST /api/user/flair` | flair sync opt-in/out |
| `GET /api/leaderboard/global?type=` | sparks / moves / played |

### Internal (declared in devvit.json)

- Menu (moderator): `/internal/menu/post-create`, `post-daily`, `reset-level-stats`,
  `reset-all-users`
- Scheduler: `/internal/scheduler/daily-puzzle` (hourly), `fitcheck-post` (Fri 15:00
  UTC), `fitcheck-award` (Mon 00:00 UTC)
- Triggers: `/internal/triggers/on-app-install`, `on-app-upgrade`

---

## 13. Redis Schema

All values are strings; parse on read, stringify on write.

```
user:{username}              HASH    sparks:lifetime, daily:streak, daily:lastDate,
                                     done:{levelId}, stars:{levelId}, equipped,
                                     owned:{itemId}, flair:optOut, flair:last,
                                     fitcheck:won, created, lb:seeded
sparks:{username}            STRING  spendable Sparks balance
users:all                    ZSET    permanent player registry (join time)

level:{levelId}              STRING  JSON LevelData — dailies TTL 30d, UGC TTL 90d
level:first-completer        HASH    levelId → first solver
level:first-stats            HASH    levelId → "steps|timeMs" of the first solve
level:crowned                HASH    levelId → crown claimant
levels:version               STRING  deployed LEVELS_VERSION (upgrade wipe guard)

daily:{YYYY-MM-DD}           STRING  → levelId of that day's Sqlot
daily-post:{YYYY-MM-DD}      STRING  → Reddit post id (idempotence guard)

lb:global:sparks|moves|played  ZSET  negated scores (see §9)

ugc:index                    ZSET    community level ids by publish time
ugc:titles                   HASH    levelId → title/creator search registry
ugc:plays                    HASH    levelId → play count
duel:{levelId}[, :stats]     Beat-the-Creator post linkage

fitcheck:current / :week     STRING  live thread id / week label
fitcheck:comments:{postId}   entries for the weekly award
fitcheck:carded:{postId}     HASH    per-user "already posted" guard
subreddit:name               STRING  persisted at install for the schedulers
```

---

## 14. Development

### Prerequisites

- Node.js ≥ 22.2
- A Reddit account connected at [developers.reddit.com](https://developers.reddit.com)

### Commands

```sh
npm install
npm run login        # devvit login (one-time)
npm run dev          # devvit playtest — live-reloads into r/sqlotter_dev
npm run type-check   # tsc --build (run first)
npm run lint         # eslint src
npm run build        # vite build → dist/
npm run deploy       # type-check + lint + devvit upload (new version, private)
npm run launch       # deploy + devvit publish (submit for review / go public)
```

Backend calls (`/api/*`) only work through playtest or an installed app — not a bare
local server. Test across portrait mobile (390×844 and 320×568), landscape tablet,
and desktop; every scene must survive rotation.

### Conventions

- TypeScript strict; no `any`, no casts. Type aliases over interfaces; named exports.
- Shared modules (`src/shared/`) must stay dependency-free — no Phaser, no Devvit.
- Never import `@devvit/public-api` — this is a Devvit **Web** app.
- Every new internal endpoint must be declared in `devvit.json`.
- `src/shared/maskData.ts` is generated by `scripts/generate_masks.py`; regenerate it
  when modifier art changes, never hand-edit.

---

## 15. Deployment

Short version: `npm run deploy` uploads a new private version you can install on your
own test subreddit; `npm run launch` additionally submits the app for Reddit's review
so it can be installed anywhere and listed publicly.

The full path — developer account, playtest, upload, publish, review, creating the
game's home subreddit, and hackathon submission — is documented step by step in
[`docs/deployment.md`](docs/deployment.md).

---

## 16. Hackathon Context

**Event:** Reddit "Games with a Hook" — deadline July 15, 2026, 6:00 pm PDT.

| Target prize | Sqlotter's answer |
|--------------|-------------------|
| Best App with a Hook ($15k) | The daily Sqlot ritual + streak flair + crowns |
| Best Use of Phaser ($5k) | Canvas-composited slime renderer, 9-slice pixel UI, full RESIZE responsiveness |
| Best Use of User Contributions ($3k) | Record-your-solution editor → Beat-the-Creator duel posts |
| Best Use of Retention Mechanics ($3k) | Streaks, Sparks economy, Fit Check Friday, global boards |

Design tenets: time-to-fun under 5 seconds, mobile-first, Splot reacts to everything,
no dead ends, celebrate wins loudly.

**Audio** (`src/client/audio.ts`): every game event has a matched retro SFX —
splashes splash, goggles shatter like glass, pumpkins crunch, refusals buzz, wins
power up, stars pip at rising pitch, dailies open with an evil laugh — plus an 84s
music loop that plays seamlessly across scenes. All SFX are silence-trimmed mono
WAVs decoded into Web Audio buffers, so playback is zero-latency — and only a
~130KB core UI set rides the boot critical path; the rest (and the 2MB music)
streams in the background after the game is interactive, so slow connections
reach the menu roughly twice as fast. SFX and Music each have a toggle in the
home page's settings popup (shown to guests too); preferences persist to Redis
for logged-in players.

---

## 17. Further Docs

| Doc | Contents |
|-----|----------|
| [`docs/core-gameplay.md`](docs/core-gameplay.md) | The sim in depth: rules, coverage, scoring, level generation |
| [`docs/slime-rendering.md`](docs/slime-rendering.md) | How SlimeRenderer composites patterns from real PNGs |
| [`docs/splot-mascot.md`](docs/splot-mascot.md) | The mascot layer stack, expressions, customization |
| [`docs/ui-components.md`](docs/ui-components.md) | Icons, text, responsive layout math |
| [`docs/9-slicing.md`](docs/9-slicing.md) | The 9-slice panel/button system |
| [`docs/assets.md`](docs/assets.md) | Full asset catalog with texture keys |
| [`docs/reddit-engagement.md`](docs/reddit-engagement.md) | The five shareability features |
| [`docs/deployment.md`](docs/deployment.md) | Launch/deploy guide |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENTS.md`](AGENTS.md) | Agent/contributor instructions |

---

*Built with Devvit Web · Phaser 4 · Hono · TypeScript*
