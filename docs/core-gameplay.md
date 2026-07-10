# Core Gameplay — How Sqlotter Works

Sqlotter is a **Factory Balls**-style stencil-painting puzzle. Every level shows a
**goal pattern** — a bare slime painted in zones of color. The player starts from a
bare white slime and reproduces the pattern by combining two kinds of palette actions:

- **Paint** — splashes a color over every part of the slime that isn't protected.
  The pot always offers the standard **16-color rack** (`PAINT_COLORS_16`).
- **Stencils** (goggles, glasses, belts, pendants, pumpkins, underwear, plate, cone,
  scarf) — worn items that **protect whatever they cover** from paint. Tapping a worn
  stencil takes it off again. **Goggles are one-time use**: the splash that lands on
  them knocks them off and breaks them (automatically, no action logged) — only a
  reset restores them. The pumpkin tile always offers all three sizes (25/50/75).

Three specials round out the toolbox:

- **Nose** — worn small; every splash grows it one size (small → medium → big, each a
  different mask), and a splash on a big nose knocks it off. A growing stencil you
  steer with your coats.
- **Alpha dip** — one-shot translucency: every exposed cell drops to 75% opacity
  ("dipped"). Counts as a splash (breaks goggles, grows the nose). One dip per run —
  a second tap is refused like broken goggles.
- **Bubble** — reusable soft dip that only affects its inner circle; the outer ring
  keeps full color. Not a splash: goggles and noses are safe. Dipping is idempotent
  (dipped stays 75%), and a fresh color coat makes a cell opaque again.

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
| Curated levels (tutorial + 24 generated worlds) | `src/shared/curatedLevels.ts` |
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

`SimState` is `{ grid, alpha, colors, worn, broken, spent }`: a per-cell color index,
a per-cell opacity flag (opaque | dipped at 75%), the color table (index 0 =
unpainted white), the ordered list of worn mask ids, the mask ids broken this run,
and the one-shot action ids already used this run (the alpha dip).

Each action id resolves against the level palette **plus the standard catalog**
(the 16 paints and 3 pumpkin sizes — `resolveActionDef`) and does exactly one thing:

| Action | Effect | Step cost |
|--------|--------|-----------|
| `paint` def | every exposed body cell ← this color at full opacity; then splash side effects | 1 |
| `alpha` dip | every exposed cell → dipped (75%); splash side effects; one dip per run — a second tap is refused | 1 |
| `bubble` | exposed cells inside the bubble's inner circle → dipped; reusable, no splash side effects | 1 |
| stencil def, not worn | put it on (protects its cells from now on) | 1 |
| stencil def, worn | take it off | 1 |
| pumpkin def, another size worn | swap: the new size replaces the worn one in place | 1 |
| nose tap | wear it small / take it off at whatever size it grew to | 1 |
| `__reset__` | clear everything (grid, worn, broken, spent) — logged, clock keeps running | 1 |
| refused tap | broken goggles, spent dip, or a wear past the 3-stencil limit — not logged, replays containing one are invalid | 0 |

**Splash side effects** (color paint and alpha dip, not the bubble): every worn pair
of goggles snaps off into `broken`, and a worn nose grows one size (a splash on big
knocks it off, re-wearable small).

**Wear-stacking rules** (`MAX_WORN` in `slimeSim.ts`): Splot wears at most **3
stencils at once**. Pumpkins are full head-covers, so only one fits — tapping a
different size while one is worn **swaps it in place as a single action** (the
`'swap'` ActionKind; worn count unchanged, so the limit can never refuse it, and
the Game scene teaches it in the moment: the picker title flips to "Tap a size to
swap" and the first swap gets an info popup). A wear that would exceed the limit
is refused exactly like broken goggles (state untouched, nothing logged); the
Game scene answers with a cross icon popping above the refused palette tile and a
message saying why. Within those limits there are no other conflicts or use
counts. The puzzle is ordering plus outfit economy: which (at most three) stencils
are on when each coat lands, and which single splash each pair of goggles is spent
on.

**Tooltips**: every palette tile explains itself — hover (desktop, ~350 ms) or
long-press (touch, ~500 ms; the release is swallowed so peeking never costs a
move) shows a one-line behavior blurb (`slotTooltip` in Game.ts), clamped
on-screen at every viewport width.

**Win check** (`isCleanMatch`): every body cell displays the same effective color
(hue + dip state — a dipped cell shows its color composited at 75% over white) as the
goal replay, and `worn` is empty.

**The goal IS a replay.** `LevelData` has no stored goal state — `optimalSolution`
(an action-id list over the level's own palette) *is* the goal: replaying it through
the sim produces the target pattern. This is also the par under the 3-star move limit, and it must
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
| `plate` | large dish shape | large |
| `cone` | inverted-triangle cone shape | large |
| `scarf` | wrap-around band (left/right variants mirror the art, one shared mask) | medium |
| `nose-small/medium/big` | nose area, one mask per size | grows per splash |
| `bubble-inner` | region the bubble dips (not a worn mask) | inner circle |

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

Stencils currently worn are then drawn as normal images above the outline (they sit
ON the slime, so the border must not cut across their art), and the player sees
exactly what's protecting what. The goal preview is just
`setPattern(palette, optimalSolution)` — always bare, since valid solutions end bare.

The sim and the renderer share their geometry by construction (the bitmaps were
sampled from the same PNGs with the same threshold), so what the player sees is what
the win check judges.

---

## Scoring: moves, stars, Sparks, streaks

**Moves** — every logged action costs one move, including taking a stencil off
(goggles snapping off after a splash is automatic and free). Reset is a logged
action so the server replay sees the whole history, but scored moves count from
the LAST reset (`effectiveSteps`): reset wipes the board and the move counter,
never the clock — a reset trades moves for seconds.

**Stars** (`calcStars` / `moveBuffer`): the player is shown a move LIMIT of
`par + buffer` where `buffer = max(2, ceil(par/2))` (par 5 → limit 8). Within
it → ★★★; each further buffer-width tier crossed costs one star, down to 0
(the level still completes). The HUD raises the shown limit tier by tier
(`currentMoveTier`) and grays a mini star as each one falls.

**Sparks** are TIME-driven (stars are the move currency), awarded server-side
in `POST /api/complete`, only on a player's first completion (`hSetNX
user:{name} done:{levelId}`): 10 base, + up to 15 speed bonus
(`timeSparksBonus`: full under ~30s, zero by 5 min), +10 under the move limit
(3 stars), +10 matched par exactly, +15 daily, +30 first-ever completer.

**Persistent attempts** — leaving a level mid-attempt saves the live action
log + banked time (session store in `levelProgress.ts` + `wip:{levelId}` in
the user hash via `POST /api/progress`); re-entering restores it (strict
replay via `LevelEngine.restore`, so a log that no longer replays is
dropped). Cleared on completion. Guided lessons and previews stay ephemeral.

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

**Curated — 5 tutorial + 384 generated (25 worlds, 389 levels).** `curatedLevels.ts`
hand-authors the Splash Course — five dense lessons that together cover every rule:
First Splash (paint / last coat wins / stencil toggle / finish bare), Full Outfit
(stacking, the three-wear limit with an invited refusal, white counts as a color),
Fragile & Tough (goggles break on a splash, glasses don't), Pumpkin Parfait
(top-down cover, one at a time, tap-to-swap) and Grand Finale (the growing nose,
the one-shot alpha dip — itself a splash — and the reusable bubble).
Every lesson is a GUIDED tutorial: `LevelData.guide` carries one coach line per
solution step, and the Game scene runs the lesson step-by-step — the next expected
tile glows gold (down into the color/pumpkin pickers), a persistent coach panel
narrates the step (`STEP n/m`), off-script taps are nudged back without costing a
move, and taps the sim would refuse anyway (a 4th wear in Full Outfit) get the
real refusal so the rule lands. Reset restarts the script. The course is OPTIONAL:
lessons never lock, World 1 is never gated behind them, the coach panel carries a
standing Skip button, and the course page ends in a "Skip to World 1" tile.
`curatedLevels.ts` also
generates worlds 1–24 on first access
(`getCuratedLevels()`, memoized) with a fixed-seed PRNG — identical on client and
server, no build step. Generation is lazy so it never blocks the client's boot script
or a server cold start. Each generated level is validated during generation: its
solution replays cleanly, ends bare, and every paint op is necessary (dropping one
changes the pattern).

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

**Daily — the Sqlot.** A daily level is a **Sqlot**, the game's player-facing name
for the ritual. `generateDailyLevel(date)` seeds the same generator from the date;
Sqlots skew HARD on purpose — weekdays tier 4, weekends tier 5 (easy lives in
the Splash Course, the Sqlot is the competitive ritual). Each Sqlot gets a
deterministic quirky name ("The Grumpy Goggle Job") drawn from the same seed,
used in the level, the post title (`Sqlot 2026-07-09: The Grumpy Goggle Job`),
and every Splat Card that quotes it. From the daily epoch onward, each Sqlot is
generated against the shape/recipe keys of the entire campaign plus every prior
Sqlot, so a daily is never a re-skin of a campaign level or an earlier daily.
Solvable by construction; `GET /api/daily` falls back to rotating curated
levels if the scheduler hasn't published one. The scheduler task runs hourly
and is idempotent per piece (level store / Reddit post checked separately), so
a transient failure costs an hour, not the whole day.

**User-generated.** The Editor records the creator *playing* the pattern: every tap
(paint / stencil on / stencil off) appends to the action list, which becomes both the
goal and the reference solution. Creators get the full 20-stencil catalog and the
16-color rack, choose how many decoys (0–3) pad the published palette, and can attach
an optional hint. Recordings are capped at `MAX_SOLUTION_STEPS` (60 — roomy on
purpose; an anti-abuse bound on stored size and replay cost, not a design cap) —
enforced while recording and re-checked by the server — so **every published level is
provably solvable within that many moves**, and the recording's length is the level's
advertised par. Publishing
requires the recording to end bare with paint on the slime; the server re-verifies,
stores at `level:{id}` (90-day TTL), indexes in `ugc:index` plus the `ugc:titles`
search registry (`GET /api/levels/community?q=` matches title or creator), and posts
the Beat-the-Creator challenge post.

---

## The difficulty ladder

Three dials make a level hard:

1. **Solution length** — more coats and toggles, more orderings to consider.
2. **Stencil stacking** — multiple stencils worn at once, partial mid-solution
   removals (`midRemove`) that expose a zone for a later coat.
3. **Decoys** — palette stencils/colors the solution never uses. Every generated
   world level carries at least one (ramping to 3–4 in the late worlds), so the
   palette never spells out the recipe. Star thresholds are optimal-relative, so
   exploratory taps cost stars (never the attempt — everything is removable, reset
   always available).

Generated hints exist only through World 9. **Worlds 10+ ship without hints** —
at the expert tier, cracking the recipe unaided is the whole point (the in-game
help button hides itself on hintless levels).

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

Beyond the main ramp, worlds 11–21 are **specialists** — each spotlights one toy at
expert budgets (Monocle Mire, Ring Reef, Nose Nebula, Scarf Summit, Stacked Shallows,
Bubble Bog, Mirage Meadow, Fade Fjord, Vertigo Vale, Snare Strait, Gauntlet Gulch) —
and worlds 22–24 are the mechanic-dense finale (Bullseye Bay, Opacity Ocean,
Splotter's Sanctum), where roughly half the slots use nose/alpha/bubble. See
`WORLD_NAMES` / `WORLD_RAMPS` in `curatedLevels.ts` for the authoritative list.
