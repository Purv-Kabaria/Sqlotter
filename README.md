# Splot! — The Slime Puzzle Game

> A Factory-Balls-style sequence puzzle game built on Reddit's Devvit platform. Craft the perfect slime by applying modifiers in the right order. Customise your mascot Splot, compete on leaderboards, and solve a fresh community puzzle every day.

---

## Table of Contents

1. [Game Overview](#1-game-overview)
2. [Core Mechanic](#2-core-mechanic)
3. [Modifier System](#3-modifier-system)
4. [Incompatibility Rules](#4-incompatibility-rules)
5. [Character & Customisation](#5-character--customisation)
6. [Progression & Sparks Economy](#6-progression--sparks-economy)
7. [Leaderboard System](#7-leaderboard-system)
8. [Daily Puzzle System](#8-daily-puzzle-system)
9. [User-Generated Levels](#9-user-generated-levels)
10. [Screens & Layouts](#10-screens--layouts)
11. [Technical Architecture](#11-technical-architecture)
12. [Low-Level Design (LLD)](#12-low-level-design-lld)
13. [API Reference](#13-api-reference)
14. [Data Schemas](#14-data-schemas)
15. [Edge Cases & Failure Modes](#15-edge-cases--failure-modes)
16. [Development Setup](#16-development-setup)
17. [Hackathon Context](#17-hackathon-context)

---

## 1. Game Overview

**Splot!** is a logic puzzle game where every level presents a **goal slime** — a round, blob-shaped character decorated with a specific combination of accessories (goggles, belts, paint colours, pumpkin masks, etc.). The player's job is to reproduce that exact appearance by applying the available **modifiers** in the correct sequence.

The concept is inspired by the classic browser game **Factory Balls** (Bart Bonte, 2009), where players drag balls through tools in the right order to decorate them. Splot! adapts this for:

- **Reddit's Devvit platform** (Interactive Posts, runs in the feed)
- **Mobile-first design** (tap-to-apply modifiers)
- **Community features** (daily puzzles, user-generated levels, leaderboards)
- **Persistent mascot** (Splot, customisable with Sparks)

**Elevator pitch:** "Wordle meets Factory Balls on Reddit — solve the slime, climb the board, come back tomorrow."

---

## 2. Core Mechanic

### The Puzzle

Each level contains:

| Element | Description |
|---------|-------------|
| **Goal Slime** | The target appearance the player must recreate |
| **Your Slime** | The player's current slime (starts at default state) |
| **Modifier Palette** | The set of tools available for this level (4–12 items) |
| **Step Counter** | Counts each modifier application |
| **Timer** | Tracks elapsed time (affects secondary leaderboard) |

### Solving a Level

1. Study the goal slime (colour, accessories, their visual properties)
2. Identify which modifiers produce which visual effect
3. Tap modifiers to apply them in sequence
4. If the slime matches the goal → **level complete**
5. If stuck → tap **Reset** (resets slime state; step count continues accumulating in the current attempt)
6. The winning attempt's step count is recorded as the player's best for that level

### Why Order Matters

Modifiers are **stateful** and **partially exclusive**:

- Applying **blue paint** then **goggles** → blue slime with goggles
- Applying **goggles** then **blue paint** → same result (paint does not affect goggle colour)
- Applying **red paint** then **blue paint** → blue slime (second paint overrides first)
- Applying **pumpkin-75%** then **underwear** → invalid (incompatibility rule fires)

The puzzle author chooses a target state and an available modifier set. The optimal solution is the shortest valid sequence that produces the target.

### Modifier Application Flow

```
Player taps modifier M
        |
Is M compatible with current slime state?
        |                           |
       NO                          YES
        |                           |
 Shake animation            Apply modifier to state
 Show toast "reason"        Play apply animation
 Block application          Update step counter
                            Check win condition
                                    |
                        Does state == goal?
                            |           |
                          YES           NO
                            |           |
                     Level Complete  Continue
```

---

## 3. Modifier System

### Modifier Types

#### Paint
- Changes the slime's base `color` property
- No visual element added; only the tint of `slime/color.png` changes
- Multiple paints can be applied; each overrides the previous
- Available colours are defined per-level (each colour is a separate palette item)

#### Goggles (`goggles`)
- Adds an eye-area overlay to the slime
- **6 variants**: `h-thick`, `h-thin`, `h-mono`, `v-thick`, `v-thin`, `v-mono`
- **One-shot mechanic**: After goggles are applied in an attempt, the icon greys out permanently for that attempt. Resetting the slime restores the icon.
- Occupies the **Eye Slot** — mutually exclusive with Glasses

#### Glasses (`glasses`)
- Adds a glasses overlay to the slime
- **4 variants**: `h-thick`, `h-thin`, `v-thick`, `v-thin`
- Can be re-applied to swap variants (replaces previous glasses)
- Occupies the **Eye Slot** — mutually exclusive with Goggles

#### Belt (`belt`)
- Adds a band/stripe overlay across the slime's midsection
- **4 variants**: `h-thick`, `h-thin`, `v-thick`, `v-thin`
- One belt active at a time; applying a new belt replaces the previous
- Occupies the **Belt Slot**

#### Pendant (`pendant`)
- Adds a necklace/charm overlay on the upper slime
- **2 variants**: `h` (horizontal), `v` (vertical)
- One pendant active at a time; applying a new pendant replaces the previous
- Occupies the **Pendant Slot**

#### Pumpkin (`pumpkin`)
- Overlays a pumpkin pattern covering a percentage of the slime
- **3 coverage values**: 25%, 50%, 75%
- Applying a new pumpkin replaces the previous coverage level
- Interacts with Belt and Underwear slots at 75% coverage

#### Underwear (`underwear`)
- Adds a cartoon underwear overlay at the bottom of the slime
- Single variant; binary (on/off)
- Occupies the **Underwear Slot**

### Modifier Asset Naming Convention

```
modifiers/{orientation}-{type}-{size}.png

Examples:
  modifiers/horizontal-goggles-thick.png
  modifiers/vertical-belt-thin.png
  modifiers/pumpkin-50.png
  modifiers/underwear.png
```

`h` = horizontal (element spans left-to-right on the slime)
`v` = vertical (element spans top-to-bottom on the slime)

### Slime State Type

```typescript
type SlimeColor = string; // hex "#RRGGBB"
type GogglesVariant = 'h-thick' | 'h-thin' | 'h-mono' | 'v-thick' | 'v-thin' | 'v-mono';
type GlassesVariant = 'h-thick' | 'h-thin' | 'v-thick' | 'v-thin';
type BeltVariant    = 'h-thick' | 'h-thin' | 'v-thick' | 'v-thin';
type PendantVariant = 'h' | 'v';
type PumpkinCoverage = 25 | 50 | 75;

type SlimeState = {
  color: SlimeColor;
  goggles: GogglesVariant | null;
  glasses: GlassesVariant | null;
  belt: BeltVariant | null;
  pendant: PendantVariant | null;
  pumpkin: PumpkinCoverage | null;
  underwear: boolean;
};
```

`gogglesUsed` is runtime-only (`boolean`) and is NOT persisted in the level definition or goal state.

### Win Condition

```typescript
function statesMatch(current: SlimeState, goal: SlimeState): boolean {
  return (
    current.color     === goal.color     &&
    current.goggles   === goal.goggles   &&
    current.glasses   === goal.glasses   &&
    current.belt      === goal.belt      &&
    current.pendant   === goal.pendant   &&
    current.pumpkin   === goal.pumpkin   &&
    current.underwear === goal.underwear
  );
}
```

---

## 4. Incompatibility Rules

These rules exist for logical, gameplay, and comedic reasons. All checks run against the current `SlimeState` before a modifier is applied.

| Rule ID | When triggered | Blocked condition | Player toast message |
|---------|---------------|-------------------|---------------------|
| `EYE-SLOT` | Apply goggles | `glasses !== null` | "Splot can't see through all that!" |
| `EYE-SLOT` | Apply glasses | `goggles !== null` | "Splot can't see through all that!" |
| `GOGGLE-ONE-SHOT` | Apply goggles | `gogglesUsed === true` | "Those goggles are all used up!" |
| `PUMPKIN-UNDERWEAR` | Apply underwear | `pumpkin === 75` | "There's no room for undies on that pumpkin!" |
| `UNDERWEAR-PUMPKIN75` | Apply pumpkin 75% | `underwear === true` | "Take the undies off first!" |
| `THICK-BELT-PUMPKIN75` | Apply pumpkin 75% | `belt === 'h-thick' \| 'v-thick'` | "The pumpkin ate the belt!" |
| `PUMPKIN75-THICK-BELT` | Apply thick belt | `pumpkin === 75` | "Can't belt a full pumpkin!" |

**Combos that ARE allowed:**

| Combo | Notes |
|-------|-------|
| Belt + Underwear | Different regions of slime |
| Belt + Pendant | Different slots |
| Pumpkin 25% or 50% + Belt (any) | Below 75% — no conflict |
| Pumpkin 25% or 50% + Underwear | Below 75% — no conflict |
| Glasses + Belt + Pendant | All different slots |
| Multiple paints in sequence | Each overrides previous colour |
| Pendant + Goggles | Different slots |

---

## 5. Character & Customisation

### Splot the Mascot

Splot is the player's personal slime mascot. Unlike the puzzle slime, Splot is the player's identity — shown in menus, the shop, win screens, and shared post thumbnails.

Splot is rendered from layered PNG sprites in `public/assets/character/`:

**Rendering order:**
```
character/shadow.png          (depth 5)
character/blob.png            (depth 10)  — tinted to player's chosen colour
character/mouth/*.png         (depth 20)
character/mouth/blush.png     (depth 22)  — contextual
character/mouth/cry.png       (depth 22)  — contextual
character/eyes/*.png          (depth 30)
character/eyebrows/*.png      (depth 40)
character/accessories/*.png   (depth 50)
character/overlay-normal.png  (depth 60)
character/outline.png         (depth 65)
```

### Customisable Items (purchased with Sparks)

| Category | Items | Cost |
|----------|-------|------|
| Eyes | eye-doubt, eye-cute, eye-pain, eye-happy, eye-shock, eye-open | 50 Sparks each |
| Eyebrows | eyebrow-surprise, eyebrow-sad, eyebrow-angry | 30 Sparks each |
| Mouth | mouth-squiggle, mouth-frown, mouth-kiss, mouth-smile, mouth-ooo | 50 Sparks each |
| Accessories | cap, hat, party-hat | 80 Sparks each |
| Premium accessories | crown, horns | 150 Sparks each |

**Default unlocked (free):** `eye-normal`, `eyebrow-normal`, `mouth-happy`

### Dynamic Expressions (automatic, not purchased)

The game overrides Splot's expression temporarily during gameplay events. These revert after 2 seconds:

| Event | Eyes | Eyebrows | Mouth | Extra |
|-------|------|----------|-------|-------|
| Modifier applied | eye-happy | eyebrow-normal | mouth-smile | — |
| Incompatibility | eye-shock | eyebrow-surprise | mouth-ooo | shake tween |
| Win | eye-cute | eyebrow-normal | mouth-kiss | particles |
| Wrong attempt | eye-pain | eyebrow-sad | mouth-frown | — |
| Idle > 5s | eye-doubt | eyebrow-normal | mouth-squiggle | — |

---

## 6. Progression & Sparks Economy

### Earning Sparks

| Action | Base | Bonus |
|--------|------|-------|
| Complete any level | 10 | — |
| Complete in optimal steps | 10 | +20 |
| Complete daily puzzle | 10 | +15 |
| 1st player to complete a level | 10 | +30 |
| 2nd player to complete a level | 10 | +20 |
| 3rd player to complete a level | 10 | +10 |
| Own user-level receives 10 plays | 0 | +5 |
| Own user-level receives 50 plays | 0 | +15 |
| 7-day daily puzzle streak | 0 | +50 |

### Spending Sparks

| Item | Cost |
|------|------|
| Eye style | 50 |
| Mouth style | 50 |
| Eyebrow style | 30 |
| Regular accessory (cap/hat/party-hat) | 80 |
| Premium accessory (crown/horns) | 150 |

### Stars (displayed on Level Select)

| Stars | Condition |
|-------|-----------|
| ⭐ | Completed (any step count) |
| ⭐⭐ | Completed in ≤ 2× optimal steps |
| ⭐⭐⭐ | Completed in exactly optimal steps |

---

## 7. Leaderboard System

### Per-Level Leaderboards

Each level has two separate leaderboards (shown as tabs):

| Tab | Sort key | Display |
|-----|----------|---------|
| Fewest Steps | steps ASC | rank, username, step count |
| Fastest | timeMs ASC | rank, username, formatted time |

Only successful completions count. Each user's **best** result is kept (`zAdd` with `LT: true`).

Top 3 entries display gold/silver/bronze medal icons from `icons/community/`.

### Global Leaderboards

Three global boards accessible from `MainMenu`:

| Board | Metric | Sort |
|-------|--------|------|
| Most Levels Solved | `levelsCompletedCount` | DESC |
| Most Accurate | `(optimalSolves / total) × 100` | DESC |
| Most Sparks | `sparks` | DESC |

Global boards display top 50. The current player's own rank is always shown even if outside top 50.

### Realtime Updates

When a player submits a level completion, the server pushes a realtime event:

```typescript
await realtime.send(`leaderboard:${levelId}`, {
  type: 'new-entry',
  username,
  steps,
  timeMs,
  rank,
});
```

The `Leaderboard` scene subscribes and live-updates the display. Falls back to 30-second polling if the realtime connection drops.

---

## 8. Daily Puzzle System

### Schedule

A Devvit scheduler cron runs daily at **08:00 UTC**:

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

### Generation Algorithm

```
1. Determine difficulty tier (1–5) by day-of-week:
   Mon=1, Tue=2, Wed=3, Thu=4, Fri=4, Sat=5, Sun=3

2. Select N modifiers from weighted pool:
   N = difficulty + 2  (range: 3–7)

3. Build a valid solution sequence:
   a. Start with default SlimeState
   b. For each step, pick a random compatible modifier and apply
   c. Retry up to 10 times on incompatibility; discard sequence if unresolvable
   d. Record sequence as optimalSolution

4. Add 1–2 "decoy" modifiers (valid but not needed) to increase apparent complexity

5. Validate: solution sequence produces the goal state (server-side simulation)

6. Store level in Redis

7. reddit.submitCustomPost({ title: "Splot! Daily Puzzle — {date}" })

8. Store daily:{YYYY-MM-DD} → levelId in Redis
```

### Daily Post Structure

Each daily puzzle appears as its own Interactive Post in the subreddit. The splash view (inline feed) shows:
- The date and "Daily Puzzle" label
- Goal slime preview (rendered from `postData`)
- Time remaining countdown
- Current completion count

### First-Completion Rewards

The first 3 players to solve the daily puzzle receive bonus Sparks (stored in `daily:{date}:first-completions` sorted set):

| Rank | Bonus Sparks |
|------|-------------|
| 1st | +50 |
| 2nd | +30 |
| 3rd | +20 |

---

## 9. User-Generated Levels

### Level Editor (`Editor` scene)

Available to logged-in users from `MainMenu`. The editor provides:

1. **Goal Slime Builder** — full modifier palette to design the target state
2. **Available Modifiers Picker** — choose which modifiers appear in the player's palette (min 3, max 12)
3. **Test Mode** — play the level as created; step count recorded as reference for optimal
4. **Title field** — up to 60 characters
5. **Publish** — creates a Reddit post and stores the level in Redis

**Validation (server-side before publish):**
- Goal state must differ from default (at least 1 modifier applied)
- The available palette must contain a valid solution path to the goal state
- Optimal solution length: 1–15 steps
- No incompatible goal states (e.g., goggles + glasses simultaneously)
- No duplicate modifier variants in the palette

### User Level Posts

Published as Interactive Posts: **"Splot Level by u/{author} — {title}"**

Each user-level post includes:
- Its own per-level leaderboard (steps + time)
- Play count and completion rate displayed in splash
- Star rating (1–5) after completing

### Discovery

Community levels are discoverable through:
- `LevelSelect` → "Community Levels" section (sorted by plays DESC)
- The game subreddit's post feed (each level = 1 post)
- Level editor publishes prompt a share sheet (`showShareSheet`)

---

## 10. Screens & Layouts

### Screen Inventory

| Scene | Entry | Description |
|-------|-------|-------------|
| `Splash` | Inline feed view | Preview; Start button; daily countdown |
| `MainMenu` | After Start | Navigation hub |
| `LevelSelect` | Play button | Grid with stars + lock states |
| `Game` | Select level | Core puzzle gameplay |
| `LevelComplete` | Win condition | Stars, Sparks earned, ranks |
| `Editor` | Create Level | Build and publish custom puzzles |
| `Leaderboard` | Trophy icon | Per-level and global rankings |
| `Shop` | Bag icon | Buy cosmetics with Sparks |
| `Settings` | Gear icon | Sound, account info |
| `GameOver` | Error/timeout | Error fallback |

### Splash Screen (Inline, ~50 KB max)

```
┌─────────────────────────────┐
│   Splot!                    │
│                             │
│   [Goal Slime Preview]      │
│   "Can you make this?"      │
│                             │
│   Daily Puzzle  ⏱ 14h 22m  │
│                             │
│       [ Play Now ]          │
└─────────────────────────────┘
```

Rendered in plain HTML/CSS (no Phaser). Uses `context.postData` for goal preview. Calls `requestExpandedMode('game')` on click.

### Main Menu

```
┌────────────────────────┐
│  [⚙]             [?]  │
│                        │
│      [Splot mascot]    │
│    Hey {username}!     │
│                        │
│  ┌──────────────────┐  │
│  │  Daily Puzzle    │  │
│  └──────────────────┘  │
│  [Play]   [Leaderboard]│
│  [Create] [Shop]       │
│                        │
│  ✨ 230 Sparks         │
└────────────────────────┘
```

### Level Select

```
┌──────────────────────────────┐
│  [←] Levels            [🏆] │
├──────────────────────────────┤
│  World 1 — Basics            │
│  ┌────┐ ┌────┐ ┌────┐       │
│  │ 1  │ │ 2  │ │ 3  │       │
│  │⭐⭐⭐│ │⭐⭐ │ │ 🔒 │       │
│  └────┘ └────┘ └────┘       │
│  World 2 — Layers            │
│  ┌────┐ ┌────┐               │
│  │ 4  │ │ 5  │               │
│  │ 🔒 │ │ 🔒 │               │
│  └────┘ └────┘               │
│  Community Levels            │
│  [Browse User Levels ↗]      │
└──────────────────────────────┘
```

Level N+1 unlocks when Level N is completed (1-star threshold).

### Game Screen — Portrait Mobile (390 × 844)

```
┌───────────────────────┐  390px wide
│ [←] Level 12   ⏱ 05s │  56px — HUD row 1
│ Steps: 3  [Reset] [?] │  44px — HUD row 2
├───────────────────────┤
│        GOAL           │
│  ┌─────────────────┐  │
│  │   [Goal Slime]  │  │  180×180
│  └─────────────────┘  │
├───────────────────────┤
│         YOU           │
│  ┌─────────────────┐  │
│  │ [Current Slime] │  │  180×180
│  └─────────────────┘  │
├───────────────────────┤
│   Modifier Palette    │
│ ┌──┐ ┌──┐ ┌──┐ ┌──┐ │  64×64 tiles
│ │M1│ │M2│ │M3│ │M4│ │
│ └──┘ └──┘ └──┘ └──┘ │
│ ┌──┐ ┌──┐ ┌──┐      │
│ │M5│ │M6│ │M7│      │
│ └──┘ └──┘ └──┘      │
└───────────────────────┘
```

### Game Screen — Landscape Desktop (1024 × 768)

```
┌──────────────────────────────────────────────────┐
│ [←] Level 12        ⏱ 05s   Steps: 3  [Reset][?]│ 56px HUD
├───────────────────┬──────────────────────────────┤
│                   │   GOAL           YOU          │
│  MODIFIERS        │  ┌────────┐  ┌────────┐      │
│  ┌──┐ ┌──┐       │  │ Goal   │  │  You   │      │
│  │M1│ │M2│       │  └────────┘  └────────┘      │
│  └──┘ └──┘       │                               │
│  ┌──┐ ┌──┐       │                               │
│  │M3│ │M4│  220px│                               │
│  └──┘ └──┘       │                               │
│  ┌──┐ ┌──┐       │                               │
│  │M5│ │M6│       │                               │
│  └──┘ └──┘       │                               │
└───────────────────┴──────────────────────────────┘
```

### Level Complete

```
┌───────────────────────┐
│                       │
│    ✨ Solved! ✨       │
│  [Splot celebrating]  │
│                       │
│      ⭐ ⭐ ⭐          │
│                       │
│  Steps:  4 / 3 opt.   │
│  Time:   00:12        │
│  Earned: +10 ✨       │
│                       │
│  [Leaderboard 🏆]     │
│  [← Menu] [Next →]   │
└───────────────────────┘
```

### Shop / Customisation

```
┌──────────────────────────┐
│  [←] Splot Shop          │
│       ✨ 230 Sparks       │
├──────────────────────────┤
│  [Eyes][Mouth][Brows][+] │  ← category tabs
├──────────────────────────┤
│  [Splot preview with     │
│   currently selected]    │
├──────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐  │
│  │ N  │ │ ?  │ │ 🔒 │  │  N = equipped, ? = buy
│  │ ✓  │ │50✨│ │50✨│  │
│  └────┘ └────┘ └────┘  │
└──────────────────────────┘
```

---

## 11. Technical Architecture

### System Diagram

```
Reddit Feed (iFrame)
┌─────────────────────────────────────────────┐
│  SPLASH (splash.html + splash.ts)           │
│  • Plain HTML/CSS — no Phaser               │
│  • Reads postData for goal preview          │
│  • requestExpandedMode('game') on click     │
└───────────────────┬─────────────────────────┘
                    | requestExpandedMode
┌───────────────────▼─────────────────────────┐
│  GAME (game.html + game.ts)                 │
│  Phaser 4 scene pipeline:                   │
│  Boot → Preloader → MainMenu                │
│       → LevelSelect → Game → LevelComplete  │
│       → Editor → Leaderboard → Shop         │
│                                             │
│  Server calls: fetch('/api/...')            │
└───────────────────┬─────────────────────────┘
                    | HTTP (same origin)
┌───────────────────▼─────────────────────────┐
│  SERVER (src/server/index.ts — Hono/Node)   │
│                                             │
│  /api/*         ← game API routes           │
│  /internal/*    ← Devvit-managed routes     │
│    /menu/*      ← moderator menu actions    │
│    /form/*      ← form submissions          │
│    /triggers/*  ← Reddit event triggers     │
│    /scheduler/* ← cron job handlers         │
│                                             │
│  redis     — KV + sorted sets               │
│  reddit    — submit posts, get user         │
│  scheduler — cron + one-off jobs            │
│  realtime  — push events to clients         │
│  context   — postId, userId, subredditName  │
└─────────────────────────────────────────────┘
```

### Phaser Scene Graph

```
Boot  →  Preloader  →  MainMenu
                         ├→ LevelSelect  →  Game  →  LevelComplete
                         │                              ├→ Game (next)
                         │                              └→ LevelSelect
                         ├→ Leaderboard
                         ├→ Shop
                         ├→ Editor  →  Game (test mode)
                         └→ Settings (UI overlay, not a scene)
```

### Responsive Layout Strategy

All scenes use `Phaser.Scale.RESIZE` mode and re-layout on the `resize` event:

```typescript
create() {
  this.scale.on('resize', this.onResize, this);
  this.onResize(this.scale);
}

onResize(gameSize: Phaser.Structs.Size) {
  const { width, height } = gameSize;
  this.cameras.resize(width, height);
  const sf = Math.min(width / 1024, height / 768, 1);
  // reposition and rescale all game objects using sf
}
```

Portrait breakpoint: `height > width`. Switch to landscape layout when `width > height`.

---

## 12. Low-Level Design (LLD)

### LevelEngine (client-side)

```typescript
// src/client/engine/LevelEngine.ts
class LevelEngine {
  private state: SlimeState;
  private readonly goalState: SlimeState;
  private stepCount = 0;
  private gogglesUsed = false;

  constructor(level: LevelData) {
    this.state = defaultSlimeState();
    this.goalState = level.targetSlime;
  }

  applyModifier(modifier: ModifierAction): ApplyResult {
    const conflict = checkCompatibility(this.state, modifier, this.gogglesUsed);
    if (conflict) return { success: false, conflict };

    this.state = applyModifierToState(this.state, modifier);
    this.stepCount++;
    if (modifier.type === 'goggles') this.gogglesUsed = true;

    return {
      success: true,
      newState: this.state,
      isWin: statesMatch(this.state, this.goalState),
    };
  }

  reset() {
    this.state = defaultSlimeState();
    this.gogglesUsed = false;
    // stepCount intentionally kept — accumulates across resets within one play session
  }

  getStepCount() { return this.stepCount; }
  getState()     { return { ...this.state }; }
}
```

### SlimeRenderer (Phaser Container)

```typescript
// src/client/components/SlimeRenderer.ts
class SlimeRenderer {
  readonly container: Phaser.GameObjects.Container;
  private layers: Map<string, Phaser.GameObjects.Image>;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.container = scene.add.container(x, y);
    this.layers = new Map();
    this.buildLayers(scene);
  }

  updateState(state: SlimeState) {
    const color = Phaser.Display.Color.HexStringToColor(state.color).color;
    this.layer('slime-color').setTint(color);

    this.setLayer('mod-pumpkin',    state.pumpkin  ? `modifier-pumpkin-${state.pumpkin}` : null);
    this.setLayer('mod-underwear',  state.underwear ? 'modifier-underwear' : null);
    this.setLayer('mod-belt',       state.belt     ? `modifier-belt-${state.belt}` : null);
    this.setLayer('mod-pendant',    state.pendant  ? `modifier-pendant-${state.pendant}` : null);

    const eyeKey = state.goggles ? `modifier-goggles-${state.goggles}`
                 : state.glasses ? `modifier-glasses-${state.glasses}` : null;
    this.setLayer('mod-eye', eyeKey);
  }

  private setLayer(key: string, textureKey: string | null) {
    const img = this.layer(key);
    if (textureKey) {
      img.setTexture(textureKey).setVisible(true);
    } else {
      img.setVisible(false);
    }
  }

  private layer(key: string) {
    return this.layers.get(key)!;
  }
}
```

### Redis Leaderboard Operations

```typescript
// src/server/core/leaderboard.ts
import { redis } from '@devvit/web/server';

const stepsKey = (id: string) => `leaderboard:level:${id}:steps`;
const timeKey  = (id: string) => `leaderboard:level:${id}:time`;

export async function recordCompletion(
  levelId: string, username: string, steps: number, timeMs: number
) {
  await Promise.all([
    // LT = only update if new score is lower (better)
    redis.zAdd(stepsKey(levelId), [{ score: steps,  member: username }], { LT: true }),
    redis.zAdd(timeKey(levelId),  [{ score: timeMs, member: username }], { LT: true }),
  ]);
}

export async function getTopEntries(levelId: string, by: 'steps' | 'time', count = 10) {
  const key = by === 'steps' ? stepsKey(levelId) : timeKey(levelId);
  return redis.zRange(key, 0, count - 1, { by: 'rank' });
}

export async function getUserRank(levelId: string, username: string, by: 'steps' | 'time') {
  const key = by === 'steps' ? stepsKey(levelId) : timeKey(levelId);
  return redis.zRank(key, username);
}
```

### Daily Puzzle Generator

```typescript
// src/server/core/dailyGenerator.ts
import { redis, reddit, context } from '@devvit/web/server';

const MODIFIER_POOL: ModifierDef[] = [/* all available modifiers */];
const DIFFICULTY_BY_DOW = [3, 1, 2, 3, 4, 4, 5]; // Sun=0 … Sat=6

export async function generateAndPublishDaily(date: string) {
  const dow = new Date(date).getDay();
  const difficulty = DIFFICULTY_BY_DOW[dow];
  const level = generateLevel(difficulty);

  const levelId = crypto.randomUUID();
  await redis.hSet(`level:${levelId}`, {
    id: levelId,
    title: `Daily Puzzle — ${date}`,
    authorId: 'APP',
    authorName: 'Splot',
    targetSlimeJson: JSON.stringify(level.goalState),
    modifiersJson: JSON.stringify(level.palette),
    optimalSteps: String(level.solution.length),
    optimalSolutionJson: JSON.stringify(level.solution),
    difficulty: String(difficulty),
    isDaily: '1',
    dailyDate: date,
    createdAt: String(Date.now()),
  });

  const post = await reddit.submitCustomPost({
    title: `Splot! Daily Puzzle — ${date}`,
  });

  await redis.hSet(`level:${levelId}`, { postId: post.id });
  await redis.set(`daily:${date}`, levelId);

  return { levelId, postId: post.id };
}
```

---

## 13. API Reference

### GET /api/init

```typescript
type InitResponse = {
  postId: string;
  username: string | null;
  isLoggedIn: boolean;
  sparks: number;
  equippedItems: Record<string, string>; // slot → itemId
};
```

### GET /api/daily

```typescript
type DailyResponse = {
  date: string;           // "YYYY-MM-DD"
  levelId: string;
  level: LevelData;
  playCount: number;
  completionCount: number;
  firstCompletions: Array<{ username: string; timeMs: number }>;
};
```

### GET /api/level/:levelId

```typescript
type LevelData = {
  id: string;
  title: string;
  authorId: string;
  authorName: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  targetSlime: SlimeState;
  availableModifiers: ModifierDef[];
  optimalSteps: number;
  isDaily: boolean;
  playCount: number;
  completionCount: number;
};

type ModifierDef = {
  id: string;        // e.g. "goggles-h-thick"
  type: 'paint' | 'goggles' | 'glasses' | 'belt' | 'pendant' | 'pumpkin' | 'underwear';
  variant: string;
  color?: string;    // for paint only
};
```

### POST /api/complete

**Request:**
```typescript
type CompleteRequest = {
  levelId: string;
  steps: number;
  timeMs: number;
  solution: ModifierAction[];
};
```

**Response:**
```typescript
type CompleteResponse = {
  sparksEarned: number;
  totalSparks: number;
  isOptimal: boolean;
  stars: 1 | 2 | 3;
  stepRank: number | null;
  timeRank: number | null;
  isFirstCompletion: boolean;
};
```

### GET /api/leaderboard/level/:levelId?by=steps|time&limit=50

### GET /api/leaderboard/global?type=levels_solved|accuracy|sparks&limit=50

### GET /api/user/profile

### POST /api/user/equip — body: `{ itemId: string }`

### GET /api/levels/list?page=0&size=20&filter=curated|community|daily

### POST /api/level/create (login required)

### POST /api/level/:levelId/rate — body: `{ rating: 1|2|3|4|5 }` (login required, after completing)

---

## 14. Data Schemas

### Redis Key Namespace

```
level:{levelId}                  HASH   — level metadata + stats
user:{userId}                    HASH   — user profile
completion:{levelId}:{userId}    HASH   — best attempt per user per level
daily:{YYYY-MM-DD}               STRING — maps date to levelId
leaderboard:level:{id}:steps     ZSET   — score=steps, member=username
leaderboard:level:{id}:time      ZSET   — score=timeMs, member=username
leaderboard:global:levels_solved ZSET   — score=count, member=userId
leaderboard:global:accuracy      ZSET   — score=pct×100 (int), member=userId
leaderboard:global:sparks        ZSET   — score=sparks, member=userId
daily:{date}:first-completions   ZSET   — score=timestamp, member=username (top 3)
levels:curated                   LIST   — ordered curated level IDs
levels:community                 ZSET   — score=playCount, member=levelId
```

### Level Hash Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | UUID |
| `title` | string | max 60 chars |
| `authorId` | string | Reddit user ID or "APP" |
| `authorName` | string | username |
| `targetSlimeJson` | string | `JSON.stringify(SlimeState)` |
| `modifiersJson` | string | `JSON.stringify(ModifierDef[])` |
| `optimalSteps` | string | integer |
| `optimalSolutionJson` | string | `JSON.stringify(ModifierAction[])` |
| `difficulty` | string | "1"–"5" |
| `isDaily` | string | "1" or "0" |
| `dailyDate` | string | "YYYY-MM-DD" or "" |
| `playCount` | string | integer counter |
| `completionCount` | string | integer counter |
| `ratingSum` | string | integer |
| `ratingCount` | string | integer |
| `createdAt` | string | unix ms |
| `postId` | string | Reddit post ID |

### User Hash Fields

| Field | Type | Description |
|-------|------|-------------|
| `sparks` | string | integer |
| `unlockedItemsJson` | string | `JSON.stringify(string[])` |
| `equippedItemsJson` | string | `JSON.stringify(Record<slot, itemId>)` |
| `levelsCompletedCount` | string | integer |
| `optimalSolvesCount` | string | integer |
| `streakCurrentDays` | string | integer |
| `streakLastDate` | string | "YYYY-MM-DD" |
| `joinedAt` | string | unix ms |

---

## 15. Edge Cases & Failure Modes

### Game Logic

| Edge case | Handling |
|-----------|----------|
| Goal slime equals default state | Disallowed in editor validation and generation |
| Level palette has 0 valid solution paths | Server rejects; editor shows validation error |
| Reset during win animation | Reset is debounced for 500ms after win |
| Two simultaneous taps (mobile) | Input lock for 100ms after each modifier apply |
| Goggles applied → reset → goggles applied again | `gogglesUsed` resets on `engine.reset()` |
| Apply modifier while apply animation runs | Debounce lock (100ms) prevents double-apply |
| Step count overflow | Capped at 999 in display; no functional limit |

### Network & Server

| Edge case | Handling |
|-----------|----------|
| `/api/complete` called with wrong solution | Server re-simulates the solution; returns error if invalid |
| `/api/complete` called twice for same level | Check `completion:{levelId}:{userId}` existence; update only if better |
| Daily generation fails | Scheduler retries on non-200; fallback: reuse previous day's level |
| Redis approaching 500 MB | Log warning at 400 MB; archive completions older than 90 days |
| User not logged in tries to complete | Allow local completion; prompt login to persist (`showLoginPrompt`) |
| `postId` missing from context | Return 400; client shows "Open in Reddit" message |
| Server timeout (> 30s) | 408 response; client shows retry toast |

### Leaderboard

| Edge case | Handling |
|-----------|----------|
| Username changes on Reddit | Leaderboards use `userId` as member; display name comes from user hash |
| User submits better score | `LT: true` flag ensures only best (lower) score is kept in the sorted set |
| Leaderboard has 0 entries | "Be the first to solve this!" empty state |
| Realtime subscription disconnects | Automatic 30-second polling fallback |

### Level Editor

| Edge case | Handling |
|-----------|----------|
| Editor creates incompatible goal (goggles + glasses) | Validation before publish; toast + highlight conflicting items |
| User tries to publish with optimal steps = 0 | Blocked: "Your puzzle needs at least 1 step!" |
| Optimal steps > 15 | Warning: "This puzzle might be too hard. Consider simplifying." (not blocked) |
| Palette modifiers cannot reach goal state | Server validation returns path-not-found error; show which modifier is missing |

---

## 16. Development Setup

### Prerequisites

- Node.js ≥ 22.2.0
- Reddit account connected at developers.reddit.com

### Install

```sh
npm install
```

### Dev (Devvit playtest)

```sh
npm run dev
# Streams to: https://www.reddit.com/r/{name}_dev/?playtest={name}
```

Backend calls only work in playtest — not local-only mode.

### Type Check & Lint

```sh
npm run type-check
npm run lint
```

### Deploy & Publish

```sh
npm run deploy    # type-check + lint + upload to Devvit
npm run launch    # deploy + publish (triggers Reddit review)
```

### Testing

| What | How |
|------|-----|
| Responsive layout | Chrome DevTools → Device emulation: 390×844 (mobile), 1024×768 (desktop) |
| Multi-account | Test with developer, moderator, regular-user accounts |
| Daily puzzle | Manually POST to `/internal/scheduler/daily-puzzle` in playtest |
| Leaderboard | Use two browser tabs with different Reddit accounts |

---

## 17. Hackathon Context

**Event:** Reddit Games with a Hook  
**Deadline:** July 15, 2026 @ 6:00pm PDT  
**Total prize pool:** $40,000

### Target Prizes

| Prize | Amount | Splot! qualifier |
|-------|--------|-----------------|
| Best App with a Hook | $15,000 | Daily puzzles + leaderboards + Sparks = daily return loop |
| Best Use of Phaser | $5,000 | Phaser 4 rendering, animations, responsive RESIZE |
| Best Use of User Contributions | $3,000 | Level editor → community Reddit posts → play/rate |
| Best Use of Retention Mechanics | $3,000 | Daily + streaks + Sparks economy + competitive boards |

### Judging Criteria

| Criterion | Splot! answer |
|-----------|--------------|
| **Delightful UX** | Animated Splot expressions, particle effects, < 200ms modifier feedback |
| **Polish** | Mobile-first, no broken states, Devvit-compliant, feature-complete core loop |
| **Reddit-y** | Community puzzle sharing, per-subreddit leaderboards, u/ attribution on levels, daily subreddit post ritual |
| **Hook-y** | Daily puzzle creates a daily ritual; streaks incentivise return; Sparks unlock cosmetics; leaderboard rivalry |
| **Phaser Innovation** | Layer-compositing slime renderer via Containers, RenderTexture for post previews, RESIZE mode for cross-device |

### Anti-patterns to Avoid

- AI-generated art placeholder aesthetic → all sprites are custom
- Literal Reddit theming (karma, Snoo) → focus is on slimes and puzzles
- Cloning a popular game → Factory Balls is relatively obscure; Splot adapts it with original mechanics
- Mobile-unfriendly layout → portrait-first throughout, tested on 390-wide viewports

---

*Built with Devvit Web · Phaser 4 · Hono · TypeScript*
