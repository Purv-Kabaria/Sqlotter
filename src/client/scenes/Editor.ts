import * as Phaser from 'phaser';
import type { ModifierDef, SlimeState, PumpkinCoverage, GogglesVariant, GlassesVariant, BeltVariant, PendantVariant } from '../../shared/types';
import { DEFAULT_SLIME_STATE } from '../../shared/types';
import { SlimeRenderer } from '../components/SlimeRenderer';
import type { LevelData } from '../../shared/types';
import type { LevelCreateResponse } from '../../shared/api';
import { PIXEL_FONT, addPixelPanel, addPixelButton } from '../components/PixelUI';

// ── Modifier palette available in the editor ──────────────
const PAINT_COLORS: ModifierDef[] = [
  { id: 'paint-red',    type: 'paint', color: '#FF4444' },
  { id: 'paint-orange', type: 'paint', color: '#FF8C00' },
  { id: 'paint-yellow', type: 'paint', color: '#FFD700' },
  { id: 'paint-lime',   type: 'paint', color: '#6DD400' },
  { id: 'paint-blue',   type: 'paint', color: '#00BFFF' },
  { id: 'paint-purple', type: 'paint', color: '#9B59B6' },
  { id: 'paint-pink',   type: 'paint', color: '#FF69B4' },
  { id: 'paint-white',  type: 'paint', color: '#FFFFFF' },
];

const ALL_MODS: ModifierDef[] = [
  { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick' },
  { id: 'goggles-v-thick', type: 'goggles', variant: 'v-thick' },
  { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
  { id: 'glasses-v-thick', type: 'glasses', variant: 'v-thick' },
  { id: 'belt-h-thick',    type: 'belt',    variant: 'h-thick' },
  { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin'  },
  { id: 'belt-v-thick',    type: 'belt',    variant: 'v-thick' },
  { id: 'pendant-h',       type: 'pendant', variant: 'h'       },
  { id: 'pendant-v',       type: 'pendant', variant: 'v'       },
  { id: 'pumpkin-25',      type: 'pumpkin', coverage: 25       },
  { id: 'pumpkin-50',      type: 'pumpkin', coverage: 50       },
  { id: 'pumpkin-75',      type: 'pumpkin', coverage: 75       },
  { id: 'underwear',       type: 'underwear'                   },
];

// ── Local conflict check (returns message or null) ─────────
function checkConflict(state: SlimeState, mod: ModifierDef, gogglesUsed: boolean): string | null {
  if (mod.type === 'goggles') {
    if (gogglesUsed)              return 'Goggles can only be applied once!';
    if (state.glasses !== null)   return "Can't wear goggles AND glasses!";
  }
  if (mod.type === 'glasses' && state.goggles !== null) {
    return "Can't wear glasses AND goggles!";
  }
  if (mod.type === 'underwear' && state.pumpkin === 75) {
    return 'No room for undies with full pumpkin!';
  }
  if (mod.type === 'pumpkin' && mod.coverage === 75) {
    if (state.underwear) return 'Remove underwear before full pumpkin!';
    if (state.belt === 'h-thick' || state.belt === 'v-thick') return 'Pumpkin would cover the thick belt!';
  }
  if (mod.type === 'belt' && (mod.variant === 'h-thick' || mod.variant === 'v-thick') && state.pumpkin === 75) {
    return 'Full pumpkin blocks thick belts!';
  }
  return null;
}

// ── Local state transition ─────────────────────────────────
function applyMod(state: SlimeState, mod: ModifierDef): SlimeState {
  const next = { ...state };
  switch (mod.type) {
    case 'paint':     next.color    = mod.color!;                         break;
    case 'goggles':   next.goggles  = mod.variant as GogglesVariant;      break;
    case 'glasses':   next.glasses  = mod.variant as GlassesVariant;      break;
    case 'belt':      next.belt     = mod.variant as BeltVariant;         break;
    case 'pendant':   next.pendant  = mod.variant as PendantVariant;      break;
    case 'pumpkin':   next.pumpkin  = mod.coverage as PumpkinCoverage;    break;
    case 'underwear': next.underwear = true;                               break;
  }
  return next;
}

function modLabel(mod: ModifierDef): string {
  if (mod.type === 'goggles')   return `Goggles ${mod.variant}`;
  if (mod.type === 'glasses')   return `Glasses ${mod.variant}`;
  if (mod.type === 'belt')      return `Belt ${mod.variant}`;
  if (mod.type === 'pendant')   return `Pendant ${mod.variant}`;
  if (mod.type === 'pumpkin')   return `Pumpkin ${mod.coverage}%`;
  if (mod.type === 'underwear') return 'Underwear';
  return mod.id;
}

function computeDifficulty(steps: number): 1 | 2 | 3 | 4 | 5 {
  if (steps <= 1) return 1;
  if (steps <= 3) return 2;
  if (steps <= 4) return 3;
  if (steps <= 6) return 4;
  return 5;
}

function getIconKey(mod: ModifierDef): string | null {
  if (mod.type === 'goggles')   return 'icon-goggles-thick';
  if (mod.type === 'glasses')   return 'icon-glasses-thick';
  if (mod.type === 'belt')      return mod.variant?.includes('thin') ? 'icon-belt-thin' : 'icon-belt-thick';
  if (mod.type === 'pendant')   return 'icon-pendant';
  if (mod.type === 'pumpkin')   return 'icon-pumpkin';
  if (mod.type === 'underwear') return 'icon-underwear';
  return null;
}

const C = {
  BG:     0x1a0a2e,
  PANEL:  0x2d1b4e,
  GREEN:  0x6dd400,
  GOLD:   0xffd700,
  BLUE:   0x1a6fbf,
  TEXT:   '#ffffff',
  DIM:    '#7a8a9a',
  ACCENT: '#6DD400',
} as const;

// ── Editor Scene ───────────────────────────────────────────
export class Editor extends Phaser.Scene {
  private goalState: SlimeState = { ...DEFAULT_SLIME_STATE };
  private solutionSeq: ModifierDef[] = [];
  private gogglesUsed = false;
  private titleValue = 'My Custom Level';

  private goalRenderer: SlimeRenderer | null = null;
  private stepsText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private titleInput: HTMLInputElement | null = null;
  private titleInputY = 62;
  // Guards every scene.start(...) call — prevents double-clicking back/Test
  // Play/Publish (or clicking one while another's transition is in flight)
  // from queuing more than one scene transition.
  private navigating = false;

  constructor() { super('Editor'); }

  init() {
    this.goalState   = { ...DEFAULT_SLIME_STATE };
    this.solutionSeq = [];
    this.gogglesUsed = false;
    this.titleValue  = 'My Custom Level';
    this.navigating  = false;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(300, 26, 10, 46);

    const { width, height } = this.scale;
    const cx = width / 2;

    // Background
    ['bg2-1', 'bg2-2'].forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.4 : 0.2).setDepth(-10);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
    });

    this.buildHeader(cx, width);

    // Title DOM input overlaid on canvas
    this.titleInput = this.createTitleInput(cx, this.titleInputY, Math.min(width - 96, 260));
    this.scale.on('resize', this.onResize, this);

    // Goal slime panel
    const slimeSize = Math.min(width * 0.28, 120);
    const slimeY = 145;
    this.buildSlimePanel(cx, slimeY, slimeSize);

    // Steps / difficulty line
    this.stepsText = this.add.text(cx, slimeY + slimeSize / 2 + 24, 'Steps: 0  |  Diff: 1/5', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.DIM,
      stroke: '#1a0a2e',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(5);

    // Feedback text
    this.feedbackText = this.add.text(cx, slimeY + slimeSize / 2 + 40, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: '#ff8888',
      wordWrap: { width: width - 32 },
      align: 'center',
    }).setOrigin(0.5).setDepth(5);

    // Modifier section (paint + mod grid)
    const modStartY = slimeY + slimeSize / 2 + 56;
    this.buildModSection(cx, modStartY, width);

    // Bottom action buttons
    this.buildBottomButtons(cx, height, width);
  }

  private buildHeader(cx: number, width: number) {
    const backBg = this.add.graphics().setDepth(10);
    backBg.fillStyle(0x000000, 0.4);
    backBg.fillRoundedRect(-18, -14, 36, 28, 7);
    const backTxt = this.add.text(0, 0, '‹', { fontSize: '22px', color: '#fff' }).setOrigin(0.5, 0.45);
    const backC = this.add.container(28, 26, [backBg, backTxt])
      .setDepth(10).setSize(44, 44).setInteractive({ useHandCursor: true });
    backC.on('pointerup', () => this.goToScene('MainMenu'));

    this.add.text(cx, 26, 'LEVEL EDITOR', {
      fontFamily: PIXEL_FONT,
      fontSize: '11px',
      color: C.ACCENT,
      stroke: '#1a0a2e',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(10);

    const div = this.add.graphics().setDepth(10);
    div.lineStyle(1, 0x6dd400, 0.2);
    div.lineBetween(0, 46, width, 46);
  }

  private buildSlimePanel(cx: number, slimeY: number, slimeSize: number) {
    const panelW = slimeSize * 2.2;
    const panelH = slimeSize + 24;

    addPixelPanel(this, cx, slimeY, panelW, panelH).setDepth(2).setAlpha(0.94);

    this.add.text(cx, slimeY - panelH / 2 + 12, 'GOAL SLIME', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.ACCENT,
      stroke: '#1a0a2e',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(3);

    this.goalRenderer = new SlimeRenderer(this, cx, slimeY, slimeSize);
    this.goalRenderer.setState(this.goalState);

    // Undo / Reset buttons
    const btnY = slimeY + slimeSize / 2 + 8;
    this.buildSmallBtn(cx - 36, btnY, 60, 24, 'Undo',  () => this.undo());
    this.buildSmallBtn(cx + 36, btnY, 60, 24, 'Reset', () => this.reset());
  }

  private buildModSection(cx: number, startY: number, width: number) {
    this.add.text(cx, startY, 'BUILD YOUR GOAL:', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.ACCENT,
      stroke: '#1a0a2e',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(5);

    // Paint color swatches
    const swatchD  = Math.min(Math.floor((width - 40) / 8), 36);
    const rowW     = (swatchD + 4) * 8 - 4;
    const swatchY  = startY + 20;
    const swatchX0 = cx - rowW / 2 + swatchD / 2;

    PAINT_COLORS.forEach((mod, i) => {
      const x = swatchX0 + i * (swatchD + 4);
      this.buildColorSwatch(x, swatchY, swatchD, mod);
    });

    // Modifier grid (3 cols)
    const cols   = 3;
    const pad    = 12;
    const gap    = 6;
    const cardW  = (width - pad * 2 - gap * (cols - 1)) / cols;
    const cardH  = 44;
    const gridY0 = swatchY + swatchD / 2 + 12;

    ALL_MODS.forEach((mod, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = pad + col * (cardW + gap) + cardW / 2;
      const y   = gridY0 + row * (cardH + gap) + cardH / 2;
      this.buildModCard(x, y, cardW, cardH, mod);
    });
  }

  private buildColorSwatch(x: number, y: number, d: number, mod: ModifierDef) {
    const col = parseInt((mod.color ?? '#ffffff').replace('#', ''), 16);
    const c = this.add.circle(x, y, d / 2, col).setDepth(5);
    c.setStrokeStyle(1.5, 0xffffff, 0.35);
    this.add.zone(x, y, Math.max(d, 44), Math.max(d, 44)).setDepth(6).setInteractive({ useHandCursor: true })
      .on('pointerover', () => c.setStrokeStyle(2.5, 0x6dd400, 1))
      .on('pointerout',  () => c.setStrokeStyle(1.5, 0xffffff, 0.35))
      .on('pointerup', () => {
        c.setStrokeStyle(3, 0x6dd400, 1);
        this.applyGoalMod(mod);
        this.time.delayedCall(200, () => c.setStrokeStyle(1.5, 0xffffff, 0.35));
      });
  }

  private buildModCard(cx: number, cy: number, w: number, h: number, mod: ModifierDef) {
    const bg = this.add.graphics();
    const drawNorm = () => {
      bg.clear();
      bg.fillStyle(C.PANEL, 0.9);
      bg.lineStyle(1, 0x6dd400, 0.4);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 7);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 7);
    };
    const drawHov = () => {
      bg.clear();
      bg.fillStyle(0x4a2c8a, 1);
      bg.lineStyle(2, 0x6dd400, 0.9);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 7);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 7);
    };
    drawNorm();

    const iconKey = getIconKey(mod);
    const items: Phaser.GameObjects.GameObject[] = [bg];

    if (iconKey && this.textures.exists(iconKey)) {
      items.push(this.add.image(-w / 2 + 16, 0, iconKey).setDisplaySize(18, 18));
    }

    const txtX = iconKey ? -w / 2 + 30 : -w / 2 + 6;
    const txtW = w - (iconKey ? 38 : 12);
    items.push(this.add.text(txtX, 0, modLabel(mod), {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: C.TEXT,
      wordWrap: { width: txtW },
    }).setOrigin(0, 0.5));

    const c = this.add.container(cx, cy, items).setDepth(5).setSize(w, h).setInteractive({ useHandCursor: true });
    c.on('pointerover', drawHov);
    c.on('pointerout', drawNorm);
    c.on('pointerdown', () => this.tweens.add({ targets: c, scaleX: 0.95, scaleY: 0.95, duration: 50 }));
    c.on('pointerup', () => {
      this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 50 });
      this.applyGoalMod(mod);
    });
  }

  private buildBottomButtons(cx: number, height: number, width: number) {
    const btnY = height - 32;
    const btnW = Math.min((width - 48) / 2, 148);
    const btnH = 46;

    addPixelButton(this, {
      x: cx - btnW / 2 - 6, y: btnY,
      width: btnW, height: btnH,
      label: 'Test Play',
      iconKey: 'icon-play',
      onClick: () => this.testPlay(),
    }).setDepth(8);

    addPixelButton(this, {
      x: cx + btnW / 2 + 6, y: btnY,
      width: btnW, height: btnH,
      label: 'Publish',
      iconKey: 'icon-share',
      onClick: () => void this.publish(),
    }).setDepth(8);
  }

  private buildSmallBtn(x: number, y: number, w: number, h: number, label: string, cb: () => void) {
    addPixelButton(this, {
      x, y,
      width: Math.max(w, 60), height: Math.max(h, 36),
      label,
      fontSize: 8,
      onClick: cb,
    }).setDepth(5);
  }

  // ── Goal building ──────────────────────────────────────────
  private applyGoalMod(mod: ModifierDef) {
    const err = checkConflict(this.goalState, mod, this.gogglesUsed);
    if (err) {
      this.showFeedback(err, true);
      this.goalRenderer?.playShakeAnim(this);
      return;
    }
    this.goalState = applyMod(this.goalState, mod);
    if (mod.type === 'goggles') this.gogglesUsed = true;
    this.solutionSeq.push(mod);
    this.goalRenderer?.setState(this.goalState);
    this.goalRenderer?.playApplyAnim(this);
    this.updateMeta();
    this.showFeedback('', false);
  }

  private undo() {
    if (this.solutionSeq.length === 0) return;
    this.solutionSeq.pop();
    this.goalState   = { ...DEFAULT_SLIME_STATE };
    this.gogglesUsed = false;
    for (const m of this.solutionSeq) {
      this.goalState = applyMod(this.goalState, m);
      if (m.type === 'goggles') this.gogglesUsed = true;
    }
    this.goalRenderer?.setState(this.goalState);
    this.updateMeta();
  }

  private reset() {
    this.solutionSeq = [];
    this.goalState   = { ...DEFAULT_SLIME_STATE };
    this.gogglesUsed = false;
    this.goalRenderer?.setState(this.goalState);
    this.updateMeta();
  }

  private updateMeta() {
    const steps = this.solutionSeq.length;
    const diff  = computeDifficulty(steps);
    this.stepsText?.setText(`Steps: ${steps}  |  Diff: ${diff}/5`);
  }

  private showFeedback(msg: string, isError: boolean) {
    if (!this.feedbackText) return;
    if (!msg) { this.feedbackText.setAlpha(0); return; }
    this.feedbackText.setText(msg).setColor(isError ? '#ff8888' : '#6DD400').setAlpha(1);
    this.tweens.killTweensOf(this.feedbackText);
    this.time.delayedCall(2200, () => {
      this.tweens.add({ targets: this.feedbackText, alpha: 0, duration: 300 });
    });
  }

  // ── Test / Publish ─────────────────────────────────────────
  private testPlay() {
    if (this.solutionSeq.length === 0) {
      this.showFeedback('Apply some modifiers to build a goal first!', true);
      return;
    }
    const level = this.buildLevelData('__preview__');
    this.goToScene('Game', { levelId: '__preview__', previewData: level });
  }

  // Centralizes every scene.start(...) call — see `navigating` field comment.
  private goToScene(key: string, data?: Record<string, unknown>) {
    if (this.navigating) return;
    this.navigating = true;
    this.titleInput?.remove();
    this.cameras.main.fadeOut(250, 26, 10, 46);
    this.time.delayedCall(260, () => this.scene.start(key, data));
  }

  private async publish() {
    if (this.solutionSeq.length === 0) {
      this.showFeedback('Build a goal first!', true);
      return;
    }
    const title = (this.titleInput?.value ?? '').trim() || 'My Custom Level';
    this.titleValue = title;

    try {
      const res = await fetch('/api/level/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          difficulty:   computeDifficulty(this.solutionSeq.length),
          goalState:    this.goalState,
          palette:      this.buildPalette(),
          optimalSteps: this.solutionSeq.length,
          solution:     this.solutionSeq.map((modifier) => modifier.id),
        }),
      });

      // The player may have already navigated away (e.g. tapped back) while
      // this request was in flight — don't touch UI/scene state that's gone.
      if (this.navigating) return;

      if (res.status === 401) {
        this.showFeedback('Log in to publish levels!', true);
        return;
      }
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        this.showFeedback(err.message ?? 'Failed to publish', true);
        return;
      }

      const data = await res.json() as LevelCreateResponse;
      this.showFeedback('Published! Sharing your level…', false);
      this.time.delayedCall(1800, () => {
        this.goToScene('Game', { levelId: data.levelId });
      });
    } catch {
      if (!this.navigating) this.showFeedback('Network error — try again', true);
    }
  }

  private buildPalette(): ModifierDef[] {
    // All solution mods + up to 2 plausible decoys
    const usedIds = new Set(this.solutionSeq.map(m => m.id));
    const decoyPool = ALL_MODS.filter(m => !usedIds.has(m.id) && m.type !== 'goggles');
    const palette = [...this.solutionSeq];

    for (let i = 0; i < Math.min(2, decoyPool.length); i++) {
      const idx = Math.floor(Math.random() * decoyPool.length);
      const [decoy] = decoyPool.splice(idx, 1);
      if (decoy) palette.push(decoy);
    }

    // Shuffle so solution order isn't visible
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = palette[i]!;
      palette[i] = palette[j]!;
      palette[j] = tmp;
    }
    return palette;
  }

  private buildLevelData(id: string): LevelData {
    return {
      id,
      title:        this.titleValue,
      difficulty:   computeDifficulty(this.solutionSeq.length),
      goalState:    { ...this.goalState },
      palette:      this.buildPalette(),
      optimalSteps: this.solutionSeq.length,
    };
  }

  private createTitleInput(cx: number, y: number, w: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = 'Level title...';
    input.maxLength   = 60;
    input.value       = this.titleValue;

    Object.assign(input.style, {
      position:    'fixed',
      padding:     '0 8px',
      boxSizing:   'border-box',
      background:  '#2d1b4e',
      color:       '#fff',
      border:      '1px solid #6dd400aa',
      borderRadius: '6px',
      outline:     'none',
      zIndex:      '100',
      fontFamily:  'Arial, sans-serif',
    });

    const canvas = this.game.canvas;
    const parent = canvas.parentElement ?? document.body;
    parent.appendChild(input);
    this.positionTitleInput(input, cx, y, w);
    input.addEventListener('input', () => { this.titleValue = input.value; });
    return input;
  }

  private positionTitleInput(input: HTMLInputElement, cx: number, y: number, w: number) {
    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx     = rect.width  / this.scale.width;
    const sy     = rect.height / this.scale.height;
    const scale  = Math.min(sx, sy);

    Object.assign(input.style, {
      left:     `${rect.left + (cx - w / 2) * sx}px`,
      top:      `${rect.top  + (y - 13) * sy}px`,
      width:    `${w * sx}px`,
      height:   `${26 * sy}px`,
      fontSize: `${13 * scale}px`,
    });
  }

  private onResize() {
    if (!this.titleInput) return;
    const { width } = this.scale;
    this.positionTitleInput(this.titleInput, width / 2, this.titleInputY, Math.min(width - 96, 260));
  }

  shutdown() {
    this.navigating = true;
    this.scale.off('resize', this.onResize, this);
    this.titleInput?.remove();
    this.titleInput = null;
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
