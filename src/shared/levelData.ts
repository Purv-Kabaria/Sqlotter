import type {
  LevelData, SlimeState,
  GogglesVariant, GlassesVariant, BeltVariant, PendantVariant,
  ModifierDef,
} from './types';
import { DEFAULT_SLIME_STATE } from './types';
import { CURATED_LEVELS, WORLD_NAMES } from './curatedLevels';

// The curated set is generated — 10 worlds × 16 levels. Edit/regen via
// scripts/generate_levels.py, never by hand.
export { CURATED_LEVELS, LEVELS_PER_WORLD, WORLD_COUNT, WORLD_NAMES } from './curatedLevels';

export function getLevelById(id: string): LevelData | undefined {
  return CURATED_LEVELS.find(l => l.id === id);
}

export const WORLD_LABELS: Record<number, string> = {};
WORLD_NAMES.forEach((name, i) => { WORLD_LABELS[i + 1] = `World ${i + 1} — ${name}`; });

// ── Daily puzzle generation ───────────────────────────────

/** Seeded pseudo-random (mulberry32) so the same seed always gives the same level. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randItem<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/**
 * Generate a deterministic daily level from a date string (YYYY-MM-DD).
 * The level id is `daily-YYYY-MM-DD`.
 */
export function generateDailyLevel(date: string): LevelData {
  // Numeric seed from date digits
  const seed = parseInt(date.replace(/-/g, ''), 10);
  const rng  = mulberry32(seed);

  // Difficulty cycles Mon–Sun: 1 2 2 3 3 4 5
  const dow   = new Date(date).getDay(); // 0=Sun
  const difficulties = [1, 2, 2, 3, 3, 4, 5];
  const diff  = difficulties[dow] as 1 | 2 | 3 | 4 | 5;

  // Number of modifier applications for this difficulty
  const modCount = diff + 1; // 2–6 steps

  // Color pool
  const colors = ['#FF4136','#0074D9','#2ECC40','#FFDC00','#B10DC9','#FF851B','#39CCCC','#FF69B4','#01FF70','#7FDBFF'];

  // Build a valid random modifier sequence
  const state: SlimeState = { ...DEFAULT_SLIME_STATE };
  const palette: ModifierDef[] = [];
  const applied: ModifierDef[] = [];
  let gogglesUsed = false;

  const pickPaint = (): ModifierDef => ({ id: `paint-${applied.length}`, type: 'paint', color: randItem(rng, colors) });
  const pickGlasses = (): ModifierDef => {
    const variants = ['h-thick','h-thin','v-thick','v-thin'] as const;
    return { id: 'glasses', type: 'glasses', variant: randItem(rng, variants) };
  };
  const pickGoggles = (): ModifierDef => {
    const variants = ['h-thick','h-thin','h-mono','v-thick','v-thin','v-mono'] as const;
    return { id: 'goggles', type: 'goggles', variant: randItem(rng, variants) };
  };
  const pickBelt = (): ModifierDef => {
    const variants = ['h-thick','h-thin','v-thick','v-thin'] as const;
    return { id: 'belt', type: 'belt', variant: randItem(rng, variants) };
  };
  const pickPendant = (): ModifierDef => ({ id: 'pendant', type: 'pendant', variant: rng() > 0.5 ? 'h' : 'v' });
  const pickPumpkin = (): ModifierDef => ({ id: 'pumpkin', type: 'pumpkin', coverage: randItem(rng, [25, 50] as const) });

  // Always start with paint
  const startPaint = pickPaint();
  applied.push(startPaint);
  palette.push(startPaint);
  state.color = startPaint.color!;

  for (let i = 1; i < modCount; i++) {
    const roll = rng();

    // Choose modifier type based on current state to avoid conflicts
    let mod: ModifierDef;

    if (roll < 0.25 && !state.goggles && !state.glasses && !gogglesUsed) {
      mod = pickGoggles();
      state.goggles = mod.variant as GogglesVariant;
      gogglesUsed = true;
    } else if (roll < 0.4 && !state.goggles && !state.glasses) {
      mod = pickGlasses();
      state.glasses = mod.variant as GlassesVariant;
    } else if (roll < 0.6 && !state.belt) {
      mod = pickBelt();
      state.belt = mod.variant as BeltVariant;
    } else if (roll < 0.75 && !state.pendant) {
      mod = pickPendant();
      state.pendant = mod.variant as PendantVariant;
    } else if (roll < 0.88 && !state.pumpkin) {
      // Only 25/50 pumpkin in generated levels (avoid the tricky 75% interactions)
      mod = pickPumpkin();
      state.pumpkin = mod.coverage!;
    } else {
      // Re-paint a different colour
      let paint = pickPaint();
      while (paint.color === state.color) paint = pickPaint();
      mod = paint;
      state.color = paint.color!;
    }

    applied.push(mod);
    palette.push(mod);
  }

  // Add 1–2 decoy modifiers that are valid but not needed
  const decoyCount = diff >= 3 ? 2 : 1;
  for (let d = 0; d < decoyCount; d++) {
    const decoyRoll = rng();
    if (decoyRoll < 0.5 && !state.belt) {
      const decoyBelt = pickBelt();
      decoyBelt.id = `decoy-belt-${d}`;
      palette.push(decoyBelt);
    } else {
      const decoyPaint = pickPaint();
      decoyPaint.id = `decoy-paint-${d}`;
      palette.push(decoyPaint);
    }
  }

  const level: LevelData = {
    id: `daily-${date}`,
    title: `Daily — ${date}`,
    difficulty: diff,
    goalState: { ...state },
    palette,
    optimalSteps: modCount,
    optimalSolution: applied.map(m => m.id),
    isDaily: true,
  };
  return level;
}
