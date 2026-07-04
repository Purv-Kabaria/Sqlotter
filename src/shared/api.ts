import type { LevelData, LeaderboardEntry, UserProfile, Stars, ModifierDef } from './types';

// ── Init ──────────────────────────────────────────────────
export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  isLoggedIn?: boolean;
  sparks: number;
  streakDays?: number;
  equippedItems?: Record<string, string>;
  levelsCompleted?: string[];
  // Splotter Flair sync preference (defaults on; players can be flair-precious).
  flairEnabled?: boolean;
  count?: number;
};

// ── Levels ────────────────────────────────────────────────
export type LevelsListResponse = {
  levels: LevelData[];
};

export type CommunityLevelSummary = Pick<
  LevelData,
  'id' | 'title' | 'difficulty' | 'authorName' | 'optimalSteps'
>;

export type CommunityLevelsResponse = {
  levels: CommunityLevelSummary[];
};

export type LevelResponse = {
  level: LevelData;
};

export type DailyResponse = {
  date: string;
  levelId: string;
  level: LevelData;
  completionCount?: number;
};

// ── Completion ────────────────────────────────────────────
export type CompleteRequest = {
  levelId: string;
  timeMs: number;
  actions: string[];
};

export type CompleteResponse = {
  sparksEarned: number;
  newTotal: number;
  stars: Stars;
  isFirstCompletion: boolean;
  streakDays?: number;
  // True when this player holds the level's first-ever-completion record and
  // the First Splat Crown for it is still unclaimed (daily/UGC levels only).
  firstSplat?: boolean;
};

// ── Splat Card sharing ────────────────────────────────────
// CompleteRequest's shape plus an optional player-written caption: the server
// re-verifies the run (isValidSolution) before posting anything to Reddit.
export type ShareCardRequest = {
  levelId: string;
  timeMs: number;
  actions: string[];
  // Player's own title for the card (≤ 60 chars; the server sanitizes it).
  cardTitle?: string;
};

export type ShareCardResponse = { posted: boolean };

// ── First Splat Crown ─────────────────────────────────────
// Claims the one-time trophy comment for a level's first-ever solver. The
// image is a PNG data URI snapshot of the in-game trophy card; the server
// verifies the claimant against the level:first-completer record and falls
// back to a text-only crown comment when no (valid) image is attached.
export type FirstSplatRequest = {
  levelId: string;
  imageDataUrl?: string;
};

export type FirstSplatResponse = { posted: boolean };

// ── Fit Check Friday ──────────────────────────────────────
// Posts the player's current Splot loadout as a comment on the live weekly
// Fit Check thread (404 when none is live). No request body: the server
// reads the equipped record straight from the user hash.
export type ShareFitResponse = { posted: boolean };

// ── Splotter Flair opt-in/out ─────────────────────────────
export type FlairPrefRequest  = { enabled: boolean };
export type FlairPrefResponse = { enabled: boolean };

// ── Leaderboard ───────────────────────────────────────────
export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
};

// ── User ──────────────────────────────────────────────────
export type ProfileResponse = UserProfile & {
  completedLevels: string[];
  levelStars: Record<string, number>;
  // Splotter Flair sync preference (defaults on; players can be flair-precious).
  flairEnabled?: boolean;
};

export type EquipRequest  = { itemId: string; slot: string };
export type EquipResponse = { equippedItems: Record<string, string> };

export type BuyRequest  = { itemId: string };
export type BuyResponse = { sparks: number; unlockedItems: string[] };

// ── Level creation (UGC) ──────────────────────────────────
// The recorded solution doubles as the goal: replaying it through the shared
// stencil sim produces the target pattern (see src/shared/slimeSim.ts).
export type LevelCreateRequest = {
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  palette: ModifierDef[];
  optimalSteps: number;
  solution: string[];
  hint?: string;
};

export type LevelCreateResponse = {
  levelId: string;
  postId?: string;
};

// ── Legacy (keep for existing routes) ─────────────────────
export type IncrementResponse = { type: 'increment'; postId: string; count: number };
export type DecrementResponse = { type: 'decrement'; postId: string; count: number };
