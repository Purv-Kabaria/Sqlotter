import type { ApplyResult, LevelData, ModifierDef, SlimeState, Stars } from '../../shared/types';
import { DEFAULT_SLIME_STATE } from '../../shared/types';
import { applyModifier } from '../../shared/gameRules';

export { calcStars } from '../../shared/gameRules';

export function calcSparks(stars: Stars, isFirstCompletion: boolean): number {
  if (!isFirstCompletion) return 0;
  const base = 10;
  const optimalBonus = stars === 3 ? 20 : 0;
  return base + optimalBonus;
}

export function modifierAssetKey(mod: ModifierDef): string | null {
  switch (mod.type) {
    case 'paint': return null;
    case 'goggles': return `mod-goggles-${mod.variant}`;
    case 'glasses': return `mod-glasses-${mod.variant}`;
    case 'belt': return `mod-belt-${mod.variant}`;
    case 'pendant': return `mod-pendant-${mod.variant}`;
    case 'pumpkin': return `mod-pumpkin-${mod.coverage}`;
    case 'underwear': return 'mod-underwear';
  }
}

export class LevelEngine {
  private state: SlimeState;
  private readonly level: LevelData;
  private stepCount = 0;
  private gogglesUsed = false;
  private actionIds: string[] = [];
  private startTime: number;

  constructor(level: LevelData) {
    this.level = level;
    this.state = { ...DEFAULT_SLIME_STATE };
    this.startTime = Date.now();
  }

  get currentState(): SlimeState { return { ...this.state }; }
  get goalState(): SlimeState { return { ...this.level.goalState }; }
  get steps(): number { return this.stepCount; }
  get isGogglesSpent(): boolean { return this.gogglesUsed; }
  get actions(): string[] { return [...this.actionIds]; }

  applyModifier(mod: ModifierDef): ApplyResult {
    const result = applyModifier(this.state, mod, this.gogglesUsed, this.level.goalState);
    if (!result.ok) return result;

    this.state = result.newState;
    this.stepCount++;
    this.actionIds.push(mod.id);
    if (mod.type === 'goggles') this.gogglesUsed = true;
    return result;
  }

  reset() {
    this.state = { ...DEFAULT_SLIME_STATE };
    this.gogglesUsed = false;
    this.stepCount = 0;
    this.actionIds = [];
    this.startTime = Date.now();
  }

  elapsedMs(): number {
    return Date.now() - this.startTime;
  }
}
