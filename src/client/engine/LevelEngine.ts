import type {
  SlimeState, ModifierDef, ApplyResult,
  ConflictType, Stars, GogglesVariant, GlassesVariant,
  BeltVariant, PendantVariant, PumpkinCoverage,
} from '../../shared/types';
import { DEFAULT_SLIME_STATE, CONFLICT_MESSAGES } from '../../shared/types';
import type { LevelData } from '../../shared/types';

// ── Compatibility check ────────────────────────────────────────
function checkCompatibility(
  state: SlimeState,
  mod: ModifierDef,
  gogglesUsed: boolean,
): { conflict: ConflictType } | null {
  if (mod.type === 'goggles') {
    if (gogglesUsed) return { conflict: 'GOGGLE_ONE_SHOT' };
    if (state.glasses !== null) return { conflict: 'EYE_SLOT' };
  }
  if (mod.type === 'glasses' && state.goggles !== null) {
    return { conflict: 'EYE_SLOT' };
  }
  if (mod.type === 'underwear' && state.pumpkin === 75) {
    return { conflict: 'PUMPKIN_UNDERWEAR' };
  }
  if (mod.type === 'pumpkin' && mod.coverage === 75) {
    if (state.underwear) return { conflict: 'UNDERWEAR_PUMPKIN75' };
    if (state.belt === 'h-thick' || state.belt === 'v-thick') {
      return { conflict: 'THICK_BELT_PUMPKIN75' };
    }
  }
  if (mod.type === 'belt' && (mod.variant === 'h-thick' || mod.variant === 'v-thick')) {
    if (state.pumpkin === 75) return { conflict: 'PUMPKIN75_THICK_BELT' };
  }
  return null;
}

// ── State transition ───────────────────────────────────────────
export function applyToState(state: SlimeState, mod: ModifierDef): SlimeState {
  const next = { ...state };
  switch (mod.type) {
    case 'paint':
      next.color = mod.color!;
      break;
    case 'goggles':
      next.goggles = mod.variant as GogglesVariant;
      break;
    case 'glasses':
      next.glasses = mod.variant as GlassesVariant;
      break;
    case 'belt':
      next.belt = mod.variant as BeltVariant;
      break;
    case 'pendant':
      next.pendant = mod.variant as PendantVariant;
      break;
    case 'pumpkin':
      next.pumpkin = mod.coverage as PumpkinCoverage;
      break;
    case 'underwear':
      next.underwear = true;
      break;
  }
  return next;
}

// ── Win detection ──────────────────────────────────────────────
export function statesMatch(a: SlimeState, b: SlimeState): boolean {
  return (
    a.color     === b.color     &&
    a.goggles   === b.goggles   &&
    a.glasses   === b.glasses   &&
    a.belt      === b.belt      &&
    a.pendant   === b.pendant   &&
    a.pumpkin   === b.pumpkin   &&
    a.underwear === b.underwear
  );
}

// ── Stars calculation ──────────────────────────────────────────
export function calcStars(steps: number, optimalSteps: number): Stars {
  if (steps <= optimalSteps)      return 3;
  if (steps <= optimalSteps * 2)  return 2;
  return 1;
}

// ── Sparks earned ──────────────────────────────────────────────
export function calcSparks(stars: Stars, isFirstCompletion: boolean): number {
  const base = stars === 3 ? 30 : stars === 2 ? 20 : 10;
  return base + (isFirstCompletion ? 30 : 0);
}

// ── Modifier text key (for asset loading) ─────────────────────
export function modifierAssetKey(mod: ModifierDef): string | null {
  switch (mod.type) {
    case 'paint': return null; // paint has no overlay sprite
    case 'goggles': return `mod-goggles-${mod.variant}`;
    case 'glasses': return `mod-glasses-${mod.variant}`;
    case 'belt':    return `mod-belt-${mod.variant}`;
    case 'pendant': return `mod-pendant-${mod.variant}`;
    case 'pumpkin': return `mod-pumpkin-${mod.coverage}`;
    case 'underwear': return 'mod-underwear';
  }
}

// ── Core engine class ─────────────────────────────────────────
export class LevelEngine {
  private state: SlimeState;
  private readonly level: LevelData;
  private stepCount = 0;
  private gogglesUsed = false;
  private startTime: number;

  constructor(level: LevelData) {
    this.level = level;
    this.state = { ...DEFAULT_SLIME_STATE };
    this.startTime = Date.now();
  }

  get currentState(): SlimeState { return { ...this.state }; }
  get goalState(): SlimeState    { return { ...this.level.goalState }; }
  get steps(): number            { return this.stepCount; }
  get isGogglesSpent(): boolean  { return this.gogglesUsed; }

  applyModifier(mod: ModifierDef): ApplyResult {
    const conflict = checkCompatibility(this.state, mod, this.gogglesUsed);
    if (conflict) {
      return {
        ok: false,
        conflict: conflict.conflict,
        message: CONFLICT_MESSAGES[conflict.conflict],
      };
    }
    this.state = applyToState(this.state, mod);
    this.stepCount++;
    if (mod.type === 'goggles') this.gogglesUsed = true;

    const isWin = statesMatch(this.state, this.level.goalState);
    return { ok: true, newState: { ...this.state }, isWin };
  }

  reset() {
    this.state = { ...DEFAULT_SLIME_STATE };
    this.gogglesUsed = false;
    this.stepCount = 0;
    this.startTime = Date.now();
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
