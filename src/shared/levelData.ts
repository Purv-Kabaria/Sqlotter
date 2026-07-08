import type { LevelData } from './types';
import type { GenConfig, GeneratedRecipe, Mechanic } from './curatedLevels';
import {
  buildGeneratedLevel, buildMechanicRecipe, difficultyForSteps, getCuratedLevels,
  getCuratedShapeKeys, mulberry32,
} from './curatedLevels';
import { replaySim, structureKey } from './slimeSim';

// The curated set lives in curatedLevels.ts (hand-authored tutorial + worlds
// generated deterministically on first access — no build step involved).
export {
  getCuratedLevels, LEVELS_PER_WORLD, LEVELS_VERSION, warmCuratedLevels, WORLD_COUNT,
  WORLD_NAMES, WORLDS_META,
} from './curatedLevels';
export type { WorldMeta } from './curatedLevels';

export function getLevelById(id: string): LevelData | undefined {
  return getCuratedLevels().find(l => l.id === id);
}

// ── Daily puzzle generation ───────────────────────────────

// Difficulty ramps through the week (Mon..Sun), and each tier maps onto a
// stencil recipe roughly matching the curated worlds' curve.
const DAILY_CONFIGS: Record<1 | 2 | 3 | 4 | 5, GenConfig> = {
  1: { maskPool: ['belt-h-thin', 'belt-v-thin', 'pendant-h', 'scarf', 'underwear'], masks: [1, 2], paints: [2, 2], baseFirst: 0.6, midRemove: 0.1, decoys: [1, 1] },
  2: { maskPool: ['belt-h-thick', 'belt-v-thick', 'goggles-h-thick', 'glasses-v-thin', 'scarf', 'plate', 'underwear', 'pumpkin-25'], masks: [2, 2], paints: [2, 3], baseFirst: 0.7, midRemove: 0.2, decoys: [1, 2] },
  3: { maskPool: ['goggles-h-thin', 'goggles-v-mono', 'glasses-h-thick', 'belt-v-thin', 'plate', 'cone', 'pumpkin-25', 'pumpkin-50', 'pendant-v'], masks: [2, 3], paints: [3, 3], baseFirst: 0.6, midRemove: 0.3, decoys: [2, 2] },
  4: { maskPool: ['goggles-h-thick', 'goggles-v-thin', 'glasses-h-thin', 'belt-h-thick', 'cone', 'scarf', 'pumpkin-50', 'pumpkin-75', 'underwear', 'pendant-h'], masks: [2, 3], paints: [3, 4], baseFirst: 0.7, midRemove: 0.35, decoys: [2, 3] },
  5: { maskPool: ['goggles-h-mono', 'goggles-v-thick', 'glasses-v-thick', 'belt-v-thick', 'belt-h-thin', 'plate', 'cone', 'scarf', 'pumpkin-25', 'pumpkin-75', 'underwear', 'pendant-v'], masks: [3, 4], paints: [4, 4], baseFirst: 0.7, midRemove: 0.45, decoys: [2, 3] },
};

// Quirky deterministic daily names — "The Grumpy Goggle Job" beats
// "Daily — 2026-07-04" in the post title, on the win screen, and in every
// Splat Card that quotes it. Drawn from the date-seeded rng, so client and
// server always agree on the name.
const DAILY_ADJ = [
  'Grumpy', 'Sneaky', 'Wobbly', 'Slippery', 'Dapper', 'Feral', 'Polite',
  'Chaotic', 'Smug', 'Haunted', 'Dizzy', 'Majestic', 'Sassy', 'Rowdy',
  'Bashful', 'Unhinged', 'Soggy', 'Suspicious', 'Glorious', 'Mischievous',
] as const;
const DAILY_NOUN = [
  'Splat Heist', 'Goggle Job', 'Pumpkin Caper', 'Stripe Racket', 'Paint Panic',
  'Undies Incident', 'Belt Ballet', 'Squish Parade', 'Drip Scheme', 'Color Crime',
  'Splash Gambit', 'Stencil Shuffle', 'Slime Affair', 'Coat Conspiracy',
  'Blot Plot', 'Visor Vendetta',
] as const;

function quirkyDailyTitle(rng: () => number): string {
  const adj  = DAILY_ADJ[Math.floor(rng() * DAILY_ADJ.length)]!;
  const noun = DAILY_NOUN[Math.floor(rng() * DAILY_NOUN.length)]!;
  return `The ${adj} ${noun}`;
}

// Most days feature one of the new mechanics for variety; a quarter stay pure
// generated puzzles. Consumes exactly one rng draw so the puzzle seed stays
// stable. Weekends always feature a mechanic (the marquee dailies).
function dailyFeature(rng: () => number, weekend: boolean): Mechanic | null {
  const r = rng();
  if (r < 0.30) return 'nose';
  if (r < 0.58) return 'alpha';
  if (r < 0.82) return 'bubble';
  return weekend ? 'alpha' : null; // weekends never fall through to plain generated
}

// ── Daily uniqueness ──────────────────────────────────────
// From DAILY_EPOCH onward, every daily is generated against the shape/recipe
// keys of the ENTIRE curated set plus every prior daily — a daily is never a
// re-skin of a campaign level, and no two dailies repeat a goal shape (plain
// puzzles) or a recipe (mechanic showcases, whose bullseyes/fades share one
// coarse structure key by design — see the world builders). The walk from the
// epoch is deterministic (fixed seeds, fixed order) and memoized per process;
// each historical day costs ~1ms, so even years in this stays trivially cheap
// for the server (the only caller — clients fetch /api/daily).
//
// Dates BEFORE the epoch keep the original un-deduped output, so a deploy of
// this change never swaps an already-posted daily under its players.
const DAILY_EPOCH_MS = Date.UTC(2026, 6, 10); // 2026-07-10
const DAY_MS = 86_400_000;

const dailySeq: LevelData[] = []; // index = days since epoch
let dailyUsed: Set<string> | null = null;

/**
 * Generate a deterministic daily stencil puzzle from a date string
 * (YYYY-MM-DD). The level id is `daily-YYYY-MM-DD`. Dailies skew HARD, rotate
 * a featured mechanic (nose / alpha dip / bubble) for variety, and are unique
 * against the curated set and all prior dailies (see above).
 */
export function generateDailyLevel(date: string): LevelData {
  const ms = Date.parse(`${date}T00:00:00Z`);
  // Pre-epoch (or unparseable) dates: the legacy un-deduped generator.
  if (!(ms >= DAILY_EPOCH_MS)) return generateDailyRaw(date);

  const idx = Math.round((ms - DAILY_EPOCH_MS) / DAY_MS);
  const memo = dailySeq[idx];
  if (memo) return memo;
  dailyUsed ??= new Set(getCuratedShapeKeys());
  for (let i = dailySeq.length; i <= idx; i++) {
    const day = new Date(DAILY_EPOCH_MS + i * DAY_MS).toISOString().slice(0, 10);
    const level = generateDailyRaw(day, dailyUsed);
    // The builders register accepted shapes themselves; the generator's
    // last-resort fallback path doesn't. Registering the published level's
    // keys explicitly (idempotent) closes that gap, so even a fallback day
    // can't be duplicated by a later one.
    const goal = replaySim(level.palette, level.optimalSolution);
    if (goal) dailyUsed.add(structureKey(goal));
    dailyUsed.add(level.optimalSolution.join('>'));
    dailySeq[i] = level;
  }
  return dailySeq[idx]!;
}

function generateDailyRaw(date: string, usedShapes?: Set<string>): LevelData {
  const seed = parseInt(date.replace(/-/g, ''), 10);
  const rng  = mulberry32(seed);

  // Dailies are the competitive ritual — they skew HARD on purpose (the
  // Splash Course and early worlds are where easy lives). Weekdays are
  // devious, weekends diabolical. Sun-Sat.
  const dow = new Date(date).getDay(); // 0=Sun
  const weekend = dow === 0 || dow === 6;
  const difficulties = [5, 4, 4, 4, 4, 5, 5] as const;
  const tier = difficulties[dow] ?? 4;

  // Draw order is FIXED (title → feature → generation) so the puzzle stays
  // stable no matter how many attempts a build burns.
  const title = quirkyDailyTitle(rng);
  const feature = dailyFeature(rng, weekend);

  // A featured mechanic must clear the daily's minimum bar (>= 4 moves) or the
  // day falls back to a hard generated puzzle — no trivially short dailies.
  const MIN_DAILY_STEPS = 4;
  let recipe: GeneratedRecipe | null = null;
  if (feature) {
    for (let k = 0; k < 6 && !recipe; k++) {
      const cand = buildMechanicRecipe(feature, rng, tier >= 5 ? 3 : 2, usedShapes);
      recipe = cand && cand.solution.length >= MIN_DAILY_STEPS ? cand : null;
    }
  }
  recipe ??= buildGeneratedLevel(rng, DAILY_CONFIGS[tier], usedShapes);
  const steps = recipe.solution.length;

  // The displayed difficulty honours the daily's HARD tier. A mechanic feature
  // (nose/alpha/bubble) is only ~4-5 moves but is still that day's headline
  // brain-teaser, so a daily never grades below its weekday/weekend tier; a long
  // generated fallback that lands harder than the tier keeps its step-based grade.
  const stepDifficulty = difficultyForSteps(steps);
  const difficulty = stepDifficulty > tier ? stepDifficulty : tier;

  return {
    id: `daily-${date}`,
    title,
    difficulty,
    palette: recipe.palette,
    optimalSteps: steps,
    optimalSolution: recipe.solution,
    isDaily: true,
  };
}
