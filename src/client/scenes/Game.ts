import * as Phaser from 'phaser';
import { LevelEngine, calcStars } from '../engine/LevelEngine';
import {
  addBeigeCard, addDarkPanel, addDepthIcon,
  addPixelButton, applyRectClip, PIXEL_FONT,
} from '../components/PixelUI';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import { paintOverlayShine } from '../components/overlayShine';
import type { LevelData, ModifierDef } from '../../shared/types';
import type { CompleteRequest, CompleteResponse } from '../../shared/api';
import { CURATED_LEVELS } from '../../shared/levelData';
import { PAINT_COLORS_16 } from '../../shared/gameRules';

// ── Colour constants ───────────────────────────────────────────────────────
const C = {
  HEADER_BG:   0x0A0500,
  GAME_BG:     0x3A1E6E,
  PALETTE_BG:  0x0E0700,
  BEIGE:       '#DEC998',
  BEIGE_NUM:   0xDEC998,
  DARK_BROWN:  '#3A1A08',
  TEXT_LIGHT:  '#FFFCE8',
  TEXT_BEIGE:  '#DEC998',
  DIM:         '#7a8a9a',
  GOLD:        0xFFD700,
} as const;

const HEADER_H = 52;

// ── Modifier grouping ──────────────────────────────────────────────────────
type PaletteSlot =
  | { kind: 'paint';   mods: ModifierDef[] }
  | { kind: 'pumpkin'; mods: ModifierDef[] }
  | { kind: 'single';  mod: ModifierDef };

function groupPalette(palette: ModifierDef[]): PaletteSlot[] {
  const slots: PaletteSlot[] = [];
  let paintGroup: ModifierDef[] | null = null;
  let pumpkinGroup: ModifierDef[] | null = null;
  for (const mod of palette) {
    if (mod.type === 'paint') {
      if (!paintGroup) { paintGroup = []; slots.push({ kind: 'paint', mods: paintGroup }); }
      paintGroup.push(mod);
    } else if (mod.type === 'pumpkin') {
      if (!pumpkinGroup) { pumpkinGroup = []; slots.push({ kind: 'pumpkin', mods: pumpkinGroup }); }
      pumpkinGroup.push(mod);
    } else {
      slots.push({ kind: 'single', mod });
    }
  }
  return slots;
}

function modIconKey(mod: ModifierDef): string {
  if (mod.type === 'paint')     return 'icon-paint';
  if (mod.type === 'pumpkin')   return 'icon-pumpkin';
  if (mod.type === 'underwear') return 'icon-underwear';
  if (mod.type === 'pendant')   return 'icon-pendant';
  if (mod.type === 'goggles')   return mod.variant?.includes('thin') ? 'icon-goggles-thin' : 'icon-goggles-thick';
  if (mod.type === 'glasses')   return mod.variant?.includes('thin') ? 'icon-glasses-thin' : 'icon-glasses-thick';
  if (mod.type === 'belt')      return mod.variant?.includes('thin') ? 'icon-belt-thin' : 'icon-belt-thick';
  return 'icon-sparkle';
}

function isHorizontalVariant(mod: ModifierDef): boolean {
  return !!(mod.variant?.startsWith('h'));
}
function isVerticalVariant(mod: ModifierDef): boolean {
  return !!(mod.variant?.startsWith('v'));
}

export class Game extends Phaser.Scene {
  private engine: LevelEngine | null = null;
  private level:  LevelData  | null = null;
  private levelId = 'L01';
  private isPreview = false;
  private winHandled = false;
  private loadToken = 0;
  // Guards every scene.start(...) call site — without it, a button clicked while
  // handleWin()'s /api/complete fetch is still in flight can force-navigate to
  // LevelComplete after the player already backed out to a different scene.
  private navigating = false;
  private hudLayer: Phaser.GameObjects.Container | null = null;

  private goalRenderer:    SlimeRenderer | null = null;
  private currentRenderer: SlimeRenderer | null = null;
  private splot:           SplotMascot  | null = null;

  private timerText:     Phaser.GameObjects.Text       | null = null;
  private stepsText:     Phaser.GameObjects.Text       | null = null;
  private conflictPopup: Phaser.GameObjects.Container  | null = null;
  private timerEvent:    Phaser.Time.TimerEvent        | null = null;
  private loadingText:   Phaser.GameObjects.Text       | null = null;

  private paletteContainer: Phaser.GameObjects.Container | null = null;
  private paletteMask:      Phaser.GameObjects.Graphics  | null = null;
  private paletteScrollY = 0;
  private paletteMaxScroll = 0;
  private paletteSlots: PaletteSlot[] = [];
  private paletteSlotContainers: Phaser.GameObjects.Container[] = [];
  private cols = 3;

  private activePopup: Phaser.GameObjects.Container | null = null;
  private bgRects:  Phaser.GameObjects.Rectangle[] = [];
  private bgImages: Phaser.GameObjects.Image[] = [];

  // Track stat pill text objects for live updates
  private timerPillText:  Phaser.GameObjects.Text | null = null;
  private stepsPillText:  Phaser.GameObjects.Text | null = null;

  constructor() { super('Game'); }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  init(data: { levelId?: string; previewData?: LevelData }) {
    this.engine        = null;
    this.level         = data?.previewData ?? null;
    this.levelId       = data?.levelId ?? 'L01';
    this.isPreview     = !!data?.previewData;
    this.winHandled    = false;
    this.navigating    = false;
    this.hudLayer      = null;
    this.loadToken    += 1;
    this.paletteScrollY = 0;
    this.paletteMaxScroll = 0;
    this.paletteSlots  = [];
    this.paletteSlotContainers = [];
    this.bgRects  = [];
    this.bgImages = [];
    this.timerPillText = null;
    this.stepsPillText = null;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.HEADER_BG);
    this.cameras.main.fadeIn(300, 10, 5, 14);
    this.scale.on('resize', this.onResize, this);

    this.buildBackground();

    if (this.level) {
      this.engine = new LevelEngine(this.level);
      this.buildHUD();
      this.buildGameArea();
      this.buildPalette();
      this.startTimer();
    } else if (this.levelId === 'daily') {
      this.showLoading();
      void this.fetchDailyAndStart(this.loadToken);
    } else {
      this.startWithLevelId(this.levelId);
    }
  }

  private showLoading() {
    const { width, height } = this.scale;
    this.loadingText = this.add.text(width / 2, height / 2, 'Loading...', {
      fontFamily: PIXEL_FONT, fontSize: '10px', color: C.TEXT_BEIGE,
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: this.loadingText, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
  }

  private async fetchDailyAndStart(token: number) {
    try {
      const res = await fetch('/api/daily');
      if (res.ok) {
        const data = await res.json() as { levelId: string; level: LevelData };
        this.levelId = data.levelId;
        this.level   = data.level;
      } else {
        this.useFallbackLevel();
      }
    } catch {
      this.useFallbackLevel();
    }
    if (token !== this.loadToken) return;
    this.loadingText?.destroy();
    if (!this.level) {
      this.showLoadError('Daily puzzle is unavailable.', () => this.scene.restart({ levelId: 'daily' }));
      return;
    }
    this.engine = new LevelEngine(this.level);
    this.buildHUD(); this.buildGameArea(); this.buildPalette(); this.startTimer();
  }

  private useFallbackLevel() {
    const dow = new Date().getDay();
    const fb  = CURATED_LEVELS[dow % CURATED_LEVELS.length] ?? CURATED_LEVELS[0] ?? null;
    this.level   = fb;
    this.levelId = fb?.id ?? 'L01';
  }

  private startWithLevelId(id: string) {
    const curated = CURATED_LEVELS.find(l => l.id === id);
    if (curated) {
      this.level  = curated;
      this.engine = new LevelEngine(this.level);
      this.buildHUD(); this.buildGameArea(); this.buildPalette(); this.startTimer();
      return;
    }
    this.showLoading();
    const token = this.loadToken;
    void (async () => {
      try {
        const res = await fetch(`/api/level/${id}`);
        this.level = res.ok ? (await res.json() as { level: LevelData }).level : CURATED_LEVELS[0] ?? null;
      } catch {
        this.level = CURATED_LEVELS[0] ?? null;
      }
      if (token !== this.loadToken) return;
      this.loadingText?.destroy();
      if (!this.level) {
        this.showLoadError('Could not load this level.', () => this.scene.start('LevelSelect'));
        return;
      }
      this.engine = new LevelEngine(this.level);
      this.buildHUD(); this.buildGameArea(); this.buildPalette(); this.startTimer();
    })();
  }

  // ── Background zones ─────────────────────────────────────────────────────
  private buildBackground() {
    const { width, height } = this.scale;
    const isPortrait = height > width;

    this.bgRects.forEach(r => r.destroy());
    this.bgImages.forEach(i => i.destroy());
    this.bgRects  = [];
    this.bgImages = [];

    ['bg4-1', 'bg4-2'].forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.18 : 0.08).setDepth(-10).setTint(C.GAME_BG);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgImages.push(img);
    });

    if (isPortrait) {
      const gameH = this.calcPortraitGameH(height);
      const gameRect = this.add.rectangle(width / 2, HEADER_H + gameH / 2, width, gameH, C.GAME_BG)
        .setAlpha(0.85).setDepth(-9);
      this.bgRects.push(gameRect);
      const modY  = HEADER_H + gameH;
      const modH  = height - modY;
      const modRect = this.add.rectangle(width / 2, modY + modH / 2, width, modH, C.PALETTE_BG)
        .setDepth(-9);
      this.bgRects.push(modRect);
    } else {
      const splitX = this.calcLandscapeSplit(width);
      this.bgRects.push(
        this.add.rectangle(splitX / 2, height / 2, splitX, height, C.GAME_BG).setAlpha(0.85).setDepth(-9),
      );
      this.bgRects.push(
        this.add.rectangle(splitX + (width - splitX) / 2, height / 2, width - splitX, height, C.PALETTE_BG).setDepth(-9),
      );
    }
  }

  private calcPortraitGameH(height: number): number {
    // Game area: header + two slime panels + stat pills = ~38% of height
    return Math.round(height * 0.38);
  }

  private calcLandscapeSplit(width: number): number {
    return Math.round(width * 0.57);
  }

  // ── HUD strip ────────────────────────────────────────────────────────────
  private buildHUD() {
    if (!this.level) return;
    // Called on every resize (see onResize) — destroy the previous HUD first,
    // otherwise every resize leaks another back/hint/reset button stacked on
    // top of the last, each still wired to its own pointerup handler.
    this.hudLayer?.destroy(true);
    const { width } = this.scale;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(this.add.rectangle(width / 2, HEADER_H / 2, width, HEADER_H, C.HEADER_BG).setDepth(15));

    // Back button
    const back = addDepthIcon(this, 28, HEADER_H / 2, 'icon-arrow', 22, 22);
    back.setDepth(16).setInteractive({ useHandCursor: true });
    back.on('pointerup', () => {
      this.closeActivePopup();
      this.goToScene(this.isPreview ? 'Editor' : 'LevelSelect');
    });
    elements.push(back);

    // SQLOTTER logo centered
    if (this.textures.exists('title')) {
      const maxW = Math.min(width * 0.42, 180);
      elements.push(this.add.image(width / 2, HEADER_H / 2, 'title')
        .setDisplaySize(maxW, maxW * 0.22).setDepth(16));
    }

    // Hint + Reset in header right
    const hint = addDepthIcon(this, width - 54, HEADER_H / 2, 'icon-help', 20, 20);
    hint.setDepth(16).setInteractive({ useHandCursor: true });
    hint.on('pointerup', () => this.showHint());
    elements.push(hint);

    const reset = addDepthIcon(this, width - 26, HEADER_H / 2, 'icon-reset', 22, 22);
    reset.setDepth(16).setInteractive({ useHandCursor: true });
    reset.on('pointerup', () => this.handleReset());
    elements.push(reset);

    this.hudLayer = this.add.container(0, 0, elements);
  }

  // ── Game area (slime panels + stat pills) ────────────────────────────────
  private buildGameArea() {
    if (!this.engine) return;

    this.goalRenderer?.container.destroy();
    this.currentRenderer?.container.destroy();
    this.splot?.container.destroy();
    this.timerPillText = null;
    this.stepsPillText = null;

    const { width, height } = this.scale;
    const isPortrait = height > width;

    if (isPortrait) {
      this.buildPortraitGameArea(width, height);
    } else {
      this.buildLandscapeGameArea(width, height);
    }
  }

  // Portrait: slimes side-by-side in game zone, stat pills below
  private buildPortraitGameArea(width: number, height: number) {
    const gameH   = this.calcPortraitGameH(height);
    const areaTop = HEADER_H + 10;
    const areaBot = HEADER_H + gameH;

    // Reserve bottom row for stat pills (~36px)
    const statPillH   = 36;
    const statPillY   = areaBot - statPillH / 2 - 6;
    const labelH      = 28;
    const labelY      = areaBot - statPillH - labelH / 2 - 10;

    const slimeAreaBot = labelY - labelH / 2 - 8;
    const panelSz      = Math.min(slimeAreaBot - areaTop - 8, (width * 0.46) - 8, 160);
    const slimeSz      = Math.round(panelSz * 0.68);

    const goalX = width * 0.27;
    const curX  = width * 0.73;
    const panelCy = areaTop + panelSz / 2 + 4;

    // Slime panels
    addBeigeCard(this, goalX, panelCy, panelSz, panelSz).setDepth(2);
    addBeigeCard(this, curX,  panelCy, panelSz, panelSz).setDepth(2);

    this.goalRenderer = new SlimeRenderer(this, goalX, panelCy, slimeSz);
    this.goalRenderer.container.setDepth(4);
    this.goalRenderer.setState(this.engine!.goalState);

    this.currentRenderer = new SlimeRenderer(this, curX, panelCy, slimeSz);
    this.currentRenderer.container.setDepth(4);
    this.currentRenderer.setState(this.engine!.currentState);

    // Label pills: "Goal" and "Current"
    const goalLabelW = 80, curLabelW = 100;
    addBeigeCard(this, goalX, labelY, goalLabelW, labelH).setDepth(3);
    this.add.text(goalX, labelY, 'Goal', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(4);

    addBeigeCard(this, curX, labelY, curLabelW, labelH).setDepth(3);
    this.add.text(curX, labelY, 'Current', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(4);

    // Stat pills: timer left, steps right
    const pillW = (width / 2) - 20;
    const timerX = pillW / 2 + 8;
    const stepsX = width - pillW / 2 - 8;

    addBeigeCard(this, timerX, statPillY, pillW, statPillH).setDepth(3);
    const timerIc = addDepthIcon(this, timerX - pillW / 2 + 16, statPillY, 'icon-timer', 16, 16);
    timerIc.setDepth(4);
    this.timerText = this.add.text(timerX - pillW / 2 + 28, statPillY, '0s', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
    }).setOrigin(0, 0.5).setDepth(4);
    this.timerPillText = this.timerText;

    addBeigeCard(this, stepsX, statPillY, pillW, statPillH).setDepth(3);
    const stepsIc = addDepthIcon(this, stepsX - pillW / 2 + 16, statPillY, 'icon-plus', 16, 16);
    stepsIc.setDepth(4);
    this.stepsText = this.add.text(stepsX - pillW / 2 + 28, statPillY, '0', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
    }).setOrigin(0, 0.5).setDepth(4);
    this.stepsPillText = this.stepsText;
  }

  // Landscape: slimes side-by-side in left zone, stat pills below
  private buildLandscapeGameArea(width: number, height: number) {
    const splitX  = this.calcLandscapeSplit(width);
    const areaTop = HEADER_H + 12;
    const areaBot = height - 14;

    // Stat pill row at bottom of left zone
    const statPillH = 36;
    const statPillY = areaBot - statPillH / 2 - 6;
    const labelH    = 28;
    const labelY    = areaBot - statPillH - labelH / 2 - 10;

    const slimeAreaBot = labelY - labelH / 2 - 8;
    const panelSz = Math.min(slimeAreaBot - areaTop - 8, (splitX * 0.46) - 8, 200);
    const slimeSz = Math.round(panelSz * 0.68);

    const goalX  = splitX * 0.28;
    const curX   = splitX * 0.72;
    const panelCy = areaTop + panelSz / 2 + 4;

    addBeigeCard(this, goalX, panelCy, panelSz, panelSz).setDepth(2);
    addBeigeCard(this, curX,  panelCy, panelSz, panelSz).setDepth(2);

    this.goalRenderer = new SlimeRenderer(this, goalX, panelCy, slimeSz);
    this.goalRenderer.container.setDepth(4);
    this.goalRenderer.setState(this.engine!.goalState);

    this.currentRenderer = new SlimeRenderer(this, curX, panelCy, slimeSz);
    this.currentRenderer.container.setDepth(4);
    this.currentRenderer.setState(this.engine!.currentState);

    // Label pills
    const goalLabelW = 80, curLabelW = 100;
    addBeigeCard(this, goalX, labelY, goalLabelW, labelH).setDepth(3);
    this.add.text(goalX, labelY, 'Goal', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(4);

    addBeigeCard(this, curX, labelY, curLabelW, labelH).setDepth(3);
    this.add.text(curX, labelY, 'Current', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(4);

    // Stat pills: timer left, steps right inside left zone
    const halfW = splitX / 2 - 14;
    const timerX = halfW / 2 + 8;
    const stepsX = splitX - halfW / 2 - 8;

    addBeigeCard(this, timerX, statPillY, halfW, statPillH).setDepth(3);
    const timerIc = addDepthIcon(this, timerX - halfW / 2 + 16, statPillY, 'icon-timer', 16, 16);
    timerIc.setDepth(4);
    this.timerText = this.add.text(timerX - halfW / 2 + 28, statPillY, '0s', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
    }).setOrigin(0, 0.5).setDepth(4);
    this.timerPillText = this.timerText;

    addBeigeCard(this, stepsX, statPillY, halfW, statPillH).setDepth(3);
    const stepsIc = addDepthIcon(this, stepsX - halfW / 2 + 16, statPillY, 'icon-plus', 16, 16);
    stepsIc.setDepth(4);
    this.stepsText = this.add.text(stepsX - halfW / 2 + 28, statPillY, '0', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
    }).setOrigin(0, 0.5).setDepth(4);
    this.stepsPillText = this.stepsText;
  }

  // ── Modifier palette ──────────────────────────────────────────────────────
  private buildPalette() {
    if (!this.level) return;
    this.paletteContainer?.destroy(true);
    this.paletteMask?.destroy();
    this.paletteScrollY = 0;
    this.paletteSlotContainers = [];

    const { width, height } = this.scale;
    const isPortrait = height > width;

    let pX: number, pY: number, pW: number, pH: number;
    if (isPortrait) {
      const gameH = this.calcPortraitGameH(height);
      pX = 0; pY = HEADER_H + gameH; pW = width; pH = height - pY;
    } else {
      const splitX = this.calcLandscapeSplit(width);
      pX = splitX; pY = 0; pW = width - splitX; pH = height;
    }

    this.paletteContainer = this.add.container(0, 0).setDepth(6);

    // Logo in landscape right panel
    if (!isPortrait && this.textures.exists('title')) {
      const maxW = Math.min(pW * 0.65, 160);
      const logo = this.add.image(pX + pW / 2, 26, 'title');
      logo.setDisplaySize(maxW, maxW * 0.22).setDepth(16);
      this.paletteContainer.add(logo);
    }

    this.cols = 3;
    const padX = 12;
    const padY = isPortrait ? 12 : 54;
    const gap  = 8;
    const cellSz = Math.floor((pW - padX * 2 - gap * (this.cols - 1)) / this.cols);

    this.paletteSlots = groupPalette(this.level.palette);

    this.paletteSlots.forEach((slot, i) => {
      const col = i % this.cols;
      const row = Math.floor(i / this.cols);
      const cx  = pX + padX + col * (cellSz + gap) + cellSz / 2;
      const cy  = pY + padY + row * (cellSz + gap) + cellSz / 2;
      const c   = this.buildPaletteSlot(cx, cy, cellSz, slot);
      this.paletteSlotContainers.push(c);
      this.paletteContainer!.add(c);
    });

    const rows = Math.ceil(this.paletteSlots.length / this.cols);
    const totalH = padY + rows * (cellSz + gap) + padY;
    this.paletteMaxScroll = Math.max(0, totalH - pH);

    // Filters Mask, not a geometry mask — setMask() is a no-op under Phaser 4's
    // WebGL renderer, which let scrolled palette rows draw over the whole scene.
    this.paletteMask = this.make.graphics();
    applyRectClip(this, this.paletteContainer, this.paletteMask, pX, pY, pW, pH);

    if (this.paletteMaxScroll > 0) {
      const zone = this.add.zone(pX + pW / 2, pY + pH / 2, pW, pH).setDepth(5).setInteractive();
      let dragStart = 0, scrollStart = 0;
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragStart = p.y; scrollStart = this.paletteScrollY;
      });
      zone.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        this.paletteScrollY = Phaser.Math.Clamp(scrollStart + dragStart - p.y, 0, this.paletteMaxScroll);
        this.applyPaletteScroll();
      });
    }
  }

  private applyPaletteScroll() {
    if (this.paletteContainer) this.paletteContainer.y = -this.paletteScrollY;
  }

  private buildPaletteSlot(cx: number, cy: number, cellSz: number, slot: PaletteSlot): Phaser.GameObjects.Container {
    const items: Phaser.GameObjects.GameObject[] = [];
    const bg = addBeigeCard(this, 0, 0, cellSz, cellSz);
    items.push(bg);

    const iconSz = Math.round(cellSz * 0.44);

    if (slot.kind === 'paint') {
      items.push(addDepthIcon(this, 0, -cellSz * 0.05, 'icon-paint', iconSz, iconSz));
      const dotR = 4, shown = Math.min(slot.mods.length, 5);
      const totalW = shown * (dotR * 2 + 2) - 2;
      slot.mods.slice(0, shown).forEach((m, di) => {
        const col = m.color ? parseInt(m.color.replace('#', ''), 16) : 0xFFFFFF;
        items.push(
          this.add.circle(-totalW / 2 + di * (dotR * 2 + 2) + dotR, cellSz * 0.28, dotR, col)
            .setStrokeStyle(1, 0x3D1808),
        );
      });
    } else if (slot.kind === 'pumpkin') {
      items.push(addDepthIcon(this, 0, 0, 'icon-pumpkin', iconSz, iconSz));
      items.push(this.add.text(0, cellSz * 0.3, slot.mods.map(m => `${m.coverage}%`).join(' '), {
        fontFamily: PIXEL_FONT, fontSize: '6px', color: C.DARK_BROWN,
      }).setOrigin(0.5));

      const state = this.engine?.currentState;
      if (state?.pumpkin === 75 && slot.mods.every(m => m.coverage !== 75)) {
        items.push(addDepthIcon(this, 0, 0, 'icon-cross', iconSz * 0.8, iconSz * 0.8, 1, 0.4).setAlpha(0.85));
      }
    } else {
      const mod = slot.mod;
      const isSpent = !this.engine?.isModAvailable(mod);
      const ic = addDepthIcon(this, 0, -cellSz * 0.08, modIconKey(mod), iconSz, iconSz);
      if (isSpent) ic.setAlpha(0.35);
      items.push(ic);

      if (isHorizontalVariant(mod) || isVerticalVariant(mod)) {
        const angle = isHorizontalVariant(mod) ? 0 : 90;
        const arrowSz = Math.round(cellSz * 0.22);
        const arrow = addDepthIcon(this, cellSz * 0.28, -cellSz * 0.28, 'icon-arrow', arrowSz, arrowSz, 1, 0.4);
        (arrow.list[1] as Phaser.GameObjects.Image | undefined)?.setTint(0xFF5500);
        arrow.setAngle(angle);
        items.push(arrow);
      }

      const remaining = this.engine?.getRemainingCount(mod.id) ?? Infinity;
      if (mod.count !== undefined && remaining !== Infinity) {
        const badgeSz = Math.round(cellSz * 0.26);
        const bx = cellSz * 0.3, by = cellSz * 0.3;
        items.push(addBeigeCard(this, bx, by, badgeSz, badgeSz));
        items.push(this.add.text(bx, by, `${remaining}x`, {
          fontFamily: PIXEL_FONT, fontSize: '6px', color: C.DARK_BROWN,
        }).setOrigin(0.5));
      }

      if (isSpent) {
        items.push(addDepthIcon(this, 0, 0, 'icon-cross', iconSz, iconSz, 1, 0.4).setAlpha(0.78));
      }
    }

    const container = this.add.container(cx, cy, items).setDepth(7).setSize(cellSz, cellSz);
    container.setInteractive({ useHandCursor: true });

    container.on('pointerup', () => {
      if (slot.kind === 'paint') {
        this.showColorPicker(slot.mods);
      } else if (slot.kind === 'pumpkin') {
        this.showPumpkinPicker(slot.mods);
      } else if (this.engine?.isModAvailable(slot.mod)) {
        this.applyModifier(slot.mod);
      }
    });
    container.on('pointerdown', () => {
      this.tweens.add({ targets: container, scaleX: 0.92, scaleY: 0.92, duration: 55 });
    });
    container.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 80 });
    });

    return container;
  }

  // ── Colour picker popup ───────────────────────────────────────────────────
  private showColorPicker(paintMods: ModifierDef[]) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const colors = paintMods.length > 1
      ? paintMods.map(m => m.color ?? '#FFFFFF')
      : PAINT_COLORS_16.slice();
    const currentColor = (this.engine?.currentState.color ?? '#FFFFFF').toUpperCase();

    const COLS   = 4;
    const pad    = 12;
    const gap    = 8;
    const popW   = Math.min(width - 24, 296);
    const slotSz = Math.floor((popW - pad * 2 - gap * (COLS - 1)) / COLS);
    const slimeSz = Math.round(slotSz * 0.68);
    const ROWS   = Math.ceil(colors.length / COLS);
    const titleH = 38;
    const popH   = titleH + pad + ROWS * (slotSz + gap) - gap + pad;

    const pcx = width  / 2;
    const pcy = height / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    // Full-screen dim overlay
    const overlay = this.add.rectangle(pcx, pcy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    // Popup card (beige, matching modifier slots)
    items.push(addBeigeCard(this, pcx, pcy, popW, popH));

    // Title
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2, 'Pick a Color', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    // Separator
    items.push(this.add.rectangle(pcx, pcy - popH / 2 + titleH, popW - 24, 2, 0x3A1A08, 0.18));

    const gridLeft = pcx - popW / 2 + pad;
    const gridTop  = pcy - popH / 2 + titleH + pad;

    colors.forEach((hex, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const sx  = gridLeft + col * (slotSz + gap) + slotSz / 2;
      const sy  = gridTop  + row * (slotSz + gap) + slotSz / 2;
      const numCol   = parseInt(hex.replace('#', ''), 16);
      const isSelected = hex.toUpperCase() === currentColor;

      // Slot bg — highlight if currently selected color
      const slotBg = addBeigeCard(this, sx, sy, slotSz, slotSz);
      if (isSelected) slotBg.setTint(0xE8C060);
      items.push(slotBg);

      // Slime: shadow + color (with genuine overlay-blended shine) + border.
      // Body is baked (tint + genuine overlay-blended shine) into a texture rather
      // than tinted live — see overlayShine.ts for why a plain Phaser tint +
      // BlendModes.OVERLAY can't do this under WebGL. Keyed by hex so re-opening the
      // popup reuses the same generated texture instead of rebuilding it every time.
      const shadow = this.add.image(sx + 2, sy + 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      // setTintFill() was removed in Phaser 4 — tint + FILL tint mode instead
      shadow.setTint(0x000000).setTintMode(Phaser.TintModes.FILL); shadow.setAlpha(0.28);
      const swatchShineKey = paintOverlayShine(
        this, `slime-shine-swatch-${numCol.toString(16)}`, 'slime-color', 'slime-shine', numCol, 0.5,
      );
      const slimeImg = this.add.image(sx, sy, swatchShineKey).setDisplaySize(slimeSz, slimeSz);
      const border   = this.add.image(sx, sy, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      items.push(shadow, slimeImg, border);

      // Checkmark badge on currently selected color
      if (isSelected) {
        const ckSz = Math.round(slotSz * 0.28);
        items.push(addBeigeCard(this, sx + slotSz * 0.30, sy - slotSz * 0.30, ckSz + 6, ckSz + 6));
        items.push(addDepthIcon(this, sx + slotSz * 0.30, sy - slotSz * 0.30, 'icon-check', ckSz, ckSz));
      }

      // Hit zone
      const zone = this.add.zone(sx, sy, slotSz + 4, slotSz + 4).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        this.closeActivePopup();
        const match = paintMods.find(m => m.color === hex);
        if (match) this.applyModifier(match);
        else if (paintMods[0]) this.applyModifier({ ...paintMods[0], color: hex });
      });
      zone.on('pointerover', () =>
        this.tweens.add({ targets: [slimeImg, border, shadow], scaleX: 1.12, scaleY: 1.12, duration: 80 }));
      zone.on('pointerout', () =>
        this.tweens.add({ targets: [slimeImg, border, shadow], scaleX: 1, scaleY: 1, duration: 80 }));
      items.push(zone);
    });

    this.activePopup = this.add.container(0, 0, items).setDepth(50);
    this.tweens.add({
      targets: this.activePopup,
      alpha: { from: 0, to: 1 },
      scaleX: { from: 0.88, to: 1 },
      scaleY: { from: 0.88, to: 1 },
      duration: 180,
      ease: 'Back.easeOut',
    });
  }

  // ── Pumpkin picker popup ──────────────────────────────────────────────────
  private showPumpkinPicker(pumpkinMods: ModifierDef[]) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const popW = Math.min(width - 32, 280);
    const slimeSz = 72;
    const popH = 100 + slimeSz + 24;
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);
    items.push(addBeigeCard(this, width / 2, height / 2, popW, popH));
    items.push(this.add.text(width / 2, height / 2 - popH / 2 + 18, 'Pumpkin size', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const step = popW / (pumpkinMods.length + 1);
    pumpkinMods.forEach((mod, ci) => {
      const cx  = width / 2 - popW / 2 + step * (ci + 1);
      const cy  = height / 2;
      const cov = mod.coverage ?? 50;
      const numCol = parseInt((this.engine?.currentState.color ?? '#FFFFFF').replace('#', ''), 16);

      const sh  = this.add.image(cx + 2, cy + 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      sh.setTint(0x000000).setTintMode(Phaser.TintModes.FILL); sh.setAlpha(0.30);
      const sli = this.add.image(cx, cy, 'slime-color').setDisplaySize(slimeSz, slimeSz).setTint(numCol);
      const pum = this.add.image(cx, cy, `mod-pumpkin-${cov}`).setDisplaySize(slimeSz, slimeSz);
      const brd = this.add.image(cx, cy, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      items.push(sh, sli, pum, brd);
      items.push(this.add.text(cx, cy + slimeSz / 2 + 14, `${cov}%`, {
        fontFamily: PIXEL_FONT, fontSize: '8px', color: C.TEXT_BEIGE,
      }).setOrigin(0.5));

      const zone = this.add.zone(cx, cy, slimeSz + 8, slimeSz + 8).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => { this.closeActivePopup(); this.applyModifier(mod); });
      zone.on('pointerover', () => this.tweens.add({ targets: [sli, pum, brd], scaleX: 1.1, scaleY: 1.1, duration: 80 }));
      zone.on('pointerout',  () => this.tweens.add({ targets: [sli, pum, brd], scaleX: 1,   scaleY: 1,   duration: 80 }));
      items.push(zone);
    });

    this.activePopup = this.add.container(0, 0, items).setDepth(50);
    this.tweens.add({ targets: this.activePopup, alpha: { from: 0, to: 1 }, duration: 150 });
  }

  private closeActivePopup() {
    if (!this.activePopup) return;
    const p = this.activePopup;
    this.activePopup = null;
    this.tweens.add({ targets: p, alpha: 0, duration: 120, onComplete: () => p.destroy(true) });
  }

  // ── Conflict popup ─────────────────────────────────────────────────────────
  private showConflictPopup(message: string) {
    this.conflictPopup?.destroy(true);
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const popY = isPortrait ? height * 0.82 : height * 0.88;
    const popW = Math.min(width - 24, 320);
    const bg   = addDarkPanel(this, width / 2, popY, popW, 44);
    const icon = this.add.image(width / 2 - popW / 2 + 22, popY, 'icon-warning').setDisplaySize(18, 18);
    const txt  = this.add.text(width / 2 - popW / 2 + 38, popY, message, {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: '#FFB3B3',
      wordWrap: { width: popW - 52 },
    }).setOrigin(0, 0.5);
    this.conflictPopup = this.add.container(0, 0, [bg, icon, txt]).setDepth(40).setAlpha(0);
    this.tweens.add({ targets: this.conflictPopup, alpha: 1, duration: 150 });
    this.time.delayedCall(2200, () => {
      this.tweens.add({ targets: this.conflictPopup, alpha: 0, duration: 200,
        onComplete: () => this.conflictPopup?.destroy(true) });
    });
  }

  // ── Load error ─────────────────────────────────────────────────────────────
  private showLoadError(message: string, retry: () => void) {
    const { width, height } = this.scale;
    const panelW = Math.min(width - 40, 320);
    const bg   = addDarkPanel(this, 0, 0, panelW, 160).setDepth(80);
    const icon = this.add.image(0, -48, 'icon-warning').setDisplaySize(32, 32).setDepth(81);
    const txt  = this.add.text(0, -10, message, {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: '#ffb3b3',
      align: 'center', wordWrap: { width: panelW - 36 },
    }).setOrigin(0.5).setDepth(81);
    const btn  = addPixelButton(this, { x: 0, y: 59, width: 148, height: 44, label: 'Try Again', onClick: retry }).setDepth(81);
    const panel = this.add.container(width / 2, height / 2, [bg, icon, txt, btn])
      .setDepth(80).setAlpha(0).setScale(0.96);
    this.tweens.add({ targets: panel, alpha: 1, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
  }

  // ── Apply modifier ────────────────────────────────────────────────────────
  private applyModifier(mod: ModifierDef) {
    if (!this.engine || !this.currentRenderer) return;
    const result = this.engine.applyModifier(mod);

    if (!result.ok) {
      this.currentRenderer.playShakeAnim(this);
      this.splot?.playConflict();
      this.showConflictPopup(result.message);
      return;
    }

    this.currentRenderer.setState(result.newState);
    this.currentRenderer.playApplyAnim(this);
    this.playModifierBurst(mod);
    this.splot?.playAppliedFlash();

    const steps = this.engine.steps;
    this.stepsText?.setText(`${steps}`);
    this.stepsPillText?.setText(`${steps}`);

    this.buildPalette();
    if (result.isWin) void this.handleWin();
  }

  // ── Win logic ─────────────────────────────────────────────────────────────
  private playModifierBurst(mod: ModifierDef) {
    if (!this.currentRenderer) return;
    const origin = this.currentRenderer.container;
    const iconKey = modIconKey(mod);
    const tint    = mod.type === 'paint' && mod.color ? parseInt(mod.color.replace('#', ''), 16) : C.GOLD;
    for (let i = 0; i < 7; i++) {
      const angle = Phaser.Math.DegToRad(-120 + i * 40 + Phaser.Math.Between(-8, 8));
      const dist  = Phaser.Math.Between(30, 58);
      const p = this.textures.exists(iconKey) && i % 2 === 0
        ? this.add.image(origin.x, origin.y, iconKey).setDisplaySize(14, 14)
        : this.add.image(origin.x, origin.y, 'icon-sparkle').setDisplaySize(10, 10).setTint(tint);
      p.setDepth(30).setAlpha(0.9).setScale(0.45);
      this.tweens.add({
        targets: p, x: origin.x + Math.cos(angle) * dist, y: origin.y + Math.sin(angle) * dist,
        alpha: 0, scaleX: 1.2, scaleY: 1.2, angle: Phaser.Math.Between(-45, 45),
        duration: 420, ease: 'Quad.easeOut', onComplete: () => p.destroy(),
      });
    }
  }

  private async handleWin() {
    if (!this.engine || !this.level || this.winHandled) return;
    this.winHandled = true;
    this.timerEvent?.destroy();

    const elapsed = this.engine.elapsedMs();
    const steps   = this.engine.steps;
    const stars   = calcStars(steps, this.level.optimalSteps);

    this.currentRenderer?.playWinAnim(this);
    this.splot?.playWin();

    if (this.isPreview) {
      this.time.delayedCall(900, () => this.goToScene('Editor', undefined, 300, 320));
      return;
    }

    const payload: CompleteRequest = { levelId: this.levelId, timeMs: elapsed, actions: this.engine.actions };
    const t0 = Date.now();
    let sparks = 0, streakDays: number | undefined;
    try {
      const res = await fetch('/api/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json() as CompleteResponse;
        sparks = data.sparksEarned ?? 0;
        streakDays = data.streakDays;
      }
    } catch { /* best-effort */ }

    this.time.delayedCall(Math.max(0, 900 - (Date.now() - t0)), () => {
      this.goToScene('LevelComplete', {
        levelId: this.levelId, steps, timeMs: elapsed, stars, sparks, streakDays,
        nextLevelId: this.getNextLevelId(),
      }, 300, 320);
    });
  }

  // Centralizes every scene.start(...) call so only the first invocation ever
  // fires — guards against double-clicking a nav control, and against
  // handleWin()'s async completion racing with a manual back-button press.
  private goToScene(key: string, data?: Record<string, unknown>, fadeOutMs = 250, delayMs = 260) {
    if (this.navigating) return;
    this.navigating = true;
    this.cameras.main.fadeOut(fadeOutMs, 10, 5, 14);
    this.time.delayedCall(delayMs, () => this.scene.start(key, data));
  }

  private getNextLevelId(): string | null {
    const idx = CURATED_LEVELS.findIndex(l => l.id === this.levelId);
    return idx >= 0 && idx < CURATED_LEVELS.length - 1 ? CURATED_LEVELS[idx + 1]!.id : null;
  }

  private showHint() {
    if (this.level?.hint) this.showConflictPopup(this.level.hint);
  }

  private handleReset() {
    this.engine?.reset();
    this.currentRenderer?.setState(this.engine?.currentState ?? {
      color: '#FFFFFF', goggles: null, glasses: null, belt: null, pendant: null, pumpkin: null, underwear: false,
    });
    this.stepsText?.setText('0');
    this.stepsPillText?.setText('0');
    this.buildPalette();
  }

  // ── Timer ────────────────────────────────────────────────────────────────
  private startTimer() {
    this.timerEvent?.destroy();
    const start = Date.now();
    this.timerEvent = this.time.addEvent({
      delay: 1000, loop: true,
      callback: () => {
        const s  = Math.floor((Date.now() - start) / 1000);
        const m  = Math.floor(s / 60);
        const ss = String(s % 60).padStart(2, '0');
        const label = m > 0 ? `${m}:${ss}` : `${s}s`;
        this.timerText?.setText(label);
        this.timerPillText?.setText(label);
      },
    });
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  private onResize(gs: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gs instanceof Phaser.Scale.ScaleManager ? gs : gs;
    this.cameras.resize(width, height);
    this.buildBackground();
    if (this.engine) {
      this.buildHUD();
      this.buildGameArea();
      this.buildPalette();
    }
  }

  shutdown() {
    this.navigating = true; // belt-and-suspenders: block any late goToScene() call
    this.timerEvent?.destroy();
    this.scale.off('resize', this.onResize, this);
    this.closeActivePopup();
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
