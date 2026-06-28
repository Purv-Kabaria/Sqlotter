import type { LevelData, LeaderboardEntry, UserProfile, Stars, SlimeState, ModifierDef } from './types';

// ── Init ──────────────────────────────────────────────────
export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  isLoggedIn?: boolean;
  sparks: number;
  equippedItems?: Record<string, string>;
  levelsCompleted?: string[];
  count?: number;
};

// ── Levels ────────────────────────────────────────────────
export type LevelsListResponse = {
  type: 'levels';
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
  type: 'level';
  level: LevelData;
};

export type DailyResponse = {
  type: 'daily';
  date: string;
  level: LevelData;
  completionCount: number;
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
};

// ── Leaderboard ───────────────────────────────────────────
export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
};

// ── User ──────────────────────────────────────────────────
export type ProfileResponse = UserProfile & {
  completedLevels: string[];
  levelStars: Record<string, number>;
};

export type EquipRequest  = { itemId: string; slot: string };
export type EquipResponse = { equippedItems: Record<string, string> };

export type BuyRequest  = { itemId: string };
export type BuyResponse = { sparks: number; unlockedItems: string[] };

// ── Level creation (UGC) ──────────────────────────────────
export type LevelCreateRequest = {
  title: string;
  difficulty: 1 | 2 | 3 | 4 | 5;
  goalState: SlimeState;
  palette: ModifierDef[];
  optimalSteps: number;
  hint?: string;
};

export type LevelCreateResponse = {
  levelId: string;
};

// ── Legacy (keep for existing routes) ─────────────────────
export type IncrementResponse = { type: 'increment'; postId: string; count: number };
export type DecrementResponse = { type: 'decrement'; postId: string; count: number };
