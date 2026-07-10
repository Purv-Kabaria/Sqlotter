import type { LevelData, ModifierDef } from '../../shared/types';
import type { ActionKind, SimState } from '../../shared/slimeSim';
import {
  applySimAction, createSimState, isCleanMatch, maskIdOf, replaySim, RESET_ACTION_ID,
} from '../../shared/slimeSim';
import { effectiveSteps } from '../../shared/gameRules';

export { calcStars, currentMoveTier, moveLimit } from '../../shared/gameRules';

/** Phaser texture key for a stencil modifier's art; null for paints. */
export function modifierAssetKey(mod: ModifierDef): string | null {
  const maskId = maskIdOf(mod);
  return maskId === null ? null : `mod-${maskId}`;
}

export type ApplyOutcome = {
  kind: ActionKind;
  isWin: boolean;
  /** Mask ids the move broke (goggles knocked off by this splash). */
  broke: string[];
};

/**
 * Client-side wrapper around the shared stencil-paint simulation. Paints color
 * every exposed body cell; stencil modifiers toggle on (protecting what they
 * cover) and off — except goggles, which break after one splash lands on them.
 * Win = pattern matches the goal replay AND nothing is worn.
 */
export class LevelEngine {
  private readonly goal: SimState;
  private readonly palette: readonly ModifierDef[];
  private state: SimState;
  private actionIds: string[] = [];
  private startTime: number;

  constructor(level: LevelData) {
    this.goal = replaySim(level.palette, level.optimalSolution) ?? createSimState();
    this.palette = level.palette;
    this.state = createSimState();
    this.startTime = Date.now();
  }

  /** Moves that COUNT — everything after the most recent reset (see gameRules). */
  get steps(): number { return effectiveSteps(this.actionIds); }
  get actions(): string[] { return [...this.actionIds]; }
  get wornMaskIds(): string[] { return [...this.state.worn]; }

  /** Whether this stencil is currently on the slime (always false for paints). */
  isWorn(mod: ModifierDef): boolean {
    // The nose is worn at whatever size it has grown to (nose-small/medium/big).
    if (mod.type === 'nose') return this.state.worn.some((id) => id.startsWith('nose-'));
    const maskId = maskIdOf(mod);
    return maskId !== null && this.state.worn.includes(maskId);
  }

  /** Current worn nose size, or null when no nose is on. */
  noseSize(): 'small' | 'medium' | 'big' | null {
    const id = this.state.worn.find((w) => w.startsWith('nose-'));
    return id ? (id.slice(5) as 'small' | 'medium' | 'big') : null;
  }

  /** Whether this stencil broke this run (goggles are one-time use). */
  isBroken(mod: ModifierDef): boolean {
    const maskId = maskIdOf(mod);
    return maskId !== null && this.state.broken.includes(maskId);
  }

  /** Whether this one-shot action has been used this run (the alpha dip). */
  isSpent(mod: ModifierDef): boolean {
    return this.state.spent.includes(mod.id);
  }

  applyModifier(mod: ModifierDef): ApplyOutcome {
    const brokenBefore = this.state.broken.length;
    const kind = applySimAction(this.state, mod);
    // A tap on broken goggles is refused outright — nothing logged, no step.
    if (kind === 'broken') return { kind, isWin: false, broke: [] };
    this.actionIds.push(mod.id);
    return {
      kind,
      isWin: isCleanMatch(this.state, this.goal),
      broke: this.state.broken.slice(brokenBefore),
    };
  }

  // Reset clears the slime AND the move counter (steps count from the last
  // reset) but NOT the clock — Sparks ride on time, so a reset trades moves
  // for seconds. The action log keeps the whole history so the server replay
  // sees exactly what happened.
  reset() {
    this.state = createSimState();
    this.actionIds.push(RESET_ACTION_ID);
  }

  /**
   * Resumes a persisted attempt: strict-replays the saved log and rewinds the
   * clock by the banked time. Rejected (false, engine untouched) when the log
   * no longer replays — a level whose rules changed — or when it is somehow
   * already a win, which a fresh attempt must never silently be.
   */
  restore(actions: readonly string[], elapsedMs: number): boolean {
    if (actions.length === 0) return false;
    const replayed = replaySim(this.palette, actions);
    if (!replayed || isCleanMatch(replayed, this.goal)) return false;
    this.state = replayed;
    this.actionIds = [...actions];
    this.startTime = Date.now() - Math.max(0, elapsedMs);
    return true;
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
