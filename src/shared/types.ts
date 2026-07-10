export type SlimeColor = string; // "#RRGGBB"

export type GogglesVariant = 'h-thick' | 'h-thin' | 'h-mono' | 'v-thick' | 'v-thin' | 'v-mono';
export type GlassesVariant = 'h-thick' | 'h-thin' | 'v-thick' | 'v-thin';
export type BeltVariant    = 'h-thick' | 'h-thin' | 'v-thick' | 'v-thin';
export type PendantVariant = 'h' | 'v';
export type PumpkinCoverage = 25 | 50 | 75;

export type ModifierType =
  | 'paint' | 'goggles' | 'glasses'
  | 'belt' | 'pendant' | 'pumpkin' | 'underwear'
  // ── Newer modifiers (see src/shared/slimeSim.ts for the exact rules) ──
  // plain toggle stencils, like belts:
  | 'plate' | 'cone' | 'scarf'
  // 'nose'   — a stencil worn small that GROWS one size per paint splash
  //            (small→medium→big); a splash on the big nose knocks it off,
  //            re-wearable as small. One nose per level.
  // 'alpha'  — a paint VARIANT: dips every exposed cell to 75% opacity
  //            (colour kept). Usable once per level.
  // 'bubble' — a reusable opacity changer: dips only its inner circle to 75%,
  //            leaving the outer ring untouched.
  | 'nose' | 'alpha' | 'bubble';

// Non-paint modifiers are paint STENCILS: worn, they protect the slime cells
// they cover; tapped again, they come off. Paints color every exposed cell.
// See src/shared/slimeSim.ts for the shared simulation.
export type ModifierDef = {
  id: string;
  type: ModifierType;
  variant?: string;
  coverage?: PumpkinCoverage;
  color?: SlimeColor;
};

export type LevelData = {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  palette: ModifierDef[];
  // The goal IS this sequence: replaying it through the sim produces the goal
  // pattern (always ending bare — no stencils worn). Also the 3-star target.
  optimalSolution: readonly string[];
  optimalSteps: number;
  hint?: string;
  // Shown once in a modal when the level opens (tutorial levels only).
  tutorial?: string;
  // Guided lesson script (tutorial levels only): one coach line per
  // optimalSolution step. When present (and the same length as the solution),
  // the Game scene runs the level as a guided tutorial — the next expected
  // tile glows, other taps are gently refused, and this text narrates why
  // each step works.
  guide?: readonly string[];
  authorName?: string;
  isDaily?: boolean;
};

export type Stars = 1 | 2 | 3;

export type CompletionData = {
  levelId: string;
  steps: number;
  timeMs: number;
  stars: Stars;
  isOptimal: boolean;
  sparksEarned: number;
};

export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  isCurrentUser?: boolean;
};

export type UserProfile = {
  username: string;
  sparks: number;
  unlockedItems: string[];
  equippedItems: Record<string, string>;
  levelsCompleted: number;
  optimalSolves: number;
  streakDays: number;
};

// Slot values are SplotMascot texture suffixes: `char-${value}` must be a
// loaded texture key ('brow-normal' → 'char-brow-normal', NOT 'eyebrow-normal').
export const DEFAULT_EQUIPPED: Record<string, string> = {
  eye:       'eye-normal',
  eyebrow:   'brow-normal',
  mouth:     'mouth-happy',
  accessory: '',
};
