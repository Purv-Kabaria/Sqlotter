# Core Gameplay — How Sqlotter Works

Sqlotter is a **Factory Balls**-style stencil-painting puzzle. Every level shows a
**goal pattern** — a bare slime painted in zones of color. The player starts from a
bare white slime and reproduces the pattern by combining two kinds of palette actions:

- **Paint** — splashes a color over every part of the slime that isn't protected.
  The pot always offers the standard **16-color rack** (`PAINT_COLORS_16`).
- **Stencils** (goggles, glasses, belts, pendants, pumpkins, underwear) — worn items
  that **protect whatever they cover** from paint. Tapping a worn stencil takes it
  off again. **Goggles are one-time use**: the splash that lands on them knocks them
  off and breaks them (automatically, no action logged) — only a reset restores them.
  The pumpkin tile always offers all three sizes (25/50/75).

Goals never show attached modifiers — the accessories are *tools*, not targets. The
level is won the moment the painted pattern matches the goal **and nothing is worn**
(goals are bare slimes, so the player must take everything off to finish).

The canonical medium-difficulty example:

```
pumpkin-25 on → paint green → goggles on → paint red (goggles break off) → pumpkin-25 off
```

Result: a white cap on top (pumpkin-protected the whole time), a green goggle-shaped
band across the eyes (protected during the red coat), red everywhere else. Five steps,
three colors, zero items worn at the end — the red splash popped the goggles off by
itself.

Where the logic lives:

| Concern | File |
|---------|------|
| Level/modifier types | `src/shared/types.ts` |
| Shared paint simulation (grid, replay, win check) | `src/shared/slimeSim.ts` |
| Mask coverage bitmaps (baked from the PNGs) | `src/shared/maskData.ts` via `scripts/generate_masks.py` |
| Stars, level integrity, solution verification | `src/shared/gameRules.ts` |
| Per-attempt session: steps, timer, worn set | `src/client/engine/LevelEngine.ts` |
| Gameplay scene: palette UI, HUD, animations, win flow | `src/client/scenes/Game.ts` |
| Pattern compositing (canvas, real PNGs) | `src/client/components/SlimeRenderer.ts` |
| Curated levels (tutorial + 10 generated worlds) | `src/shared/curatedLevels.ts` |
| Daily level generator (seeded, deterministic) | `src/shared/levelData.ts` |
| Server validation + rewards | `src/server/routes/api.ts` (`POST /api/complete`) |

`src/shared/slimeSim.ts` + `gameRules.ts` are imported by **both** client and server:
the client uses them to run the game, the server uses the exact same functions to
verify submitted solutions. Never fork the rules — change them in one place.

---

## The simulation

The slime is a 64×64 cell grid (`MASK_GRID`), sampled once from the real art by
`scripts/generate_masks.py`:

- `BODY_MASK` — which cells belong to the slime body (from `slime/color.png`).
- `MASK_BITMAPS[maskId]` — which cells each stencil covers (from each modifier PNG's
  alpha channel, threshold ≥ 100 so translucent goggle lenses count as covering).

`SimState` is `{ grid, colors, worn, broken }`: a per-cell color index, the color
table (index 0 = unpainted white), the ordered list of worn mask ids, and the mask
ids broken this run.

Each action id resolves against the level palette **plus the standard catalog**
(the 16 paints and 3 pumpkin sizes — `resolveActionDef`) and does exactly one thing:

| Action | Effect | Step cost |
|--------|--------|-----------|
| `paint` def | every body cell NOT covered by a worn stencil ← this color; then any worn **goggles** snap off into `broken` | 1 |
| stencil def, not worn | put it on (protects its cells from now on) | 1 |
| stencil def, worn | take it off | 1 |
| broken goggles | refused — the tap is not logged, replays containing one are invalid | 0 |

Aside from the goggle break there are no conflicts and no use counts — any other
stencil can go on or off at any time, and any combination can be worn simultaneously.
The puzzle is ordering plus goggle economy: which stencils are on when each coat
lands, and which single splash each pair of goggles is spent on.

**Win check** (`isCleanMatch`): every body cell resolves to the same color as the
goal replay, and `worn` is empty.

**The goal IS a replay.** `LevelData` has no stored goal state — `optimalSolution`
(an action-id list over the level's own palette) *is* the goal: replaying it through
the sim produces the target pattern. This is also the 3-star step target, and it must
end bare and actually paint something (`verifyLevelIntegrity`).

---

## Stencil coverage

What each mask protects (measured on the 64×64 grid, % of body cells):

| Stencil | Region | Coverage |
|---------|--------|----------|
| `pumpkin-25` | top cap | ~17% |
| `pumpkin-50` | top half | ~48% |
| `pumpkin-75` | all but the bottom edge | ~92% |
| `underwear` | hips/bottom | ~27% |
| `belt-*-thick` | wide middle band (h) or column (v) | ~34% |
| `belt-*-thin` | narrow band/column | ~15% |
| `goggles-*-thick` / `glasses-*-thick` | wide eye band | ~24% |
| `goggles-*-thin` / `glasses-*-thin` | narrow eye band | ~16% |
| `goggles-*-mono` | monocle band | ~19% |
| `pendant-h` / `pendant-v` | chest charm | ~19% |

`h-`/`v-` prefixes are orientation: `horizontal-*` assets run left-right,
`vertical-*` top-to-bottom, so the same item family gives two different pattern
shapes. Goggles vs glasses of the same variant cover nearly identical bands — they're
aesthetic alternates, useful as decoys.

**Note:** pumpkins cover from the TOP down (pumpkin-25 protects the top cap), which
matches the actual art.

---

## Rendering

`SlimeRenderer.setPattern(palette, actions)` replays the action list (via
`replayOps`) and composites the result on a per-instance canvas texture with the
**real PNGs** — not the grid:

1. Draw the white body.
2. For each paint op: build a stamp (body tinted with the op's color via multiply),
   punch out every stencil worn at that moment (`destination-out`, alpha flattened at
   the same threshold the grid sampling used), draw the stamp.
3. Overlay-blend the gloss shine, clamp back to the body alpha.

Stencils currently worn are then drawn as normal images between the pattern and the
outline, so the player sees exactly what's protecting what. The goal preview is just
`setPattern(palette, optimalSolution)` — always bare, since valid solutions end bare.

The sim and the renderer share their geometry by construction (the bitmaps were
sampled from the same PNGs with the same threshold), so what the player sees is what
the win check judges.

---

## Scoring: steps, stars, Sparks, streaks

**Steps** — every logged action costs one step, including taking a stencil off
(goggles snapping off after a splash is automatic and free). Reset
(`LevelEngine.reset()`) is itself a logged, step-costing action: it clears the grid,
the worn set and the broken set (goggles come back), but the step count and the
clock keep running.

**Stars** (`calcStars`): `steps <= optimalSteps` → ★★★, `<= 2×` → ★★, else ★.

**Sparks** are awarded server-side in `POST /api/complete`, only on a player's first
completion (`hSetNX user:{name} done:{levelId}`): 10 base, +20 optimal, +15 daily,
+30 first-ever completer.

**Daily streak** — consecutive-day daily completions increment `daily:streak`.

---

## Server-side verification (anti-cheat)

The client reports **what it did**, never "I won". `POST /api/complete` receives
`{ levelId, timeMs, actions }`; the server replays `actions` through the same sim
(`isValidSolution`) and requires a clean match against the level's own solution
replay. A forged sequence (unknown id, wrong pattern, stencils still worn) is
rejected with 400. The same check guards `POST /api/level/create`, so UGC levels are
provably solvable before they're stored.

---

## Level sources

**Curated — 8 tutorial + 160 generated.** `curatedLevels.ts` hand-authors the Splash
Course (each lesson teaches one stencil concept: paint, re-coat, wear/remove, paint
order, undies print, goggle band, pumpkin sizes, stacking) and generates worlds 1–10
on first access (`getCuratedLevels()`, memoized) with a fixed-seed PRNG — identical
on client and server, no build step. Generation is lazy so it never blocks the
client's boot script or a server cold start. Each generated level is validated
during generation: its solution replays cleanly, ends bare, and every paint op is
necessary (dropping one changes the pattern).

Three mechanisms keep the set varied and ramped:

1. **Structural uniqueness** — every accepted goal's `structureKey` (the pattern
   majority-downsampled to 16×16 blocks with colors relabeled in first-appearance
   order) must be new across the whole set, tutorials included. Recolors of an
   earlier shape and near-twins (goggles vs glasses of the same variant) collide
   and are rejected, so all 160 generated goals are genuinely different shapes.
2. **Ramped budgets** — each world is a `WorldRamp`, not a flat config: stencil,
   paint and decoy counts interpolate from a world-start to a world-end value
   across the 16 slots, so slot 1 plays like the world's floor and slot 16 like
   its ceiling. The generator also lifts the stencil count to `paints − 1` when a
   slot asks for more coats than its stencils could make matter.
3. **Within-world sort** — the 16 recipes are ordered by a difficulty score
   (solution length, then peak simultaneous stencils, then palette size) before
   level ids are assigned, so the ramp the player feels is guaranteed monotonic.

`LEVELS_VERSION` stamps the set; the `onAppUpgrade` trigger wipes level
progress when it changes.

**Daily.** `generateDailyLevel(date)` seeds the same generator from the date;
weekday picks the difficulty tier (Sun–Sat → 3 1 2 2 3 4 5). Solvable by
construction; `GET /api/daily` falls back to rotating curated levels if the
scheduler hasn't published one.

**User-generated.** The Editor records the creator *playing* the pattern: every tap
(paint / stencil on / stencil off) appends to the action list, which becomes both the
goal and the reference solution. Publishing requires the recording to end bare with
paint on the slime; the server re-verifies, stores at `level:{id}` (90-day TTL),
indexes in `ugc:index`, and posts the Beat-the-Creator challenge post.

---

## The difficulty ladder

Three dials make a level hard:

1. **Solution length** — more coats and toggles, more orderings to consider.
2. **Stencil stacking** — multiple stencils worn at once, partial mid-solution
   removals (`midRemove`) that expose a zone for a later coat.
3. **Decoys** — palette stencils/colors the solution never uses. Star thresholds are
   optimal-relative, so exploratory taps cost stars (never the attempt — everything
   is removable, reset always available).

Counts below ramp from the world's first level to its last (see `WORLD_RAMPS`):

| World | Name | Stencils | Paints | Feel |
|-------|------|----------|--------|------|
| 1 | Splat School | 1→2 | 1→2 | first bands and prints |
| 2 | Dress-Up Dell | 1→2 | ~2 | wearables, first mid-removals |
| 3 | Goggle Grove | 1→2 eye items | 3 | goggles break after one splash |
| 4 | Pumpkin Patch | 2 | 2→3 | nested pumpkin rings |
| 5 | Two-Tone Tarn | 2 | 2→3 | staggered two-band goals |
| 6 | Layer Lagoon | 2→3 | 3 | stacked stencils |
| 7 | Decoy Dunes | 2→3 + 2–3 decoys | 2→3 | the palette lies |
| 8 | Trap Tundra | 2→3 + decoys | 3→4 | deeper stacks |
| 9 | Expert Estuary | 3 | 3→4 | three stencils deep |
| 10 | Master Marsh | 3→4 | 4 | everything at once |
