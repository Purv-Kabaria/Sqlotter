import type { LevelData, Stars } from './types';
import { isCleanMatch, isPainted, replaySim } from './slimeSim';

// Star thresholds are optimal-relative: match the target = 3, within 2x = 2.
export function calcStars(steps: number, optimalSteps: number): Stars {
  if (steps <= optimalSteps) return 3;
  if (steps <= optimalSteps * 2) return 2;
  return 1;
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
