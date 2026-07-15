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
  // Sound preferences (default on; Redis-backed for logged-in players).
  sfxEnabled?: boolean;
  musicEnabled?: boolean;
  // First-visit welcome tour on the home page: true once dismissed, so a
  // returning player never sees it again (guests fall back to a session flag).
  guideSeen?: boolean;
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
  // PNG data URI snapshot of the in-game card preview — same validation and
  // media.upload() path as FirstSplatRequest's image below.
  imageDataUrl?: string;
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
// Posts the player's current Splot as an IMAGE comment on the live weekly Fit
// Check thread. Only accepted while the player is actually viewing that thread
// (the server matches context.postId against the live fitcheck post), so a fit
// can only be dropped on a Fit Check post. The optional caption + photo URL
// ride along for memeability — the server sanitizes both.
export type ShareFitRequest = {
  // PNG data URI snapshot of the player's fit card — same validation and
  // media.upload() path as ShareCardRequest's image. The comment is image-first.
  imageDataUrl?: string;
  // Player's own words about the fit (≤ 140 chars; the server sanitizes it).
  caption?: string;
  // Optional external photo URL (http/https, ≤ 300 chars) — embedded inline
  // when Reddit accepts it, linked otherwise.
  photoUrl?: string;
};

export type ShareFitResponse = { posted: boolean };

// ── Splotter Flair opt-in/out ─────────────────────────────
export type FlairPrefRequest  = { enabled: boolean };
export type FlairPrefResponse = { enabled: boolean };

// ── Sound settings (SFX / music toggles on the home page) ─
export type SoundSettingsRequest  = { sfx: boolean; music: boolean };
export type SoundSettingsResponse = { sfx: boolean; music: boolean };

// ── Welcome tour (first-visit home page guide) ────────────
export type GuideSeenResponse = { seen: boolean };

// ── In-progress attempts (persistent levels) ──────────────
// Backing out of a level must not wipe the work: the client saves the live
// action log + banked time, and restores it on the next visit. Empty actions
// clear the save; /api/complete clears it server-side on a win.
export type ProgressSaveRequest  = { levelId: string; actions: string[]; timeMs: number };
export type ProgressSaveResponse = { saved: boolean };
export type ProgressGetResponse  = { actions?: string[]; timeMs?: number };

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

// equip: buy-then-wear in one round trip — the common "buy it, wear it"
// path used to be two sequential requests (and two full UI rebuilds).
export type BuyRequest  = { itemId: string; equip?: boolean };
export type BuyResponse = { sparks: number; unlockedItems: string[]; equippedItems?: Record<string, string> };

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
