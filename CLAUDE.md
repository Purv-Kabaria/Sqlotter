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
  underwear.png
```

`horizontal-*` = element oriented left-right across the slime.
`vertical-*` = element oriented top-to-bottom on the slime.

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
                   underwear, belt-thick, belt-thin
icons/hud/         heart, spark, star, fire
icons/community/   people, trophy, pencil, gold, silver, bronze
icons/shop/        bag, lock, unlock, price
icons/status/      check, cross, warning
icons/misc/        plus, minus, dot, sparkle
backgrounds/       background 1/, background 2/, background 3/, background 4/
```

---

## Game Mechanics

### Core Loop
1. Player loads a level (from curated set, daily, or user-generated)
2. See the **goal pattern** — a BARE slime painted in zones of color (never with modifiers attached)
3. Tap palette items: **paint** splashes color over everything unprotected; **stencils** (goggles/glasses/belts/pendants/pumpkins/underwear) toggle on/off — worn stencils protect what they cover from paint. **Goggles are one-time use**: the splash that lands on them knocks them off broken (automatic, free) and they can't be worn again until a reset
4. Each logged tap = 1 step (wearing, removing, and painting all cost a step); order matters
5. When the painted pattern matches the goal AND nothing is worn → level complete → earn Sparks

### Simulation Model (src/shared/slimeSim.ts)
The slime is a 64×64 cell grid. `BODY_MASK` marks body cells; `MASK_BITMAPS[maskId]`
marks each stencil's coverage — both baked from the real PNG alpha channels by
`scripts/generate_masks.py` into `src/shared/maskData.ts`, so client and server run
the identical simulation with no canvas.

```typescript
type SimState = {
  grid: Uint8Array;   // per-cell index into colors
  colors: string[];   // colors[0] = '#FFFFFF' (unpainted)
  worn: string[];     // mask ids currently worn, in order
  broken: string[];   // goggles broken this run (a splash landed on them)
};
```

- Paint action: every body cell not covered by a worn stencil ← the paint color; then
  every worn GOGGLES mask snaps off into `broken` (automatic, no action logged)
- Stencil action: toggle — on if off, off if on. Broken goggles refuse the tap
  (nothing logged; replays containing one are invalid). Everything else is a free
  toggle — no conflicts, no counts
- Action ids resolve against the palette PLUS the standard catalog
  (`resolveActionDef`): the 16 paints (`PAINT_COLORS_16`) and the 3 pumpkin sizes are
  always available — the color picker always offers the full 16-color rack, the
  pumpkin picker all three sizes
- Win (`isCleanMatch`): all body cells match the goal replay's colors && `worn` is empty
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

For the **Splot mascot** in menus/shop (not puzzle):
```
depth  5 — character/shadow.png
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
Key:   user:{userId}
Type:  hash
Fields:
  sparks               ← number
  unlockedItemsJson    ← JSON.stringify(string[])  ← item IDs
  preferencesJson      ← JSON.stringify(UserPrefs)
  levelsCompletedCount
  optimalSolvesCount
  joinedAt
```

### Level Completion Record (per user per level)
```
Key:   completion:{levelId}:{userId}
Type:  hash
Fields:
  bestSteps    ← best steps in a successful attempt
  bestTimeMs
  attempts
  completedAt  ← first completion timestamp
  isOptimal    ← "1" | "0"
```

### Leaderboards (Redis Sorted Sets)
```
leaderboard:level:{levelId}:steps   score=steps    member=username
leaderboard:level:{levelId}:time    score=timeMs   member=username
leaderboard:global:levels_solved    score=count    member=userId
leaderboard:global:accuracy         score=pct×100  member=userId  (integer 0-10000)
leaderboard:global:sparks           score=sparks   member=userId
```

Use `zAdd` with `{ NX: true }` to insert best scores only (or `{ LT: true }` for steps/time where lower=better).

### Daily Puzzle Index
```
Key:   daily:{YYYY-MM-DD}
Type:  string → levelId
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
- `Leaderboard.ts` — per-level and global boards
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
  ├─ [Play]           → LevelSelect
  ├─ [Daily Puzzle]   → Game (daily level)
  ├─ [Leaderboards]   → Leaderboard
  ├─ [Create Level]   → (login gate) → Editor
  └─ [Shop]           → (login gate) → Shop

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
GET  /api/init              → { postId, username, isLoggedIn }
GET  /api/level/:levelId    → LevelResponse
GET  /api/daily             → DailyResponse (today's level)
POST /api/complete          → { levelId, steps, timeMs } → CompletionResponse
GET  /api/leaderboard/level/:levelId   → LeaderboardResponse
GET  /api/leaderboard/global/:type     → LeaderboardResponse
GET  /api/user/profile      → UserProfileResponse
POST /api/user/equip        → { itemId } → EquipResponse
GET  /api/levels/list       → LevelsListResponse
POST /api/level/create      → LevelCreateRequest → LevelCreateResponse
```

### Type conventions
- All request/response types live in `src/shared/api.ts`
- Prefer type aliases over interfaces
- Never cast types (`as`)
- All Redis values are strings; parse on read, stringify on write

---

## Sparks Economy

| Event | Sparks earned |
|-------|--------------|
| Level complete (any steps) | 10 |
| Level complete in optimal steps | +20 bonus |
| Daily puzzle complete | +15 bonus |
| First to complete a level | +30 bonus |
| User-level gets 10 plays | +5 (passive) |

| Item | Sparks cost |
|------|------------|
| Extra eye style | 50 |
| Extra mouth style | 50 |
| Extra eyebrow style | 30 |
| Accessory (cap, hat) | 80 |
| Accessory (crown, horns) | 150 |
| Accessory (party-hat) | 80 |

---

## Daily Puzzle System

Declare in `devvit.json`:
```json
"scheduler": {
  "tasks": {
    "daily-puzzle": {
      "endpoint": "/internal/scheduler/daily-puzzle",
      "cron": "0 8 * * *"
    }
  }
}
```

Server handler generates a random solvable level using the level generation algorithm, calls `reddit.submitCustomPost()`, and stores the mapping `daily:{YYYY-MM-DD}` → `levelId` in Redis.

**Generation algorithm:**
1. Pick difficulty tier (1-5) based on day of week
2. Pick N random compatible modifiers from modifier pool
3. Apply them in a valid sequence to get a target state
4. Store the generating sequence as `optimalSolution`
5. Optionally add 1-2 decoy modifiers (valid but not needed)

---

## Code Style (enforced by existing project)

- **TypeScript strict** — no `any`, no type casts
- Prefer **type aliases** over interfaces
- Prefer **named exports** over default exports
- Use `void (async () => { ... })()` pattern for fire-and-forget in Phaser event handlers
- Server routes use `async (c) => { ... }` Hono handler signature
- All Redis keys use `:`-separated namespaces: `user:{id}`, `level:{id}`, `leaderboard:{...}`
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
