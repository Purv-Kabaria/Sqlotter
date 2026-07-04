import * as Phaser from 'phaser';
import { LevelEngine, calcStars } from '../engine/LevelEngine';
import {
  addBeigeBadge, addBeigeButton, addBeigeButtonShell, addBeigeSolidCard,
  addDarkPanel, addDepthIcon, PIXEL_FONT,
} from '../components/PixelUI';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import { paintOverlayShine } from '../components/overlayShine';
import type { LevelData, ModifierDef } from '../../shared/types';
import type { CompleteRequest, CompleteResponse } from '../../shared/api';
import { getCuratedLevels } from '../../shared/levelData';
import { BASE_COLOR, standardPaints, standardPumpkins } from '../../shared/slimeSim';

// Tutorial modals ("Splash Course" levels) show once per page load per level —
// replaying a lesson or resetting it doesn't re-interrupt the player.
const tutorialShownThisSession = new Set<string>();

const PIXELIFY = '"Pixelify Sans", sans-serif';

// ── Colour constants ───────────────────────────────────────────────────────
const C = {
  HEADER_BG:   0x0A0500,
  GAME_BG:     0x57317D, // matches the bg3 purple-cloud set behind everything
  BEIGE:       '#DEC998',
  BEIGE_NUM:   0xDEC998,
  DARK_BROWN:  '#3A1A08',
  TEXT_LIGHT:  '#FFFCE8',
  TEXT_BEIGE:  '#DEC998',
  DIM:         '#7a8a9a',
  GOLD:        0xFFD700,
  WORN_RING:   0x6DD400,
} as const;

// Tall enough for the 48px beige header buttons plus breathing room.
const HEADER_H = 64;
const HUD_BTN  = 48;

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
  private paletteSlots: PaletteSlot[] = [];
  // Loose game-area objects (cards, pills, pill texts) — tracked so the
  // resize rebuild can destroy them; orphaning them duplicates the play area.
  private areaObjs: Phaser.GameObjects.GameObject[] = [];

  private activePopup: Phaser.GameObjects.Container | null = null;
  private bgImages: Phaser.GameObjects.Image[] = [];

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
    this.paletteSlots  = [];
    this.areaObjs      = [];
    this.bgImages = [];
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.HEADER_BG);
    this.cameras.main.fadeIn(300, 10, 5, 14);
    this.scale.on('resize', this.onResize, this);

    this.buildBackground();

    if (this.level) {
      this.beginLevel();
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
    this.beginLevel();
  }

  // Single entry point for "the level is known — set the table". Builds the
  // engine + UI, then either starts the clock or (first visit to a tutorial
  // level this session) holds it behind the tutorial modal so reading the
  // lesson never costs time.
  private beginLevel() {
    if (!this.level) return;
    this.engine = new LevelEngine(this.level);
    this.buildHUD();
    this.buildGameArea();
    this.buildPalette();

    const tutorial = this.level.tutorial;
    if (tutorial && !tutorialShownThisSession.has(this.level.id)) {
      tutorialShownThisSession.add(this.level.id);
      this.showTutorialModal(tutorial, () => {
        // Fresh engine, NOT engine.reset(): reset is a logged, move-costing
        // action now — re-basing the attempt clock must not add one.
        if (this.level) this.engine = new LevelEngine(this.level);
        this.startTimer();
      });
    } else {
      this.startTimer();
    }
  }

  private useFallbackLevel() {
    const dow = new Date().getDay();
    const curated = getCuratedLevels();
    const fb  = curated[dow % curated.length] ?? curated[0] ?? null;
    this.level   = fb;
    this.levelId = fb?.id ?? 'L01';
  }

  private startWithLevelId(id: string) {
    const curated = getCuratedLevels().find(l => l.id === id);
    if (curated) {
      this.level = curated;
      this.beginLevel();
      return;
    }
    this.showLoading();
    const token = this.loadToken;
    void (async () => {
      try {
        const res = await fetch(`/api/level/${id}`);
        this.level = res.ok ? (await res.json() as { level: LevelData }).level : getCuratedLevels()[0] ?? null;
      } catch {
        this.level = getCuratedLevels()[0] ?? null;
      }
      if (token !== this.loadToken) return;
      this.loadingText?.destroy();
      if (!this.level) {
        this.showLoadError('Could not load this level.', () => this.scene.start('LevelSelect'));
        return;
      }
      this.beginLevel();
    })();
  }

  // ── Background — full-screen purple clouds (bg3 set, per the design mock),
  // same cover-scale layering as MainMenu/Shop. The play/palette areas are
  // panels drawn on top, not background splits. ──────────────────────────────
  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg3-1', 'bg3-2', 'bg3-3', 'bg3-4'];
    const alphas = [1, 0.80, 0.55, 0.30];

    this.bgImages.forEach(i => i.destroy());
    this.bgImages = [];

    keys.forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.3).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgImages.push(img);
    });
  }

  // Landscape: palette column on the right. Portrait: palette panel below the
  // cards. Both return the rect the palette panel occupies; the game area
  // takes what's left.
  private paletteRect(width: number, height: number): { x: number; y: number; w: number; h: number } {
    const pad = 14;
    if (height > width) {
      const y = HEADER_H + Math.round((height - HEADER_H) * 0.52);
      return { x: pad, y, w: width - pad * 2, h: height - y - pad };
    }
    const w = Math.max(220, Math.min(360, Math.round(width * 0.32)));
    return { x: width - pad - w, y: HEADER_H + pad, w, h: height - HEADER_H - pad * 2 };
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

    // Header controls are real beige buttons (same shells as every other
    // screen's icon buttons) — 48px, so the shell auto-picks the small-corner
    // pieces and hover/press feedback comes built in. Arrow art points right,
    // so back rotates it 180° (same as Leaderboard's back button).
    elements.push(this.hudIconButton(10 + HUD_BTN / 2, HEADER_H / 2, 'icon-arrow', 180, () => {
      this.closeActivePopup();
      this.goToScene(this.isPreview ? 'Editor' : 'LevelSelect');
    }));

    // Level title + context line, centered. In-game the header identifies the
    // puzzle ("Orange Splash" / "World 1 · Level 1") — branding stays on the
    // splash/menu screens (and the landscape palette keeps its logo). Width
    // budget: whatever the back button (left) and hint+reset pair (right)
    // leave free, mirrored so the title stays visually centered.
    const sideReserve = 10 + HUD_BTN * 2 + 8 + 12;
    const maxChars = Math.max(10, Math.floor((width - sideReserve * 2) / 9));
    const rawTitle = this.level.title;
    const titleLabel = rawTitle.length > maxChars ? `${rawTitle.slice(0, maxChars - 3)}...` : rawTitle;
    elements.push(this.add.text(width / 2, HEADER_H / 2 - 8, titleLabel, {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: C.TEXT_LIGHT,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(16));
    const context = this.levelContextLabel();
    if (context) {
      elements.push(this.add.text(width / 2, HEADER_H / 2 + 12, context, {
        fontFamily: PIXEL_FONT, fontSize: '6px', color: '#9A8A6A',
      }).setOrigin(0.5).setDepth(16));
    }

    // Hint + Reset in header right.
    elements.push(this.hudIconButton(width - 10 - HUD_BTN - 8 - HUD_BTN / 2, HEADER_H / 2, 'icon-help', 0, () => this.showHint()));
    elements.push(this.hudIconButton(width - 10 - HUD_BTN / 2, HEADER_H / 2, 'icon-reset', 0, () => this.handleReset()));

    this.hudLayer = this.add.container(0, 0, elements);
  }

  // Square beige icon button for the header strip — the same shell+depth-icon
  // recipe as MainMenu/Leaderboard's icon buttons, sized to fit inside HEADER_H.
  private hudIconButton(x: number, y: number, iconKey: string, angle: number, onClick: () => void): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, x, y, HUD_BTN, HUD_BTN, false, onClick);
    const iconSize = Math.round(HUD_BTN * 0.44);
    shell.addContent([addDepthIcon(this, 0, -1, iconKey, iconSize, iconSize).setAngle(angle)]);
    shell.container.setDepth(16);
    return shell.container;
  }

  // "Where am I" line under the level title: daily / UGC author / world+level
  // parsed from the curated id scheme (w00 is the tutorial world).
  private levelContextLabel(): string {
    const level = this.level;
    if (!level) return '';
    if (this.isPreview) return 'Editor preview';
    if (level.isDaily) return 'Daily Puzzle';
    if (level.authorName) return `by u/${level.authorName}`;
    const match = /^w(\d+)-l(\d+)$/.exec(level.id);
    if (!match) return '';
    const world = parseInt(match[1]!, 10);
    const lesson = parseInt(match[2]!, 10);
    return world === 0 ? `Splash Course · Lesson ${lesson}` : `World ${world} · Level ${lesson}`;
  }

  // ── Game area — the design-mock block: two beige cards (Goal | Current)
  // with label pills and Time/Moves pills beneath, centered in whatever the
  // palette panel leaves free. One code path for both orientations. ─────────
  private buildGameArea() {
    if (!this.engine || !this.level) return;

    this.goalRenderer?.container.destroy();
    this.currentRenderer?.container.destroy();
    this.splot?.stopIdleAnims();
    this.splot?.container.destroy();
    this.splot = null;
    this.areaObjs.forEach((o) => o.destroy());
    this.areaObjs = [];

    const { width, height } = this.scale;
    const isPortrait = height > width;
    const pal = this.paletteRect(width, height);
    const area = isPortrait
      ? { x: 10, y: HEADER_H + 10, w: width - 20, h: pal.y - HEADER_H - 20 }
      : { x: 14, y: HEADER_H + 10, w: pal.x - 28, h: height - HEADER_H - 24 };

    const gapX   = Math.max(14, Math.round(area.w * 0.04));
    const rowGap = 10;
    const labelH = Math.max(38, Math.min(48, Math.round(area.h * 0.14)));
    const statH  = labelH;
    // Portrait caps the cards a touch lower than landscape so tablets keep
    // enough leftover height below the block for the mascot.
    const cardSz = Math.max(66, Math.min(
      Math.floor((area.w - gapX) / 2),
      area.h - labelH - statH - rowGap * 2,
      isPortrait ? 272 : 300,
    ));
    const blockW = cardSz * 2 + gapX;
    const blockH = cardSz + rowGap + labelH + rowGap + statH;

    // Splot gets whatever height the block leaves over (capped so he doesn't
    // dwarf the cards). Block + mascot are centered together as one group, so
    // he's a designed part of the layout rather than leftover-strip garnish.
    const splotSz   = Math.min(150, area.h - blockH - 16);
    const showSplot = splotSz >= 52;
    const groupH    = blockH + (showSplot ? 8 + splotSz : 0);

    const left   = area.x + (area.w - blockW) / 2;
    const top    = area.y + Math.max(0, (area.h - groupH) / 2);
    const goalX  = left + cardSz / 2;
    const curX   = left + cardSz + gapX + cardSz / 2;
    const cardCy = top + cardSz / 2;
    const labelY = top + cardSz + rowGap + labelH / 2;
    const statY  = labelY + labelH / 2 + rowGap + statH / 2;
    const slimeSz = Math.round(cardSz * 0.72);

    this.areaObjs.push(
      addBeigeSolidCard(this, goalX, cardCy, cardSz, cardSz).setDepth(2),
      addBeigeSolidCard(this, curX,  cardCy, cardSz, cardSz).setDepth(2),
    );

    this.goalRenderer = new SlimeRenderer(this, goalX, cardCy, slimeSz);
    this.goalRenderer.container.setDepth(4);
    this.goalRenderer.setPattern(this.level.palette, this.level.optimalSolution);

    this.currentRenderer = new SlimeRenderer(this, curX, cardCy, slimeSz);
    this.currentRenderer.container.setDepth(4);
    this.currentRenderer.setPattern(this.level.palette, this.engine.actions);

    this.buildPill(goalX, labelY, cardSz, labelH, 'Goal');
    this.buildPill(curX,  labelY, cardSz, labelH, 'Current');
    this.timerText = this.buildPill(goalX, statY, cardSz, statH, 'Time: 0s');
    this.stepsText = this.buildPill(curX, statY, cardSz, statH, `Moves: ${this.stepsLabel(this.engine.steps)}`);

    // Splot coaches from below the block, sized by the group layout above —
    // only screens too short for a ≥52px mascot go without (reactions stay
    // null-safe everywhere he's poked). Tapping him is the same freebie squish
    // as the home screen.
    if (showSplot) {
      this.splot = new SplotMascot(this, left + blockW / 2, top + blockH + 8 + splotSz / 2, splotSz);
      this.splot.container.setDepth(5);
      this.splot.container.setInteractive(
        new Phaser.Geom.Circle(0, 0, splotSz * 0.5),
        Phaser.Geom.Circle.Contains,
      );
      this.splot.container.on('pointerdown', () => {
        this.splot?.playSquishAnim();
        this.splot?.setExpression('excited', 1200);
      });
    }
  }

  // Beige pill with centered pixel text — the Goal/Current labels and the
  // Time/Moves stat rows. Small-corner badge pieces, so any height ≥ 33 works.
  private buildPill(cx: number, cy: number, w: number, h: number, label: string): Phaser.GameObjects.Text {
    this.areaObjs.push(addBeigeBadge(this, cx, cy, w, h).setDepth(3));
    const fs = Math.max(8, Math.min(12, Math.round(h * 0.24), Math.floor(w / (Math.max(label.length, 9) * 1.05))));
    const text = this.add.text(cx, cy, label, {
      fontFamily: PIXEL_FONT, fontSize: `${fs}px`, color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(4);
    this.areaObjs.push(text);
    return text;
  }

  // Moves pill shows the star target too ("2/4" = two taps against a 4-step
  // optimum) — the star thresholds are all optimal-relative, so the target is
  // the single most decision-relevant number on the HUD.
  private stepsLabel(steps: number): string {
    const optimal = this.level?.optimalSteps;
    return optimal ? `${steps}/${optimal}` : `${steps}`;
  }

  private updateStepsDisplay() {
    this.stepsText?.setText(`Moves: ${this.stepsLabel(this.engine?.steps ?? 0)}`);
  }

  // ── Modifier palette — dark panel (right column in landscape, bottom sheet
  // in portrait) holding the logo and a 3-wide grid of beige tiles; unused
  // grid slots render as empty tiles, matching the design mock. ─────────────
  private buildPalette() {
    if (!this.level) return;
    this.paletteContainer?.destroy(true);

    const { width, height } = this.scale;
    const isPortrait = height > width;
    const r = this.paletteRect(width, height);

    const container = this.add.container(0, 0).setDepth(6);
    this.paletteContainer = container;

    container.add(addDarkPanel(this, r.x + r.w / 2, r.y + r.h / 2, r.w, r.h).setAlpha(0.96));

    // Logo header inside the panel (landscape only — portrait needs the room)
    let gridTop = r.y + 14;
    if (!isPortrait && this.textures.exists('title')) {
      const logoW = Math.min(r.w * 0.72, 190);
      const logoH = Math.round(logoW * 112 / 512);
      container.add(this.add.image(r.x + r.w / 2, r.y + 16 + logoH / 2, 'title').setDisplaySize(logoW, logoH));
      gridTop = r.y + 16 + logoH + 14;
    }

    this.paletteSlots = groupPalette(this.level.palette);
    const cols = 3, gap = 10, padX = 14;
    const availW = r.w - padX * 2;
    const availH = r.y + r.h - 12 - gridTop;
    const rowsNeeded = Math.max(1, Math.ceil(this.paletteSlots.length / cols));
    // Tiles shrink until every row fits — palettes are small enough (≤ ~9
    // grouped slots) that scrolling is never needed.
    let cell = Math.min(92, Math.floor((availW - gap * (cols - 1)) / cols));
    cell = Math.min(cell, Math.floor((availH - (rowsNeeded - 1) * gap) / rowsNeeded));
    cell = Math.max(44, cell);
    // Fill the panel with empty tiles below the real ones (the mock's look),
    // capped so tall windows don't stack a tower of blanks.
    const rowsFit = Math.floor((availH + gap) / (cell + gap));
    const rowsDrawn = Math.max(rowsNeeded, Math.min(rowsFit, Math.max(rowsNeeded, 4)));
    const gridW = cols * cell + (cols - 1) * gap;
    const gridLeft = r.x + (r.w - gridW) / 2;

    for (let i = 0; i < rowsDrawn * cols; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = gridLeft + col * (cell + gap) + cell / 2;
      const cy = gridTop + row * (cell + gap) + cell / 2;
      const slot = this.paletteSlots[i];
      if (slot) {
        container.add(this.buildPaletteSlot(cx, cy, cell, slot));
      } else {
        container.add(addBeigeBadge(this, cx, cy, cell, cell).setAlpha(0.5));
      }
    }
  }

  // One palette tile: a real beige button (shared shell = standard hover/press
  // feedback) with the modifier's icon. Worn stencils get a green ring + check;
  // broken goggles go dim with a cross badge and stop taking taps.
  private buildPaletteSlot(cx: number, cy: number, cell: number, slot: PaletteSlot): Phaser.GameObjects.Container {
    const onClick = () => {
      if (slot.kind === 'paint') {
        this.showColorPicker(slot.mods);
      } else if (slot.kind === 'pumpkin') {
        this.showPumpkinPicker(slot.mods);
      } else {
        this.applyModifier(slot.mod);
      }
    };
    const broken = slot.kind === 'single' && (this.engine?.isBroken(slot.mod) ?? false);
    const shell = addBeigeButtonShell(this, cx, cy, cell, cell, broken, broken ? undefined : onClick, true);
    const content: Phaser.GameObjects.GameObject[] = [];
    const iconSz = Math.round(cell * 0.5);
    let worn = false;

    if (slot.kind === 'paint') {
      // Just the pot — no color dots. Showing the palette's paint colors here
      // would hand the player the solution's color list for free.
      content.push(addDepthIcon(this, 0, 0, 'icon-paint', iconSz, iconSz));
    } else if (slot.kind === 'pumpkin') {
      // Worn check goes by mask id — the picker offers all three sizes, so the
      // worn one may not be a palette def at all.
      worn = (this.engine?.wornMaskIds ?? []).some((id) => id.startsWith('pumpkin-'));
      content.push(addDepthIcon(this, 0, -cell * 0.07, 'icon-pumpkin', iconSz, iconSz));
      content.push(this.add.text(0, cell * 0.27, '25 50 75', {
        fontFamily: PIXEL_FONT, fontSize: `${Math.max(6, Math.round(cell * 0.09))}px`, color: C.DARK_BROWN,
      }).setOrigin(0.5));
    } else {
      const mod = slot.mod;
      worn = this.engine?.isWorn(mod) ?? false;
      const icon = addDepthIcon(this, 0, 0, modIconKey(mod), iconSz, iconSz);
      if (broken) icon.setAlpha(0.35);
      content.push(icon);

      if (!broken && (isHorizontalVariant(mod) || isVerticalVariant(mod))) {
        const arrowSz = Math.round(cell * 0.20);
        const arrow = addDepthIcon(this, cell * 0.28, cell * 0.28, 'icon-arrow', arrowSz, arrowSz, 1, 0.4);
        (arrow.list[1] as Phaser.GameObjects.Image | undefined)?.setTint(0xFF5500);
        arrow.setAngle(isHorizontalVariant(mod) ? 0 : 90);
        content.push(arrow);
      }
    }

    if (worn) {
      content.push(this.add.rectangle(0, 0, cell - 8, cell - 8).setStrokeStyle(3, C.WORN_RING, 1));
      const badgeSz = Math.round(cell * 0.22);
      content.push(addDepthIcon(this, -cell * 0.30, -cell * 0.30, 'icon-check', badgeSz, badgeSz));
    }
    if (broken) {
      const badgeSz = Math.round(cell * 0.26);
      content.push(addDepthIcon(this, 0, 0, 'icon-cross', badgeSz, badgeSz));
    }

    shell.addContent(content);
    shell.container.setDepth(7);
    return shell.container;
  }

  // ── Colour picker popup ───────────────────────────────────────────────────
  // The pot always offers the full 16-color rack (plus any legacy palette
  // color outside it). Palette defs win their color slot, so stored levels'
  // exact action ids stay authoritative; catalog ids resolve in every replay
  // via slimeSim's standard-catalog fallback.
  private showColorPicker(paintMods: ModifierDef[]) {
    this.closeActivePopup();
    const { width, height } = this.scale;

    const byColor = new Map<string, ModifierDef>();
    for (const m of standardPaints()) byColor.set((m.color ?? BASE_COLOR).toUpperCase(), m);
    for (const m of paintMods) byColor.set((m.color ?? BASE_COLOR).toUpperCase(), m);
    const mods = [...byColor.values()];

    // Portrait stacks a 4-wide grid; landscape lays the rack 8 across.
    const COLS   = width > height ? 8 : 4;
    const ROWS   = Math.ceil(mods.length / COLS);
    const pad    = 14;
    const gap    = 8;
    const titleH = 36;
    const maxW   = Math.min(width - 24, COLS === 8 ? 620 : 320);
    let slotSz = Math.min(72, Math.floor((maxW - pad * 2 - gap * (COLS - 1)) / COLS));
    slotSz = Math.max(36, Math.min(slotSz,
      Math.floor((height - titleH - pad * 2 - (ROWS - 1) * gap - 40) / ROWS)));
    const popW = slotSz * COLS + gap * (COLS - 1) + pad * 2;
    const popH = titleH + pad + ROWS * (slotSz + gap) - gap + pad;

    const pcx = width  / 2;
    const pcy = height / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    // Full-screen dim overlay — tap outside the card to dismiss
    const overlay = this.add.rectangle(pcx, pcy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    // Popup card + title — the same beige-shell look as the menu popups
    items.push(addBeigeButtonShell(this, pcx, pcy, popW, Math.max(popH, 66), false).container);
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2 + 4, 'Pick a Color', {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const gridLeft = pcx - popW / 2 + pad;
    const gridTop  = pcy - popH / 2 + titleH + pad;
    const slimeSz  = Math.round(slotSz * 0.68);

    mods.forEach((mod, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const sx  = gridLeft + col * (slotSz + gap) + slotSz / 2;
      const sy  = gridTop  + row * (slotSz + gap) + slotSz / 2;
      const numCol = parseInt((mod.color ?? BASE_COLOR).replace('#', ''), 16);

      // Each swatch is a real small-corner beige button — shared hover/press
      // feedback for free, no hand-rolled scale tweens.
      const shell = addBeigeButtonShell(this, sx, sy, slotSz, slotSz, false, () => {
        this.closeActivePopup();
        this.applyModifier(mod);
      }, true);

      // Slime: shadow + color (with genuine overlay-blended shine) + border.
      // Body is baked (tint + genuine overlay-blended shine) into a texture rather
      // than tinted live — see overlayShine.ts for why a plain Phaser tint +
      // BlendModes.OVERLAY can't do this under WebGL. Keyed by hex so re-opening the
      // popup reuses the same generated texture instead of rebuilding it every time.
      const shadow = this.add.image(2, 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      // setTintFill() was removed in Phaser 4 — tint + FILL tint mode instead
      shadow.setTint(0x000000).setTintMode(Phaser.TintModes.FILL); shadow.setAlpha(0.28);
      const swatchShineKey = paintOverlayShine(
        this, `slime-shine-swatch-${numCol.toString(16)}`, 'slime-color', 'slime-shine', numCol, 0.5,
      );
      const slimeImg = this.add.image(0, 0, swatchShineKey).setDisplaySize(slimeSz, slimeSz);
      const border   = this.add.image(0, 0, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      shell.addContent([shadow, slimeImg, border]);
      items.push(shell.container);
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
  // Like the paint pot, the pumpkin tile always offers all three sizes —
  // palette defs win their id slot, catalog ids resolve in replay.
  private showPumpkinPicker(pumpkinMods: ModifierDef[]) {
    this.closeActivePopup();
    const { width, height } = this.scale;

    const byId = new Map<string, ModifierDef>();
    for (const m of standardPumpkins()) byId.set(m.id, m);
    for (const m of pumpkinMods) byId.set(m.id, m);
    const mods = [...byId.values()].sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0));

    const pad    = 14;
    const gap    = 10;
    const titleH = 36;
    const slotSz = Math.min(104, Math.floor(
      (Math.min(width - 24, 360) - pad * 2 - gap * (mods.length - 1)) / mods.length));
    const popW = slotSz * mods.length + gap * (mods.length - 1) + pad * 2;
    const popH = titleH + pad + slotSz + pad;
    const pcx  = width  / 2;
    const pcy  = height / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(pcx, pcy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);
    items.push(addBeigeButtonShell(this, pcx, pcy, popW, popH, false).container);
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2 + 4, 'Pumpkin size', {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const gridLeft = pcx - popW / 2 + pad;
    const tileY    = pcy - popH / 2 + titleH + pad + slotSz / 2;
    const slimeSz  = Math.round(slotSz * 0.56);

    mods.forEach((mod, i) => {
      const sx  = gridLeft + i * (slotSz + gap) + slotSz / 2;
      const cov = mod.coverage ?? 50;
      const worn = (this.engine?.wornMaskIds ?? []).includes(`pumpkin-${cov}`);

      const shell = addBeigeButtonShell(this, sx, tileY, slotSz, slotSz, false, () => {
        this.closeActivePopup();
        this.applyModifier(mod);
      }, true);

      const sh  = this.add.image(2, -slotSz * 0.08 + 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      sh.setTint(0x000000).setTintMode(Phaser.TintModes.FILL); sh.setAlpha(0.30);
      const sli = this.add.image(0, -slotSz * 0.08, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      const pum = this.add.image(0, -slotSz * 0.08, `mod-pumpkin-${cov}`).setDisplaySize(slimeSz, slimeSz);
      const brd = this.add.image(0, -slotSz * 0.08, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      const lbl = this.add.text(0, slotSz * 0.30, worn ? `${cov}% ON` : `${cov}%`, {
        fontFamily: PIXEL_FONT, fontSize: '8px', color: worn ? '#2E5C0A' : C.DARK_BROWN,
      }).setOrigin(0.5);
      shell.addContent([sh, sli, pum, brd, lbl]);
      if (worn) {
        shell.addContent([
          this.add.rectangle(0, 0, slotSz - 8, slotSz - 8).setStrokeStyle(3, C.WORN_RING, 1),
        ]);
      }
      items.push(shell.container);
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

  // ── Tutorial modal ─────────────────────────────────────────────────────────
  // Splot introduces the lesson ("Splash Course" levels carry a `tutorial`
  // string). The attempt timer is held until dismissal — see beginLevel().
  private showTutorialModal(text: string, onDismiss: () => void) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const popW = Math.min(width - 28, 330);

    // Measure the wrapped lesson text first so the card height fits it.
    const txt = this.add.text(0, 0, text, {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.DARK_BROWN,
      align: 'center', lineSpacing: 6,
      wordWrap: { width: popW - 36 },
    }).setOrigin(0.5, 0);

    const splotSz = 62;
    const btnH = 44;
    const popH = 20 + splotSz + 14 + txt.height + 16 + btnH + 16;
    const cx = width / 2;
    const cy = height / 2;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      this.closeActivePopup();
      onDismiss();
    };

    const items: Phaser.GameObjects.GameObject[] = [];
    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive();
    overlay.on('pointerup', dismiss);
    items.push(overlay);
    // Solid card, not addBeigeCard — that texture is ~80% transparent, and a
    // paragraph of lesson text needs an opaque face to stay readable.
    items.push(addBeigeSolidCard(this, cx, cy, popW, popH));

    const splot = new SplotMascot(this, cx, cy - popH / 2 + 20 + splotSz / 2, splotSz);
    splot.setExpression('excited');
    items.push(splot.container);

    txt.setPosition(cx, cy - popH / 2 + 20 + splotSz + 14);
    items.push(txt);

    items.push(addBeigeButton(this, {
      x: cx, y: cy + popH / 2 - 16 - btnH / 2, width: 150, height: btnH,
      label: 'Got it!', fontSize: 13, fontFamily: PIXELIFY, onClick: dismiss,
    }));

    this.activePopup = this.add.container(0, 0, items).setDepth(55);
    this.activePopup.setAlpha(0).setScale(0.92);
    this.tweens.add({
      targets: this.activePopup, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 220, ease: 'Back.easeOut',
    });
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
    const btn  = addBeigeButton(this, {
      x: 0, y: 59, width: 148, height: 44, label: 'Try Again',
      fontSize: 13, fontFamily: PIXELIFY, onClick: retry,
    }).setDepth(81);
    const panel = this.add.container(width / 2, height / 2, [bg, icon, txt, btn])
      .setDepth(80).setAlpha(0).setScale(0.96);
    this.tweens.add({ targets: panel, alpha: 1, scaleX: 1, scaleY: 1, duration: 220, ease: 'Back.easeOut' });
  }

  // ── Apply modifier ────────────────────────────────────────────────────────
  // Paints splash color over everything a worn stencil doesn't protect;
  // stencil tiles toggle on/off — except goggles, which snap off broken after
  // one splash lands on them. Every logged tap is a step.
  private applyModifier(mod: ModifierDef) {
    if (!this.engine || !this.currentRenderer || !this.level) return;
    const result = this.engine.applyModifier(mod);

    // Broken goggles refuse the tap — nothing was logged, no step spent.
    // The tile is disabled too; this guards the pickers and races.
    if (result.kind === 'broken') {
      this.showConflictPopup('Those goggles are broken — one splash was all they had!');
      this.splot?.setExpression('pain', 900);
      return;
    }

    this.currentRenderer.setPattern(this.level.palette, this.engine.actions);
    this.currentRenderer.playApplyAnim(this);
    if (result.kind === 'paint') {
      this.playModifierBurst(mod);
      this.splot?.playAppliedFlash();
      if (result.broke.length > 0 && !result.isWin) {
        this.showConflictPopup('The goggles snapped off — goggles break after one splash!');
        this.splot?.setExpression('shocked', 1200);
      }
    } else {
      this.splot?.setExpression(result.kind === 'wear' ? 'doubt' : 'excited', 900);
    }

    this.updateStepsDisplay();

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
    const goalPalette = this.level.palette;
    const goalActions = this.level.optimalSolution;
    const title = this.level.title;
    const t0 = Date.now();
    let sparks = 0, streakDays: number | undefined, firstSplat = false;
    try {
      const res = await fetch('/api/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json() as CompleteResponse;
        sparks = data.sparksEarned ?? 0;
        streakDays = data.streakDays;
        firstSplat = data.firstSplat === true;
      }
    } catch { /* best-effort */ }

    this.time.delayedCall(Math.max(0, 900 - (Date.now() - t0)), () => {
      this.goToScene('LevelComplete', {
        levelId: this.levelId, title, steps, timeMs: elapsed, stars, sparks, streakDays,
        nextLevelId: this.getNextLevelId(),
        actions: payload.actions,
        firstSplat, goalPalette, goalActions,
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
    const curated = getCuratedLevels();
    const idx = curated.findIndex(l => l.id === this.levelId);
    return idx >= 0 && idx < curated.length - 1 ? curated[idx + 1]!.id : null;
  }

  private showHint() {
    if (this.level?.hint) this.showConflictPopup(this.level.hint);
  }

  // Reset wipes the slime back to white but the RUN continues: moves made are
  // kept (the reset costs one more), and the clock keeps ticking.
  private handleReset() {
    if (!this.engine) return;
    this.engine.reset();
    this.currentRenderer?.setPattern(this.level?.palette ?? [], []);
    this.updateStepsDisplay();
    this.splot?.setExpression('squiggle', 900);
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
        this.timerText?.setText(`Time: ${label}`);
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
