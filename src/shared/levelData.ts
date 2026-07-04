import type { LevelData } from './types';
import type { GenConfig } from './curatedLevels';
import {
  buildGeneratedLevel, difficultyForSteps, getCuratedLevels, mulberry32,
} from './curatedLevels';

// The curated set lives in curatedLevels.ts (hand-authored tutorial + worlds
// generated deterministically on first access — no build step involved).
export {
  getCuratedLevels, LEVELS_PER_WORLD, LEVELS_VERSION, WORLD_COUNT, WORLD_NAMES, WORLDS_META,
} from './curatedLevels';
export type { WorldMeta } from './curatedLevels';

export function getLevelById(id: string): LevelData | undefined {
  return getCuratedLevels().find(l => l.id === id);
}

// ── Daily puzzle generation ───────────────────────────────

// Difficulty ramps through the week (Mon..Sun), and each tier maps onto a
// stencil recipe roughly matching the curated worlds' curve.
const DAILY_CONFIGS: Record<1 | 2 | 3 | 4 | 5, GenConfig> = {
  1: { maskPool: ['belt-h-thin', 'belt-v-thin', 'pendant-h', 'underwear'], masks: [1, 1], paints: [1, 2], baseFirst: 0.6, midRemove: 0, decoys: [1, 1] },
  2: { maskPool: ['belt-h-thick', 'belt-v-thick', 'goggles-h-thick', 'glasses-v-thin', 'underwear', 'pumpkin-25'], masks: [1, 2], paints: [2, 2], baseFirst: 0.7, midRemove: 0.1, decoys: [1, 1] },
  3: { maskPool: ['goggles-h-thin', 'goggles-v-mono', 'glasses-h-thick', 'belt-v-thin', 'pumpkin-25', 'pumpkin-50', 'pendant-v'], masks: [2, 2], paints: [2, 3], baseFirst: 0.6, midRemove: 0.25, decoys: [1, 2] },
  4: { maskPool: ['goggles-h-thick', 'goggles-v-thin', 'glasses-h-thin', 'belt-h-thick', 'pumpkin-50', 'pumpkin-75', 'underwear', 'pendant-h'], masks: [2, 3], paints: [3, 3], baseFirst: 0.7, midRemove: 0.3, decoys: [2, 2] },
  5: { maskPool: ['goggles-h-mono', 'goggles-v-thick', 'glasses-v-thick', 'belt-v-thick', 'belt-h-thin', 'pumpkin-25', 'pumpkin-75', 'underwear', 'pendant-v'], masks: [3, 4], paints: [3, 4], baseFirst: 0.7, midRemove: 0.4, decoys: [2, 2] },
};

/**
 * Generate a deterministic daily stencil puzzle from a date string
 * (YYYY-MM-DD). The level id is `daily-YYYY-MM-DD`.
 */
export function generateDailyLevel(date: string): LevelData {
  const seed = parseInt(date.replace(/-/g, ''), 10);
  const rng  = mulberry32(seed);

  // Difficulty cycles Sun-Sat: 3 1 2 2 3 4 5 (weekend = spicier)
  const dow = new Date(date).getDay(); // 0=Sun
  const difficulties = [3, 1, 2, 2, 3, 4, 5] as const;
  const tier = difficulties[dow] ?? 3;

  const recipe = buildGeneratedLevel(rng, DAILY_CONFIGS[tier]);
  const steps = recipe.solution.length;

  return {
    id: `daily-${date}`,
    title: `Daily — ${date}`,
    difficulty: difficultyForSteps(steps),
    palette: recipe.palette,
    optimalSteps: steps,
    optimalSolution: recipe.solution,
    isDaily: true,
  };
}
