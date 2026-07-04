import type { LevelData, ModifierDef, PumpkinCoverage } from './types';
import type { PaintColor } from './slimeSim';
import {
  isBreakableMask, isPainted, PAINT_COLORS_16, paintDefOf, patternsEqual, replaySim, structureKey,
} from './slimeSim';

// ── Curated level set — stencil-painting puzzles ────────────────────────────
// Every level is defined by its palette and its optimalSolution: replaying the
// solution through the shared sim (slimeSim.ts) produces the goal PATTERN — a
// bare, multi-colored slime. Modifiers never appear in goals; they are the
// stencils that make the patterns possible.
//
// Worlds 1-10 are generated deterministically on FIRST ACCESS (seeded PRNG per
// level), so the client and server always agree on the exact same level set.
// Generation is lazy on purpose: doing it at module load blocked the client's
// boot script and every server cold start for the full 160-level build.

// Bump when the level set changes incompatibly — the app-upgrade trigger wipes
// level progress (completions/stars/streaks/level leaderboards) on a mismatch
// so nobody keeps stars for levels that no longer exist.
export const LEVELS_VERSION = '4-unique-shapes';

export const WORLD_COUNT = 11;
export const LEVELS_PER_WORLD = 16; // max per world (grid capacity)

export type WorldMeta = { num: number; name: string; start: number; size: number };

export const WORLD_NAMES: readonly string[] = [
  'Splash Course',
  'Splat School',
  'Dress-Up Dell',
  'Goggle Grove',
  'Pumpkin Patch',
  'Two-Tone Tarn',
  'Layer Lagoon',
  'Decoy Dunes',
  'Trap Tundra',
  'Expert Estuary',
  'Master Marsh',
];

// ── Shared generation utilities (also used by the daily puzzle) ─────────────

/** Seeded pseudo-random (mulberry32) so the same seed always gives the same level. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type GenColor = PaintColor;

// The generator draws from the same 16-color catalog the paint pot offers —
// see slimeSim.ts (PAINT_COLORS_16), the single source of truth for colors.
export const GEN_COLORS: readonly GenColor[] = PAINT_COLORS_16;

/** Builds the ModifierDef for a stencil, with the mask id doubling as the palette id. */
export function maskMod(maskId: string): ModifierDef {
  const [kind, ...rest] = maskId.split('-');
  const variant = rest.join('-');
  switch (kind) {
    case 'goggles':   return { id: maskId, type: 'goggles', variant };
    case 'glasses':   return { id: maskId, type: 'glasses', variant };
    case 'belt':      return { id: maskId, type: 'belt', variant };
    case 'pendant':   return { id: maskId, type: 'pendant', variant };
    case 'pumpkin':   return { id: maskId, type: 'pumpkin', coverage: parseInt(variant, 10) as PumpkinCoverage };
    default:          return { id: maskId, type: 'underwear' };
  }
}

export function paintMod(color: GenColor): ModifierDef {
  return paintDefOf(color);
}

function pickDistinct<T>(rng: () => number, pool: readonly T[], n: number): T[] {
  const copy = [...pool];
  const out: T[] = [];
  while (out.length < n && copy.length > 0) {
    const idx = Math.floor(rng() * copy.length);
    out.push(...copy.splice(idx, 1));
  }
  return out;
}

function intIn(rng: () => number, range: readonly [number, number]): number {
  return range[0] + Math.floor(rng() * (range[1] - range[0] + 1));
}

export type GenConfig = {
  maskPool: readonly string[];
  masks: readonly [number, number];   // stencils used by the solution
  paints: readonly [number, number];  // paint ops in the solution
  baseFirst: number;                  // probability of a bare base coat first
  midRemove: number;                  // probability of a mid-solution stencil removal
  decoys: readonly [number, number];  // extra unused palette entries
};

export type GeneratedRecipe = {
  palette: ModifierDef[];
  solution: string[];
  colors: GenColor[];
  /** Most stencils worn at once during the solution — a difficulty signal. */
  peakWorn: number;
};

/**
 * Generates one valid stencil puzzle: a solution whose every paint op matters
 * (dropping any single paint changes the final pattern) and which ends bare.
 * Deterministic for a given rng. `usedShapes` gets the accepted STRUCTURE key
 * (color-blind, block-downsampled — see slimeSim.structureKey) so callers can
 * steer away from goals that are mere recolors or near-twins of earlier ones.
 */
export function buildGeneratedLevel(
  rng: () => number,
  cfg: GenConfig,
  usedShapes?: Set<string>,
): GeneratedRecipe {
  let fallback: GeneratedRecipe | null = null;

  // Generous attempt budget: the structural dedupe rejects whole families of
  // shapes at once, so late worlds need room to roll something genuinely new.
  for (let attempt = 0; attempt < 40; attempt++) {
    let paintCount = Math.max(1, intIn(rng, cfg.paints));
    // Each paint after the first needs a stencil change to stay visible, so
    // more paints than stencils+1 can never all matter — lift the stencil
    // count to match instead of burning every attempt on necessity rejections
    // (which would ship un-deduped fallback shapes).
    const maskCount = Math.min(
      Math.max(intIn(rng, cfg.masks), paintCount - 1),
      cfg.maskPool.length,
    );
    const masks = pickDistinct(rng, cfg.maskPool, maskCount);
    const baseFirst = maskCount === 0 || rng() < cfg.baseFirst;
    // Every after-base paint needs a stencil in play (a bare repaint would just
    // wipe the pattern), so with stencils there must be at least one such paint.
    if (maskCount > 0 && paintCount - (baseFirst ? 1 : 0) < 1) paintCount++;
    const colors = pickDistinct(rng, GEN_COLORS, paintCount);

    const actions: string[] = [];
    const defsById = new Map<string, ModifierDef>();
    const worn: string[] = [];
    const queue = [...colors];
    let peakWorn = 0;

    // Mirrors the sim's goggle-break rule: a splash knocks worn goggles off
    // (broken, no removal action) — so the cleanup loop below never tries to
    // log a removal for goggles the sim already popped, which would replay as
    // an invalid wear-broken attempt.
    const doPaint = (color: GenColor) => {
      const def = paintMod(color);
      defsById.set(def.id, def);
      actions.push(def.id);
      for (let w = worn.length - 1; w >= 0; w--) {
        if (isBreakableMask(worn[w]!)) worn.splice(w, 1);
      }
    };
    const toggle = (maskId: string) => {
      defsById.set(maskId, maskMod(maskId));
      actions.push(maskId);
      const at = worn.indexOf(maskId);
      if (at >= 0) worn.splice(at, 1);
      else worn.push(maskId);
      if (worn.length > peakWorn) peakWorn = worn.length;
    };

    if (baseFirst) doPaint(queue.shift()!);

    // Assign each stencil to one of the remaining paints; the first after-base
    // paint always gets one so no later coat lands on a bare slime.
    const afterBase = queue.length;
    const slotOf = masks.map((_, i) => (i === 0 ? 0 : Math.floor(rng() * afterBase)));
    for (let p = 0; p < afterBase; p++) {
      masks.forEach((maskId, i) => { if (slotOf[i] === p) toggle(maskId); });
      doPaint(queue.shift()!);
      if (rng() < cfg.midRemove && worn.length > 1 && queue.length > 0) {
        toggle(worn[Math.floor(rng() * worn.length)]!);
      }
    }
    while (worn.length > 0) toggle(worn[Math.floor(rng() * worn.length)]!);

    const palette = [...defsById.values()];
    const goal = replaySim(palette, actions);
    if (!goal || goal.worn.length !== 0 || !isPainted(goal)) continue;

    // Every paint op must matter — dropping it must change the final pattern.
    let allNecessary = true;
    for (let i = 0; i < actions.length; i++) {
      if (!defsById.get(actions[i]!) || defsById.get(actions[i]!)!.type !== 'paint') continue;
      const without = actions.filter((_, j) => j !== i);
      const alt = replaySim(palette, without);
      if (alt && alt.worn.length === 0 && patternsEqual(alt, goal)) { allNecessary = false; break; }
    }

    // Decoys: unused stencils and colors, so the palette doesn't spell out the recipe.
    const decoyN = intIn(rng, cfg.decoys);
    const decoyMasks = pickDistinct(rng, cfg.maskPool.filter((m) => !defsById.has(m)), decoyN);
    for (const m of decoyMasks) palette.push(maskMod(m));
    if (decoyN > decoyMasks.length) {
      const spare = pickDistinct(rng, GEN_COLORS.filter((c) => !colors.includes(c)), decoyN - decoyMasks.length);
      for (const c of spare) palette.push(paintMod(c));
    }
    // Shuffle so palette order never leaks the solution order.
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = palette[i]!; palette[i] = palette[j]!; palette[j] = tmp;
    }

    const recipe: GeneratedRecipe = { palette, solution: actions, colors, peakWorn };
    if (!allNecessary) { fallback = fallback ?? recipe; continue; }
    const key = structureKey(goal);
    if (usedShapes?.has(key)) { fallback = fallback ?? recipe; continue; }
    usedShapes?.add(key);
    return recipe;
  }

  // Every attempt tripped a soft check (duplicate shape / redundant paint) —
  // ship the first valid one rather than fail; it still replays cleanly.
  if (fallback) return fallback;
  // Unreachable in practice: a single bare paint always validates.
  const color = GEN_COLORS[Math.floor(rng() * GEN_COLORS.length)]!;
  const def = paintMod(color);
  return { palette: [def], solution: [def.id], colors: [color], peakWorn: 0 };
}

export function difficultyForSteps(steps: number): 1 | 2 | 3 | 4 | 5 {
  if (steps <= 2) return 1;
  if (steps <= 4) return 2;
  if (steps <= 6) return 3;
  if (steps <= 8) return 4;
  return 5;
}

function hintFor(recipe: GeneratedRecipe): string {
  const first = recipe.solution[0] ?? '';
  const lead = first.startsWith('paint-')
    ? `Lay down ${first.slice(6)} first.`
    : 'Stencil first — protect the white!';
  return `${lead} Finish with everything taken off.`;
}

// ── Tutorial world — Splash Course (hand-authored) ──────────────────────────

const TUTORIAL_LEVELS: LevelData[] = [
  {
    id: 'w00-l01', title: 'First Splash', difficulty: 1,
    palette: [
      { id: 'paint-green', type: 'paint', color: '#2ECC40' },
      { id: 'paint-pink', type: 'paint', color: '#FF69B4' },
    ],
    optimalSteps: 1,
    optimalSolution: ['paint-green'],
    hint: 'Tap the paint pot, then the green swatch!',
    tutorial: 'Meet Splot! Copy the GOAL pattern to win. Tap the paint pot below and pick GREEN to give Splot a fresh coat.',
  },
  {
    id: 'w00-l02', title: 'Fresh Coat', difficulty: 1,
    palette: [
      { id: 'paint-yellow', type: 'paint', color: '#FFDC00' },
      { id: 'paint-red', type: 'paint', color: '#FF4136' },
      { id: 'paint-blue', type: 'paint', color: '#0074D9' },
    ],
    optimalSteps: 1,
    optimalSolution: ['paint-blue'],
    hint: 'Only the last coat counts — Splot wants blue.',
    tutorial: 'Painted the wrong color? A fresh coat covers everything that is not protected. Extra coats cost extra steps, though!',
  },
  {
    id: 'w00-l03', title: 'Cover Up', difficulty: 1,
    palette: [
      { id: 'belt-h-thin', type: 'belt', variant: 'h-thin' },
      { id: 'paint-teal', type: 'paint', color: '#39CCCC' },
    ],
    optimalSteps: 3,
    optimalSolution: ['belt-h-thin', 'paint-teal', 'belt-h-thin'],
    hint: 'Belt on, paint, then tap the belt again to take it off.',
    tutorial: 'Accessories are STENCILS! Whatever they cover, paint cannot touch. Put the belt ON, splash teal, then tap the belt again to take it OFF — Splot must finish BARE, exactly like the goal.',
  },
  {
    id: 'w00-l04', title: 'Stripe Trick', difficulty: 2,
    palette: [
      { id: 'paint-yellow', type: 'paint', color: '#FFDC00' },
      { id: 'belt-h-thin', type: 'belt', variant: 'h-thin' },
      { id: 'paint-purple', type: 'paint', color: '#B10DC9' },
    ],
    optimalSteps: 4,
    optimalSolution: ['paint-yellow', 'belt-h-thin', 'paint-purple', 'belt-h-thin'],
    hint: 'Yellow first — then protect the stripe you want to keep.',
    tutorial: 'Order is everything. Paint Splot yellow FIRST, cover the stripe with the belt, splash purple over the rest — then take the belt off to reveal it.',
  },
  {
    id: 'w00-l05', title: 'Undies Print', difficulty: 2,
    palette: [
      { id: 'underwear', type: 'underwear' },
      { id: 'paint-orange', type: 'paint', color: '#FF851B' },
      { id: 'paint-red', type: 'paint', color: '#FF4136' },
    ],
    optimalSteps: 4,
    optimalSolution: ['paint-orange', 'underwear', 'paint-red', 'underwear'],
    hint: 'Orange, undies on, red, undies off.',
    tutorial: "Undies stencil Splot's bottom half. Paint orange, pull them on, splash red, pull them off — orange briefs forever.",
  },
  {
    id: 'w00-l06', title: 'Goggle Band', difficulty: 2,
    palette: [
      { id: 'paint-sky', type: 'paint', color: '#7FDBFF' },
      { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick' },
      { id: 'paint-navy', type: 'paint', color: '#003AB4' },
    ],
    optimalSteps: 3,
    optimalSolution: ['paint-sky', 'goggles-h-thick', 'paint-navy'],
    hint: 'The goggles guard a band right across the middle.',
    tutorial: 'Goggles stencil a band straight across Splot — but they are FRAGILE! One splash and they snap off broken, all by themselves. Sky blue first, goggles on, navy over the top.',
  },
  {
    id: 'w00-l07', title: 'Pumpkin Cap', difficulty: 1,
    palette: [
      { id: 'pumpkin-25', type: 'pumpkin', coverage: 25 },
      { id: 'paint-green', type: 'paint', color: '#2ECC40' },
      { id: 'pumpkin-50', type: 'pumpkin', coverage: 50 },
    ],
    optimalSteps: 3,
    optimalSolution: ['pumpkin-25', 'paint-green', 'pumpkin-25'],
    hint: 'The goal keeps a SMALL white cap — pick the 25% pumpkin.',
    tutorial: 'Pumpkins cover Splot from the TOP down — 25%, 50% or 75%. Covered means protected. Mind the size: the goal shows how much stays white!',
  },
  {
    id: 'w00-l08', title: 'Double Stencil', difficulty: 3,
    palette: [
      { id: 'pumpkin-25', type: 'pumpkin', coverage: 25 },
      { id: 'paint-green', type: 'paint', color: '#2ECC40' },
      { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick' },
      { id: 'paint-red', type: 'paint', color: '#FF4136' },
    ],
    optimalSteps: 5,
    optimalSolution: [
      'pumpkin-25', 'paint-green', 'goggles-h-thick', 'paint-red', 'pumpkin-25',
    ],
    hint: 'Pumpkin, green, goggles, red — then the pumpkin off.',
    tutorial: "Stack stencils! Pumpkin on, splash GREEN. Goggles on too, splash RED — the goggles break off on their own, so just lift the pumpkin. You're ready — go make art!",
  },
];

// ── Generated worlds 1-10 ───────────────────────────────────────────────────

const EYE_MASKS = [
  'goggles-h-thick', 'goggles-h-thin', 'goggles-h-mono',
  'goggles-v-thick', 'goggles-v-thin', 'goggles-v-mono',
  'glasses-h-thick', 'glasses-h-thin', 'glasses-v-thick', 'glasses-v-thin',
] as const;
const BELT_MASKS = ['belt-h-thick', 'belt-h-thin', 'belt-v-thick', 'belt-v-thin'] as const;
const BODY_MASKS = ['pendant-h', 'pendant-v', 'underwear'] as const;
const PUMPKIN_MASKS = ['pumpkin-25', 'pumpkin-50', 'pumpkin-75'] as const;
const ALL_MASKS = [...EYE_MASKS, ...BELT_MASKS, ...BODY_MASKS, ...PUMPKIN_MASKS] as const;

// A world is a difficulty RAMP, not a flat config: every numeric knob has a
// world-start and world-end value, interpolated across the 16 level slots.
// Slot 1 of a world plays like its floor, slot 16 like its ceiling, and each
// world's ceiling hands off to the next world's floor — one long staircase.
type WorldRamp = {
  maskPool: readonly string[];
  masks:  readonly [number, number];  // stencil count, world start → end
  paints: readonly [number, number];  // paint ops, world start → end
  baseFirst: number;
  midRemove: readonly [number, number];
  decoys: readonly [number, number];
};

const WORLD_RAMPS: readonly WorldRamp[] = [
  // W1 Splat School — one simple stencil, a second arrives late in the world.
  { maskPool: [...BELT_MASKS, ...BODY_MASKS, 'pumpkin-25'], masks: [1, 2], paints: [1, 2], baseFirst: 0.6, midRemove: [0, 0], decoys: [0, 1] },
  // W2 Dress-Up Dell — wearables as stencils, first mid-solution removals.
  { maskPool: [...BODY_MASKS, 'belt-h-thin', 'belt-v-thin', 'pumpkin-25', 'pumpkin-50'], masks: [1, 2], paints: [1.5, 2], baseFirst: 0.7, midRemove: [0, 0.15], decoys: [0, 1] },
  // W3 Goggle Grove — eye stencils; goggles break after one splash, which
  // makes each level ~1 step cheaper, so the paint budget runs a notch higher
  // to keep the world-to-world step ramp intact.
  { maskPool: EYE_MASKS, masks: [1, 2], paints: [3, 3], baseFirst: 0.75, midRemove: [0, 0.2], decoys: [1, 1] },
  // W4 Pumpkin Patch — nested pumpkins make ring-shaped goals. The pool runs
  // wider than the theme strictly needs: pumpkins nest (25 ⊂ 50 ⊂ 75), which
  // collapses many pair-shapes into one silhouette and starves the dedupe on
  // a narrow pool.
  { maskPool: [...PUMPKIN_MASKS, 'underwear', 'pendant-h', 'belt-h-thin', 'belt-h-thick', 'belt-v-thin'], masks: [2, 2], paints: [2, 3], baseFirst: 0.6, midRemove: [0.15, 0.3], decoys: [0, 1] },
  // W5 Two-Tone Tarn — two stencils, staggered bands.
  { maskPool: [...BELT_MASKS, ...BODY_MASKS, 'pumpkin-25', 'pumpkin-50'], masks: [2, 2], paints: [2.5, 3], baseFirst: 0.6, midRemove: [0.2, 0.35], decoys: [1, 1] },
  // W6 Layer Lagoon — overlapping stencils worn together.
  { maskPool: [...EYE_MASKS.slice(0, 6), ...BELT_MASKS, 'pumpkin-25', 'pumpkin-50'], masks: [2, 3], paints: [3, 3], baseFirst: 0.7, midRemove: [0.3, 0.4], decoys: [0, 1] },
  // W7 Decoy Dunes — the palette lies.
  { maskPool: ALL_MASKS, masks: [2, 3], paints: [2, 3], baseFirst: 0.6, midRemove: [0.25, 0.35], decoys: [2, 3] },
  // W8 Trap Tundra — more layers, more decoys.
  { maskPool: ALL_MASKS, masks: [2, 3], paints: [3, 4], baseFirst: 0.6, midRemove: [0.3, 0.4], decoys: [2, 2] },
  // W9 Expert Estuary — three stencils deep.
  { maskPool: ALL_MASKS, masks: [3, 3], paints: [3, 4], baseFirst: 0.7, midRemove: [0.35, 0.45], decoys: [1, 2] },
  // W10 Master Marsh — everything at once.
  { maskPool: ALL_MASKS, masks: [3, 4], paints: [4, 4], baseFirst: 0.7, midRemove: [0.4, 0.5], decoys: [2, 2] },
];

// The lerped counts stay RANGES (floor..ceil of the interpolated value), not
// fixed numbers: each generation attempt re-rolls inside the band, which is
// the escape hatch when the structural dedupe has exhausted every shape the
// lower count can express (e.g. all single-stencil silhouettes are taken).
function slotConfig(ramp: WorldRamp, t: number): GenConfig {
  const band = (range: readonly [number, number]): [number, number] => {
    const v = range[0] + (range[1] - range[0]) * t;
    return [Math.floor(v), Math.ceil(v)];
  };
  return {
    maskPool: ramp.maskPool,
    masks: band(ramp.masks),
    paints: band(ramp.paints),
    baseFirst: ramp.baseFirst,
    midRemove: ramp.midRemove[0] + (ramp.midRemove[1] - ramp.midRemove[0]) * t,
    decoys: band(ramp.decoys),
  };
}

// Solution length dominates; simultaneous layers and palette size (decoys)
// break ties. Used to order each world easiest-first after generation.
function recipeScore(recipe: GeneratedRecipe): number {
  return recipe.solution.length * 1000 + recipe.peakWorn * 10 + recipe.palette.length;
}

const LEVEL_NOUNS = [
  'Splash', 'Stripe', 'Band', 'Wrap', 'Slice', 'Patch', 'Visor', 'Coat',
  'Blot', 'Swirl', 'Dip', 'Print', 'Sash', 'Crown', 'Veil', 'Shade',
] as const;

function generateWorlds(): LevelData[] {
  const levels: LevelData[] = [];

  // Every generated goal must have a shape no other level has — including the
  // hand-authored tutorials, whose shapes seed the set.
  const usedShapes = new Set<string>();
  for (const lvl of TUTORIAL_LEVELS) {
    const goal = replaySim(lvl.palette, lvl.optimalSolution);
    if (goal) usedShapes.add(structureKey(goal));
  }

  WORLD_RAMPS.forEach((ramp, w) => {
    const worldNum = w + 1;

    const recipes: GeneratedRecipe[] = [];
    for (let i = 0; i < LEVELS_PER_WORLD; i++) {
      // Fixed seed per slot — the set is stable across builds and identical on
      // client and server. The salt keeps it decoupled from the daily seeds.
      const rng = mulberry32(0x5711 + worldNum * 1000 + i * 7);
      recipes.push(buildGeneratedLevel(rng, slotConfig(ramp, i / (LEVELS_PER_WORLD - 1)), usedShapes));
    }

    // Slot budgets ramp up, but the rng can still hand slot 3 a longer
    // solution than slot 5 — sorting by score guarantees the ramp the player
    // actually feels. Deterministic: stable score with index tiebreak.
    const ordered = recipes
      .map((recipe, i) => ({ recipe, i }))
      .sort((a, b) => recipeScore(a.recipe) - recipeScore(b.recipe) || a.i - b.i);

    ordered.forEach(({ recipe }, i) => {
      const steps = recipe.solution.length;
      const colorName = recipe.colors[recipe.colors.length - 1]?.name ?? 'Slime';
      levels.push({
        id: `w${String(worldNum).padStart(2, '0')}-l${String(i + 1).padStart(2, '0')}`,
        title: `${colorName} ${LEVEL_NOUNS[i % LEVEL_NOUNS.length]}`,
        difficulty: difficultyForSteps(steps),
        palette: recipe.palette,
        optimalSteps: steps,
        optimalSolution: recipe.solution,
        hint: hintFor(recipe),
      });
    });
  });

  return levels;
}

let curatedCache: LevelData[] | null = null;

/** The full curated set (tutorial + generated worlds), built once on demand. */
export function getCuratedLevels(): LevelData[] {
  curatedCache ??= [...TUTORIAL_LEVELS, ...generateWorlds()];
  return curatedCache;
}

export const WORLDS_META: readonly WorldMeta[] = WORLD_NAMES.map((name, num) => ({
  num,
  name,
  start: num === 0 ? 0 : TUTORIAL_LEVELS.length + (num - 1) * LEVELS_PER_WORLD,
  size: num === 0 ? TUTORIAL_LEVELS.length : LEVELS_PER_WORLD,
}));
