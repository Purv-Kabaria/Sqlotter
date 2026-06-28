import type { LevelData, LeaderboardEntry, CompletionData, UserProfile, Stars } from './types';

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
  steps: number;
  timeMs: number;
  stars: Stars;
  isOptimal: boolean;
  sparksEarned?: number;
};

export type CompleteResponse = {
  sparksEarned: number;
  newTotal: number;
  stars: Stars;
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

// ── Legacy (keep for existing routes) ─────────────────────
export type IncrementResponse = { type: 'increment'; postId: string; count: number };
export type DecrementResponse = { type: 'decrement'; postId: string; count: number };
