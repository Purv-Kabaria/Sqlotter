import type { LevelData, Stars } from './types';
import { isCleanMatch, isPainted, replaySim, RESET_ACTION_ID } from './slimeSim';

// Every published level must be provably solvable within this many moves —
// the creator's own recording is the proof, and it doubles as the level's
// par. Enforced in the Editor while recording and again by /api/level/create.
// Deliberately roomy: creators build epics, and the ceiling exists only as an
// anti-abuse bound on stored-level size and replay cost, not as a design cap.
export const MAX_SOLUTION_STEPS = 60;

// Upper bound on a submitted ATTEMPT (/api/complete, share cards) — players
// fumble well past par, so this scales off the level ceiling rather than
// capping anyone's genuine (if messy) solve.
export const MAX_ATTEMPT_ACTIONS = MAX_SOLUTION_STEPS * 5;

// ── Move scoring ─────────────────────────────────────────────────────────────
// The player is never shown bare par: every level advertises a move LIMIT of
// par + a buffer (par 5 → limit 8). Finish within it = 3 stars; each further
// buffer-width tier crossed costs one star, down to 0 (the level still
// completes and pays base Sparks). The HUD raises the shown limit as tiers
// are crossed — see currentMoveTier.

/** Slack over par: half of par, floored at 2 (par 5 → 3, so the limit is 8). */
export function moveBuffer(optimalSteps: number): number {
  return Math.max(2, Math.ceil(optimalSteps / 2));
}

/** The advertised move limit — finishing within it keeps all 3 stars. */
export function moveLimit(optimalSteps: number): number {
  return optimalSteps + moveBuffer(optimalSteps);
}

/**
 * Moves that COUNT: everything after the most recent reset. Reset wipes the
 * move counter (not the clock) — the full log still replays server-side, so
 * the pre-reset history stays verifiable without being scored.
 */
export function effectiveSteps(actions: readonly string[]): number {
  return actions.length - (actions.lastIndexOf(RESET_ACTION_ID) + 1);
}

export function calcStars(steps: number, optimalSteps: number): Stars {
  const buffer = moveBuffer(optimalSteps);
  const limit = optimalSteps + buffer;
  if (steps <= limit) return 3;
  if (steps <= limit + buffer) return 2;
  if (steps <= limit + 2 * buffer) return 1;
  return 0;
}

/**
 * What the HUD shows mid-run for a current move count: the limit tier the
 * player is inside (it grows as tiers are crossed) and the stars still on the
 * table. Past the last tier there is no limit left to show.
 */
export function currentMoveTier(
  steps: number, optimalSteps: number,
): { limit: number | null; starsAtStake: Stars } {
  const starsAtStake = calcStars(steps, optimalSteps);
  const limit = starsAtStake === 0
    ? null
    : optimalSteps + moveBuffer(optimalSteps) * (4 - starsAtStake);
  return { limit, starsAtStake };
}

// Sparks are TIME-driven (stars are the move currency): full bonus for a
// solve under ~30s, fading to nothing by five minutes. Server-authoritative —
// the client only ever displays what /api/complete returns.
export function timeSparksBonus(timeMs: number): number {
  const scaled = Math.ceil(15 * (1 - timeMs / 300_000));
  return Math.max(0, Math.min(15, scaled));
}

/**
 * A level is well-formed when its own optimalSolution replays cleanly: every
 * action id resolves against the palette, the run ends bare (no stencils
 * worn), and at least one paint landed — an all-white goal would be "solved"
 * by any wear-then-remove pair. The goal pattern IS this replay.
 */
export function verifyLevelIntegrity(level: LevelData): boolean {
  if (level.optimalSolution.length === 0) return false;
  const goal = replaySim(level.palette, level.optimalSolution);
  return goal !== null && goal.worn.length === 0 && isPainted(goal);
}

/**
 * Server-side (and preview) win verification: the submitted actions must
 * reproduce the goal pattern with nothing worn at the end.
 */
export function isValidSolution(level: LevelData, actionIds: readonly string[]): boolean {
  const goal = replaySim(level.palette, level.optimalSolution);
  if (!goal || goal.worn.length !== 0) return false;
  const attempt = replaySim(level.palette, actionIds);
  if (!attempt) return false;
  return isCleanMatch(attempt, goal);
}
