import type {
  LevelData, SlimeState,
  GogglesVariant, GlassesVariant, BeltVariant, PendantVariant,
  ModifierDef,
} from './types';
import { DEFAULT_SLIME_STATE } from './types';

const D: SlimeState = {
  color: '#FFFFFF', goggles: null, glasses: null,
  belt: null, pendant: null, pumpkin: null, underwear: false,
};

export const CURATED_LEVELS: LevelData[] = [
  // ─────────────── WORLD 1 — BASICS ───────────────
  {
    id: 'L01', title: 'First Coat', difficulty: 1,
    goalState: { ...D, color: '#FF4136' },
    palette: [
      { id: 'paint-red',   type: 'paint', color: '#FF4136' },
      { id: 'paint-blue',  type: 'paint', color: '#0074D9' },
    ],
    optimalSteps: 1,
    hint: 'Pick the right colour!',
  },
  {
    id: 'L02', title: 'Safety First', difficulty: 1,
    goalState: { ...D, color: '#0074D9', goggles: 'h-thick' },
    palette: [
      { id: 'paint-blue',      type: 'paint',   color: '#0074D9' },
      { id: 'paint-green',     type: 'paint',   color: '#2ECC40' },
      { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick', count: 1 },
      { id: 'goggles-h-thin',  type: 'goggles', variant: 'h-thin',  count: 1 },
    ],
    optimalSteps: 2,
    hint: 'Paint first, then protect those eyes!',
  },
  {
    id: 'L03', title: 'Slim Shady', difficulty: 1,
    goalState: { ...D, color: '#2ECC40', belt: 'h-thin' },
    palette: [
      { id: 'paint-green',  type: 'paint', color: '#2ECC40' },
      { id: 'paint-yellow', type: 'paint', color: '#FFDC00' },
      { id: 'belt-h-thin',  type: 'belt',  variant: 'h-thin' },
      { id: 'belt-h-thick', type: 'belt',  variant: 'h-thick' },
    ],
    optimalSteps: 2,
    hint: 'Green and lean!',
  },
  {
    id: 'L04', title: 'Pumpkin Spice', difficulty: 1,
    goalState: { ...D, color: '#FFDC00', pumpkin: 50 },
    palette: [
      { id: 'paint-yellow', type: 'paint',   color: '#FFDC00' },
      { id: 'paint-orange', type: 'paint',   color: '#FF851B' },
      { id: 'pumpkin-50',   type: 'pumpkin', coverage: 50 },
      { id: 'pumpkin-25',   type: 'pumpkin', coverage: 25 },
    ],
    optimalSteps: 2,
    hint: 'Half pumpkin, half slime!',
  },
  // ─────────────── WORLD 2 — MIX UP ───────────────
  {
    id: 'L05', title: 'Dressed Up', difficulty: 2,
    goalState: { ...D, color: '#B10DC9', underwear: true, pendant: 'h' },
    palette: [
      { id: 'paint-purple', type: 'paint',    color: '#B10DC9' },
      { id: 'paint-pink',   type: 'paint',    color: '#FF69B4' },
      { id: 'underwear',    type: 'underwear' },
      { id: 'pendant-h',    type: 'pendant',  variant: 'h' },
      { id: 'pendant-v',    type: 'pendant',  variant: 'v' },
    ],
    optimalSteps: 3,
    hint: 'Accessorise before you finalise!',
  },
  {
    id: 'L06', title: 'Specs Appeal', difficulty: 2,
    goalState: { ...D, color: '#FF851B', glasses: 'h-thick' },
    palette: [
      { id: 'paint-orange', type: 'paint',   color: '#FF851B' },
      { id: 'paint-red',    type: 'paint',   color: '#FF4136' },
      { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
      { id: 'glasses-h-thin',  type: 'glasses', variant: 'h-thin' },
      { id: 'glasses-v-thin',  type: 'glasses', variant: 'v-thin' },
    ],
    optimalSteps: 2,
    hint: 'Four eyes are better than two!',
  },
  {
    id: 'L07', title: 'Lil Pumpkin', difficulty: 2,
    goalState: { ...D, color: '#39CCCC', pumpkin: 25, pendant: 'v' },
    palette: [
      { id: 'paint-teal',   type: 'paint',   color: '#39CCCC' },
      { id: 'pumpkin-25',   type: 'pumpkin', coverage: 25 },
      { id: 'pumpkin-50',   type: 'pumpkin', coverage: 50 },
      { id: 'pendant-v',    type: 'pendant', variant: 'v' },
      { id: 'pendant-h',    type: 'pendant', variant: 'h' },
    ],
    optimalSteps: 3,
    hint: 'Just a little bit of pumpkin!',
  },
  {
    id: 'L08', title: 'Vertical Limit', difficulty: 2,
    goalState: { ...D, color: '#FF69B4', belt: 'v-thick', glasses: 'v-thin' },
    palette: [
      { id: 'paint-pink',    type: 'paint',   color: '#FF69B4' },
      { id: 'belt-v-thick',  type: 'belt',    variant: 'v-thick' },
      { id: 'belt-v-thin',   type: 'belt',    variant: 'v-thin' },
      { id: 'glasses-v-thin',type: 'glasses', variant: 'v-thin' },
      { id: 'goggles-v-thin',type: 'goggles', variant: 'v-thin', count: 1 },
    ],
    optimalSteps: 3,
    hint: 'Go vertical!',
  },
  // ─────────────── WORLD 2 — TWO-COLOUR ───────────
  {
    id: 'L13', title: 'Two Tone', difficulty: 2,
    goalState: { ...D, color: '#2ECC40', colorBottom: '#FF69B4', pumpkin: 50 },
    palette: [
      { id: 'paint-pink',    type: 'paint',   color: '#FF69B4' },
      { id: 'paint-green',   type: 'paint',   color: '#2ECC40' },
      { id: 'paint-blue',    type: 'paint',   color: '#0074D9' },
      { id: 'pumpkin-50',    type: 'pumpkin', coverage: 50 },
      { id: 'pumpkin-25',    type: 'pumpkin', coverage: 25 },
    ],
    optimalSteps: 3,
    optimalSolution: ['paint-pink', 'pumpkin-50', 'paint-green'],
    hint: 'Protect the bottom with pumpkin, then dip the top!',
  },
  {
    id: 'L14', title: 'Layered Up', difficulty: 3,
    goalState: { ...D, color: '#0074D9', colorBottom: '#FFDC00', pumpkin: 75, goggles: 'h-thick' },
    palette: [
      { id: 'paint-yellow',    type: 'paint',   color: '#FFDC00' },
      { id: 'paint-blue',      type: 'paint',   color: '#0074D9' },
      { id: 'paint-red',       type: 'paint',   color: '#FF4136' },
      { id: 'pumpkin-75',      type: 'pumpkin', coverage: 75 },
      { id: 'pumpkin-50',      type: 'pumpkin', coverage: 50 },
      { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick', count: 1 },
      { id: 'goggles-v-thick', type: 'goggles', variant: 'v-thick', count: 1 },
    ],
    optimalSteps: 4,
    optimalSolution: ['paint-yellow', 'pumpkin-75', 'paint-blue', 'goggles-h-thick'],
    hint: 'Layer the colours, then protect your eyes!',
  },
  // ─────────────── WORLD 3 — EXPERT ───────────────
  {
    id: 'L09', title: 'Double Vision', difficulty: 3,
    goalState: { ...D, color: '#0074D9', goggles: 'v-mono' },
    palette: [
      { id: 'paint-red',    type: 'paint',   color: '#FF4136' },
      { id: 'paint-blue',   type: 'paint',   color: '#0074D9' },
      { id: 'paint-green',  type: 'paint',   color: '#2ECC40' },
      { id: 'goggles-v-mono', type: 'goggles', variant: 'v-mono', count: 1 },
      { id: 'goggles-h-mono', type: 'goggles', variant: 'h-mono', count: 1 },
    ],
    optimalSteps: 2,
    hint: 'Pick the colour, pick the eye!',
  },
  {
    id: 'L10', title: 'Fully Loaded', difficulty: 3,
    goalState: { ...D, color: '#2ECC40', belt: 'h-thin', glasses: 'h-thick', underwear: true },
    palette: [
      { id: 'paint-green',     type: 'paint',   color: '#2ECC40' },
      { id: 'paint-lime',      type: 'paint',   color: '#01FF70' },
      { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin' },
      { id: 'belt-h-thick',    type: 'belt',    variant: 'h-thick' },
      { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
      { id: 'underwear',       type: 'underwear' },
      { id: 'pumpkin-25',      type: 'pumpkin', coverage: 25 },
    ],
    optimalSteps: 4,
    hint: 'Dress Splot up properly!',
  },
  {
    id: 'L11', title: 'Pumpkin Head', difficulty: 4,
    goalState: { ...D, color: '#FF4136', pumpkin: 75, goggles: 'h-thin' },
    palette: [
      { id: 'paint-red',      type: 'paint',   color: '#FF4136' },
      { id: 'paint-orange',   type: 'paint',   color: '#FF851B' },
      { id: 'pumpkin-75',     type: 'pumpkin', coverage: 75 },
      { id: 'pumpkin-50',     type: 'pumpkin', coverage: 50 },
      { id: 'goggles-h-thin', type: 'goggles', variant: 'h-thin', count: 1 },
      { id: 'underwear',      type: 'underwear' },    // conflict trap!
    ],
    optimalSteps: 3,
    hint: 'Watch out for conflicts!',
  },
  {
    id: 'L12', title: 'The Works', difficulty: 5,
    goalState: { ...D, color: '#B10DC9', glasses: 'v-thick', belt: 'v-thin', pendant: 'h' },
    palette: [
      { id: 'paint-purple',    type: 'paint',   color: '#B10DC9' },
      { id: 'paint-blue',      type: 'paint',   color: '#0074D9' },
      { id: 'glasses-v-thick', type: 'glasses', variant: 'v-thick' },
      { id: 'glasses-v-thin',  type: 'glasses', variant: 'v-thin' },
      { id: 'belt-v-thin',     type: 'belt',    variant: 'v-thin' },
      { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin' },
      { id: 'pendant-h',       type: 'pendant', variant: 'h' },
      { id: 'goggles-v-thin',  type: 'goggles', variant: 'v-thin', count: 1 }, // eye-slot trap!
    ],
    optimalSteps: 4,
    hint: 'Every choice counts!',
  },
];

export function getLevelById(id: string): LevelData | undefined {
  return CURATED_LEVELS.find(l => l.id === id);
}

export const WORLD_LABELS: Record<number, string> = {
  1: 'World 1 — Basics',
  2: 'World 2 — Mix Up',
  3: 'World 3 — Expert',
  4: 'World 4 — Master',
};

// ── Daily puzzle generation ───────────────────────────────────

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
