import * as Phaser from 'phaser';
import { LevelEngine, calcStars } from '../engine/LevelEngine';
import {
  addBeigeBadge, addBeigeButton, addBeigeButtonShell, addBeigeSolidCard,
  addDarkPanel, addDepthIcon, BODY_FONT, PIXEL_FONT,
} from '../components/PixelUI';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import { paintOverlayShine } from '../components/overlayShine';
import type { EditorDraft } from './Editor';
import type { LevelData, ModifierDef } from '../../shared/types';
import type { CompleteRequest, CompleteResponse } from '../../shared/api';
import { getCuratedLevels } from '../../shared/levelData';
import { recordCompletion } from '../levelProgress';
import { BASE_COLOR, maskIdOf, MAX_WORN, standardPaints, standardPumpkins } from '../../shared/slimeSim';
import type { ActionKind } from '../../shared/slimeSim';
import { playSfx, startMusic } from '../audio';

// Tutorial modals ("Splash Course" levels) show once per page load per level —
// replaying a lesson or resetting it doesn't re-interrupt the player.
const tutorialShownThisSession = new Set<string>();

// The pumpkin swap explainer also shows once per page load — the first swap
// teaches the mechanic; every later one is self-evident from the slime.
let pumpkinSwapExplained = false;

const PIXELIFY = BODY_FONT;

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

// One-line behavior blurb per palette tile — shown as a tooltip on hover
// (desktop) or long-press (touch), so every tool explains itself without
// spending a move.
function slotTooltip(slot: PaletteSlot): string {
  if (slot.kind === 'paint') {
    return 'Paint Pot — splashes color over every spot no stencil protects. A splash also breaks worn goggles and grows a worn nose.';
  }
  if (slot.kind === 'pumpkin') {
    return 'Pumpkin — covers Splot from the top down (25 / 50 / 75%). Only one fits at a time; tapping another size swaps it in one move.';
  }
  switch (slot.mod.type) {
    case 'goggles':   return 'Goggles — stencil an eye band. FRAGILE: they snap off broken after protecting one splash.';
    case 'glasses':   return 'Glasses — tough eye-band stencil. Splashes never break them; take them off yourself.';
    case 'belt':      return 'Belt — stencils a straight band, thin or thick, sideways or upright.';
    case 'pendant':   return 'Pendant — stencils a chain and charm over Splot.';
    case 'underwear': return "Undies — stencil Splot's whole bottom half.";
    case 'nose':      return 'Nose — worn small; every splash grows it one size. A splash on the big nose pops it off.';
    case 'alpha':     return 'Alpha Dip — fades everything exposed to 75% opacity. One use per level, and it counts as a splash.';
    case 'bubble':    return 'Bubble — fades only its inner circle to 75%; the rim stays bold. Reusable, and gentle: not a splash.';
    case 'plate':     return 'Plate — big dish-shaped stencil.';
    case 'cone':      return 'Cone — big triangle stencil, wide at the top.';
    case 'scarf':     return 'Scarf — diagonal band stencil.';
    case 'pumpkin':   return 'Pumpkin — covers from the top down. Only one at a time; another size swaps.';
    case 'paint':     return 'Paint — splashes color on everything unprotected.';
  }
}

function modIconKey(scene: Phaser.Scene, mod: ModifierDef): string {
  if (mod.type === 'paint')     return 'icon-paint';
  if (mod.type === 'alpha')     return 'icon-paint';
  if (mod.type === 'pumpkin')   return 'icon-pumpkin';
  if (mod.type === 'underwear') return 'icon-underwear';
  if (mod.type === 'pendant')   return 'icon-pendant';
  if (mod.type === 'goggles')   return mod.variant?.includes('thin') ? 'icon-goggles-thin' : 'icon-goggles-thick';
  if (mod.type === 'glasses')   return mod.variant?.includes('thin') ? 'icon-glasses-thin' : 'icon-glasses-thick';
  if (mod.type === 'belt')      return mod.variant?.includes('thin') ? 'icon-belt-thin' : 'icon-belt-thick';
  // Newer mods: dedicated puzzle icons when the art has landed (reserved
  // slots — see Preloader's OPTIONAL_PUZZLE_ICONS), else the mod's own mask
  // art. icon-nose always resolves: a real file wins, otherwise the Preloader
  // bakes a zoomed mod-nose-big into the key (the raw art is a tiny speck).
  const pick = (icon: string, art: string) => (scene.textures.exists(icon) ? icon : art);
  if (mod.type === 'nose')      return 'icon-nose';
  if (mod.type === 'bubble')    return pick('icon-bubble', 'mod-bubble');
  if (mod.type === 'plate')     return pick('icon-plate', 'mod-plate');
  if (mod.type === 'cone')      return pick('icon-cone', 'mod-cone');
  if (mod.type === 'scarf')     return pick('icon-scarf', 'mod-scarf');
  return 'icon-sparkle';
}

// Short tile caption for tiles whose icon alone doesn't say what they do.
function singleTileLabel(mod: ModifierDef): string {
  if (mod.type === 'alpha')  return 'DIP';
  if (mod.type === 'bubble') return '75%';
  return '';
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
  // True when the home page's walkthrough button opened this level — the win
  // screen then chains through the first Splash Course lessons and back home.
  private isWalkthrough = false;
  // The creator's in-progress recording, carried through a Test Play preview so
  // both exits (win or back) restore the Editor instead of wiping it.
  private editorDraft: EditorDraft | null = null;
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
  // Screen position of each palette tile ('paint' / 'pumpkin' / mod id) — the
  // refusal cross (see showRefusalCross) needs to know WHERE the tapped tool
  // lives, including for taps that arrive via the color/pumpkin pickers.
  private slotPosById = new Map<string, { x: number; y: number; cell: number }>();
  // Loose game-area objects (cards, pills, pill texts) — tracked so the
  // resize rebuild can destroy them; orphaning them duplicates the play area.
  private areaObjs: Phaser.GameObjects.GameObject[] = [];

  private activePopup: Phaser.GameObjects.Container | null = null;
  // Set while the tutorial modal is up. Unlike the pickers (transient, safe
  // to close on resize), the tutorial must survive rotation — its dismissal
  // starts the attempt clock, so closing it on rotate would silently start
  // the timer while the player is still reading. onResize re-shows it at the
  // new size instead.
  private activeTutorial: { text: string; onDismiss: () => void } | null = null;
  private bgImages: Phaser.GameObjects.Image[] = [];

  // ── Guided lesson state ────────────────────────────────────────────────────
  // Splash Course levels carry a per-step `guide` script: guideStep is the
  // index of the NEXT expected optimalSolution action (-1 = not guided). The
  // expected tile glows, the coach panel narrates the step, and any other tap
  // is gently nudged back — except taps the sim would refuse anyway, which
  // fall through to the real refusal UX (lesson 2 invites trying a 4th wear).
  private guideStep = -1;
  private guidePanel: Phaser.GameObjects.Container | null = null;
  private guideHighlight: Phaser.GameObjects.Rectangle | null = null;
  private guideFlashTimer: Phaser.Time.TimerEvent | null = null;

  // Modifier tooltip (hover on desktop, long-press on touch)
  private modTooltip: Phaser.GameObjects.Container | null = null;
  private tooltipTimer: Phaser.Time.TimerEvent | null = null;
  private tooltipSticky = false;
  private suppressNextTileTap = false;

  constructor() { super('Game'); }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  init(data: { levelId?: string; previewData?: LevelData; editorDraft?: EditorDraft; walkthrough?: boolean }) {
    this.engine        = null;
    this.level         = data?.previewData ?? null;
    this.levelId       = data?.levelId ?? 'L01';
    this.isPreview     = !!data?.previewData;
    this.isWalkthrough = data?.walkthrough === true;
    this.editorDraft   = data?.editorDraft ?? null;
    this.winHandled    = false;
    this.navigating    = false;
    this.hudLayer      = null;
    this.loadToken    += 1;
    this.paletteSlots  = [];
    this.areaObjs      = [];
    this.activeTutorial = null;
    this.bgImages = [];
    this.guideStep = -1;
    this.guidePanel = null;
    this.guideHighlight = null;
    this.guideFlashTimer = null;
    this.modTooltip = null;
    this.tooltipTimer = null;
    this.suppressNextTileTap = false;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.HEADER_BG);
    this.cameras.main.fadeIn(300, 10, 5, 14);
    this.scale.on('resize', this.onResize, this);
    // Deep-linked level posts land here without passing MainMenu — the music
    // loop starts from whichever scene the player reaches first (no-op if on).
    startMusic();

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
      this.showLoadError("Today's Sqlot is unavailable.", () => this.scene.restart({ levelId: 'daily' }));
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
    // A lesson is guided when it ships a coach line for every solution step.
    const guide = this.level.guide;
    this.guideStep = !this.isPreview
      && Array.isArray(guide) && guide.length > 0
      && guide.length === this.level.optimalSolution.length ? 0 : -1;
    this.buildHUD();
    this.buildGameArea();
    this.buildPalette();

    // Dailies skew devious on purpose — they get to gloat about it.
    if (this.level.isDaily) playSfx('daily', { volume: 0.55 });

    const tutorial = this.level.tutorial;
    // The walkthrough exists to teach — its lesson modals always show, even
    // when a replayed lesson already used up its once-per-session slot.
    if (tutorial && (this.isWalkthrough || !tutorialShownThisSession.has(this.level.id))) {
      tutorialShownThisSession.add(this.level.id);
      this.showTutorialModal(tutorial, () => {
        // Fresh engine, NOT engine.reset(): reset is a logged, move-costing
        // action now — re-basing the attempt clock must not add one.
        if (this.level) this.engine = new LevelEngine(this.level);
        this.updateGuide();
        this.startTimer();
      });
    } else {
      this.updateGuide();
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
      // A missing level (404 — expired UGC, or a stale link) must say so, not
      // silently swap in the first tutorial level: the player arrived from a
      // "Beat u/x's level" post and would get a level that matches nothing on
      // it. Network failures get the same honest error, with a way onward.
      let fetched: LevelData | null = null;
      let gone = false;
      try {
        const res = await fetch(`/api/level/${id}`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) fetched = (await res.json() as { level: LevelData }).level;
        else gone = res.status === 404;
      } catch { /* fetched stays null → load error below */ }
      if (token !== this.loadToken) return;
      this.loadingText?.destroy();
      this.level = fetched;
      if (!this.level) {
        if (gone) {
          this.showLoadError('This level is gone — community levels retire after 90 days.',
            () => this.scene.start('LevelSelect'), 'Browse Levels');
        } else {
          this.showLoadError('Could not load this level.',
            () => this.scene.restart({ levelId: id }));
        }
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
      if (this.isPreview) {
        this.goToScene('Editor', this.editorDraft ? { draft: this.editorDraft } : undefined);
      } else if (this.isWalkthrough) {
        // The walkthrough came from home — back means home, not the world grid.
        this.goToScene('MainMenu');
      } else {
        this.goToScene('LevelSelect');
      }
    }));

    // Level title + context line. In-game the header identifies the puzzle
    // ("Orange Splash" / "World 1 · Level 1") — branding stays on the
    // splash/menu screens (and the landscape palette keeps its logo). Both
    // lines center in the gap the buttons actually leave — back on the left,
    // hint+reset on the right, like a standard app bar. Mirroring the wider
    // right side instead starved 320px screens down to ~7 characters.
    const hudLeftEdge  = 10 + HUD_BTN + 10;
    const hudRightEdge = width - (10 + HUD_BTN + 8 + HUD_BTN) - 10;
    const hudTextCX    = (hudLeftEdge + hudRightEdge) / 2;
    const hudTextMaxW  = Math.max(60, hudRightEdge - hudLeftEdge);
    const titleText = this.add.text(hudTextCX, HEADER_H / 2 - 8, this.level.title, {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: C.TEXT_LIGHT,
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(16);
    this.fitHudLine(titleText, this.level.title, hudTextMaxW);
    elements.push(titleText);
    const context = this.levelContextLabel();
    if (context) {
      // Secondary context line ("World 1 · Level 1"). Pixelify at 9px reads far
      // cleaner than the 6px display face it replaced.
      const ctxText = this.add.text(hudTextCX, HEADER_H / 2 + 13, context, {
        fontFamily: PIXELIFY, fontSize: '9px', color: '#B7A585',
      }).setOrigin(0.5).setDepth(16);
      this.fitHudLine(ctxText, context, hudTextMaxW);
      elements.push(ctxText);
    }

    // Hint + Reset in header right. Levels without a hint (dailies, the
    // expert worlds 10+) don't get a dead help button — reset stands alone.
    if (this.level.hint) {
      elements.push(this.hudIconButton(width - 10 - HUD_BTN - 8 - HUD_BTN / 2, HEADER_H / 2, 'icon-help', 0, () => this.showHint()));
    }
    elements.push(this.hudIconButton(width - 10 - HUD_BTN / 2, HEADER_H / 2, 'icon-reset', 0, () => this.handleReset()));

    this.hudLayer = this.add.container(0, 0, elements);
  }

  // Fits one HUD text line into maxW, measured for real instead of estimated
  // per-glyph: first drop to 8px (Press Start 2P is an 8px-native face, so it
  // stays crisp; Pixelify holds up too), then trim characters with a "..." tail
  // ("…" has no glyph in these faces).
  private fitHudLine(text: Phaser.GameObjects.Text, full: string, maxW: number) {
    if (text.width <= maxW) return;
    text.setFontSize(8);
    let keep = full.length;
    while (keep > 3 && text.width > maxW) {
      keep -= 1;
      text.setText(`${full.slice(0, keep).trimEnd()}...`);
    }
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
    if (level.isDaily) return 'Daily Sqlot';
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
        playSfx('squish');
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
    if (!this.stepsText) return;
    const label = `Moves: ${this.stepsLabel(this.engine?.steps ?? 0)}`;
    if (this.stepsText.text === label) return;
    this.stepsText.setText(label);
    // Micro-pop so the spent move registers without reading the number.
    this.tweens.killTweensOf(this.stepsText);
    this.stepsText.setScale(1);
    this.tweens.add({
      targets: this.stepsText, scaleX: 1.18, scaleY: 1.18,
      duration: 90, yoyo: true, ease: 'Quad.easeOut',
    });
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
    this.slotPosById.clear();
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
    this.slotPosById.set(
      slot.kind === 'single' ? slot.mod.id : slot.kind, { x: cx, y: cy, cell },
    );
    const onClick = () => {
      // A long-press that showed the tooltip is a question, not a move —
      // swallow the tap it rides in on.
      if (this.suppressNextTileTap) { this.suppressNextTileTap = false; return; }
      this.hideTooltip();
      if (slot.kind === 'paint') {
        this.showColorPicker(slot.mods);
      } else if (slot.kind === 'pumpkin') {
        this.showPumpkinPicker(slot.mods);
      } else {
        this.applyModifier(slot.mod);
      }
    };
    // A tile is disabled when its stencil broke (goggles) OR its one-shot was
    // spent (the alpha dip) — both refuse taps and show a cross.
    const single  = slot.kind === 'single' ? slot.mod : null;
    const broken  = single ? (this.engine?.isBroken(single) ?? false) : false;
    const spent   = single ? (this.engine?.isSpent(single) ?? false) : false;
    const disabled = broken || spent;
    const shell = addBeigeButtonShell(this, cx, cy, cell, cell, disabled, disabled ? undefined : onClick, true);

    // Tooltip triggers: a settled hover (mouse) or a held press (touch). The
    // press path arms suppressNextTileTap so releasing doesn't also act, and
    // its tooltip is STICKY — pointerout (which touch fires on release) must
    // not hide it before it can be read; it self-expires instead.
    if (!disabled) {
      const tip = slotTooltip(slot);
      shell.container.on('pointerover', () => this.armTooltip(tip, cx, cy, cell, 350, false));
      shell.container.on('pointerdown', () => this.armTooltip(tip, cx, cy, cell, 500, true));
      shell.container.on('pointerout', () => {
        this.tooltipTimer?.destroy();
        this.tooltipTimer = null;
        // A drag-off after the tooltip fired never reaches onClick — don't
        // leave the swallow flag armed for some future unrelated tap.
        this.suppressNextTileTap = false;
        if (!this.tooltipSticky) this.hideTooltip();
      });
      shell.container.on('pointerup', () => {
        this.tooltipTimer?.destroy();
        this.tooltipTimer = null;
      });
    }
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
      const label = singleTileLabel(mod);
      const icon = addDepthIcon(this, 0, label ? -cell * 0.08 : 0, modIconKey(this, mod), iconSz, iconSz);
      if (disabled) icon.setAlpha(0.35);
      content.push(icon);

      if (label) {
        content.push(this.add.text(0, cell * 0.30, label, {
          fontFamily: PIXEL_FONT, fontSize: `${Math.max(6, Math.round(cell * 0.11))}px`,
          color: disabled ? '#9A7A5A' : C.DARK_BROWN,
        }).setOrigin(0.5));
      }

      // Orientation arrow — h/v stencils, plus the scarf once its dedicated
      // (direction-neutral) icon is in use: one scarf icon serves both
      // diagonals, the arrow says which one. Current scarf art runs the
      // "right" diagonal; a future left variant flips the angle.
      const scarfArrow = mod.type === 'scarf' && this.textures.exists('icon-scarf');
      if (!disabled && (isHorizontalVariant(mod) || isVerticalVariant(mod) || scarfArrow)) {
        const arrowSz = Math.round(cell * 0.20);
        const arrow = addDepthIcon(this, cell * 0.28, cell * 0.28, 'icon-arrow', arrowSz, arrowSz, 1, 0.4);
        (arrow.list[1] as Phaser.GameObjects.Image | undefined)?.setTint(0xFF5500);
        arrow.setAngle(scarfArrow
          ? (mod.variant === 'left' ? 135 : -45)
          : (isHorizontalVariant(mod) ? 0 : 90));
        content.push(arrow);
      }
    }

    if (worn) {
      content.push(this.add.rectangle(0, 0, cell - 8, cell - 8).setStrokeStyle(3, C.WORN_RING, 1));
      const badgeSz = Math.round(cell * 0.22);
      content.push(addDepthIcon(this, -cell * 0.30, -cell * 0.30, 'icon-check', badgeSz, badgeSz));
      // The nose shows the size it has grown to (S / M / L).
      const nose = single && single.type === 'nose' ? this.engine?.noseSize() : null;
      if (nose) {
        content.push(this.add.text(cell * 0.30, -cell * 0.30, nose[0]!.toUpperCase(), {
          fontFamily: PIXEL_FONT, fontSize: `${Math.max(7, Math.round(cell * 0.16))}px`,
          color: '#1E3D08',
        }).setOrigin(0.5));
      }
    }
    if (disabled) {
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
    playSfx('menuIn');
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
    overlay.on('pointerup', () => { playSfx('menuOut'); this.closeActivePopup(); });
    items.push(overlay);

    // Popup card + title — the same beige-shell look as the menu popups
    items.push(addBeigeButtonShell(this, pcx, pcy, popW, Math.max(popH, 66), false).container);
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2 + 4, 'Pick a Color', {
      fontFamily: PIXELIFY, fontSize: '15px', fontStyle: 'bold', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const gridLeft = pcx - popW / 2 + pad;
    const gridTop  = pcy - popH / 2 + titleH + pad;
    const slimeSz  = Math.round(slotSz * 0.68);
    // Guided lesson: the scripted color glows inside the rack too.
    const guideTarget = this.guideStep >= 0 ? this.level?.optimalSolution[this.guideStep] : undefined;

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
      if (mod.id === guideTarget) {
        const ring = this.add.rectangle(sx, sy, slotSz + 6, slotSz + 6)
          .setStrokeStyle(4, 0xFFD700, 1);
        this.tweens.add({
          targets: ring, alpha: 0.35, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        items.push(ring);
      }
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
    playSfx('menuIn');
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
    overlay.on('pointerup', () => { playSfx('menuOut'); this.closeActivePopup(); });
    items.push(overlay);
    items.push(addBeigeButtonShell(this, pcx, pcy, popW, popH, false).container);
    // With a pumpkin already on, the title teaches the mechanic at the moment
    // it matters: tapping any other size swaps it in one move.
    const anyPumpkinWorn = (this.engine?.wornMaskIds ?? []).some((id) => id.startsWith('pumpkin-'));
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2 + 4, anyPumpkinWorn ? 'Tap a size to swap' : 'Pumpkin size', {
      fontFamily: PIXELIFY, fontSize: '15px', fontStyle: 'bold', color: C.DARK_BROWN,
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
      const brd = this.add.image(0, -slotSz * 0.08, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      // Pumpkin above the border — worn stencils sit ON the slime (same
      // layering as SlimeRenderer), so the outline must not cut across it.
      const pum = this.add.image(0, -slotSz * 0.08, `mod-pumpkin-${cov}`).setDisplaySize(slimeSz, slimeSz);
      // Worn size reads ON; while one is on, the other sizes read SWAP — the
      // pumpkin rule (one at a time, tap to trade) is visible right on the tiles.
      const lbl = this.add.text(0, slotSz * 0.30, worn ? `${cov}% ON` : anyPumpkinWorn ? `${cov}% SWAP` : `${cov}%`, {
        // #1E3D08, not the lighter #2E5C0A — this sits on the beige button
        // shell, where the lighter green was too close to it to read.
        fontFamily: PIXEL_FONT, fontSize: '8px', color: worn ? '#1E3D08' : C.DARK_BROWN,
      }).setOrigin(0.5);
      shell.addContent([sh, sli, brd, pum, lbl]);
      if (worn) {
        shell.addContent([
          this.add.rectangle(0, 0, slotSz - 8, slotSz - 8).setStrokeStyle(3, C.WORN_RING, 1),
        ]);
      }
      items.push(shell.container);
      // Guided lesson: the scripted size glows inside the picker too.
      if (this.guideStep >= 0 && this.level?.optimalSolution[this.guideStep] === mod.id) {
        const ring = this.add.rectangle(sx, tileY, slotSz + 6, slotSz + 6)
          .setStrokeStyle(4, 0xFFD700, 1);
        this.tweens.add({
          targets: ring, alpha: 0.35, duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
        items.push(ring);
      }
    });

    this.activePopup = this.add.container(0, 0, items).setDepth(50);
    this.tweens.add({ targets: this.activePopup, alpha: { from: 0, to: 1 }, duration: 150 });
  }

  // Sound: dismissals whoosh (menuOut) at their call sites — not here, where a
  // swatch pick would stack a whoosh onto the action sound that follows it.
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
    // Re-shown on resize/rotate with activeTutorial already set — only a
    // genuinely new modal gets the entrance whoosh.
    if (!this.activeTutorial) playSfx('menuIn');
    this.activeTutorial = { text, onDismiss };
    const { width, height } = this.scale;
    const popW = Math.min(width - 28, 330);

    // Measure the wrapped lesson text first so the card height fits it. A lesson
    // is body copy the player actually reads, so it uses Pixelify (rounder, far
    // more legible at size) rather than the blocky display face — the card height
    // is derived from txt.height below, so the taller lines fit automatically.
    const splotSz = 62;
    const btnH = 44;
    const txt = this.add.text(0, 0, text, {
      fontFamily: PIXELIFY, fontSize: '15px', color: C.DARK_BROWN,
      align: 'center', lineSpacing: 6,
      wordWrap: { width: popW - 36 },
    }).setOrigin(0.5, 0);
    // Short landscape viewports: step the body down before the card clips.
    if (20 + splotSz + 14 + txt.height + 16 + btnH + 16 > height - 12) {
      txt.setFontSize(13);
      txt.setLineSpacing(4);
    }
    const popH = 20 + splotSz + 14 + txt.height + 16 + btnH + 16;
    const cx = width / 2;
    const cy = height / 2;

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      playSfx('menuOut');
      this.activeTutorial = null;
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

  // ── Conflict / info popup ──────────────────────────────────────────────────
  // Transient message strip above the palette: refusals and snap-offs ('warn'),
  // hints and mechanic explainers ('info'). Body copy, so it speaks Pixelify at
  // a readable size — the panel grows to fit the wrapped text, and the hold
  // time scales with message length so long hints can actually be read.
  private showConflictPopup(message: string, tone: 'warn' | 'info' = 'warn') {
    // Guided lessons keep ONE message surface: refusals/snap-offs/hints flash
    // through the coach panel, then the step text returns.
    if (this.guideStep >= 0 && this.guidePanel) {
      this.guideFlash(message, tone === 'warn' ? '#FFB9B9' : '#F0E2C0');
      return;
    }
    this.conflictPopup?.destroy(true);
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const popY = isPortrait ? height * 0.82 : height * 0.88;
    const popW = Math.min(width - 24, 340);
    const txt  = this.add.text(width / 2 - popW / 2 + 40, popY, message, {
      fontFamily: PIXELIFY, fontSize: '13px', color: tone === 'warn' ? '#FFB9B9' : '#F0E2C0',
      wordWrap: { width: popW - 56 }, lineSpacing: 3,
    }).setOrigin(0, 0.5);
    const popH = Math.max(46, Math.ceil(txt.height) + 20);
    const bg   = addDarkPanel(this, width / 2, popY, popW, popH);
    const icon = this.add.image(width / 2 - popW / 2 + 23, popY, tone === 'warn' ? 'icon-warning' : 'icon-help')
      .setDisplaySize(19, 19);
    this.conflictPopup = this.add.container(0, 0, [bg, icon, txt]).setDepth(40).setAlpha(0);
    this.tweens.add({ targets: this.conflictPopup, alpha: 1, duration: 150 });
    this.time.delayedCall(Math.min(4500, 1800 + message.length * 28), () => {
      this.tweens.add({ targets: this.conflictPopup, alpha: 0, duration: 200,
        onComplete: () => this.conflictPopup?.destroy(true) });
    });
  }

  // ── Load error ─────────────────────────────────────────────────────────────
  private showLoadError(message: string, retry: () => void, buttonLabel = 'Try Again') {
    playSfx('lose', { volume: 0.6 });
    const { width, height } = this.scale;
    const panelW = Math.min(width - 40, 320);
    const bg   = addDarkPanel(this, 0, 0, panelW, 160).setDepth(80);
    const icon = this.add.image(0, -48, 'icon-warning').setDisplaySize(32, 32).setDepth(81);
    const txt  = this.add.text(0, -10, message, {
      fontFamily: PIXELIFY, fontSize: '14px', color: '#FFB9B9',
      align: 'center', wordWrap: { width: panelW - 36 }, lineSpacing: 3,
    }).setOrigin(0.5).setDepth(81);
    const btn  = addBeigeButton(this, {
      x: 0, y: 59, width: 148, height: 44, label: buttonLabel,
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
    // Once the level is won (or the scene is leaving), the win animation is
    // playing and the completion payload is already captured — a late tap during
    // that window would only glitch the slime mid-celebration, so ignore it.
    if (!this.engine || !this.currentRenderer || !this.level || this.winHandled || this.navigating) return;

    // Guided lesson gate: only the scripted next action goes through. Taps
    // the sim would refuse anyway fall through to the real refusal UX below —
    // a lesson may be inviting exactly that refusal (Full Outfit's "try a
    // fourth"), and the cross + reason teach more than a follow-the-glow nudge.
    if (this.guideStep >= 0
        && this.level.optimalSolution[this.guideStep] !== mod.id
        && !this.wouldBeRefused(mod)) {
      playSfx('nudge');
      this.guideNudge();
      return;
    }

    const result = this.engine.applyModifier(mod);

    // A refused tap (broken goggles / a spent one-shot / a wear the stacking
    // rules forbid) logs nothing and spends no step. The message says WHY and
    // the cross badge above the tapped tile says WHICH tool was refused.
    // (A different pumpkin size is never refused — it swaps, see below.)
    if (result.kind === 'broken') {
      let msg: string;
      if (mod.type === 'alpha') {
        msg = 'The alpha dip is used up. One dip per level!';
      } else if (this.engine.isBroken(mod)) {
        msg = 'Those goggles are broken. One splash was all they had!';
      } else {
        msg = `Splot can only wear ${MAX_WORN} things at once. Take something off!`;
      }
      playSfx('refuse');
      this.showConflictPopup(msg);
      this.showRefusalCross(mod);
      this.splot?.setExpression('pain', 900);
      return;
    }

    this.playActionSfx(mod, result.kind);
    this.currentRenderer.setPattern(this.level.palette, this.engine.actions);
    this.currentRenderer.playApplyAnim(this);
    if (result.kind === 'paint') {
      this.playModifierBurst(mod);
      this.splot?.playAppliedFlash();
      if (result.broke.length > 0 && !result.isWin) {
        // The snap-off gets physical feedback, not just words: the slime
        // recoils and the broken goggles visibly tumble off it.
        playSfx('breakOff');
        this.currentRenderer.playShakeAnim(this);
        this.playGoggleDropAnim(result.broke);
        this.showConflictPopup('The goggles snapped off. Goggles break after one splash!');
        this.splot?.setExpression('shocked', 1200);
      }
    } else if (result.kind === 'swap') {
      // One head-cover at a time: the new size replaced the worn one in a
      // single move. Say so the first time — after that the visual carries it.
      // (Guided lessons skip it: the coach script explains the swap itself.)
      this.splot?.setExpression('excited', 900);
      if (!pumpkinSwapExplained && this.guideStep < 0) {
        pumpkinSwapExplained = true;
        this.showConflictPopup('Pumpkin swapped! One fits at a time — tapping another size swaps it in one move.', 'info');
      }
    } else {
      this.splot?.setExpression(result.kind === 'wear' ? 'doubt' : 'excited', 900);
    }

    this.updateStepsDisplay();

    this.buildPalette();
    // The gate above means any action that lands in guided mode IS the
    // scripted one — advance the lesson to the next step.
    if (this.guideStep >= 0) this.guideStep += 1;
    this.updateGuide();
    if (result.isWin) void this.handleWin();
  }

  // The sound of an action that LANDED — keyed off what the sim said happened,
  // so it never disagrees with the visuals. Paint-like taps split by tool:
  // splash for paint, a glug for the alpha dip, a pop for the bubble.
  // ('broken' returned above; 'reset' can't come from a modifier tap.)
  private playActionSfx(mod: ModifierDef, kind: ActionKind) {
    if (kind === 'paint') {
      if (mod.type === 'alpha')       playSfx('dip');
      else if (mod.type === 'bubble') playSfx('bubble');
      else                            playSfx('splash');
    } else if (kind === 'swap' || (kind === 'wear' && mod.type === 'pumpkin')) {
      playSfx('pumpkin');
    } else if (kind === 'wear') {
      playSfx('wear');
    } else if (kind === 'remove') {
      playSfx('remove');
    }
  }

  // Exact mirror of the sim's refusal rules (applySimAction) — the guided
  // gate uses it to tell "off-script but legal" (nudge back) from "the sim
  // would refuse this anyway" (let the real refusal UX play out).
  private wouldBeRefused(mod: ModifierDef): boolean {
    if (!this.engine) return false;
    if (mod.type === 'paint' || mod.type === 'bubble') return false;
    if (mod.type === 'alpha') return this.engine.isSpent(mod);
    const worn = this.engine.wornMaskIds;
    if (mod.type === 'nose') {
      return !worn.some((id) => id.startsWith('nose-')) && worn.length >= MAX_WORN;
    }
    const maskId = maskIdOf(mod);
    if (maskId === null) return false;
    if (worn.includes(maskId)) return false; // toggle off — always allowed
    if (this.engine.isBroken(mod)) return true;
    // A different pumpkin size swaps in place — never refused.
    if (maskId.startsWith('pumpkin-') && worn.some((id) => id.startsWith('pumpkin-'))) return false;
    return worn.length >= MAX_WORN;
  }

  // A red cross pops up above the refused tool's palette tile and fades — the
  // conflict popup says why, this says where. Pumpkin/paint refusals arriving
  // via their pickers point at the group tile.
  private showRefusalCross(mod: ModifierDef) {
    const key = mod.type === 'paint' ? 'paint' : mod.type === 'pumpkin' ? 'pumpkin' : mod.id;
    const pos = this.slotPosById.get(key);
    if (!pos) return;
    const sz = Math.round(pos.cell * 0.34);
    const cross = addDepthIcon(this, pos.x, pos.y - pos.cell * 0.30, 'icon-cross', sz, sz)
      .setDepth(40).setAlpha(0);
    this.tweens.add({
      targets: cross, alpha: 1, y: pos.y - pos.cell * 0.62,
      duration: 160, ease: 'Quad.easeOut',
      onComplete: () => this.tweens.add({
        targets: cross, alpha: 0, duration: 320, delay: 420,
        onComplete: () => cross.destroy(),
      }),
    });
  }

  // ── Guided lesson rendering ────────────────────────────────────────────────
  // Rebuilds the coach panel + the glowing target ring for the current step.
  // Runs on step advance and after every palette rebuild (tile positions move).
  private updateGuide() {
    this.guideFlashTimer?.destroy();
    this.guideFlashTimer = null;
    this.guidePanel?.destroy(true);
    this.guidePanel = null;
    this.guideHighlight?.destroy();
    this.guideHighlight = null;
    // While the intro modal is up the lesson hasn't started; its dismissal
    // callback calls back in here.
    if (this.guideStep < 0 || !this.level || this.activeTutorial) return;
    const guide = this.level.guide;
    if (!guide || this.guideStep >= this.level.optimalSolution.length) return;

    // Glow the tile this step needs — group actions point at their group tile.
    const actionId = this.level.optimalSolution[this.guideStep]!;
    const key = actionId.startsWith('paint-') ? 'paint'
      : actionId.startsWith('pumpkin-') ? 'pumpkin'
      : actionId;
    const pos = this.slotPosById.get(key);
    if (pos) {
      const ring = this.add.rectangle(pos.x, pos.y, pos.cell + 6, pos.cell + 6)
        .setStrokeStyle(4, 0xFFD700, 1).setDepth(30);
      this.guideHighlight = ring;
      this.tweens.add({
        targets: ring, alpha: 0.35, scaleX: 1.06, scaleY: 1.06,
        duration: 520, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    this.buildGuidePanel(guide[this.guideStep]!, '#F0E2C0', true);
  }

  // The coach strip — the guided lesson's one message surface (refusals,
  // snap-offs and hints flash through it; the step text returns after).
  // Persistent, so it must never cover a palette tile: portrait docks it just
  // above the palette sheet, landscape centers it over the play area.
  private buildGuidePanel(message: string, color: string, showStep: boolean) {
    this.guidePanel?.destroy(true);
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const pal = this.paletteRect(width, height);
    const popW = Math.min((isPortrait ? width : pal.x - 14) - 24, 340);
    const popCx = isPortrait ? width / 2 : (pal.x - 14) / 2 + 14;
    const contentX = popCx - popW / 2 + 40;
    // The course is optional — a standing Skip lives on the panel's right
    // edge, so the text column ends before it.
    const skipW = 58;

    const txt = this.add.text(contentX, 0, message, {
      fontFamily: PIXELIFY, fontSize: '13px', color,
      wordWrap: { width: popW - 56 - skipW - 8 }, lineSpacing: 3,
    }).setOrigin(0, 0);
    const stepH = showStep ? 14 : 0;
    const contentH = stepH + txt.height;
    const popH = Math.max(46, contentH + 18);
    const popY = isPortrait ? pal.y - popH / 2 - 6 : height - 14 - popH / 2;
    const top = popY - contentH / 2;
    txt.setY(top + stepH);

    const items: Phaser.GameObjects.GameObject[] = [
      addDarkPanel(this, popCx, popY, popW, popH),
    ];
    const icon = this.add.image(popCx - popW / 2 + 23, popY, 'icon-sparkle')
      .setDisplaySize(18, 18).setTint(0xFFD700);
    items.push(icon);
    if (showStep && this.level) {
      items.push(this.add.text(contentX, top, `STEP ${this.guideStep + 1}/${this.level.optimalSolution.length}`, {
        fontFamily: PIXEL_FONT, fontSize: '8px', color: '#FFD700',
      }).setOrigin(0, 0));
    }
    items.push(txt);
    items.push(addBeigeButton(this, {
      x: popCx + popW / 2 - skipW / 2 - 8, y: popY, width: skipW, height: 36,
      label: 'Skip', fontSize: 11, fontFamily: PIXELIFY,
      onClick: () => this.skipCourse(),
    }));
    this.guidePanel = this.add.container(0, 0, items).setDepth(40);
  }

  // The guided course is optional — Skip drops the player where the real game
  // starts. The walkthrough came from home, so it returns there; otherwise
  // land on the World 1 page (never locked behind the lessons).
  private skipCourse() {
    playSfx('cancel');
    this.closeActivePopup();
    if (this.isWalkthrough) this.goToScene('MainMenu');
    else this.goToScene('LevelSelect', { world: 1 });
  }

  // Off-script (but legal) tap: wiggle the glow, flash a nudge, keep the step.
  private guideNudge() {
    this.splot?.setExpression('doubt', 800);
    if (this.guideHighlight) {
      this.tweens.add({ targets: this.guideHighlight, x: '+=5', duration: 45, yoyo: true, repeat: 3 });
    }
    this.guideFlash('Not that one yet — follow the glowing tile!', '#FFB9B9');
  }

  // Temporarily replaces the coach text (nudges, refusals, hints), then
  // restores the step text once it has been read.
  private guideFlash(message: string, color: string) {
    this.buildGuidePanel(message, color, false);
    this.guideFlashTimer?.destroy();
    this.guideFlashTimer = this.time.delayedCall(
      Math.min(4000, 1400 + message.length * 24), () => this.updateGuide(),
    );
  }

  // ── Modifier tooltip (hover / long-press) ─────────────────────────────────
  // `fromPress` marks the long-press path: showing the tooltip arms
  // suppressNextTileTap so the release doesn't also fire the tile's action.
  private armTooltip(text: string, x: number, y: number, cell: number, delay: number, fromPress: boolean) {
    this.tooltipTimer?.destroy();
    this.tooltipTimer = this.time.delayedCall(delay, () => {
      if (fromPress) this.suppressNextTileTap = true;
      this.showModTooltip(text, x, y, cell);
      this.tooltipSticky = fromPress;
    });
  }

  private hideTooltip() {
    this.tooltipTimer?.destroy();
    this.tooltipTimer = null;
    this.tooltipSticky = false;
    this.modTooltip?.destroy(true);
    this.modTooltip = null;
  }

  private showModTooltip(text: string, x: number, y: number, cell: number) {
    this.modTooltip?.destroy(true);
    const { width } = this.scale;
    const maxW = Math.min(260, width - 20);
    const txt = this.add.text(0, 0, text, {
      fontFamily: PIXELIFY, fontSize: '12px', color: '#F5EAD0',
      wordWrap: { width: maxW - 24 }, lineSpacing: 2, align: 'center',
    }).setOrigin(0.5);
    const w = Math.min(maxW, Math.ceil(txt.width) + 24);
    const h = Math.ceil(txt.height) + 18;
    // Above the tile, clamped on-screen — small screens nudge it inward
    // rather than shrinking the (readable) text.
    const tx = Phaser.Math.Clamp(x, w / 2 + 6, width - w / 2 - 6);
    const ty = Math.max(h / 2 + 6, y - cell / 2 - h / 2 - 10);
    const tip = this.add.container(tx, ty, [addDarkPanel(this, 0, 0, w, h), txt])
      .setDepth(45).setAlpha(0);
    this.modTooltip = tip;
    this.tweens.add({ targets: tip, alpha: 1, duration: 120 });
    // Self-expire (long-press has no pointerout to dismiss it)
    this.time.delayedCall(3200, () => { if (this.modTooltip === tip) this.hideTooltip(); });
  }

  // Broken goggles tumble off the slime — they fall, spin, shrink and fade.
  // Purely presentational: the sim already moved them to `broken`.
  private playGoggleDropAnim(broken: readonly string[]) {
    if (!this.currentRenderer) return;
    const { x, y } = this.currentRenderer.container;
    const sz = this.currentRenderer.displaySize;
    for (const maskId of broken) {
      const key = `mod-${maskId}`;
      if (!this.textures.exists(key)) continue;
      const img = this.add.image(x, y, key).setDisplaySize(sz, sz).setDepth(31).setAlpha(0.95);
      this.tweens.add({
        targets: img,
        y: y + sz * 0.55,
        angle: Phaser.Math.Between(-32, 32),
        alpha: 0,
        scaleX: img.scaleX * 0.82,
        scaleY: img.scaleY * 0.82,
        duration: 460, ease: 'Quad.easeIn',
        onComplete: () => img.destroy(),
      });
    }
  }

  // ── Win logic ─────────────────────────────────────────────────────────────
  private playModifierBurst(mod: ModifierDef) {
    if (!this.currentRenderer) return;
    const origin = this.currentRenderer.container;
    const iconKey = modIconKey(this, mod);
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
    playSfx('win');

    const elapsed = this.engine.elapsedMs();
    const steps   = this.engine.steps;
    const stars   = calcStars(steps, this.level.optimalSteps);
    // Into the session progress cache immediately — LevelSelect renders from
    // it, and the next level must show unlocked without waiting on a refetch.
    recordCompletion(this.levelId, stars);

    this.currentRenderer?.playWinAnim(this);
    this.splot?.playWin();

    if (this.isPreview) {
      this.time.delayedCall(900, () => this.goToScene(
        'Editor', this.editorDraft ? { draft: this.editorDraft } : undefined, 300, 320));
      return;
    }

    const payload: CompleteRequest = { levelId: this.levelId, timeMs: elapsed, actions: this.engine.actions };
    const goalPalette = this.level.palette;
    const goalActions = this.level.optimalSolution;
    const title = this.level.title;
    const t0 = Date.now();
    let sparks = 0, streakDays: number | undefined, firstSplat = false;
    // The win animation masks the POST's typical latency; if the request
    // outlives it (slow connection, 4s cap), say what the wait is for
    // instead of freezing silently between the anim and the results screen.
    const saving: { txt: Phaser.GameObjects.Text | null } = { txt: null };
    const savingTimer = this.time.delayedCall(1100, () => {
      saving.txt = this.add.text(this.scale.width / 2, this.scale.height - 28, 'Tallying your Sparks...', {
        fontFamily: PIXEL_FONT, fontSize: '10px', color: C.TEXT_BEIGE,
      }).setOrigin(0.5).setDepth(40);
      this.tweens.add({ targets: saving.txt, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
    });
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
    savingTimer.remove(false);
    if (saving.txt) {
      this.tweens.killTweensOf(saving.txt);
      saving.txt.destroy();
    }

    this.time.delayedCall(Math.max(0, 900 - (Date.now() - t0)), () => {
      this.goToScene('LevelComplete', {
        levelId: this.levelId, title, steps, timeMs: elapsed, stars, sparks, streakDays,
        nextLevelId: this.getNextLevelId(),
        actions: payload.actions,
        firstSplat, goalPalette, goalActions,
        walkthrough: this.isWalkthrough,
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
    if (this.level?.hint) this.showConflictPopup(this.level.hint, 'info');
  }

  // Reset wipes the slime back to white but the RUN continues: moves made are
  // kept (the reset costs one more), and the clock keeps ticking.
  private handleReset() {
    if (!this.engine) return;
    playSfx('reset');
    this.engine.reset();
    this.currentRenderer?.setPattern(this.level?.palette ?? [], []);
    this.updateStepsDisplay();
    this.splot?.setExpression('squiggle', 900);
    this.buildPalette();
    // A guided lesson restarts its script — the slime is bare again, so the
    // remaining steps would no longer produce the goal from here.
    if (this.guideStep >= 0) this.guideStep = 0;
    this.updateGuide();
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
    this.hideTooltip();
    if (this.engine) {
      this.buildHUD();
      this.buildGameArea();
      this.buildPalette();
      // Tile positions moved — re-anchor the coach panel and target glow.
      this.updateGuide();
    }
    // Popups are laid out for the old viewport: re-show the tutorial modal at
    // the new size (closing it would start the attempt clock mid-read); the
    // pickers just close — they're a transient choice, same as MainMenu/Shop.
    if (this.activeTutorial) {
      this.showTutorialModal(this.activeTutorial.text, this.activeTutorial.onDismiss);
    } else {
      this.closeActivePopup();
    }
  }

  shutdown() {
    this.navigating = true; // belt-and-suspenders: block any late goToScene() call
    this.timerEvent?.destroy();
    this.scale.off('resize', this.onResize, this);
    this.closeActivePopup();
    this.hideTooltip();
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
