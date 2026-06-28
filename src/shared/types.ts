export type SlimeColor = string; // "#RRGGBB"

export type GogglesVariant = 'h-thick' | 'h-thin' | 'h-mono' | 'v-thick' | 'v-thin' | 'v-mono';
export type GlassesVariant = 'h-thick' | 'h-thin' | 'v-thick' | 'v-thin';
export type BeltVariant    = 'h-thick' | 'h-thin' | 'v-thick' | 'v-thin';
export type PendantVariant = 'h' | 'v';
export type PumpkinCoverage = 25 | 50 | 75;

export type SlimeState = {
  color: SlimeColor;
  colorBottom?: SlimeColor; // color of the pumpkin-protected bottom zone (two-color support)
  goggles: GogglesVariant | null;
  glasses: GlassesVariant | null;
  belt: BeltVariant | null;
  pendant: PendantVariant | null;
  pumpkin: PumpkinCoverage | null;
  underwear: boolean;
};

export type ModifierType =
  | 'paint' | 'goggles' | 'glasses'
  | 'belt' | 'pendant' | 'pumpkin' | 'underwear';

export type ModifierDef = {
  id: string;
  type: ModifierType;
  variant?: string;
  coverage?: PumpkinCoverage;
  color?: SlimeColor;
  count?: number; // max uses allowed (undefined = unlimited)
};

export type LevelData = {
  id: string;
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  goalState: SlimeState;
  palette: ModifierDef[];
  optimalSteps: number;
  optimalSolution?: readonly string[];
  hint?: string;
  authorName?: string;
  isDaily?: boolean;
};

export type ConflictType =
  | 'EYE_SLOT'
  | 'GOGGLE_ONE_SHOT'
  | 'PUMPKIN_UNDERWEAR'
  | 'UNDERWEAR_PUMPKIN75'
  | 'THICK_BELT_PUMPKIN75'
  | 'PUMPKIN75_THICK_BELT'
  | 'COUNT_LIMIT';

export const CONFLICT_MESSAGES: Record<ConflictType, string> = {
  EYE_SLOT:            "Splot can't see through all that!",
  GOGGLE_ONE_SHOT:     "Those goggles are all used up!",
  PUMPKIN_UNDERWEAR:   "No room for undies on that pumpkin!",
  UNDERWEAR_PUMPKIN75: "Take the undies off first!",
  THICK_BELT_PUMPKIN75:"The pumpkin ate the belt!",
  PUMPKIN75_THICK_BELT:"Can't belt a full pumpkin!",
  COUNT_LIMIT:         "No more of that modifier!",
};

export type ApplyResult =
  | { ok: true;  newState: SlimeState; isWin: boolean }
  | { ok: false; conflict: ConflictType; message: string };

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

export const DEFAULT_SLIME_STATE: SlimeState = {
  color: '#FFFFFF',
  goggles:  null,
  glasses:  null,
  belt:     null,
  pendant:  null,
  pumpkin:  null,
  underwear: false,
};

export const DEFAULT_EQUIPPED: Record<string, string> = {
  eye:       'eye-normal',
  eyebrow:   'eyebrow-normal',
  mouth:     'mouth-happy',
  accessory: '',
};
