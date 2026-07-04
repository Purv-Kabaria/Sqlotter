import * as Phaser from 'phaser';
import type { ModifierDef } from '../../shared/types';
import { isBreakableMask, replayOps, standardPaints } from '../../shared/slimeSim';
import { MAX_SOLUTION_STEPS } from '../../shared/gameRules';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import { paintOverlayShine } from '../components/overlayShine';
import type { LevelData } from '../../shared/types';
import type { LevelCreateResponse } from '../../shared/api';
import {
  PIXEL_FONT, addBeigeBadge, addBeigeButton, addBeigeButtonShell,
  addBeigeSolidCard, addDarkPanel, addDepthIcon,
} from '../components/PixelUI';
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
  BG:         0x1a0a2e,
  HEADER_BG:  0x0A0500,
  TEXT_LIGHT: '#FFFCE8',
  DARK_BROWN: '#3A1A08',
  TEXT_BEIGE: '#DEC998',
  ACCENT:     '#6DD400',
} as const;

const HEADER_H = 64;

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
  private titleInputY = 84;
  private hintInputY = 116;
  private splot: SplotMascot | null = null;
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
    this.splot      = null;
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

    // Background — the full bg2 cloud stack, cover-scaled like every other
    // scene's backdrop (the old version dimmed two layers to near-black).
    const bgKeys   = ['bg2-1', 'bg2-2', 'bg2-3', 'bg2-4'];
    const bgAlphas = [1, 0.8, 0.55, 0.3];
    bgKeys.forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(bgAlphas[i] ?? 0.3).setDepth(-10 + i);
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

    // Goal slime card — below the two input rows
    const slimeSize = Math.min(width * 0.28, 120);
    const cardH  = slimeSize + 24;
    const slimeY = 148 + Math.round(cardH / 2);
    this.buildSlimePanel(cx, slimeY, slimeSize);

    // Undo / Reset / Decoys row under the card
    const btnY = slimeY + cardH / 2 + 24;
    this.buildSmallBtn(cx - 80, btnY, 64, 24, 'Undo',  () => this.undo());
    this.buildSmallBtn(cx - 8,  btnY, 64, 24, 'Reset', () => this.reset());
    this.buildDecoyButton(cx + 82, btnY);

    // Steps / difficulty pill
    const stepsY = btnY + 34;
    addBeigeBadge(this, cx, stepsY, 236, 28).setDepth(4);
    this.stepsText = this.add.text(cx, stepsY, `Steps: 0/${MAX_SOLUTION_STEPS}  |  Diff: 1/5`, {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(5);

    // Feedback text
    this.feedbackText = this.add.text(cx, stepsY + 24, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: '#ff8888',
      stroke: '#1a0a2e',
      strokeThickness: 3,
      wordWrap: { width: width - 32 },
      align: 'center',
    }).setOrigin(0.5).setDepth(5);

    // Modifier section (paint + mod grid) on a dark panel
    const modStartY = stepsY + 44;
    this.buildModSection(cx, modStartY, width);

    // Bottom action buttons
    this.buildBottomButtons(cx, height, width);
  }

  // Header strip matching the Game scene: dark bar, beige icon button for
  // back, pencil-badged title.
  private buildHeader(cx: number, width: number) {
    this.add.rectangle(width / 2, HEADER_H / 2, width, HEADER_H, C.HEADER_BG).setDepth(10);

    const back = addBeigeButtonShell(this, 10 + 24, HEADER_H / 2, 48, 48, false,
      () => this.goToScene('MainMenu'));
    back.addContent([addDepthIcon(this, 0, -1, 'icon-arrow', 21, 21).setAngle(180)]);
    back.container.setDepth(11);

    const title = this.add.text(0, HEADER_H / 2, 'LEVEL EDITOR', {
      fontFamily: PIXEL_FONT,
      fontSize: '11px',
      color: C.TEXT_LIGHT,
      stroke: '#000000',
      strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(11);
    const iconSz = 18;
    const totalW = iconSz + 8 + title.width;
    addDepthIcon(this, cx - totalW / 2 + iconSz / 2, HEADER_H / 2 - 1, 'icon-pencil', iconSz, iconSz).setDepth(11);
    title.setX(cx - totalW / 2 + iconSz + 8);
  }

  // The goal preview: beige solid card (same asset as the Game scene's
  // Goal/Current cards) with a badge-pill label riding its top edge, and —
  // when the screen is wide enough — Splot coaching from beside it.
  private buildSlimePanel(cx: number, slimeY: number, slimeSize: number) {
    const cardW = Math.max(66, Math.round(slimeSize * 2.3));
    const cardH = slimeSize + 24;

    addBeigeSolidCard(this, cx, slimeY, cardW, cardH).setDepth(2);

    addBeigeBadge(this, cx, slimeY - cardH / 2, 132, 28).setDepth(4);
    this.add.text(cx, slimeY - cardH / 2, 'GOAL SLIME', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(5);

    this.goalRenderer = new SlimeRenderer(this, cx, slimeY, slimeSize);
    // Above the depth-2 card — at the default depth 0 the opaque card draws
    // over the slime and it renders as a barely-visible ghost.
    this.goalRenderer.container.setDepth(3);
    this.goalRenderer.setPattern(EDITOR_DEFS, this.actions);

    // Splot watches the work when there's room beside the card; his
    // reactions ride on showFeedback.
    const { width } = this.scale;
    if (width >= 620) {
      this.splot = new SplotMascot(this, cx - cardW / 2 - 64, slimeY + cardH / 2 - 42, 84);
      this.splot.container.setDepth(3);
    }
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
    // Section geometry first, so the dark panel behind it can be sized to
    // wrap the label + swatch rack + mod grid exactly (same palette-panel
    // asset the Game scene uses).
    const cols   = 4;
    const pad    = 14;
    const gap    = 6;
    const swatchD    = Math.min(Math.floor((width - 40) / 8), 40);
    const swatchY    = startY + 24;
    const swatchRowH = swatchD + 6;
    const cardW  = (width - pad * 2 - gap * (cols - 1)) / cols;
    const cardH  = 40;
    const gridY0 = swatchY + swatchRowH + swatchD / 2 + 14;
    const rows   = Math.ceil(ALL_MODS.length / cols);

    const panelTop    = startY - 16;
    const panelBottom = gridY0 + rows * (cardH + gap) - gap + 12;
    addDarkPanel(this, cx, (panelTop + panelBottom) / 2, width - 12, panelBottom - panelTop)
      .setDepth(2);

    this.add.text(cx, startY, 'BUILD YOUR GOAL', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.TEXT_BEIGE,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(5);

    // Paint color swatches — the 16-color rack in two rows of 8
    const rowW     = (swatchD + 4) * 8 - 4;
    const swatchX0 = cx - rowW / 2 + swatchD / 2;
    PAINT_COLORS.forEach((mod, i) => {
      const x = swatchX0 + (i % 8) * (swatchD + 4);
      const y = swatchY + Math.floor(i / 8) * swatchRowH;
      this.buildColorSwatch(x, y, swatchD, mod);
    });

    // Modifier grid — 4 columns so the full 20-mask catalog keeps the same
    // row count the old 13-mask/3-column grid had.
    ALL_MODS.forEach((mod, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = pad + col * (cardW + gap) + cardW / 2;
      const y   = gridY0 + row * (cardH + gap) + cardH / 2;
      this.buildModCard(x, y, cardW, cardH, mod);
    });
  }

  // Beige shell tile holding a slime-shaped color swatch (shadow + shine-
  // baked body + border) — the exact look of the Game scene's color picker,
  // sharing its baked texture keys.
  private buildColorSwatch(x: number, y: number, d: number, mod: ModifierDef) {
    const numCol = parseInt((mod.color ?? '#ffffff').replace('#', ''), 16);
    const shell = addBeigeButtonShell(this, x, y, d, d, false, () => this.applyGoalMod(mod), true);

    const slimeSz = Math.round(d * 0.62);
    const shadow = this.add.image(2, 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
    shadow.setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
    shadow.setAlpha(0.28);
    const shineKey = paintOverlayShine(
      this, `slime-shine-swatch-${numCol.toString(16)}`, 'slime-color', 'slime-shine', numCol, 0.5,
    );
    const slimeImg = this.add.image(0, 0, shineKey).setDisplaySize(slimeSz, slimeSz);
    const border   = this.add.image(0, 0, 'slime-border').setDisplaySize(slimeSz, slimeSz);
    shell.addContent([shadow, slimeImg, border]);
    shell.container.setDepth(5);
  }

  // Beige shell tile with the mod's real puzzle icon — same look (and free
  // hover/press feedback) as the Game scene's palette tiles.
  private buildModCard(cx: number, cy: number, w: number, h: number, mod: ModifierDef) {
    const shell = addBeigeButtonShell(this, cx, cy, w, h, false, () => this.applyGoalMod(mod), true);
    const content: Phaser.GameObjects.GameObject[] = [];

    const iconKey = getIconKey(mod);
    if (iconKey && this.textures.exists(iconKey)) {
      content.push(addDepthIcon(this, -w / 2 + 14, 0, iconKey, 16, 16, 1, 0.4));
    }

    const txtX = iconKey ? -w / 2 + 25 : -w / 2 + 8;
    const txtW = w - (iconKey ? 31 : 16);
    content.push(this.add.text(txtX, 0, modLabel(mod), {
      fontFamily: PIXEL_FONT,
      fontSize: '7px',
      color: C.DARK_BROWN,
      wordWrap: { width: txtW },
    }).setOrigin(0, 0.5));

    shell.addContent(content);
    shell.container.setDepth(5);
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
    this.splot?.setExpression(isError ? 'pain' : 'excited', 1400);
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

    // Beige field matching the UI assets (same treatment as the splat-card
    // caption input and the community search box).
    Object.assign(input.style, {
      position:     'fixed',
      padding:      '0 10px',
      boxSizing:    'border-box',
      background:   '#FFF6DF',
      color:        '#3A1A08',
      border:       '2px solid #7A4A20',
      borderRadius: '8px',
      outline:      'none',
      zIndex:       '100',
      fontFamily:   '"Pixelify Sans", sans-serif',
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
    this.splot?.stopIdleAnims();
    this.splot = null;
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
