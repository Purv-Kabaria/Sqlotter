# CLAUDE.md — Sqlotter: The Slime Puzzle Game

You are building **Sqlotter**, a Factory-Balls-style stencil-painting puzzle game on Reddit's Devvit platform. Players receive a goal PATTERN (a bare slime painted in zones of color) and must reproduce it by wearing modifiers as paint stencils in the right order. The mascot is Splot — a round, expressive slime who lives in the player's subreddit feed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Game Engine | **Phaser 4.x** (`phaser@4.2.0`) |
| Frontend bundler | **Vite 8** with `@devvit/start/vite` plugin |
| Server | **Hono** on Node 22 (`@devvit/web` serverless) |
| Platform | **Devvit Web 0.13.x** (`@devvit/web`, `@devvit/start`) |
| Language | **TypeScript 6** (strict) |
| Persistence | **Redis** via `@devvit/web/server` |
| Realtime | `realtime` from `@devvit/web/server` |
| Scheduling | `scheduler` from `@devvit/web/server` |

---

## Architecture

```
src/
  client/          ← Runs in iFrame on reddit.com (Phaser game)
    game.ts        ← Phaser Game config entry point
    splash.ts      ← Splash/inline view entry point
    scenes/        ← One file per Phaser Scene
  server/          ← Serverless Node.js (Devvit)
    index.ts       ← Hono app wiring
    routes/        ← api.ts, triggers.ts, menu.ts, forms.ts, scheduler.ts
    core/          ← Business logic (levels, leaderboards, users)
  shared/          ← Types shared by client + server (no runtime deps)
public/
  assets/          ← All game sprites (see Asset Inventory below)
devvit.json        ← Platform config (entry points, menu, triggers, scheduler, permissions)
```

**Entry points** (defined in `devvit.json`):
- `splash.html` — inline feed view; keep it tiny, no heavy imports
- `game.html` — expanded game view; loads Phaser

**Client → Server communication:** plain `fetch('/api/...')` — no tRPC wiring exists yet.

---

## Devvit Platform Rules — MUST READ

### What you CAN do
- `import { redis, reddit, context, scheduler, realtime } from '@devvit/web/server'`
- `import { navigateTo, requestExpandedMode, showToast, showLoginPrompt, showShareSheet, context } from '@devvit/web/client'`
- Redis sorted sets for leaderboards (`zAdd`, `zRange`, `zScore`, `zRank`, `zCard`)
- Redis hashes for user profiles and level data (`hSet`, `hGet`, `hGetAll`)
- Cron scheduler for daily puzzle generation (max 10 recurring tasks per installation)
- Realtime messaging for live leaderboard updates (max 100 msg/sec, 1 MB payload)
- `reddit.submitCustomPost()` to create level posts
- `reddit.getCurrentUsername()` / `reddit.getCurrentUser()` for identity

### What you CANNOT do
- `window.location` / `window.assign` → use `navigateTo()` from `@devvit/web/client`
- `window.alert` → use `showToast()` from `@devvit/web/client`
- Geolocation, camera, microphone, browser notifications
- Inline `<script>` tags in HTML files (use separate `.ts` files)
- `localStorage` for persistent data across sessions (use Redis)
- Import anything from `@devvit/public-api` or Blocks — **this project is Devvit Web only**

### Hard limits
| Resource | Limit |
|---------|-------|
| Redis storage | 500 MB per installation |
| Redis request size | 5 MB |
| Redis commands | 40,000/sec |
| Realtime payload | 1 MB |
| Realtime throughput | 100 msg/sec |
| Scheduler tasks | 10 recurring per installation |
| Post data | 2 KB per post |
| Server request timeout | 30 seconds |
| File uploads | 100 MB, 30-second timeout |

### devvit.json patterns
Every new internal endpoint (menu, form, trigger, scheduler) MUST be declared in `devvit.json`. Scheduler tasks require a `"scheduler"` block with `"tasks"`. Menu items require a `"menu"` block. Triggers require a `"triggers"` block.

```json
{
  "scheduler": {
    "tasks": {
      "daily-puzzle": {
        "endpoint": "/internal/scheduler/daily-puzzle",
        "cron": "0 0 * * *"
      }
    }
  }
}
```

---

## Asset Inventory

All assets live under `public/assets/`. Use `this.load.setPath('../assets')` in Phaser Preloader.

### Slime (puzzle rendering)
```
slime/color.png           ← Base slime shape; tint to set color
slime/border.png          ← Outline, always on top
slime/overlay-normal.png  ← Gloss shine (idle state)
slime/overlay-applied.png ← Gloss shine (interaction/hover)
```

### Modifiers (puzzle overlays)
```
modifiers/
  horizontal-goggles-thick.png   vertical-goggles-thick.png
  horizontal-goggles-thin.png    vertical-goggles-thin.png
  horizontal-goggle.png          vertical-goggle.png       ← monocle variants
  horizontal-glasses-thick.png   vertical-glasses-thick.png
  horizontal-glasses-thin.png    vertical-glasses-thin.png
  horizontal-pendent.png         vertical-pendent.png
  horizontal-belt-thick.png      vertical-belt-thick.png
  horizontal-belt-thin.png       vertical-belt-thin.png
  pumpkin-25.png  pumpkin-50.png  pumpkin-75.png
  underwear.png   plate.png       cone.png
  scarf-left.png  scarf-right.png bubble.png
  nose-small.png  nose-medium.png nose-big.png
```

`horizontal-*` = element oriented left-right across the slime.
`vertical-*` = element oriented top-to-bottom on the slime.
Scarf left/right share one coverage mask (the art mirrors); the nose sizes are
three distinct masks (it grows one size per splash).

### Character (Splot mascot — cosmetic only, NOT puzzle elements)
```
character/
  blob.png          outline.png      shadow.png
  overlay-normal.png  overlay-applied.png
  eyes/    eye-normal.png, eye-doubt.png, eye-cute.png, eye-pain.png,
           eye-happy.png, eye-shock.png, eye-open.png
  eyebrows/ eyebrow-normal.png, eyebrow-surprise.png,
            eyebrow-sad.png, eyebrow-angry.png
  mouth/   mouth-happy.png, mouth-smile.png, mouth-frown.png,
           mouth-squiggle.png, mouth-kiss.png, mouth-ooo.png,
           blush.png, cry.png
  accessories/ horns.png, party-hat.png, crown.png, cap.png, hat.png
```

### UI
```
ui/panel.png  button-open.png  button-hover.png
ui/button-disabled.png  button-press.png
icons/navigation/  arrow, home, settings, cancel, help, share
icons/gameplay/    play, pause, timer, reset
icons/puzzle/      paint, pendent, glasses-thick, glasses-thin,
                   goggles-thin, goggles-thick, goggle, pumpkin,
                   underwear, belt-thick, belt-thin, nose, plate,
                   cone, scarf, bubble  (the newer ones load tolerantly
                   via OPTIONAL_PUZZLE_ICONS in Preloader)
icons/hud/         heart, spark, star, fire
icons/community/   people, trophy, pencil, gold, silver, bronze
icons/shop/        bag, lock, unlock, price
icons/status/      check, cross, warning
icons/misc/        plus, minus, dot, sparkle
backgrounds/       background 1/, background 2/, background 3/, background 4/
```

### Sounds (`public/sounds/`, loaded from `sounds/` — NOT under assets/)
Mono 16-bit WAVs, silence-trimmed (originals in git history at b8ddd7c), plus
`bgm.mp3` (84s music loop). `src/client/audio.ts` is the single owner of the
event→file mapping (SFX_FILES), the SFX/music enable state (persisted via
POST /api/user/settings for logged-in players, seeded from /api/init), and the
music loop (a marker skips the MP3's silent head/tail so the wrap is seamless).
Every beige button clicks on pointerdown via PixelUI; game events play through
`playSfx(name)`. Unused files (guns/sirens/screams etc.) ship but never load.
**Loading split**: only CORE_SFX (~130KB of UI ticks) rides the Preloader;
the rest + the 2MB bgm stream in the background via `streamAudio(scene)`
(called from MainMenu/Game/LevelSelect create — idempotent, re-queues after
aborted loads; playSfx silently skips still-missing keys, music self-starts
when bgm lands). Audio must NEVER go back on the boot critical path — it was
5x the weight of the entire art set.

---

## Game Mechanics

### Core Loop
1. Player loads a level (from curated set, daily, or user-generated)
2. See the **goal pattern** — a BARE slime painted in zones of color (never with modifiers attached)
3. Tap palette items: **paint** splashes color over everything unprotected; **stencils** (goggles/glasses/belts/pendants/pumpkins/underwear) toggle on/off — worn stencils protect what they cover from paint. **Goggles are one-time use**: the splash that lands on them knocks them off broken (automatic, free) and they can't be worn again until a reset
4. Each logged tap = 1 move (wearing, removing, and painting all cost a move); order matters
5. When the painted pattern matches the goal AND nothing is worn → level complete → earn Sparks

**Move scoring** (`shared/gameRules.ts` is authoritative): the HUD never shows
bare par — every level advertises a move LIMIT of `par + buffer` where
`buffer = max(2, ceil(par/2))` (par 5 → limit 8). Finish within it = 3 stars;
each further buffer-width tier crossed raises the shown limit and costs a star,
down to 0 (the level still completes). **Stars pay for moves, Sparks pay for
time** (see Sparks Economy). **Reset** (`__reset__`) wipes the board AND the
move counter — moves count from the last reset (`effectiveSteps`) — but never
the clock. **Persistent attempts**: leaving a level mid-attempt saves the live
action log + banked time (session store + `wip:{levelId}` in Redis via
POST /api/progress, restored on re-entry, cleared on completion); guided
lessons and editor previews stay ephemeral on purpose.

**Guided tutorials**: the Splash Course is FIVE dense lessons covering every rule;
each carries `LevelData.guide` — one coach line per solution step. With a guide
present the Game scene runs step-by-step: the expected tile glows gold (down into
the color/pumpkin pickers), a persistent coach panel narrates (`STEP n/m`),
off-script taps nudge back at zero cost, and taps the sim would refuse anyway play
the real refusal (lessons invite them on purpose). Reset restarts the script. The
course is OPTIONAL: lessons never lock, World 1 is never gated behind them, the
coach panel has a standing Skip button, and the course page ends in a "Skip to
World 1" tile. **Tooltips**: every palette tile shows a one-line blurb
on hover (desktop) or long-press (touch — the release is swallowed, never a move).

### Simulation Model (src/shared/slimeSim.ts)
The slime is a 64×64 cell grid. `BODY_MASK` marks body cells; `MASK_BITMAPS[maskId]`
marks each stencil's coverage — both baked from the real PNG alpha channels by
`scripts/generate_masks.py` into `src/shared/maskData.ts`, so client and server run
the identical simulation with no canvas.

```typescript
type SimState = {
  grid: Uint8Array;   // per-cell index into colors
  alpha: Uint8Array;  // per-cell opacity: opaque | dipped (75%)
  colors: string[];   // colors[0] = '#FFFFFF' (unpainted)
  worn: string[];     // mask ids currently worn, in order
  broken: string[];   // goggles broken this run (a splash landed on them)
  spent: string[];    // one-shot action ids used this run (alpha dip)
};
```

- Paint action: every body cell not covered by a worn stencil ← the paint color at
  full opacity; then splash side effects — every worn GOGGLES mask snaps off into
  `broken`, and a worn nose grows one size (small→medium→big; a splash on big knocks
  it off). All automatic, no action logged
- Alpha dip: every exposed cell → 75% opacity ("dipped", idempotent). Counts as a
  splash. ONE dip per run — a second tap is refused like broken goggles
- Bubble: dips only exposed cells inside its inner-circle region; reusable, NOT a
  splash (goggles and noses are safe)
- Stencil action: toggle — on if off, off if on. Broken goggles refuse the tap
  (nothing logged; replays containing one are invalid). Reset (`__reset__`) is
  itself a logged, step-costing action that clears grid/worn/broken/spent
- Wear-stacking rules (`MAX_WORN` in slimeSim.ts): at most **3 stencils worn at
  once**. Pumpkins are full head-covers — only one fits, and tapping a
  DIFFERENT size while one is worn **swaps it in place as a single action**
  ('swap' ActionKind, worn count unchanged, so the limit can't refuse it). A
  wear that would exceed `MAX_WORN` is REFUSED like broken goggles: state
  untouched, nothing logged, and the Game scene pops a cross icon above the
  refused palette tile plus a message saying why
- Action ids resolve against the palette PLUS the standard catalog
  (`resolveActionDef`): the 16 paints (`PAINT_COLORS_16`) and the 3 pumpkin sizes are
  always available — the color picker always offers the full 16-color rack, the
  pumpkin picker all three sizes
- Win (`isCleanMatch`): all body cells display the goal replay's effective color
  (hue + dip state) && `worn` is empty
- The goal IS a replay: `LevelData.optimalSolution` replayed over `LevelData.palette`
  produces the goal pattern. There is no stored goal state.

Canonical example (medium level): `pumpkin-25 on → paint green → goggles on → paint
red (goggles break off) → pumpkin off` = white cap, green goggle band, red body — bare
slime, three colors, 5 steps.

### Rendering (src/client/components/SlimeRenderer.ts)
`setPattern(palette, actions)` composites on a per-instance canvas texture: white body,
then per paint op a color-tinted body stamp with the then-worn stencils punched out
(`destination-out`, alpha threshold 100 = same as the baked bitmaps), then shine
(overlay blend, clamped to body alpha). Currently-worn stencils draw as normal images
above `border.png` — they sit ON the slime, so the outline must not cut across their
art. Goal previews are `setPattern(palette, optimalSolution)`.

For the **Splot mascot** in menus/shop (not puzzle) — every instance defaults to
the player's shop-equipped look (cached /api/init) and ALWAYS uses the procedural
`splot-shadow` ellipse (Boot.ts) — `character/shadow.png` is never loaded:
```
depth  0 — splot-shadow (procedural soft ellipse)
depth 10 — character/blob.png (tinted for customization)
depth 20 — character/mouth/*.png  +  blush/cry effects
depth 30 — character/eyes/*.png
depth 40 — character/eyebrows/*.png
depth 50 — character/accessories/*.png (hat, crown, horns, etc.)
depth 60 — character/overlay-normal.png
depth 65 — character/outline.png
```

---

## Data Schemas (Redis)

### Level
```
Key:   level:{levelId}
Type:  string → JSON.stringify(LevelData)
Shape: { id, title, difficulty, palette: ModifierDef[],
         optimalSteps, optimalSolution: string[],   ← the solution IS the goal
         hint?, authorName?, isDaily? }
Notes: parseStoredLevel (src/server/routes/api.ts) validates on read and
       rejects levels whose optimalSolution doesn't replay cleanly.
```

### User Profile
```
Key:   user:{username}
Type:  hash
Fields (flat, per-concern — no JSON blobs):
  sparks:lifetime      ← never decreases; feeds the flair tier ladder
  daily:streak / daily:lastDate
  done:{levelId}       ← "1" first-completion marker (hSetNX = award guard)
  stars:{levelId}      ← best stars for that level
  wip:{levelId}        ← JSON {a: actions, t: timeMs} unfinished attempt
                         (persistent levels; cleared on completion)
  equipped             ← JSON Record<slot, itemId>
  owned:{itemId}       ← "1"
  flair:optOut / flair:last / fitcheck:won / created / lb:seeded
  sound:sfxOff / sound:musicOff ← "1" = off (absent defaults on)
Spendable balance lives separately: sparks:{username} (STRING counter).
```

### Leaderboards (purely global — no per-level boards)
```
lb:global:sparks   lifetime Sparks     (zAdd on award)
lb:global:moves    cumulative moves    (zIncrBy per completion)
lb:global:played   total completions   (zIncrBy per completion)
users:all          permanent player registry (score = join time)
```
Scores are stored NEGATED so a plain ascending zRange yields "highest first,
A-Z tiebreak". Un-negate on read (see GET /api/leaderboard/global).

### Daily Sqlot Index
```
daily:{YYYY-MM-DD}       string → levelId        (TTL 30d)
daily-post:{YYYY-MM-DD}  string → Reddit post id (idempotence guard)
```

### Community / engagement
```
ugc:index (ZSET) · ugc:titles (search) · ugc:plays (royalty counter)
level:first-completer · level:first-stats · level:crowned
duel:{levelId}[, :stats] · fitcheck:current / :week / :comments:{postId} / :carded:{postId}
levels:version · subreddit:name
```

---

## Phaser Best Practices

### Scene Structure
Each scene class lives in its own file under `src/client/scenes/`. The required scenes are:
- `Boot.ts` — loads minimal assets (background, logo)
- `Preloader.ts` — loads all game assets, shows progress bar
- `MainMenu.ts` — home screen with navigation
- `LevelSelect.ts` — grid of levels
- `Game.ts` — core puzzle gameplay
- `LevelComplete.ts` — results after solving
- `Editor.ts` — user level creation
- `Leaderboard.ts` — global boards (sparks / moves / played)
- `Shop.ts` — Splot customization with Sparks
- `GameOver.ts` — fallback/error state

### Responsive Layout Pattern
```typescript
// Always handle resize — Devvit runs on mobile, tablet, desktop
create() {
  this.scale.on('resize', this.onResize, this);
  this.onResize(this.scale);
}

onResize(gameSize: Phaser.Structs.Size) {
  const { width, height } = gameSize;
  this.cameras.resize(width, height);
  // Reposition all game objects
}
```

Always use `Phaser.Scale.RESIZE` mode. Reference resolution is 1024×768. Scale factor:
```typescript
const sf = Math.min(width / 1024, height / 768, 1); // never scale above 1×
```

### Asset Loading
```typescript
preload() {
  this.load.setPath('../assets');
  // Use consistent key naming: 'modifier-goggles-h-thick'
  this.load.image('modifier-goggles-h-thick', 'modifiers/horizontal-goggles-thick.png');
  this.load.image('slime-color', 'slime/color.png');
  this.load.image('slime-border', 'slime/border.png');
}
```

### Performance
- Use `RenderTexture` to pre-composite the slime instead of many overlapping images for static display (goal slime preview)
- Use Phaser `Group` or `Container` to group slime layers; move the container instead of individual sprites
- Pool `GameObjects` in `Game` scene rather than create/destroy on every modifier apply
- Avoid `update()` for non-animation state — use event-driven patterns

### Touch / Mobile
- Set `input.setDefaultActivePointers(2)` to support multi-touch
- Minimum tap target: 44×44 CSS pixels → convert to game units with `sf`
- Prefer `pointerup` over `pointerdown` for action triggers to prevent accidental taps
- Add haptic feedback pattern: brief scale tween on valid modifier apply; shake tween on conflict

---

## UI/UX Principles

1. **Time to fun < 5 seconds** — splash screen must show something interactive immediately
2. **Mobile-first** — design all layouts portrait-first, then adapt to landscape/desktop
3. **Splot reacts** — change Splot's expression based on game events:
   - Apply modifier → `eye-happy` + `mouth-smile`
   - Conflict → `eye-shock` + `mouth-ooo` + shake tween
   - Win → `eye-happy` + `mouth-kiss` + particle burst
   - Wrong solution → `eye-pain` + `mouth-frown`
4. **Instant feedback** — modifier application must complete its animation in < 200ms
5. **Clear goal** — goal slime must be always visible; never obscure it
6. **Progress** — show step count and timer at all times in HUD
7. **Colors** — use bright, saturated colors; Splot's default is vibrant green (#6DD400)
8. **No dead ends** — always show a reset button; no "you're stuck" states
9. **Celebration** — win screen uses particles, scale tween, and sound cue

### Screen Layouts

**Game Screen (portrait mobile, 390×844 reference):**
```
┌────────────────────┐  ← 390px wide
│ [←] Level 12  ⏱3s │  ← 56px HUD
│ Steps: 3  [Reset]  │
├────────────────────┤
│    GOAL            │  ← 200px
│   [Goal Slime]     │
├────────────────────┤
│    YOUR SLIME      │  ← 200px
│   [Your Slime]     │
├────────────────────┤
│  Modifier Palette  │  ← remaining height
│ [M1][M2][M3][M4]  │
│ [M5][M6][M7][M8]  │
└────────────────────┘
```

**Game Screen (landscape desktop, 1024×768):**
```
┌────────────────────────────────────────┐
│ [←] Level 12         ⏱ 03s  Steps: 2  │  ← 56px HUD
├──────────────┬─────────────────────────┤
│              │  GOAL        YOUR SLIME  │
│  MODIFIER    │ [Goal]       [Current]   │
│  PALETTE     │                          │
│              │          [Reset][Hint]   │
│ [M1]         │                          │
│ [M2]  ← 220px│                          │
│ [M3]         │                          │
│ [M4]         │                          │
└──────────────┴─────────────────────────┘
```

---

## Scene Navigation Flow

```
Splash (inline)
  └─ [Start] → requestExpandedMode('game')

MainMenu (expanded)
  ├─ [Play]           → LevelSelect (worlds)
  ├─ [Daily Sqlot]    → Game (levelId: 'daily')
  ├─ [Create]         → (login gate) → Editor
  ├─ [Find]           → LevelSelect (finder page — search community + campaign)
  ├─ [Shop]           → (login gate) → Shop
  └─ [Ranking]        → Leaderboard

LevelSelect
  └─ [Level N]        → Game (level N)

Game
  ├─ [Win]            → LevelComplete
  ├─ [Back]           → LevelSelect / MainMenu
  └─ [Reset]          → re-init game state (same scene)

LevelComplete
  ├─ [Next]           → Game (next level)
  ├─ [Leaderboard]    → Leaderboard (filtered to this level)
  └─ [Menu]           → MainMenu

Editor
  ├─ [Test]           → Game (preview mode, no scoring)
  └─ [Publish]        → server creates Reddit post

Leaderboard
  └─ [Back]           → MainMenu
```

---

## API Contract (Client ↔ Server)

All API routes live under `/api/`. Internal platform routes (menu, forms, triggers, scheduler) live under `/internal/`.

### Core Game APIs
```
GET  /api/init                    → InitResponse
GET  /api/level/:id               → LevelResponse (curated / daily-* / ugc-*)
GET  /api/daily                   → DailyResponse (today's Sqlot, self-healing)
POST /api/complete                → { levelId, timeMs, actions } → CompleteResponse
                                    (server REPLAYS actions through the sim)
GET  /api/levels/list             → LevelsListResponse (campaign)
GET  /api/levels/community?q=     → CommunityLevelsResponse (search/browse UGC)
POST /api/level/create            → LevelCreateRequest → LevelCreateResponse
GET  /api/leaderboard/global?type=sparks|moves|played → LeaderboardResponse
GET  /api/user/profile            → ProfileResponse
POST /api/user/buy                → BuyRequest → BuyResponse (server-priced)
POST /api/user/equip              → EquipRequest → EquipResponse
POST /api/user/flair              → FlairPrefRequest → FlairPrefResponse
POST /api/user/settings           → SoundSettingsRequest → SoundSettingsResponse
POST /api/progress                → ProgressSaveRequest (wip attempt; empty actions clear)
GET  /api/progress/:levelId       → ProgressGetResponse (restore an unfinished attempt)
POST /api/share/card              → ShareCardRequest (Splat Card comment)
POST /api/share/first-splat       → FirstSplatRequest (crown claim)
POST /api/share/fit               → Fit Check Friday comment
```

### Type conventions
- All request/response types live in `src/shared/api.ts`
- Prefer type aliases over interfaces
- Never cast types (`as`)
- All Redis values are strings; parse on read, stringify on write

---

## Sparks Economy

Sparks are TIME-driven; stars are the move currency (`timeSparksBonus` in
`shared/gameRules.ts`, applied server-side in /api/complete on first clears).

| Event | Sparks earned |
|-------|--------------|
| Level complete (any moves/time) | 10 |
| Speed bonus (linear: full under ~30s, zero by 5 min) | up to +15 |
| Under the move limit (3 stars) | +10 bonus |
| Matched par exactly | +10 more |
| Daily puzzle complete | +15 bonus |
| First to complete a level | +30 bonus |
| User-level gets 10 plays | +5 (passive) |

| Item (src/shared/shop.ts is authoritative) | Sparks cost |
|------|------------|
| Splot colors — 24 solids, exponential ladder | 1,000 – 14,000 |
| Splot colors — 5 rare finale effects (gradient/sparkle/rainbow/opal/golden) | 16,000 – 25,000 |
| Eye styles | 125 – 300 |
| Mouth styles | 100 – 225 |
| Eyebrow styles | 110 – 190 |
| Accessories (cap, party hat, horns, top hat) | 150 – 375 |
| Golden Crown | 25,000 |

---

## Daily Sqlot System

A daily level is a **Sqlot** — that's the player-facing name everywhere (post
titles, menu button, in-game subtitle). Sqlot titles stay minimal:
`Sqlot 2026-07-09: The Grumpy Goggle Job` (see `dailyPostTitle` in
`src/server/core/post.ts`).

**HARD RULE: NO post title or comment ever contains an emoji** — not the game
post, not duels, not Fit Check Friday, not Splat Cards. Titles that embed user
text go through `cleanPostTitle` (src/server/core/post.ts); comments speak in
**kaomoji** instead (the `KAOMOJI` map next to it — all markdown-safe, no
`_ \ * ^ ~`) plus plain text glyphs like ★ and ♛. Second comment rule: **a
comment never prints a solution/move list** — not even spoiler-tagged; stats
(stars, moves vs par, time, streak) are the only tease. User flair strings
(shared/flair.ts) are the one surface that keeps its emojis.

Declare in `devvit.json`:
```json
"scheduler": {
  "tasks": {
    "daily-puzzle": {
      "endpoint": "/internal/scheduler/daily-puzzle",
      "cron": "0 * * * *"
    }
  }
}
```

The task runs **hourly and idempotent per piece**: the level store (`daily:{YYYY-MM-DD}` →
`levelId`) and the Reddit post (`daily-post:{YYYY-MM-DD}`) are checked separately, so the
post lands right after UTC midnight and any transient failure retries within the hour.

**Generation algorithm** (`generateDailyLevel` in `src/shared/levelData.ts`):
1. Pick difficulty tier from the weekday — Sqlots skew hard (weekdays 4, weekends 5)
2. Draw a deterministic quirky title from the date seed ("The Grumpy Goggle Job")
3. Some days spotlight a feature mechanic (nose/alpha/bubble) when it clears the ≥4-move bar
4. Build a valid recipe with the shared generator; the sequence IS `optimalSolution`
5. Add decoy modifiers (valid but not needed)
6. **Uniqueness walk**: from `DAILY_EPOCH_MS` onward each Sqlot is generated against
   the shape/recipe keys of the entire campaign plus every prior Sqlot — never a
   re-skin of a campaign level or an earlier daily (validated out 730 days)

---

## Code Style (enforced by existing project)

- **TypeScript strict** — no `any`, no type casts
- Prefer **type aliases** over interfaces
- Prefer **named exports** over default exports
- Use `void (async () => { ... })()` pattern for fire-and-forget in Phaser event handlers
- Server routes use `async (c) => { ... }` Hono handler signature
- All Redis keys use `:`-separated namespaces: `user:{name}`, `level:{id}`, `lb:global:{board}`
- Shared types in `src/shared/` only — no cross-imports between client and server
- No `import` from `@devvit/public-api` — Devvit Web only

---

## Testing

```
npm run type-check   ← Run first; catches type errors
npm run lint         ← ESLint
npm run dev          ← devvit playtest (requires Reddit auth)
```

Test on Devvit's UI Simulator across: mobile (portrait), tablet (landscape), desktop.

---

## Hackathon Context

**Event**: Reddit Games with a Hook — deadline July 15, 2026 @ 6:00pm PDT  
**Target prizes**: Best App with a Hook ($15k), Best Use of Phaser ($5k), Best Use of User Contributions ($3k), Best Use of Retention Mechanics ($3k)  
**What judges want**: polish, mobile-first, daily engagement loops, user-generated content, community identity  
**What to avoid**: AI slop aesthetic, literal Reddit theming, generic game clones

Every feature decision should answer: "Does this give players a reason to come back tomorrow?"
