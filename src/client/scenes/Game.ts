import * as Phaser from 'phaser';
import { LevelEngine, calcStars } from '../engine/LevelEngine';
import {
  addBeigeCard, addDarkPanel, addDepthIcon,
  addPixelButton, PIXEL_FONT,
} from '../components/PixelUI';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import type { LevelData, ModifierDef } from '../../shared/types';
import type { CompleteRequest, CompleteResponse } from '../../shared/api';
import { CURATED_LEVELS } from '../../shared/levelData';
import { PAINT_COLORS_16 } from '../../shared/gameRules';

// ── Colour constants ───────────────────────────────────────────────────────
const C = {
  HEADER_BG:   0x0A0500,
  GAME_BG:     0x3A1E6E,   // deep purple for game area
  PALETTE_BG:  0x0E0700,   // near-black for modifier area
  BEIGE:       '#DEC998',
  BEIGE_NUM:   0xDEC998,
  DARK_BROWN:  '#3A1A08',
  TEXT_LIGHT:  '#FFFCE8',
  TEXT_BEIGE:  '#DEC998',
  DIM:         '#7a8a9a',
  GOLD:        0xFFD700,
} as const;

// Height of the top strip containing SQLOTTER logo
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
  if (mod.type === 'paint')    return 'icon-paint';
  if (mod.type === 'pumpkin')  return 'icon-pumpkin';
  if (mod.type === 'underwear') return 'icon-underwear';
  if (mod.type === 'pendant')  return 'icon-pendant';
  if (mod.type === 'goggles')  return mod.variant?.includes('thin') ? 'icon-goggles-thin' : 'icon-goggles-thick';
  if (mod.type === 'glasses')  return mod.variant?.includes('thin') ? 'icon-glasses-thin' : 'icon-glasses-thick';
  if (mod.type === 'belt')     return mod.variant?.includes('thin') ? 'icon-belt-thin' : 'icon-belt-thick';
  return 'icon-sparkle';
}

// Is the modifier's visual orientation "horizontal"?
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

  private goalRenderer:    SlimeRenderer | null = null;
  private currentRenderer: SlimeRenderer | null = null;
  private splot:           SplotMascot  | null = null;

  private timerText:     Phaser.GameObjects.Text       | null = null;
  private stepsText:     Phaser.GameObjects.Text       | null = null;
  private conflictPopup: Phaser.GameObjects.Container  | null = null;
  private timerEvent:    Phaser.Time.TimerEvent        | null = null;
  private loadingText:   Phaser.GameObjects.Text       | null = null;

  // Palette scroll state
  private paletteContainer: Phaser.GameObjects.Container | null = null;
  private paletteMask:      Phaser.GameObjects.Graphics  | null = null;
  private paletteScrollY = 0;
  private paletteMaxScroll = 0;
  private paletteSlots: PaletteSlot[] = [];
  private paletteSlotContainers: Phaser.GameObjects.Container[] = [];
  private cols = 3;

  // Popups
  private activePopup: Phaser.GameObjects.Container | null = null;

  private bgRects: Phaser.GameObjects.Rectangle[] = [];
  private bgImages: Phaser.GameObjects.Image[] = [];

  constructor() { super('Game'); }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  init(data: { levelId?: string; previewData?: LevelData }) {
    this.engine        = null;
    this.level         = data?.previewData ?? null;
    this.levelId       = data?.levelId ?? 'L01';
    this.isPreview     = !!data?.previewData;
    this.winHandled    = false;
    this.loadToken    += 1;
    this.paletteScrollY = 0;
    this.paletteMaxScroll = 0;
    this.paletteSlots  = [];
    this.paletteSlotContainers = [];
    this.bgRects  = [];
    this.bgImages = [];
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
      this.buildSlimeDisplays();
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
    this.buildHUD(); this.buildSlimeDisplays(); this.buildPalette(); this.startTimer();
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
      this.buildHUD(); this.buildSlimeDisplays(); this.buildPalette(); this.startTimer();
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
      this.buildHUD(); this.buildSlimeDisplays(); this.buildPalette(); this.startTimer();
    })();
  }

  // ── Background ────────────────────────────────────────────────────────
  private buildBackground() {
    const { width, height } = this.scale;
    const isPortrait = height > width;

    this.bgRects.forEach(r => r.destroy());
    this.bgImages.forEach(i => i.destroy());
    this.bgRects  = [];
    this.bgImages = [];

    // bg4 tinted purple behind game area
    ['bg4-1', 'bg4-2'].forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.18 : 0.08).setDepth(-10).setTint(C.GAME_BG);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgImages.push(img);
    });

    if (isPortrait) {
      // Purple game zone
      const gameH = this.calcPortraitGameH(height);
      const gameRect = this.add.rectangle(width / 2, HEADER_H + gameH / 2, width, gameH, C.GAME_BG)
        .setAlpha(0.85).setDepth(-9);
      this.bgRects.push(gameRect);
      // Dark modifier zone
      const modY = HEADER_H + gameH;
      const modRect = this.add.rectangle(width / 2, modY + (height - modY) / 2, width, height - modY, C.PALETTE_BG)
        .setDepth(-9);
      this.bgRects.push(modRect);
    } else {
      // Left: purple zone (~55% width); Right: dark zone
      const splitX = width * 0.56;
      const gameRect = this.add.rectangle(splitX / 2, height / 2, splitX, height, C.GAME_BG)
        .setAlpha(0.85).setDepth(-9);
      this.bgRects.push(gameRect);
      const palW = width - splitX;
      const palRect = this.add.rectangle(splitX + palW / 2, height / 2, palW, height, C.PALETTE_BG)
        .setDepth(-9);
      this.bgRects.push(palRect);
    }
  }

  private calcPortraitGameH(height: number): number {
    // Game area takes ~36% of height in portrait
    return Math.round(height * 0.36);
  }

  // ── HUD (header strip) ───────────────────────────────────────────────
  private buildHUD() {
    if (!this.level) return;
    const { width } = this.scale;
    const cx = width / 2;

    // Header background
    this.add.rectangle(cx, HEADER_H / 2, width, HEADER_H, C.HEADER_BG).setDepth(15);

    // Back button (depth icon so it looks good on dark strip)
    const back = addDepthIcon(this, 28, HEADER_H / 2, 'icon-arrow', 22, 22);
    back.setDepth(16).setInteractive({ useHandCursor: true });
    back.on('pointerup', () => {
      this.closeActivePopup();
      this.cameras.main.fadeOut(250, 10, 5, 14);
      this.time.delayedCall(260, () => this.scene.start(this.isPreview ? 'Editor' : 'LevelSelect'));
    });

    // SQLOTTER logo
    if (this.textures.exists('title')) {
      const logo = this.add.image(cx, HEADER_H / 2, 'title');
      const maxW = Math.min(width * 0.45, 180);
      logo.setDisplaySize(maxW, maxW * 0.22).setDepth(16);
    }

    // Hint button
    const hintBtn = addDepthIcon(this, width - 58, HEADER_H / 2, 'icon-help', 20, 20);
    hintBtn.setDepth(16).setInteractive({ useHandCursor: true });
    hintBtn.on('pointerup', () => this.showHint());

    // Reset button
    const resetBtn = addDepthIcon(this, width - 28, HEADER_H / 2, 'icon-reset', 22, 22);
    resetBtn.setDepth(16).setInteractive({ useHandCursor: true });
    resetBtn.on('pointerup', () => this.handleReset());

    // Timer display (small pill, below header on left)
    this.add.image(16, HEADER_H + 16, 'icon-timer').setDisplaySize(14, 14).setDepth(15).setTint(C.BEIGE_NUM);
    this.timerText = this.add.text(32, HEADER_H + 16, '0:00', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.TEXT_BEIGE,
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 0, fill: true },
    }).setOrigin(0, 0.5).setDepth(15);

    // Steps display (small pill, below header on right)
    this.stepsText = this.add.text(width - 16, HEADER_H + 16, 'Steps: 0', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.TEXT_BEIGE,
      shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 0, fill: true },
    }).setOrigin(1, 0.5).setDepth(15);
  }

  // ── Slime display panels ──────────────────────────────────────────────
  private buildSlimeDisplays() {
    if (!this.engine) return;
    this.goalRenderer?.container.destroy();
    this.currentRenderer?.container.destroy();
    this.splot?.container.destroy();

    const { width, height } = this.scale;
    const isPortrait = height > width;

    if (isPortrait) {
      this.buildPortraitSlimes(width, height);
    } else {
      this.buildLandscapeSlimes(width, height);
    }
  }

  private buildPortraitSlimes(width: number, height: number) {
    const gameH    = this.calcPortraitGameH(height);
    const areaTop  = HEADER_H + 36; // below header + sub-header timer row
    const areaBot  = HEADER_H + gameH;
    const panelCy  = (areaTop + areaBot) / 2;

    const available = areaBot - areaTop - 40; // leave space for labels
    const panelSz   = Math.min(available, (width - 40) / 2 - 10, 160);
    const slimeSz   = Math.round(panelSz * 0.68);

    const goalX    = width * 0.27;
    const curX     = width * 0.73;
    const labelY   = panelCy + panelSz / 2 + 16;

    this.buildSlimePanel(goalX, panelCy, panelSz, panelSz, 'Goal', labelY);
    this.goalRenderer = new SlimeRenderer(this, goalX, panelCy, slimeSz);
    this.goalRenderer.container.setDepth(4);
    this.goalRenderer.setState(this.engine!.goalState);

    this.buildSlimePanel(curX, panelCy, panelSz, panelSz, 'Current', labelY);
    this.currentRenderer = new SlimeRenderer(this, curX, panelCy, slimeSz);
    this.currentRenderer.container.setDepth(4);
    this.currentRenderer.setState(this.engine!.currentState);
  }

  private buildLandscapeSlimes(width: number, height: number) {
    const splitX  = width * 0.56;
    const areaTop = HEADER_H + 38;
    const areaBot = height - 14;
    const panelCy = (areaTop + areaBot) / 2;

    const available = areaBot - areaTop - 44;
    const panelSz   = Math.min(available, (splitX - 36) / 2 - 10, 200);
    const slimeSz   = Math.round(panelSz * 0.68);

    const goalX = splitX * 0.28;
    const curX  = splitX * 0.72;
    const labelY = panelCy + panelSz / 2 + 16;

    this.buildSlimePanel(goalX, panelCy, panelSz, panelSz, 'Goal', labelY);
    this.goalRenderer = new SlimeRenderer(this, goalX, panelCy, slimeSz);
    this.goalRenderer.container.setDepth(4);
    this.goalRenderer.setState(this.engine!.goalState);

    this.buildSlimePanel(curX, panelCy, panelSz, panelSz, 'Current', labelY);
    this.currentRenderer = new SlimeRenderer(this, curX, panelCy, slimeSz);
    this.currentRenderer.container.setDepth(4);
    this.currentRenderer.setState(this.engine!.currentState);
  }

  private buildSlimePanel(cx: number, cy: number, w: number, h: number, label: string, labelY: number) {
    // Beige card panel
    addBeigeCard(this, cx, cy, w, h).setDepth(2);

    // Label pill below the panel
    const pillW = label.length * 8 + 24;
    addBeigeCard(this, cx, labelY, pillW, 22).setDepth(3);
    this.add.text(cx, labelY, label, {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(4);
  }

  // ── Modifier palette ──────────────────────────────────────────────────
  private buildPalette() {
    if (!this.level) return;
    this.paletteContainer?.destroy(true);
    this.paletteMask?.destroy();
    this.paletteScrollY = 0;
    this.paletteSlotContainers = [];

    const { width, height } = this.scale;
    const isPortrait = height > width;

    // Determine palette area bounds
    let pX: number, pY: number, pW: number, pH: number;
    if (isPortrait) {
      const gameH = this.calcPortraitGameH(height);
      pX = 0;
      pY = HEADER_H + gameH;
      pW = width;
      pH = height - pY;
    } else {
      const splitX = width * 0.56;
      pX = splitX;
      pY = 0;
      pW = width - splitX;
      pH = height;
    }

    this.paletteContainer = this.add.container(0, 0).setDepth(6);

    // In landscape: add SQLOTTER logo in right panel header
    if (!isPortrait) {
      if (this.textures.exists('title')) {
        const logo = this.add.image(pX + pW / 2, 26, 'title');
        const maxW = Math.min(pW * 0.65, 160);
        logo.setDisplaySize(maxW, maxW * 0.22).setDepth(16);
        this.paletteContainer.add(logo);
      }
    }

    // 3-column grid of modifier slots
    this.cols = 3;
    const padX = 10, padY = isPortrait ? 10 : 50;
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

    // Calculate max scroll
    const rows = Math.ceil(this.paletteSlots.length / this.cols);
    const totalH = padY + rows * (cellSz + gap) + padY;
    this.paletteMaxScroll = Math.max(0, totalH - pH);

    // Clip mask so cards don't overflow the palette area (not added to display list)
    this.paletteMask = this.make.graphics();
    this.paletteMask.fillRect(pX, pY, pW, pH);
    const geomMask = this.paletteMask.createGeometryMask();
    this.paletteContainer.setMask(geomMask);

    // Touch scroll
    if (this.paletteMaxScroll > 0) {
      const zone = this.add.zone(pX + pW / 2, pY + pH / 2, pW, pH).setDepth(5).setInteractive();
      let dragStart = 0;
      let scrollStart = 0;
      zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
        dragStart   = p.y;
        scrollStart = this.paletteScrollY;
      });
      zone.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (!p.isDown) return;
        const delta = dragStart - p.y;
        this.paletteScrollY = Phaser.Math.Clamp(scrollStart + delta, 0, this.paletteMaxScroll);
        this.applyPaletteScroll();
      });
    }
  }

  private applyPaletteScroll() {
    if (this.paletteContainer) {
      this.paletteContainer.y = -this.paletteScrollY;
    }
  }

  private buildPaletteSlot(
    cx: number, cy: number, cellSz: number,
    slot: PaletteSlot,
  ): Phaser.GameObjects.Container {
    const items: Phaser.GameObjects.GameObject[] = [];

    // Background beige card
    const bg = addBeigeCard(this, 0, 0, cellSz, cellSz);
    items.push(bg);

    const iconSz = Math.round(cellSz * 0.42);

    if (slot.kind === 'paint') {
      // Paint bucket icon with depth shadow
      const ic = addDepthIcon(this, 0, -cellSz * 0.05, 'icon-paint', iconSz, iconSz);
      items.push(ic);
      // Small colour dots row at bottom hinting available colours
      const dotR  = 4;
      const shown = Math.min(slot.mods.length, 5);
      const totalW = shown * (dotR * 2 + 2) - 2;
      slot.mods.slice(0, shown).forEach((m, di) => {
        const dotX = -totalW / 2 + di * (dotR * 2 + 2) + dotR;
        const col  = m.color ? parseInt(m.color.replace('#', ''), 16) : 0xFFFFFF;
        const dot  = this.add.circle(dotX, cellSz * 0.28, dotR, col).setStrokeStyle(1, 0x3D1808);
        items.push(dot);
      });
    } else if (slot.kind === 'pumpkin') {
      const ic = addDepthIcon(this, 0, 0, 'icon-pumpkin', iconSz, iconSz);
      items.push(ic);
      // Show available coverages as small text labels
      const labels = slot.mods.map(m => `${m.coverage}%`).join(' ');
      const lbl = this.add.text(0, cellSz * 0.3, labels, {
        fontFamily: PIXEL_FONT, fontSize: '6px', color: C.DARK_BROWN,
      }).setOrigin(0.5);
      items.push(lbl);

      // Unavailable overlay if current state already has pumpkin at 75 + underwear conflict
      const state = this.engine?.currentState;
      if (state) {
        const isConflict = state.pumpkin === 75 && slot.mods.every(m => m.coverage !== 75);
        if (isConflict) {
          const cross = addDepthIcon(this, 0, 0, 'icon-cross', iconSz * 0.8, iconSz * 0.8, 1, 0.4);
          cross.setAlpha(0.85);
          items.push(cross);
        }
      }
    } else {
      const mod = slot.mod;
      const iconKey = modIconKey(mod);
      const isSpent  = !this.engine?.isModAvailable(mod);

      // Icon
      const ic = addDepthIcon(this, 0, -cellSz * 0.08, iconKey, iconSz, iconSz);
      if (isSpent) ic.setAlpha(0.35);
      items.push(ic);

      // Direction arrow for H/V modifier variants
      if (isHorizontalVariant(mod) || isVerticalVariant(mod)) {
        const angle = isHorizontalVariant(mod) ? 0 : 90; // 0 = right (h), 90 = down (v)
        const arrowSz = Math.round(cellSz * 0.22);
        const arrowX  = cellSz * 0.28;
        const arrowY  = -cellSz * 0.28;
        const arrowContainer = addDepthIcon(this, arrowX, arrowY, 'icon-arrow', arrowSz, arrowSz, 1, 0.4);
        // Tint the icon (not shadow) red/orange
        const iconInContainer = arrowContainer.list[1] as Phaser.GameObjects.Image | undefined;
        iconInContainer?.setTint(0xFF5500);
        arrowContainer.setAngle(angle);
        items.push(arrowContainer);
      }

      // Count badge (bottom-right corner)
      const remaining = this.engine?.getRemainingCount(mod.id) ?? Infinity;
      if (mod.count !== undefined && remaining !== Infinity) {
        const badgeSz = Math.round(cellSz * 0.26);
        const badgeX  = cellSz * 0.3;
        const badgeY  = cellSz * 0.3;
        const badgeBg = addBeigeCard(this, badgeX, badgeY, badgeSz, badgeSz);
        items.push(badgeBg);
        const countTxt = this.add.text(badgeX, badgeY, `${remaining}x`, {
          fontFamily: PIXEL_FONT, fontSize: '6px', color: C.DARK_BROWN,
        }).setOrigin(0.5);
        items.push(countTxt);
      }

      // Unavailable cross overlay
      if (isSpent) {
        const cross = addDepthIcon(this, 0, 0, 'icon-cross', iconSz, iconSz, 1, 0.4);
        cross.setAlpha(0.78);
        items.push(cross);
      }
    }

    const container = this.add.container(cx, cy, items).setDepth(7).setSize(cellSz, cellSz);
    container.setInteractive({ useHandCursor: true });

    // Tap handler
    container.on('pointerup', () => {
      if (slot.kind === 'paint') {
        this.showColorPicker(slot.mods);
      } else if (slot.kind === 'pumpkin') {
        this.showPumpkinPicker(slot.mods);
      } else {
        if (this.engine?.isModAvailable(slot.mod)) {
          this.applyModifier(slot.mod);
        }
      }
    });

    // Press feedback
    container.on('pointerdown', () => {
      this.tweens.add({ targets: container, scaleX: 0.94, scaleY: 0.94, duration: 60 });
    });
    container.on('pointerout', () => {
      this.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 80 });
    });

    return container;
  }

  // ── Colour picker popup ───────────────────────────────────────────────
  private showColorPicker(paintMods: ModifierDef[]) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const colors = paintMods.length > 1
      ? paintMods.map(m => m.color ?? '#FFFFFF')
      : PAINT_COLORS_16.slice();

    const popW = Math.min(width - 32, 300);
    const cols = 4;
    const dotSz = Math.floor((popW - 32 - 8 * (cols - 1)) / cols);
    const rows  = Math.ceil(colors.length / cols);
    const popH  = 48 + rows * (dotSz + 8) + 8;

    const items: Phaser.GameObjects.GameObject[] = [];

    // Dark overlay
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.65);
    overlay.setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    // Panel
    const panelBg = addDarkPanel(this, width / 2, height / 2, popW, popH);
    items.push(panelBg);

    // Title
    const title = this.add.text(width / 2, height / 2 - popH / 2 + 18, 'Pick a colour', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.TEXT_BEIGE,
    }).setOrigin(0.5);
    items.push(title);

    // Colour grid
    const gridTop = height / 2 - popH / 2 + 36;
    colors.forEach((hex, ci) => {
      const col = ci % cols;
      const row = Math.floor(ci / cols);
      const cx  = width / 2 - (popW - 32) / 2 + col * (dotSz + 8) + dotSz / 2;
      const cy  = gridTop + row * (dotSz + 8) + dotSz / 2;

      const numCol = parseInt(hex.replace('#', ''), 16);
      // Mini-slime circle
      const topImg = this.add.image(cx, cy, 'slime-color')
        .setDisplaySize(dotSz, dotSz).setTint(numCol);
      const borderImg = this.add.image(cx, cy, 'slime-border').setDisplaySize(dotSz, dotSz);
      // Shadow
      const shadow = this.add.image(cx + 2, cy + 2, 'slime-color')
        .setDisplaySize(dotSz, dotSz);
      shadow.setTint(0x000000); shadow.setTintFill(); shadow.setAlpha(0.35);
      items.push(shadow, topImg, borderImg);

      const zone = this.add.zone(cx, cy, dotSz + 4, dotSz + 4).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        this.closeActivePopup();
        // Find matching paint mod or create an ad-hoc one
        const match = paintMods.find(m => m.color === hex);
        if (match) {
          this.applyModifier(match);
        } else {
          // Use the first paint mod but with this color
          const first = paintMods[0];
          if (first) this.applyModifier({ ...first, color: hex });
        }
      });
      zone.on('pointerover', () => {
        this.tweens.add({ targets: [topImg, borderImg], scaleX: 1.12, scaleY: 1.12, duration: 80 });
      });
      zone.on('pointerout', () => {
        this.tweens.add({ targets: [topImg, borderImg], scaleX: 1, scaleY: 1, duration: 80 });
      });
      items.push(zone);
    });

    this.activePopup = this.add.container(0, 0, items).setDepth(50);
    this.tweens.add({ targets: this.activePopup, alpha: { from: 0, to: 1 }, scaleX: { from: 0.9, to: 1 },
      scaleY: { from: 0.9, to: 1 }, duration: 160, ease: 'Back.easeOut' });
  }

  // ── Pumpkin picker popup ──────────────────────────────────────────────
  private showPumpkinPicker(pumpkinMods: ModifierDef[]) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const popW  = Math.min(width - 32, 280);
    const slimeSz = 72;
    const popH  = 100 + slimeSz + 24;

    const items: Phaser.GameObjects.GameObject[] = [];
    const overlay = this.add.rectangle(0, 0, width, height, 0x000000, 0.65).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    const panelBg = addDarkPanel(this, width / 2, height / 2, popW, popH);
    items.push(panelBg);

    const title = this.add.text(width / 2, height / 2 - popH / 2 + 18, 'Pumpkin size', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.TEXT_BEIGE,
    }).setOrigin(0.5);
    items.push(title);

    const coverages = pumpkinMods.map(m => m.coverage ?? 50);
    const step = popW / (coverages.length + 1);

    coverages.forEach((cov, ci) => {
      const cx  = width / 2 - popW / 2 + step * (ci + 1);
      const cy  = height / 2;

      // Mini slime preview
      const curColor = this.engine?.currentState.color ?? '#FFFFFF';
      const numCol   = parseInt(curColor.replace('#', ''), 16);
      const sh = this.add.image(cx + 2, cy + 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      sh.setTint(0x000000); sh.setTintFill(); sh.setAlpha(0.30);
      const slimeImg   = this.add.image(cx, cy, 'slime-color').setDisplaySize(slimeSz, slimeSz).setTint(numCol);
      const pumpkinKey = `mod-pumpkin-${cov}`;
      const pumpkinImg = this.add.image(cx, cy, pumpkinKey).setDisplaySize(slimeSz, slimeSz);
      const borderImg  = this.add.image(cx, cy, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      items.push(sh, slimeImg, pumpkinImg, borderImg);

      // Label
      const lbl = this.add.text(cx, cy + slimeSz / 2 + 14, `${cov}%`, {
        fontFamily: PIXEL_FONT, fontSize: '8px', color: C.TEXT_BEIGE,
      }).setOrigin(0.5);
      items.push(lbl);

      // Tap zone
      const zone = this.add.zone(cx, cy, slimeSz + 8, slimeSz + 8).setInteractive({ useHandCursor: true });
      zone.on('pointerup', () => {
        this.closeActivePopup();
        const mod = pumpkinMods[ci];
        if (mod) this.applyModifier(mod);
      });
      zone.on('pointerover', () => {
        this.tweens.add({ targets: [slimeImg, pumpkinImg, borderImg], scaleX: 1.1, scaleY: 1.1, duration: 80 });
      });
      zone.on('pointerout', () => {
        this.tweens.add({ targets: [slimeImg, pumpkinImg, borderImg], scaleX: 1, scaleY: 1, duration: 80 });
      });
      items.push(zone);
    });

    this.activePopup = this.add.container(0, 0, items).setDepth(50);
    this.tweens.add({ targets: this.activePopup, alpha: { from: 0, to: 1 }, duration: 150 });
  }

  private closeActivePopup() {
    if (!this.activePopup) return;
    const p = this.activePopup;
    this.activePopup = null;
    this.tweens.add({
      targets: p, alpha: 0, duration: 120,
      onComplete: () => p.destroy(true),
    });
  }

  // ── Conflict popup ────────────────────────────────────────────────────
  private showConflictPopup(message: string) {
    this.conflictPopup?.destroy(true);
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const popY = isPortrait ? height * 0.82 : height * 0.88;
    const popW = Math.min(width - 24, 320);

    const bg = addDarkPanel(this, width / 2, popY, popW, 44);
    const icon = this.add.image(width / 2 - popW / 2 + 22, popY, 'icon-warning').setDisplaySize(18, 18);
    const txt  = this.add.text(width / 2 - popW / 2 + 38, popY, message, {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: '#FFB3B3',
      wordWrap: { width: popW - 52 },
    }).setOrigin(0, 0.5);

    this.conflictPopup = this.add.container(0, 0, [bg, icon, txt])
      .setDepth(40).setAlpha(0);
    this.tweens.add({ targets: this.conflictPopup, alpha: 1, duration: 150 });
    this.time.delayedCall(2200, () => {
      this.tweens.add({ targets: this.conflictPopup, alpha: 0, duration: 200,
        onComplete: () => this.conflictPopup?.destroy(true) });
    });
  }

  // ── Load error panel ──────────────────────────────────────────────────
  private showLoadError(message: string, retry: () => void) {
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const panelW = Math.min(width - 40, 320);
    const bg   = addDarkPanel(this, 0, 0, panelW, 160).setDepth(80);
    const icon = this.add.image(0, -48, 'icon-warning').setDisplaySize(32, 32).setDepth(81);
    const txt  = this.add.text(0, -10, message, {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: '#ffb3b3',
      align: 'center', wordWrap: { width: panelW - 36 },
    }).setOrigin(0.5).setDepth(81);
    const btn  = addPixelButton(this, { x: 0, y: 59, width: 148, height: 44,
      label: 'Try Again', onClick: retry }).setDepth(81);
    const panel = this.add.container(cx, cy, [bg, icon, txt, btn])
      .setDepth(80).setAlpha(0).setScale(0.96);
    this.tweens.add({ targets: panel, alpha: 1, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
  }

  // ── Apply modifier ────────────────────────────────────────────────────
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
    this.stepsText?.setText(`Steps: ${this.engine.steps}`);

    // Rebuild palette so availability / count badges update
    this.buildPalette();

    if (result.isWin) void this.handleWin();
  }

  // ── Win logic ─────────────────────────────────────────────────────────
  private playModifierBurst(mod: ModifierDef) {
    if (!this.currentRenderer) return;
    const origin = this.currentRenderer.container;
    const iconKey = modIconKey(mod);
    const tint    = mod.type === 'paint' && mod.color
      ? parseInt(mod.color.replace('#', ''), 16) : C.GOLD;

    for (let i = 0; i < 7; i++) {
      const angle    = Phaser.Math.DegToRad(-120 + i * 40 + Phaser.Math.Between(-8, 8));
      const distance = Phaser.Math.Between(30, 58);
      const tx = origin.x + Math.cos(angle) * distance;
      const ty = origin.y + Math.sin(angle) * distance;
      const p  = this.textures.exists(iconKey) && i % 2 === 0
        ? this.add.image(origin.x, origin.y, iconKey).setDisplaySize(14, 14)
        : this.add.image(origin.x, origin.y, 'icon-sparkle').setDisplaySize(10, 10).setTint(tint);
      p.setDepth(30).setAlpha(0.9).setScale(0.45);
      this.tweens.add({
        targets: p, x: tx, y: ty, alpha: 0,
        scaleX: 1.2, scaleY: 1.2, angle: Phaser.Math.Between(-45, 45),
        duration: 420, ease: 'Quad.easeOut',
        onComplete: () => p.destroy(),
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
      this.time.delayedCall(900, () => {
        this.cameras.main.fadeOut(300, 10, 5, 14);
        this.time.delayedCall(320, () => this.scene.start('Editor'));
      });
      return;
    }

    const payload: CompleteRequest = {
      levelId: this.levelId,
      timeMs: elapsed,
      actions: this.engine.actions,
    };
    const t0 = Date.now();
    let sparks = 0;
    let streakDays: number | undefined;
    try {
      const res = await fetch('/api/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json() as CompleteResponse;
        sparks     = data.sparksEarned ?? 0;
        streakDays = data.streakDays;
      }
    } catch { /* best-effort */ }

    const elapsed2 = Date.now() - t0;
    const delay    = Math.max(0, 900 - elapsed2);
    this.time.delayedCall(delay, () => {
      this.cameras.main.fadeOut(300, 10, 5, 14);
      this.time.delayedCall(320, () => {
        this.scene.start('LevelComplete', {
          levelId:    this.levelId,
          steps,
          timeMs:     elapsed,
          stars,
          sparks,
          streakDays,
          nextLevelId: this.getNextLevelId(),
        });
      });
    });
  }

  private getNextLevelId(): string | null {
    const idx = CURATED_LEVELS.findIndex(l => l.id === this.levelId);
    return idx >= 0 && idx < CURATED_LEVELS.length - 1
      ? CURATED_LEVELS[idx + 1]!.id
      : null;
  }

  // ── Hint ──────────────────────────────────────────────────────────────
  private showHint() {
    if (!this.level?.hint) return;
    this.showConflictPopup(this.level.hint);
  }

  // ── Reset ─────────────────────────────────────────────────────────────
  private handleReset() {
    this.engine?.reset();
    this.currentRenderer?.setState(this.engine?.currentState ?? { color: '#FFFFFF',
      goggles: null, glasses: null, belt: null, pendant: null, pumpkin: null, underwear: false });
    this.stepsText?.setText('Steps: 0');
    this.buildPalette();
  }

  // ── Timer ──────────────────────────────────────────────────────────────
  private startTimer() {
    this.timerEvent?.destroy();
    const start = Date.now();
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        const elapsed = Date.now() - start;
        const s = Math.floor(elapsed / 1000);
        const m = Math.floor(s / 60);
        const ss = String(s % 60).padStart(2, '0');
        this.timerText?.setText(`${m}:${ss}`);
      },
    });
  }

  // ── Resize ────────────────────────────────────────────────────────────
  private onResize(gs: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gs instanceof Phaser.Scale.ScaleManager ? gs : gs;
    this.cameras.resize(width, height);
    this.buildBackground();
    if (this.engine) {
      this.buildHUD();
      this.buildSlimeDisplays();
      this.buildPalette();
    }
  }

  shutdown() {
    this.timerEvent?.destroy();
    this.scale.off('resize', this.onResize, this);
    this.closeActivePopup();
  }
}
