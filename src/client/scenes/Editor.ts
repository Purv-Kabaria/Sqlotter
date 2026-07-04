import * as Phaser from 'phaser';
import type { ModifierDef } from '../../shared/types';
import { isBreakableMask, replayOps, standardPaints } from '../../shared/slimeSim';
import { MAX_SOLUTION_STEPS } from '../../shared/gameRules';
import { SlimeRenderer } from '../components/SlimeRenderer';
import type { LevelData } from '../../shared/types';
import type { LevelCreateResponse } from '../../shared/api';
import { PIXEL_FONT, addBeigeButton, addPixelPanel } from '../components/PixelUI';
import { DEFERRED_IMG } from './Preloader';

const PIXELIFY = '"Pixelify Sans", sans-serif';

// ── Modifier palette available in the editor ──────────────
// The same 16-color rack the game's paint pot offers (slimeSim's catalog), so
// published palettes reference the canonical paint ids and colors.
const PAINT_COLORS: readonly ModifierDef[] = standardPaints();

// The FULL stencil catalog — all 20 masks the sim knows (every goggles/
// glasses/belt orientation and thickness, both pendants, all pumpkin sizes,
// undies). Maximum creative range for creators.
const ALL_MODS: ModifierDef[] = [
  { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick' },
  { id: 'goggles-h-thin',  type: 'goggles', variant: 'h-thin'  },
  { id: 'goggles-h-mono',  type: 'goggles', variant: 'h-mono'  },
  { id: 'goggles-v-thick', type: 'goggles', variant: 'v-thick' },
  { id: 'goggles-v-thin',  type: 'goggles', variant: 'v-thin'  },
  { id: 'goggles-v-mono',  type: 'goggles', variant: 'v-mono'  },
  { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
  { id: 'glasses-h-thin',  type: 'glasses', variant: 'h-thin'  },
  { id: 'glasses-v-thick', type: 'glasses', variant: 'v-thick' },
  { id: 'glasses-v-thin',  type: 'glasses', variant: 'v-thin'  },
  { id: 'belt-h-thick',    type: 'belt',    variant: 'h-thick' },
  { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin'  },
  { id: 'belt-v-thick',    type: 'belt',    variant: 'v-thick' },
  { id: 'belt-v-thin',     type: 'belt',    variant: 'v-thin'  },
  { id: 'pendant-h',       type: 'pendant', variant: 'h'       },
  { id: 'pendant-v',       type: 'pendant', variant: 'v'       },
  { id: 'pumpkin-25',      type: 'pumpkin', coverage: 25       },
  { id: 'pumpkin-50',      type: 'pumpkin', coverage: 50       },
  { id: 'pumpkin-75',      type: 'pumpkin', coverage: 75       },
  { id: 'underwear',       type: 'underwear'                   },
];

// Everything the editor can record — paints splash color, the rest are
// stencils that toggle on/off (tap again to remove). The creator literally
// PLAYS their level here; the recorded action list becomes its solution and
// its goal pattern at once.
const EDITOR_DEFS: ModifierDef[] = [...PAINT_COLORS, ...ALL_MODS];

// "h-thick" → "H thick" — orientation loud, thickness quiet.
function variantLabel(variant: string | undefined): string {
  if (!variant) return '';
  const [axis, thickness] = variant.split('-');
  return thickness ? `${(axis ?? '').toUpperCase()} ${thickness}` : (axis ?? '').toUpperCase();
}

function modLabel(mod: ModifierDef): string {
  if (mod.type === 'goggles')   return `Goggles ${variantLabel(mod.variant)}`;
  if (mod.type === 'glasses')   return `Glasses ${variantLabel(mod.variant)}`;
  if (mod.type === 'belt')      return `Belt ${variantLabel(mod.variant)}`;
  if (mod.type === 'pendant')   return `Pendant ${variantLabel(mod.variant)}`;
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
  if (mod.type === 'goggles') {
    if (mod.variant?.includes('mono')) return 'icon-goggle';
    return mod.variant?.includes('thin') ? 'icon-goggles-thin' : 'icon-goggles-thick';
  }
  if (mod.type === 'glasses')   return mod.variant?.includes('thin') ? 'icon-glasses-thin' : 'icon-glasses-thick';
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
  // The recorded action-id sequence — solution AND goal in one.
  private actions: string[] = [];
  private titleValue = 'My Custom Level';
  private hintValue = '';
  // Creator-chosen decoy count (0-3): unused stencils/colors padded into the
  // published palette so it doesn't spell out the recipe.
  private decoyCount = 2;

  private goalRenderer: SlimeRenderer | null = null;
  private stepsText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private decoyBtn: Phaser.GameObjects.Container | null = null;
  private titleInput: HTMLInputElement | null = null;
  private hintInput: HTMLInputElement | null = null;
  private titleInputY = 62;
  private hintInputY = 92;
  // Guards every scene.start(...) call — prevents double-clicking back/Test
  // Play/Publish (or clicking one while another's transition is in flight)
  // from queuing more than one scene transition.
  private navigating = false;

  constructor() { super('Editor'); }

  init() {
    this.actions    = [];
    this.titleValue = 'My Custom Level';
    this.hintValue  = '';
    this.decoyCount = 2;
    this.decoyBtn   = null;
    this.navigating = false;
  }

  // Safety net for the deferred background set — normally MainMenu has already
  // streamed it in the background and this queues nothing.
  preload() {
    this.load.setPath('assets');
    for (const { key, path } of DEFERRED_IMG) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
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

    // Title + hint DOM inputs overlaid on canvas
    this.titleInput = this.createOverlayInput(
      this.titleInputY, 'Level title...', this.titleValue, 60,
      (v) => { this.titleValue = v; });
    this.hintInput = this.createOverlayInput(
      this.hintInputY, 'Hint for players (optional)...', this.hintValue, 160,
      (v) => { this.hintValue = v; });
    this.scale.on('resize', this.onResize, this);

    // Goal slime panel — below the two input rows
    const slimeSize = Math.min(width * 0.28, 120);
    const slimeY = 178;
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
    // Above the depth-2 panel — at the default depth 0 the near-opaque panel
    // draws over the slime and it renders as a barely-visible ghost.
    this.goalRenderer.container.setDepth(3);
    this.goalRenderer.setPattern(EDITOR_DEFS, this.actions);

    // Undo / Reset / Decoys buttons
    const btnY = slimeY + slimeSize / 2 + 8;
    this.buildSmallBtn(cx - 80, btnY, 64, 24, 'Undo',  () => this.undo());
    this.buildSmallBtn(cx - 8,  btnY, 64, 24, 'Reset', () => this.reset());
    this.buildDecoyButton(cx + 82, btnY);
  }

  // Cycles 0→3. addBeigeButton bakes its label, so the button is rebuilt on
  // every tap — cheap, and it keeps the label/state in one place.
  private buildDecoyButton(x: number, y: number) {
    this.decoyBtn?.destroy();
    this.decoyBtn = addBeigeButton(this, {
      x, y, width: 104, height: 36,
      label: `Decoys: ${this.decoyCount}`,
      fontSize: 10, fontFamily: PIXELIFY,
      onClick: () => {
        this.decoyCount = (this.decoyCount + 1) % 4;
        this.buildDecoyButton(x, y);
        this.showFeedback(
          this.decoyCount === 0
            ? 'No decoys — the palette shows exactly what the solve uses.'
            : `${this.decoyCount} decoy ${this.decoyCount === 1 ? 'item pads' : 'items pad'} the palette to hide the recipe.`,
          false,
        );
      },
    }).setDepth(5);
  }

  private buildModSection(cx: number, startY: number, width: number) {
    this.add.text(cx, startY, 'BUILD YOUR GOAL:', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.ACCENT,
      stroke: '#1a0a2e',
      strokeThickness: 2,
    }).setOrigin(0.5).setDepth(5);

    // Paint color swatches — the 16-color rack in two rows of 8
    const swatchD  = Math.min(Math.floor((width - 40) / 8), 36);
    const rowW     = (swatchD + 4) * 8 - 4;
    const swatchY  = startY + 20;
    const swatchX0 = cx - rowW / 2 + swatchD / 2;
    const swatchRowH = swatchD + 6;

    PAINT_COLORS.forEach((mod, i) => {
      const x = swatchX0 + (i % 8) * (swatchD + 4);
      const y = swatchY + Math.floor(i / 8) * swatchRowH;
      this.buildColorSwatch(x, y, swatchD, mod);
    });

    // Modifier grid — 4 columns so the full 20-mask catalog keeps the same
    // row count the old 13-mask/3-column grid had.
    const cols   = 4;
    const pad    = 12;
    const gap    = 6;
    const cardW  = (width - pad * 2 - gap * (cols - 1)) / cols;
    const cardH  = 40;
    const gridY0 = swatchY + swatchRowH + swatchD / 2 + 12;

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
      items.push(this.add.image(-w / 2 + 13, 0, iconKey).setDisplaySize(16, 16));
    }

    const txtX = iconKey ? -w / 2 + 24 : -w / 2 + 6;
    const txtW = w - (iconKey ? 30 : 12);
    items.push(this.add.text(txtX, 0, modLabel(mod), {
      fontFamily: PIXEL_FONT,
      fontSize: '7px',
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

    addBeigeButton(this, {
      x: cx - btnW / 2 - 6, y: btnY,
      width: btnW, height: btnH,
      label: 'Test Play',
      iconKey: 'icon-play',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => this.testPlay(),
    }).setDepth(8);

    addBeigeButton(this, {
      x: cx + btnW / 2 + 6, y: btnY,
      width: btnW, height: btnH,
      label: 'Publish',
      iconKey: 'icon-share',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => void this.publish(),
    }).setDepth(8);
  }

  private buildSmallBtn(x: number, y: number, w: number, h: number, label: string, cb: () => void) {
    addBeigeButton(this, {
      x, y,
      width: Math.max(w, 60), height: Math.max(h, 36),
      label,
      fontSize: 11, fontFamily: PIXELIFY,
      onClick: cb,
    }).setDepth(5);
  }

  // ── Goal building — the creator plays their own level ──────
  private applyGoalMod(mod: ModifierDef) {
    // The publish cap, enforced while recording: every level ships with a
    // proof it's beatable in at most MAX_SOLUTION_STEPS moves.
    if (this.actions.length >= MAX_SOLUTION_STEPS) {
      this.showFeedback(`Max ${MAX_SOLUTION_STEPS} moves — levels must stay beatable! Undo or Reset.`, true);
      return;
    }
    const before = replayOps(EDITOR_DEFS, this.actions);
    // Same rule as in play: goggles a splash landed on are broken for the run.
    if (mod.type !== 'paint' && before.broken.includes(mod.id)) {
      this.showFeedback(`${modLabel(mod)} broke — goggles are one-time use! (Undo or Reset restores them.)`, true);
      return;
    }
    const wasWorn = before.worn.includes(mod.id);
    this.actions.push(mod.id);
    this.goalRenderer?.setPattern(EDITOR_DEFS, this.actions);
    this.goalRenderer?.playApplyAnim(this);
    this.updateMeta();
    if (mod.type === 'paint') {
      this.showFeedback(
        before.worn.some(isBreakableMask) ? 'Splash! The goggles snapped off — one-time use.' : '',
        false,
      );
    } else if (mod.type === 'goggles' && !wasWorn) {
      this.showFeedback(`${modLabel(mod)} on — breaks off after one splash!`, false);
    } else {
      this.showFeedback(
        wasWorn ? `${modLabel(mod)} off.` : `${modLabel(mod)} on — it protects what it covers.`,
        false,
      );
    }
  }

  private undo() {
    if (this.actions.length === 0) return;
    this.actions.pop();
    this.goalRenderer?.setPattern(EDITOR_DEFS, this.actions);
    this.updateMeta();
  }

  private reset() {
    this.actions = [];
    this.goalRenderer?.setPattern(EDITOR_DEFS, this.actions);
    this.updateMeta();
  }

  private updateMeta() {
    const steps = this.actions.length;
    const diff  = computeDifficulty(steps);
    this.stepsText?.setText(`Steps: ${steps}/${MAX_SOLUTION_STEPS}  |  Diff: ${diff}/5`);
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

  // Goals must be bare slimes — a level can't be finished while stencils are
  // still on, so a recording that ends worn isn't a valid goal either.
  private validateRecording(): string | null {
    if (this.actions.length === 0) return 'Paint something to build a goal first!';
    if (!this.actions.some((id) => id.startsWith('paint-'))) return 'Goals need at least one splash of paint!';
    const { worn } = replayOps(EDITOR_DEFS, this.actions);
    if (worn.length > 0) return 'Take every stencil off — goals are bare slimes!';
    return null;
  }

  // ── Test / Publish ─────────────────────────────────────────
  private testPlay() {
    const err = this.validateRecording();
    if (err) {
      this.showFeedback(err, true);
      return;
    }
    const level = this.buildLevelData('__preview__');
    this.goToScene('Game', { levelId: '__preview__', previewData: level });
  }

  // Centralizes every scene.start(...) call — see `navigating` field comment.
  private goToScene(key: string, data?: Record<string, unknown>) {
    if (this.navigating) return;
    this.navigating = true;
    this.removeInputs();
    this.cameras.main.fadeOut(250, 26, 10, 46);
    this.time.delayedCall(260, () => this.scene.start(key, data));
  }

  private async publish() {
    const err = this.validateRecording();
    if (err) {
      this.showFeedback(err, true);
      return;
    }
    const title = (this.titleInput?.value ?? '').trim() || 'My Custom Level';
    this.titleValue = title;
    const hint = (this.hintInput?.value ?? '').trim().slice(0, 160);

    try {
      const res = await fetch('/api/level/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          difficulty:   computeDifficulty(this.actions.length),
          palette:      this.buildPalette(),
          optimalSteps: this.actions.length,
          solution:     [...this.actions],
          ...(hint ? { hint } : {}),
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
    // Every distinct def the recording used + the creator-chosen decoy count
    const usedIds = new Set(this.actions);
    const palette = EDITOR_DEFS.filter(d => usedIds.has(d.id));
    const decoyPool = ALL_MODS.filter(m => !usedIds.has(m.id));

    for (let i = 0; i < Math.min(this.decoyCount, decoyPool.length); i++) {
      const idx = Math.floor(Math.random() * decoyPool.length);
      const [decoy] = decoyPool.splice(idx, 1);
      if (decoy) palette.push(decoy);
    }

    // Shuffle so palette order doesn't leak the solution order
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = palette[i]!;
      palette[i] = palette[j]!;
      palette[j] = tmp;
    }
    return palette;
  }

  private buildLevelData(id: string): LevelData {
    const hint = this.hintValue.trim().slice(0, 160);
    return {
      id,
      title:           this.titleValue,
      difficulty:      computeDifficulty(this.actions.length),
      palette:         this.buildPalette(),
      optimalSteps:    this.actions.length,
      optimalSolution: [...this.actions],
      ...(hint ? { hint } : {}),
    };
  }

  private createOverlayInput(
    y: number, placeholder: string, value: string, maxLength: number,
    onInput: (v: string) => void,
  ): HTMLInputElement {
    const { width } = this.scale;
    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = placeholder;
    input.maxLength   = maxLength;
    input.value       = value;

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
    this.positionOverlayInput(input, width / 2, y, Math.min(width - 96, 260));
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  private positionOverlayInput(input: HTMLInputElement, cx: number, y: number, w: number) {
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
    const { width } = this.scale;
    const w = Math.min(width - 96, 260);
    if (this.titleInput) this.positionOverlayInput(this.titleInput, width / 2, this.titleInputY, w);
    if (this.hintInput)  this.positionOverlayInput(this.hintInput,  width / 2, this.hintInputY,  w);
  }

  private removeInputs() {
    this.titleInput?.remove();
    this.titleInput = null;
    this.hintInput?.remove();
    this.hintInput = null;
  }

  shutdown() {
    this.navigating = true;
    this.scale.off('resize', this.onResize, this);
    this.removeInputs();
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
