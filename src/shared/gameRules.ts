import type {
  ApplyResult, BeltVariant, ConflictType, GlassesVariant, GogglesVariant,
  LevelData, ModifierDef, PendantVariant, PumpkinCoverage, SlimeState, Stars,
} from './types';
import { CONFLICT_MESSAGES, DEFAULT_SLIME_STATE } from './types';

export function checkCompatibility(
  state: SlimeState,
  mod: ModifierDef,
  gogglesUsed: boolean,
): { conflict: ConflictType } | null {
  if (mod.type === 'goggles') {
    if (gogglesUsed) return { conflict: 'GOGGLE_ONE_SHOT' };
    if (state.glasses !== null) return { conflict: 'EYE_SLOT' };
  }
  if (mod.type === 'glasses' && state.goggles !== null) return { conflict: 'EYE_SLOT' };
  if (mod.type === 'underwear' && state.pumpkin === 75) return { conflict: 'PUMPKIN_UNDERWEAR' };
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

export function applyToState(state: SlimeState, mod: ModifierDef): SlimeState {
  const next = { ...state };
  switch (mod.type) {
    case 'paint': next.color = mod.color!; break;
    case 'goggles': next.goggles = mod.variant as GogglesVariant; break;
    case 'glasses': next.glasses = mod.variant as GlassesVariant; break;
    case 'belt': next.belt = mod.variant as BeltVariant; break;
    case 'pendant': next.pendant = mod.variant as PendantVariant; break;
    case 'pumpkin': next.pumpkin = mod.coverage as PumpkinCoverage; break;
    case 'underwear': next.underwear = true; break;
  }
  return next;
}

export function statesMatch(a: SlimeState, b: SlimeState): boolean {
  return a.color === b.color
    && a.goggles === b.goggles
    && a.glasses === b.glasses
    && a.belt === b.belt
    && a.pendant === b.pendant
    && a.pumpkin === b.pumpkin
    && a.underwear === b.underwear;
}

export function calcStars(steps: number, optimalSteps: number): Stars {
  if (steps <= optimalSteps) return 3;
  if (steps <= optimalSteps * 2) return 2;
  return 1;
}

export function applyModifier(
  state: SlimeState,
  mod: ModifierDef,
  gogglesUsed: boolean,
  goalState: SlimeState,
): ApplyResult {
  const conflict = checkCompatibility(state, mod, gogglesUsed);
  if (conflict) {
    return { ok: false, conflict: conflict.conflict, message: CONFLICT_MESSAGES[conflict.conflict] };
  }
  const newState = applyToState(state, mod);
  return { ok: true, newState, isWin: statesMatch(newState, goalState) };
}

export function isValidSolution(level: LevelData, actionIds: readonly string[]): boolean {
  let state = { ...DEFAULT_SLIME_STATE };
  let gogglesUsed = false;
  for (const actionId of actionIds) {
    const mod = level.palette.find((candidate) => candidate.id === actionId);
    if (!mod) return false;
    const result = applyModifier(state, mod, gogglesUsed, level.goalState);
    if (!result.ok) return false;
    state = result.newState;
    if (mod.type === 'goggles') gogglesUsed = true;
  }
  return statesMatch(state, level.goalState);
}
