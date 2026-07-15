import * as Phaser from 'phaser';
import { showLoginPrompt } from '@devvit/web/client';
import { playSfx, streamAudio } from '../audio';
import { isFitCheckPost } from '../launch';
import { SplotMascot } from '../components/SplotMascot';
import {
  addBeigeButton, addBeigeButtonShell, addBeigeCard, addBeigeSolidCard, addDarkPanel, addDepthIcon, addPanel9,
  applyRectClip, BODY_FONT, headingTextStyle, PIXEL_FONT,
} from '../components/PixelUI';
import { SHOP_ITEMS } from '../../shared/shop';
import type { ShopCategory, ShopItem } from '../../shared/shop';
import { ROYAL_TIER_ITEM_ID } from '../../shared/flair';
import type { BuyResponse, EquipResponse, ProfileResponse, ShareFitRequest } from '../../shared/api';
import { DEFERRED_IMG } from './Preloader';

const PIXELIFY = BODY_FONT;
// Press Start 2P's numerals stay legible at small sizes (Pixelify's "5" reads
// ambiguously) — used for every text run that's purely digits (prices, the
// sparks counter). Labels/words stay in PIXELIFY.
const NUM_FONT = PIXEL_FONT;

const C = {
  BG:        0x232323,
  TEXT_DARK: '#3A1A08',
  TEXT_DIM:  '#8a7a6a',
  TEXT_WARM: '#40301F',     // muted brown that stays legible on the beige/terracotta panels
                            // (was #75604C — too close in luminance to both surfaces to read)
  TEXT_BEIGE:'#DEC998',
  GOLD:      '#FFD700',
  GOLD_NUM:  0xFFD700,
  RED:       '#ff5555',     // toasts on dark backgrounds
  RED_DEEP:  '#C62828',     // "can't afford" prices on beige — #ff5555 washed out
  GREEN:     '#6DD400',
  GREEN_DARK:'#1E3D08',     // "equipped"/active-tab text on beige — darkened from #2E5C0A, which was too light to read there
  PLATE_EQUIP: 0x9FD060,    // green slot plate marks the equipped card
  // Selected-but-unowned card ring, drawn as a stroke-only rectangle rather
  // than a tint — Phaser tint is multiplicative, so tinting the warm beige
  // card texture can only darken it, which read as a muddy orange instead
  // of an actual highlight.
  BORDER_SELECTED: 0xFFD700,
} as const;

// Order drives both tab render order and default active category (first = default).
const CATEGORIES: ShopCategory[] = ['brows', 'eyes', 'mouth', 'accessories', 'colors'];
const CAT_LABELS: Record<ShopCategory, string> = {
  eyes: 'Eyes',
  mouth: 'Mouths',
  brows: 'Brows',
  accessories: 'Extras',
  colors: 'Colors',
};
type Rect = { x: number; y: number; w: number; h: number };

type CardRecord = {
  cx: number; cy: number; w: number; h: number;
  item: ShopItem; owned: boolean; equipped: boolean;
  container: Phaser.GameObjects.Container;
};

type DragState = {
  active: boolean;
  startPointerY: number;
  startOffset: number;
  moved: number;
  downRecord: CardRecord | null;
};

// Session cache of the profile fetch — repeat Shop visits render instantly
// with last-known sparks/inventory while a background refetch corrects them;
// only the very first visit blocks its render on the network.
let profileCache: {
  sparks: number;
  unlockedItems: string[];
  equippedItems: Record<string, string>;
} | null = null;

export class Shop extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private uiLayer: Phaser.GameObjects.Container | null = null;
  private splot: SplotMascot | null = null;
  private activeCategory: ShopCategory = CATEGORIES[0]!;
  private sparks = 0;
  private unlockedItems: Set<string> = new Set();
  private equippedItems: Record<string, string> = {};
  private sparksText: Phaser.GameObjects.Text | null = null;
  private pendingItemIds: Set<string> = new Set();

  // Toasts are absolutely positioned at build time and never repositioned —
  // a resize while one is still visible (e.g. rotating the device) would
  // otherwise leave it floating at stale coordinates from the old layout.
  private activeToasts: Phaser.GameObjects.Container[] = [];

  // Currently selected item — set on every card tap. Owned items equip on tap;
  // unowned items stay "armed" (previewed on Splot + Buy CTA in the detail
  // panel) until bought, deselected, or another item is tapped.
  private selectedItemId: string | null = null;
  private activePopup: Phaser.GameObjects.Container | null = null;

  // Fit Check Friday share — guards the POST against double-taps.
  private fitBusy = false;
  // True only when the game was opened ON a live Fit Check post (postData
  // carries the week). The "Fit Check" button is hidden otherwise, and the
  // server rejects fits posted from anywhere else, so a fit can only be dropped
  // on the thread it belongs to.
  private onFitCheckPost = false;
  // DOM <input> overlays for the fit compose popup (caption + photo URL) —
  // not Phaser objects, so they're tracked here and torn down explicitly on
  // popup close / resize / shutdown.
  private fitInputs: HTMLInputElement[] = [];

  // Guards every scene.start(...) call — prevents double-tapping the home
  // button, and gates buyItem/equipItem's async continuations from rebuilding
  // the UI after the player has already navigated away mid-request.
  private navigating = false;
  // Debounces the heavy relayout during continuous RESIZE events (window drag).
  private resizeRebuild: Phaser.Time.TimerEvent | null = null;

  // Geometry-mask source for the scroll viewport — not part of the display list,
  // so it must be destroyed manually on every rebuild.
  private scrollMaskGfx: Phaser.GameObjects.Graphics | null = null;

  // Scrollable item grid state
  private scrollContainer: Phaser.GameObjects.Container | null = null;
  private scrollThumb: Phaser.GameObjects.Rectangle | null = null;
  private scrollTrack: Phaser.GameObjects.Rectangle | null = null;
  private scrollViewport: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private scrollMaxOffset = 0;
  private cardRects: CardRecord[] = [];

  // Selecting/equipping any item rebuilds the whole UI (buildUI destroys and
  // recreates the scroll grid from scratch), which used to always reopen at
  // the top — scrolling down, then tapping an item down there, threw you back
  // to the top instead of showing the state change you just made. Keyed by
  // category so switching tabs still starts fresh, but rebuilding for the
  // SAME category (equip, buy, resize) restores where you were.
  private scrollOffsetByCategory: Partial<Record<ShopCategory, number>> = {};
  private dragState: DragState = { active: false, startPointerY: 0, startOffset: 0, moved: 0, downRecord: null };

  private onPointerMoveBound = (p: Phaser.Input.Pointer) => this.onGlobalPointerMove(p);
  private onPointerUpBound = (p: Phaser.Input.Pointer) => this.onGlobalPointerUp(p);
  private onWheelBound = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.onWheel(p, dy);

  constructor() { super('Shop'); }

  init() {
    this.bgLayers = [];
    this.uiLayer = null;
    this.splot = null;
    this.activeCategory = CATEGORIES[0]!;
    this.sparks = 0;
    this.unlockedItems = new Set();
    this.equippedItems = {};
    this.sparksText = null;
    this.pendingItemIds = new Set();
    this.activeToasts = [];
    this.selectedItemId = null;
    this.activePopup = null;
    this.fitBusy = false;
    this.onFitCheckPost = false;
    this.fitInputs = [];
    this.navigating = false;
    this.scrollMaskGfx = null;
    this.scrollContainer = null;
    this.scrollThumb = null;
    this.scrollTrack = null;
    this.scrollViewport = { x: 0, y: 0, w: 0, h: 0 };
    this.scrollMaxOffset = 0;
    this.cardRects = [];
    this.scrollOffsetByCategory = {};
    this.dragState = { active: false, startPointerY: 0, startOffset: 0, moved: 0, downRecord: null };
  }

  // Safety net for the deferred background set — normally MainMenu has already
  // streamed it in the background and this queues nothing.
  preload() {
    this.load.setPath('assets');
    for (const { key, path } of DEFERRED_IMG) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
  }

  async create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(400, 10, 5, 14);
    this.onFitCheckPost = isFitCheckPost();
    // The Shop can be the very first scene on a Fit Check post (Preloader routes
    // straight here), so kick off the deferred audio stream the menu usually
    // owns — idempotent, no-ops once everything is already cached.
    streamAudio(this);

    this.input.on('pointermove', this.onPointerMoveBound);
    this.input.on('pointerup', this.onPointerUpBound);
    this.input.on('wheel', this.onWheelBound);

    this.buildBackground();
    // Repeat visits render instantly from the session cache (a background
    // refetch corrects it). Only the very first visit blocks its render on
    // the profile (capped at 2.5s), with a pulsing label so the bare clouds
    // don't read as a hang.
    if (profileCache) {
      this.sparks = profileCache.sparks;
      this.unlockedItems = new Set(profileCache.unlockedItems);
      this.equippedItems = { ...profileCache.equippedItems };
      void this.refreshProfileInBackground();
    } else {
      const loading = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Loading shop...', {
        fontFamily: PIXELIFY, fontSize: '16px', color: '#FFF6DF',
        stroke: '#3A1A08', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(30);
      this.tweens.add({ targets: loading, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });
      await this.loadProfile();
      this.tweens.killTweensOf(loading);
      loading.destroy();
    }

    this.buildUI();
    this.scale.on('resize', this.onResize, this);
  }

  private async loadProfile() {
    try {
      // create() blocks the Shop's first render on this — cap it so a hung
      // connection opens the Shop with offline defaults after 2.5s, not never.
      const res = await fetch('/api/user/profile', { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const data: ProfileResponse = await res.json();
        this.sparks = data.sparks ?? 0;
        this.unlockedItems = new Set(data.unlockedItems ?? []);
        this.equippedItems = data.equippedItems ?? {};
        this.storeProfileCache();
      }
    } catch { /* offline fallback */ }
  }

  // Cached render path: refetch behind the visible screen; rebuild only when
  // something changed AND no popup is up (a rebuild would yank it away).
  private async refreshProfileInBackground() {
    const before = JSON.stringify(profileCache);
    await this.loadProfile();
    if (this.navigating || !this.sys.isActive()) return;
    if (JSON.stringify(profileCache) !== before && !this.activePopup) this.buildUI();
  }

  private storeProfileCache() {
    profileCache = {
      sparks: this.sparks,
      unlockedItems: [...this.unlockedItems],
      equippedItems: { ...this.equippedItems },
    };
  }

  // ── Background — full-canvas drifting pink-cloud layers, same technique as
  // MainMenu/LevelSelect (cover-scale + alternating drift, no masking) ──────
  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg2-1', 'bg2-2', 'bg2-3', 'bg2-4'];
    const alphas = [1, 0.80, 0.55, 0.30];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.3).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
      this.startBgDrift(img, i, width);
    });
  }

  private startBgDrift(img: Phaser.GameObjects.Image, index: number, width: number) {
    const dir = index % 2 === 0 ? 1 : -1;
    this.tweens.add({
      targets: img,
      x: width / 2 + dir * 18,
      duration: 13000 + index * 3500,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private repositionBgLayers(width: number, height: number) {
    this.bgLayers.forEach((img, i) => {
      this.tweens.killTweensOf(img);
      img.setPosition(width / 2, height / 2);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.startBgDrift(img, i, width);
    });
  }

  // ── Scene structure ─────────────────────────────────────────────────────

  private buildUI() {
    this.splot?.stopIdleAnims();
    this.splot = null;
    this.uiLayer?.destroy(true);
    this.activePopup?.destroy(true);
    this.activePopup = null;
    this.scrollMaskGfx?.destroy();
    this.scrollMaskGfx = null;
    this.scrollContainer = null;
    this.scrollThumb = null;
    this.scrollTrack = null;
    this.cardRects = [];
    this.sparksText = null;
    // A rebuild can land mid-gesture (async equip/buy continuations) — clear the
    // drag state so a pointerup after the rebuild can't act on a card record
    // whose container was just destroyed.
    this.dragState = { active: false, startPointerY: 0, startOffset: 0, moved: 0, downRecord: null };

    const { width, height } = this.scale;
    const els: Phaser.GameObjects.GameObject[] = [];

    if (height > width) {
      this.buildPortraitLayout(width, height, els);
    } else {
      this.buildLandscapeLayout(width, height, els);
    }

    this.uiLayer = this.add.container(0, 0, els);
  }

  private selectedItem(): ShopItem | null {
    if (!this.selectedItemId) return null;
    return SHOP_ITEMS.find(it => it.id === this.selectedItemId) ?? null;
  }

  // Free items (the default color) are owned by everyone without ever being
  // purchased, so they're never in the server-persisted unlocked set.
  private isOwned(item: ShopItem): boolean {
    return item.price === 0 || this.unlockedItems.has(item.id);
  }

  // What Splot wears right now: equipped items, plus the armed (selected but
  // unowned) item layered on top so try-ons survive UI rebuilds instead of
  // vanishing the moment the pointer lifts.
  private previewedEquipment(): Record<string, string> {
    const sel = this.selectedItem();
    if (sel && !this.isOwned(sel)) {
      return { ...this.equippedItems, [sel.slot]: sel.id };
    }
    return this.equippedItems;
  }

  // ── Landscape: left beige panel (Splot preview + item detail card + CTA) and
  // a right dark column with header row, icon tabs, and the scrollable grid ──
  private buildLandscapeLayout(w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const pad = 24;
    const splitX = Math.round(w * 0.40);
    const rightW = w - splitX;

    // Left panel — Splot preview on top, item details + CTA below
    const panelW = splitX - pad;
    const panelH = h - pad * 2;
    els.push(addPanel9(this, splitX / 2, h / 2, panelW, panelH).setDepth(3));
    const splotSz = Math.min(panelW * 0.66, panelH * 0.48, 400);
    this.spawnSplot(splitX / 2, pad + panelH * 0.30, splotSz, els);
    // Fit Check share sits right under the mascot it shows off, in the gap
    // between the preview and the detail card. Only on a live Fit Check post,
    // and only when the short landscape window actually leaves a gap (skip it
    // rather than overlap — the button stays available on every taller layout).
    const fitY = pad + panelH * 0.30 + splotSz / 2 + 32;
    const detailTop = pad + panelH * 0.58;
    if (this.onFitCheckPost && fitY + 24 <= detailTop - 6) {
      this.buildFitButton(splitX / 2, fitY, Math.min(170, panelW * 0.6), els);
    }
    this.buildDetailArea(splitX / 2, pad + panelH * 0.76, panelW * 0.84, panelH * 0.36, els);

    // Header row: home — SHOP title — sparks pill
    const headerH = Math.max(52, Math.min(84, Math.round(h * 0.105)));
    const headerY = pad + headerH / 2;
    this.buildHeaderRow(splitX + pad, w - pad, headerY, headerH, els);

    // Category tabs — single icon+label row spanning the right column
    const tabGap = 10;
    const tabW = (rightW - pad * 2 - tabGap * (CATEGORIES.length - 1)) / CATEGORIES.length;
    const tabH = Math.max(54, Math.min(88, Math.round(h * 0.11)));
    const tabsTop = headerY + headerH / 2 + 14;
    const tabRects: Rect[] = CATEGORIES.map((_, i) => ({
      x: splitX + pad + tabW / 2 + i * (tabW + tabGap), y: tabsTop + tabH / 2, w: tabW, h: tabH,
    }));
    this.buildCategoryTabs(tabRects, els);

    // Scrollable item grid fills the rest of the column
    const gridTop = tabsTop + tabH + 14;
    const gridX = splitX + pad;
    const gridW = rightW - pad * 2;
    const gridH = Math.max(80, h - gridTop - pad);
    // Most categories hold 3–5 items — fewer, larger cards showcase the art
    // better than a wide grid of small ones. Colors holds 30 plain swatches,
    // which read fine smaller, so it gets a denser grid instead of 10 rows
    // of mostly-scrolled-past cards.
    const isColors = this.activeCategory === 'colors';
    const cols = this.computeCols(gridW, isColors ? 110 : 200, isColors ? 14 : 20, isColors ? 5 : 3);
    this.buildScrollGrid(gridX, gridTop, gridW, gridH, cols, els);
  }

  // ── Portrait: header row on top, then a wide preview panel with Splot on the
  // left half and item details + CTA on the right half, one icon tab row, and
  // the scrollable grid below ────────────────────────────────────────────────
  private buildPortraitLayout(w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const pad = 12;

    // Header row: home — SHOP title — sparks pill
    const headerH = Math.max(48, Math.min(72, Math.round(h * 0.08)));
    const headerY = pad + headerH / 2;
    this.buildHeaderRow(pad, w - pad, headerY, headerH, els);

    // Preview panel: Splot left, details right
    const panelW = w - pad * 2;
    const panelH = Math.min(h * 0.30, 320);
    const panelY = headerY + headerH / 2 + 10 + panelH / 2;
    els.push(addPanel9(this, w / 2, panelY, panelW, panelH).setDepth(3));

    const splotSz = Math.min(panelH * 0.76, panelW * 0.40, 300);
    this.spawnSplot(pad + panelW * 0.27, panelY + panelH * 0.02, splotSz, els);
    // Fit Check share tucked under the mascot, inside the preview panel — only
    // on a live Fit Check post. Width capped by the Splot half of the panel so
    // it can't reach into the detail area on narrow phones.
    if (this.onFitCheckPost) {
      this.buildFitButton(pad + panelW * 0.27, panelY + panelH / 2 - 26, Math.min(150, panelW * 0.44), els);
    }
    this.buildDetailArea(pad + panelW * 0.72, panelY, panelW * 0.50, panelH - 26, els);

    // Category tabs — one row spanning all categories
    const tabsTop = panelY + panelH / 2 + 12;
    const tabGap = 8;
    const tabW = (panelW - tabGap * (CATEGORIES.length - 1)) / CATEGORIES.length;
    const tabH = Math.max(50, Math.min(80, Math.round(h * 0.085)));
    const tabRects: Rect[] = CATEGORIES.map((_, i) => ({
      x: pad + tabW / 2 + i * (tabW + tabGap), y: tabsTop + tabH / 2, w: tabW, h: tabH,
    }));
    this.buildCategoryTabs(tabRects, els);

    const gridTop = tabsTop + tabH + 12;
    const gridW = w - pad * 2;
    const gridH = Math.max(120, h - gridTop - pad);
    const isColors = this.activeCategory === 'colors';
    const cols = this.computeCols(gridW, isColors ? 90 : 140, isColors ? 10 : 14, isColors ? 4 : 3);
    this.buildScrollGrid(pad, gridTop, gridW, gridH, cols, els);
  }

  // ── Header row: home button (left) — "SHOP" wordmark (center) — sparks pill
  // (right). Replaces the old full-width SQLOTTER logo, which burned an entire
  // row of vertical space on a screen that's all about the item grid. ────────
  private buildHeaderRow(x0: number, x1: number, y: number, headerH: number, els: Phaser.GameObjects.GameObject[]) {
    // Compact icon button — the adaptive shell renders sizes below the full
    // asset's 65px floor with the half-scale corner pieces, so the home button
    // no longer dwarfs the header on phones.
    const homeSize = Math.max(44, Math.min(64, Math.round(headerH * 0.94)));
    els.push(this.buildIconButton(x0 + homeSize / 2, y, homeSize, 'icon-home', () => this.goToMenu()).setDepth(15));

    const pillH = Math.max(34, Math.min(56, Math.round(headerH * 0.72)));
    const pillW = this.buildSparksPill(x1, y, pillH, els);

    // SHOP wordmark, centered in the gap the home button and sparks pill
    // actually leave — centering on the full row ran the "P" under the pill
    // once a 5-figure balance widened it (390w portrait).
    const gapL = x0 + homeSize + 8;
    const gapR = x1 - pillW - 8;
    const fs = Math.max(20, Math.min(30, Math.round(headerH * 0.40)));
    const title = this.add.text(0, 0, 'SHOP', headingTextStyle(fs, C.TEXT_BEIGE))
      .setOrigin(0, 0.5);
    const iconSz = Math.round(fs * 1.05);
    const totalW = iconSz + 8 + title.width;
    const icon = addDepthIcon(this, -totalW / 2 + iconSz / 2, 0, 'icon-bag', iconSz, iconSz);
    title.setX(-totalW / 2 + iconSz + 8);
    const bar = this.add.container((gapL + gapR) / 2, y, [icon, title]).setDepth(12).setAlpha(0);
    if (totalW > gapR - gapL) bar.setScale(Math.max(0.6, (gapR - gapL) / totalW));
    this.tweens.add({ targets: bar, alpha: 1, duration: 240, delay: 60 });
    els.push(bar);
  }

  private spawnSplot(x: number, y: number, size: number, els: Phaser.GameObjects.GameObject[]) {
    this.splot?.stopIdleAnims();
    this.splot = new SplotMascot(this, x, y, size, this.previewedEquipment());
    this.splot.container.setDepth(5);
    els.push(this.splot.container);
  }

  // ── Item detail card: name, price/status row, and a Buy/Equip CTA for the
  // selected item. Gives purchases an explicit, discoverable action instead of
  // relying solely on the tap-twice-on-the-card gesture. ─────────────────────
  private buildDetailArea(cx: number, cy: number, w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const item = this.selectedItem();
    const nameFs = Math.max(16, Math.min(26, Math.round(w * 0.09)));
    const subFs  = Math.max(12, Math.min(18, Math.round(w * 0.068)));

    if (!item) {
      els.push(this.add.text(cx, cy - h * 0.16, 'Splot', {
        fontFamily: PIXELIFY, fontSize: `${nameFs}px`, color: C.TEXT_DARK, fontStyle: 'bold',
        shadow: { offsetX: 2, offsetY: 2, color: '#C8A870', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(6));
      els.push(this.add.text(cx, cy + h * 0.08, 'Tap an item to try it on!', {
        fontFamily: PIXELIFY, fontSize: `${subFs}px`, color: C.TEXT_WARM,
        align: 'center', wordWrap: { width: w - 12 },
      }).setOrigin(0.5).setDepth(6));
      return;
    }

    const owned = this.isOwned(item);
    const equipped = this.equippedItems[item.slot] === item.id;
    const canAfford = this.sparks >= item.price;

    els.push(this.add.text(cx, cy - h * 0.30, item.label, {
      fontFamily: PIXELIFY, fontSize: `${nameFs}px`, color: C.TEXT_DARK, fontStyle: 'bold',
      align: 'center', wordWrap: { width: w - 8 },
      shadow: { offsetX: 2, offsetY: 2, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(6));

    // Status row, paired tight under the name so the two read as one block.
    // Icon + text are measured and centered as a group.
    const statusY = cy - h * 0.06;
    if (equipped) {
      const iconSz = subFs * 1.2;
      const txt = this.add.text(0, 0, 'Equipped', {
        fontFamily: PIXELIFY, fontSize: `${subFs}px`, color: C.GREEN_DARK, fontStyle: 'bold',
      }).setOrigin(0, 0.5);
      const rowW = iconSz + 8 + txt.width;
      const check = addDepthIcon(this, -rowW / 2 + iconSz / 2, 0, 'icon-check', iconSz, iconSz);
      txt.setX(-rowW / 2 + iconSz + 8);
      els.push(this.add.container(cx, statusY, [check, txt]).setDepth(6));
    } else if (owned) {
      els.push(this.add.text(cx, statusY, 'Owned', {
        fontFamily: PIXELIFY, fontSize: `${subFs}px`, color: C.TEXT_WARM,
      }).setOrigin(0.5).setDepth(6));
    } else {
      const priceFs = subFs + 4;
      const iconSz = priceFs * 1.15;
      const txt = this.add.text(0, 0, `${item.price}`, {
        fontFamily: NUM_FONT, fontSize: `${priceFs}px`,
        color: canAfford ? C.GOLD : C.RED_DEEP,
        // Gold/red-deep are both close in luminance to the terracotta panel
        // behind this text — a corner shadow alone doesn't separate them, so
        // a full outline (same trick the crown card uses) does the real work.
        stroke: '#2B1400', strokeThickness: 3,
        shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
      }).setOrigin(0, 0.5);
      const rowW = iconSz + 8 + txt.width;
      const spark = this.add.image(-rowW / 2 + iconSz / 2, 0, 'icon-spark').setDisplaySize(iconSz, iconSz);
      txt.setX(-rowW / 2 + iconSz + 8);
      els.push(this.add.container(cx, statusY, [spark, txt]).setDepth(6));
    }

    // The golden crown does double duty: cosmetic AND the top Splotter Flair
    // tier. Worth calling out — 25k Sparks buys more than a hat.
    if (item.id === ROYAL_TIER_ITEM_ID && !owned) {
      els.push(this.add.text(cx, cy + h * 0.10, 'Unlocks the Royal Slime flair!', {
        fontFamily: PIXELIFY, fontSize: `${Math.max(10, Math.round(subFs * 0.85))}px`, color: C.GOLD,
        align: 'center', wordWrap: { width: w - 8 },
        stroke: '#2B1400', strokeThickness: 3,
        shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(6));
    }

    // CTA scales with the detail area. forceSmall keeps the thinner corner
    // asset even once btnH clears the 65px auto-threshold — same tablet-sizing
    // fix as the category tabs above.
    const btnW = Math.min(w, Math.max(150, Math.round(w * 0.92)));
    const btnH = Math.max(52, Math.min(68, Math.round(h * 0.34)));
    const btnY = cy + h * 0.32;
    const ctaFs = Math.max(15, Math.round(btnH * 0.30));
    let cta: Phaser.GameObjects.Container;
    if (equipped) {
      cta = addBeigeButton(this, {
        x: cx, y: btnY, width: btnW, height: btnH,
        label: 'Equipped', fontSize: ctaFs, fontFamily: PIXELIFY, disabled: true, forceSmall: true,
      });
    } else if (owned) {
      cta = addBeigeButton(this, {
        x: cx, y: btnY, width: btnW, height: btnH,
        label: 'Equip', iconKey: 'icon-check', fontSize: ctaFs, fontFamily: PIXELIFY, forceSmall: true,
        onClick: () => void this.equipItem(item),
      });
    } else {
      cta = addBeigeButton(this, {
        x: cx, y: btnY, width: btnW, height: btnH,
        label: canAfford ? `Buy  ${item.price}` : 'Need more',
        iconKey: canAfford ? 'icon-spark' : 'icon-lock',
        fontSize: ctaFs, fontFamily: canAfford ? NUM_FONT : PIXELIFY, disabled: !canAfford, forceSmall: true,
        ...(canAfford ? { onClick: () => this.showBuyConfirm(item) } : {}),
      });
    }
    cta.setDepth(8).setAlpha(0);
    this.tweens.add({ targets: cta, alpha: 1, duration: 200, delay: 60 });
    els.push(cta);
  }

  // ── Category tabs: text-only label, active tab in bold green. Font is
  // capped by BOTH tab height and tab width — sizing off height alone let
  // longer labels ("Mouths", "Extras") overflow the button on desktop-wide
  // windows, where more tabs sharing the row leaves each one narrower even
  // though the row is taller. The 0.62 factor is this codebase's usual
  // per-character width estimate for PIXELIFY (see LevelSelect's world
  // title fit). forceSmall keeps the thinner corner asset on tablet-sized
  // tabs (comfortably over the 65px auto-threshold, but still a compact
  // control) — the full-size 32px corners were eating proportionally more
  // of the button than that much text needs, reading as oversized. ────────
  private buildCategoryTabs(rects: Rect[], els: Phaser.GameObjects.GameObject[]) {
    // Below ~11px-fittable width (280px-class screens: five tabs of ~50px) no
    // scale of text reads — squeezed labels sat ON the corner bevels. The tabs
    // drop the words entirely there and show each category's own art instead;
    // decided for the whole row at once (the widths are uniform) so text and
    // icon tabs never mix.
    const iconTabs = rects.length > 0 && CATEGORIES.some((cat) =>
      Math.floor((rects[0]!.w * 0.78) / (CAT_LABELS[cat].length * 0.62)) < 11);
    const iconKeys: Record<ShopCategory, string> = {
      brows: 'char-brow-normal', eyes: 'char-eye-normal', mouth: 'char-mouth-smile',
      accessories: 'char-acc-cap', colors: 'icon-paint',
    };

    CATEGORIES.forEach((cat, i) => {
      const r = rects[i];
      if (!r) return;
      const active = cat === this.activeCategory;
      const labelText = CAT_LABELS[cat];
      const maxFsForWidth = Math.floor((r.w * 0.78) / (labelText.length * 0.62));
      const fs = Math.max(11, Math.min(22, Math.round(r.h * 0.30), maxFsForWidth));

      const shell = addBeigeButtonShell(this, r.x, r.y, r.w, r.h, false, () => {
        if (this.activeCategory === cat) return;
        this.activeCategory = cat;
        this.selectedItemId = null;
        this.buildUI();
      }, true);
      shell.container.setDepth(6);

      if (iconTabs) {
        // Trimmed to the art's alpha bbox — the raw character parts sit at
        // their on-face position inside a 128px canvas, so untrimmed they
        // render as an off-center speck.
        const t = this.getTrimmedIconTexture(iconKeys[cat]);
        const box = Math.min(r.h * 0.6, r.w * 0.62, 34);
        const s = Math.min(box / t.w, box / t.h, 2.4);
        const icon = this.add.image(0, 0, t.key)
          .setDisplaySize(t.w * s, t.h * s)
          .setAlpha(active ? 1 : 0.55);
        this.popActiveTab(icon, active);
        shell.addContent([icon]);
        els.push(shell.container);
        return;
      }

      const label = this.add.text(0, 0, labelText, {
        fontFamily: PIXELIFY,
        fontSize: `${fs}px`,
        color: active ? C.GREEN_DARK : C.TEXT_DARK,
        fontStyle: active ? 'bold' : 'normal',
        shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
      }).setOrigin(0.5);
      // The 0.62 estimate gets close, but at 320w the five tabs leave ~52px
      // each and "Mouths" still kisses the bevel — a measured clamp guarantees
      // the label stays inside the button face.
      const maxLabelW = r.w - 12;
      if (label.width > maxLabelW) label.setScale(maxLabelW / label.width);
      this.popActiveTab(label, active);
      shell.addContent([label]);

      els.push(shell.container);
    });
  }

  // Settle-pop on the selected tab's content. buildUI reruns on every tab
  // switch, so the pop plays exactly when a tab becomes active (and, subtly,
  // on resize/equip rebuilds — 160ms, harmless). Scales are captured AFTER
  // setDisplaySize/measured clamps, which store their result in scaleX/Y.
  private popActiveTab(obj: Phaser.GameObjects.Image | Phaser.GameObjects.Text, active: boolean) {
    if (!active) return;
    const fx = obj.scaleX, fy = obj.scaleY;
    obj.setScale(fx * 0.7, fy * 0.7);
    this.tweens.add({ targets: obj, scaleX: fx, scaleY: fy, duration: 160, ease: 'Back.easeOut' });
  }

  // Sized around the measured sparks text rather than a fixed proportional
  // width — Press Start 2P (NUM_FONT) runs much wider per character than
  // Pixelify Sans, and a fixed-width pill clipped a digit once the balance
  // hit 5 figures (easily reached now that shop items price into the tens
  // of thousands). `rightX` anchors the pill's right edge in place since its
  // width is now only known after the text is measured.
  private buildSparksPill(rightX: number, y: number, h: number, els: Phaser.GameObjects.GameObject[]): number {
    const fs = Math.max(10, Math.round(h * 0.32));
    const iconSz = Math.max(12, Math.round(h * 0.42));
    const pad = Math.round(h * 0.32);

    this.sparksText = this.add.text(0, -1, `${this.sparks}`, {
      fontFamily: NUM_FONT, fontSize: `${fs}px`, color: C.TEXT_DARK,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0, 0.5);

    const w = Math.max(90, iconSz + 6 + this.sparksText.width + pad * 2);
    const x = rightX - w / 2;
    // Non-interactive (no onClick) — the adaptive shell inside addBeigeButton
    // picks small-corner pieces automatically below the 65px asset floor.
    const button = addBeigeButton(this, { x, y, width: w, height: h, label: '', fontSize: fs, fontFamily: PIXELIFY })
      .setDepth(12);
    const icon = addDepthIcon(this, -w / 2 + pad + iconSz / 2, -1, 'icon-spark', iconSz, iconSz);
    this.sparksText.setPosition(-w / 2 + pad + iconSz + 6, -1);
    button.add([icon, this.sparksText]);
    els.push(button);
    return w;
  }

  private buildIconButton(x: number, y: number, size: number, iconKey: string, onClick: () => void): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, x, y, size, size, false, onClick);
    const iconSize = Math.round(size * 0.42);
    shell.addContent([addDepthIcon(this, 0, -1, iconKey, iconSize, iconSize)]);
    return shell.container;
  }

  // ── Fit Check Friday: drop your Splot on this week's thread. The button
  // lives under the Splot preview (the thing being shown off) and only exists
  // on a live Fit Check post (see the gated callers); tapping it opens the
  // compose sheet below. ──────────────────────────────────────────────────
  private buildFitButton(cx: number, cy: number, width: number, els: Phaser.GameObjects.GameObject[]) {
    const btn = addBeigeButton(this, {
      x: cx, y: cy, width, height: 40,
      label: 'Fit Check', iconKey: 'icon-share', fontSize: 14, fontFamily: PIXELIFY, forceSmall: true,
      onClick: () => this.showFitCompose(),
    }).setDepth(8);
    els.push(btn);
  }

  // Compose sheet: a shareable fit card (the equipped Splot on a branded backing
  // that gets snapshotted into the comment image), an optional caption + photo
  // URL for memeability, and the Post CTA. Sized in two passes — measure the
  // stack, then hug it — so the panel stays vertically balanced (never
  // top-heavy) and readable on every viewport from a short landscape strip to a
  // tall phone.
  private showFitCompose() {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const maxW = Math.min(width - 24, 380);
    const maxH = Math.min(height - 24, 600);

    // ── Pass 1: element sizes + total content height ──────────────────────
    // Vertical stack, top to bottom: padTop, title, titleGap, card, cardGap,
    // [label, labelGap, input] ×2 (with sectionGap after each), preButtonGap
    // (replacing the last input's sectionGap), buttons, padBottom.
    const padTop = 14, padBottom = 16;
    const titleGap = 12, cardGap = 10, sectionGap = 8, labelGap = 4, preButtonGap = 14;
    const titleFs = Math.max(15, Math.min(22, Math.round(maxW * 0.062)));
    const labelFs = Math.max(11, Math.min(14, Math.round(maxW * 0.038)));
    const inputH  = Math.round(Math.max(28, Math.min(34, maxH * 0.055)));
    const btnH    = Math.round(Math.max(44, Math.min(56, maxH * 0.10)));
    // Everything except the card is fixed height; the card takes the slack,
    // clamped so it never crowds the inputs out on a short screen.
    const nonCard = padTop + titleFs + titleGap + cardGap
      + 2 * (labelFs + labelGap + inputH) + sectionGap  // two fields + gap between/after
      + preButtonGap + btnH + padBottom;
    const cardSz = Math.max(80, Math.min(maxW * 0.62, maxH - nonCard, 220));
    const contentH = nonCard + cardSz;
    const popH = Math.min(maxH, contentH);
    const popW = maxW;
    const popTop = cy - popH / 2;

    // ── Pass 2: draw the stack top-down from popTop ───────────────────────
    const items: Phaser.GameObjects.GameObject[] = [];
    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);
    items.push(addBeigeButtonShell(this, cx, cy, popW, popH, false).container);

    let y = popTop + padTop;
    items.push(this.add.text(cx, y + titleFs / 2, 'Fit Check Friday', {
      fontFamily: PIXELIFY, fontSize: `${titleFs}px`, color: C.TEXT_DARK, fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(1));
    y += titleFs + titleGap;

    // Fit card (snapshot region) — opaque backing so the PNG has no see-through
    // corners; the SQLOTTER strip brands the shared image.
    const cardCY = y + cardSz / 2;
    const cardRect = { x: cx - cardSz / 2, y: cardCY - cardSz / 2, w: cardSz, h: cardSz };
    items.push(this.add.rectangle(cx, cardCY, cardSz, cardSz, 0x2A1710)
      .setStrokeStyle(3, 0x7A4A20).setDepth(1));
    const composeSplot = new SplotMascot(this, cx, cardCY - cardSz * 0.05, cardSz * 0.7, this.equippedItems);
    composeSplot.container.setDepth(2);
    items.push(composeSplot.container);
    items.push(this.add.text(cx, cardCY + cardSz / 2 - Math.max(9, cardSz * 0.06), 'SQLOTTER · FIT CHECK', {
      fontFamily: NUM_FONT, fontSize: `${Math.max(7, Math.round(cardSz * 0.05))}px`, color: C.TEXT_BEIGE,
    }).setOrigin(0.5).setDepth(3));
    y += cardSz + cardGap;

    // Optional caption + photo URL (DOM <input> overlays)
    const inputW = Math.min(popW - 40, 320);
    const addField = (label: string, placeholder: string, maxLen: number): HTMLInputElement => {
      items.push(this.add.text(cx, y + labelFs / 2, label, {
        fontFamily: PIXELIFY, fontSize: `${labelFs}px`, color: C.TEXT_WARM,
      }).setOrigin(0.5).setDepth(1));
      y += labelFs + labelGap;
      const input = this.createFitInput(cx, y + inputH / 2, inputW, inputH, placeholder, maxLen);
      y += inputH + sectionGap;
      return input;
    };
    const captionInput = addField('Say something (optional)', 'e.g. drip check, no notes', 140);
    const photoInput   = addField('Photo URL (optional)', 'https://…', 300);
    y += preButtonGap - sectionGap;

    // Cancel / Post
    const btnGap = 12;
    const btnPad = Math.max(16, popW * 0.06);
    const btnW = (popW - btnPad * 2 - btnGap) / 2;
    const btnFs = Math.max(13, Math.round(btnH * 0.30));
    const btnCY = y + btnH / 2;
    items.push(addBeigeButton(this, {
      x: cx - btnW / 2 - btnGap / 2, y: btnCY, width: btnW, height: btnH,
      label: 'Cancel', fontSize: btnFs, fontFamily: PIXELIFY,
      onClick: () => this.closeActivePopup(),
    }));
    items.push(addBeigeButton(this, {
      x: cx + btnW / 2 + btnGap / 2, y: btnCY, width: btnW, height: btnH,
      label: 'Post fit', iconKey: 'icon-share', fontSize: btnFs, fontFamily: PIXELIFY, forceSmall: true,
      onClick: () => {
        const caption  = captionInput.value.trim();
        const photoUrl = photoInput.value.trim();
        // postFit snapshots the card BEFORE tearing the sheet down.
        void this.postFit(cardRect, caption, photoUrl);
      },
    }));

    // Fade only (no scale) so the DOM inputs, positioned at final coords, stay
    // pinned to their Phaser labels through the entrance.
    this.activePopup = this.add.container(0, 0, items).setDepth(60).setAlpha(0);
    this.tweens.add({ targets: this.activePopup, alpha: 1, duration: 160, ease: 'Quad.easeOut' });
  }

  // A beige DOM <input> laid over the canvas, mapped from world coords to screen
  // (same technique as the Splat Card caption). Tracked in fitInputs for teardown.
  private createFitInput(cx: number, cyCenter: number, w: number, h: number, placeholder: string, maxLen: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.maxLength = maxLen;
    // Keep pointer events off Phaser's window-level listeners, or a tap on the
    // field would also hit the dim overlay and close the sheet.
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      input.addEventListener(ev, (e) => e.stopPropagation());
    }

    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx     = rect.width  / this.scale.width;
    const sy     = rect.height / this.scale.height;

    Object.assign(input.style, {
      position:     'fixed',
      padding:      '0 8px',
      boxSizing:    'border-box',
      background:   '#FFF6DF',
      color:        '#3A1A08',
      border:       '2px solid #7A4A20',
      borderRadius: '6px',
      outline:      'none',
      zIndex:       '100',
      fontFamily:   'Arial, sans-serif',
      left:         `${rect.left + (cx - w / 2) * sx}px`,
      top:          `${rect.top  + (cyCenter - h / 2) * sy}px`,
      width:        `${w * sx}px`,
      height:       `${h * sy}px`,
      // Floored at 13px so the field text stays readable when the canvas is
      // letterboxed smaller than the reference resolution.
      fontSize:     `${Math.max(13, Math.round(13 * Math.min(sx, sy)))}px`,
    });

    (canvas.parentElement ?? document.body).appendChild(input);
    this.fitInputs.push(input);
    return input;
  }

  private clearFitInputs() {
    for (const el of this.fitInputs) el.remove();
    this.fitInputs = [];
  }

  // Grabs the fit card as a PNG data URI on the next rendered frame — best
  // effort, mirroring the Splat Card / crown snapshot: a null result still
  // posts, just without the image.
  private snapshotFit(x: number, y: number, w: number, h: number): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null) => { if (!settled) { settled = true; resolve(value); } };
      try {
        this.game.renderer.snapshotArea(Math.round(x), Math.round(y), Math.round(w), Math.round(h), (snap) => {
          finish(snap instanceof HTMLImageElement && snap.src.startsWith('data:image/png;base64,') ? snap.src : null);
        });
      } catch {
        finish(null);
      }
      this.time.delayedCall(2000, () => finish(null));
    });
  }

  // Snapshots the card, tears down the sheet, then POSTs image + caption + photo.
  // The endpoint distinguishes not-logged-in (401), wrong post (403), no thread
  // live (404), already entered (409), cooldown (429), and a bad field (400) —
  // each gets its own friendly line.
  private async postFit(cardRect: Rect, caption: string, photoUrl: string) {
    if (this.fitBusy) return;
    this.fitBusy = true;
    // The round-trip uploads an image and posts a Reddit comment — it can take
    // several seconds, so acknowledge the tap immediately.
    this.showToast('Posting your fit…', C.GREEN);

    // Snapshot while the card is still on screen, then dismiss the sheet.
    let imageDataUrl: string | undefined;
    const src = await this.snapshotFit(cardRect.x, cardRect.y, cardRect.w, cardRect.h);
    // Stay under the server's 1.5M-char cap with margin to spare.
    if (src !== null && src.length <= 1_400_000) imageDataUrl = src;
    this.closeActivePopup();
    if (this.navigating) { this.fitBusy = false; return; }

    const body: ShareFitRequest = {};
    if (imageDataUrl) body.imageDataUrl = imageDataUrl;
    if (caption) body.caption = caption;
    if (photoUrl) body.photoUrl = photoUrl;

    try {
      const res = await fetch('/api/share/fit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      });
      if (this.navigating) return;
      if (res.ok) {
        playSfx('confirm');
        this.showToast('Fit posted — good luck!', C.GREEN);
        this.splot?.setExpression('excited', 1500);
        this.splot?.playAppliedFlash();
      } else if (res.status === 401) {
        this.showToast('Log in to join Fit Check Friday!', '#ffb347');
        try { showLoginPrompt(); } catch { /* outside Reddit iframe */ }
      } else if (res.status === 403) {
        this.showToast('Open the Fit Check post to drop your fit!', '#ffb347');
      } else if (res.status === 404) {
        this.showToast('No Fit Check live — check back soon!', '#ffb347');
      } else if (res.status === 409) {
        this.showToast("You already posted this week's fit!", '#ffb347');
      } else if (res.status === 429) {
        this.showToast('Easy there — try again in a moment!', '#ffb347');
      } else if (res.status === 400) {
        this.showToast('Could not post — check your photo URL.', C.RED);
      } else {
        this.showToast('Could not post your fit.', C.RED);
      }
    } catch {
      if (!this.navigating) this.showToast('Could not post your fit.', C.RED);
    } finally {
      this.fitBusy = false;
    }
  }

  private computeCols(gridW: number, minCard: number, gap: number, maxCols: number): number {
    const fit = Math.floor((gridW + gap) / (minCard + gap));
    return Math.max(2, Math.min(maxCols, fit));
  }

  // ── Scrollable item grid: container clipped to the viewport rect (see
  // applyRectClip — Phaser 4 WebGL needs a Filters Mask, not a geometry mask)
  // + drag/wheel scroll + manual tap dispatch (cards aren't interactive
  // themselves, which avoids drag/tap conflicts — see hitTestCard) ─────────
  private buildScrollGrid(vx: number, vy: number, vw: number, vh: number, cols: number, els: Phaser.GameObjects.GameObject[]) {
    const gap = Math.max(10, Math.round(vw * 0.035));
    const cardSize = Math.min(260, Math.floor((vw - gap * (cols - 1)) / cols));
    const contentW = cardSize * cols + gap * (cols - 1);
    const offsetX = Math.max(0, (vw - contentW) / 2);

    const filtered = SHOP_ITEMS.filter(it => it.category === this.activeCategory);
    const rows = Math.max(1, Math.ceil(filtered.length / cols));
    const contentH = rows * cardSize + (rows - 1) * gap;
    const maxScroll = Math.max(0, contentH - vh);

    this.scrollViewport = { x: vx, y: vy, w: vw, h: vh };
    this.scrollMaxOffset = maxScroll;
    this.cardRects = [];

    // Dark inset panel behind the grid (same nine-slice Game.ts uses for the
    // modifier palette) — anchors the tan cards visually and replaces the old
    // flat full-column rectangle.
    els.push(addDarkPanel(this, vx + vw / 2, vy + vh / 2, vw + 16, vh + 16).setDepth(4).setAlpha(0.92));

    // Resume this category's scroll position instead of always reopening at
    // the top — see scrollOffsetByCategory's field comment. Re-clamped since
    // maxScroll can shrink (a resize, or an item's owned/equipped state
    // changing the grid) between the offset being saved and restored here.
    const savedOffset = this.scrollOffsetByCategory[this.activeCategory] ?? 0;
    const initialOffset = Phaser.Math.Clamp(savedOffset, -maxScroll, 0);

    const scrollContainer = this.add.container(vx, vy + initialOffset).setDepth(6);
    this.scrollMaskGfx = this.make.graphics();
    applyRectClip(this, scrollContainer, this.scrollMaskGfx, vx, vy, vw, vh);
    this.scrollContainer = scrollContainer;

    filtered.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = offsetX + col * (cardSize + gap) + cardSize / 2;
      const cy = row * (cardSize + gap) + cardSize / 2;

      const owned = this.isOwned(item);
      const equipped = this.equippedItems[item.slot] === item.id;
      const selected = this.selectedItemId === item.id;

      const card = this.buildItemCard(cardSize, item, owned, equipped, selected);
      card.setPosition(cx, cy).setAlpha(0);
      this.tweens.add({ targets: card, alpha: 1, duration: 200, delay: Math.min(i * 30, 240) });
      scrollContainer.add(card);
      this.cardRects.push({ cx, cy, w: cardSize, h: cardSize, item, owned, equipped, container: card });
    });

    els.push(scrollContainer);

    const zone = this.add.zone(vx + vw / 2, vy + vh / 2, vw, vh).setInteractive();
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragState.active = true;
      this.dragState.startPointerY = p.y;
      this.dragState.startOffset = scrollContainer.y - vy;
      this.dragState.moved = 0;
      const rec = this.hitTestCard(p.x, p.y);
      this.dragState.downRecord = rec;
      if (rec) {
        this.tweens.add({ targets: rec.container, scaleX: 0.95, scaleY: 0.95, duration: 60 });
        this.previewItem(rec.item, rec.owned);
      }
    });
    els.push(zone);

    if (maxScroll > 0) {
      const trackX = vx + vw - 5;
      this.scrollTrack = this.add.rectangle(trackX, vy + vh / 2, 4, vh, 0x000000, 0.35).setDepth(8);
      const thumbH = Math.max(28, vh * (vh / contentH));
      this.scrollThumb = this.add.rectangle(trackX, vy, 4, thumbH, 0xDEC998, 0.85).setOrigin(0.5, 0).setDepth(9);
      els.push(this.scrollTrack, this.scrollThumb);
      this.updateScrollThumb(); // reflects a restored (non-zero) initialOffset
    } else {
      this.scrollTrack = null;
      this.scrollThumb = null;
    }
  }

  // Cards live inside the scroll grid's masked container. addBeigeButtonShell's
  // background is built from TileSprite pieces, which don't render reliably when
  // nested under an ancestor geometry mask — Game.ts's proven masked/scrollable
  // modifier palette sidesteps this by using addBeigeCard (Phaser's built-in
  // NineSlice, a single GameObject) instead, tinted warm tan so it reads as a
  // beige panel. Art is shown full-color/size regardless of ownership so players
  // can see exactly what they'd get.
  private buildItemCard(size: number, item: ShopItem, owned: boolean, equipped: boolean, selected: boolean): Phaser.GameObjects.Container {
    // Opaque beige slab (the flat-slot texture addBeigeCard uses is ~80%
    // transparent, which read as near-black over the dark grid panel).
    const bg = addBeigeSolidCard(this, 0, 0, size, size);
    const content: Phaser.GameObjects.GameObject[] = [bg];

    // Translucent slot inset behind the art — over the beige slab it reads as
    // a subtly darker plate that frames the customization art. Equipped tints
    // the plate green (small, since it's layered with the check badge, green
    // label, and border ring below — no single signal has to carry it alone).
    const plate = addBeigeCard(this, 0, -size * 0.09, size * 0.84, size * 0.62);
    if (equipped) plate.setTint(C.PLATE_EQUIP);
    content.push(plate);

    if (item.category === 'colors') {
      // A plain painted swatch reads better as a circle than a square icon —
      // it's immediately legible as "a color," not "a wearable part."
      const swatchSize = size * 0.5;
      content.push(this.add.image(0, -size * 0.09, this.getColorSwatchTexture(item)).setDisplaySize(swatchSize, swatchSize));
    } else {
      // The customization art is the card's hero. Character-part sources share
      // a full-head 128×128 canvas (so layers align when composited on Splot),
      // which leaves most of any single part's frame as transparent margin —
      // drawn raw, a brow was a tiny squiggle lost in the card. Contain-fit
      // the alpha-trimmed glyph into the plate instead, with an upscale cap so
      // the smallest parts don't blow up into mush.
      const t = this.getTrimmedIconTexture(item.iconKey);
      const artScale = Math.min((size * 0.66) / t.w, (size * 0.46) / t.h, 2.4);
      content.push(this.add.image(0, -size * 0.09, t.key).setDisplaySize(t.w * artScale, t.h * artScale));
    }

    const lbl = this.add.text(0, size * 0.24, item.label, {
      fontFamily: PIXELIFY,
      fontSize: `${Math.max(12, Math.round(size * 0.095))}px`,
      color: equipped ? C.GREEN_DARK : C.TEXT_DARK,
      fontStyle: 'bold',
      align: 'center',
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5, 0);
    // One measured line, downscaled to fit — wordWrap broke "Crimson Red"
    // onto two lines on the colors grid's small cards, running the second
    // line straight through the price row below.
    if (lbl.width > size - 12) lbl.setScale((size - 12) / lbl.width);
    content.push(lbl);

    const badgeX = size / 2 - size * 0.14;
    const badgeY = -size / 2 + size * 0.14;
    if (equipped) {
      content.push(addDepthIcon(this, badgeX, badgeY, 'icon-check', size * 0.18, size * 0.18));
    } else if (!owned) {
      content.push(addDepthIcon(this, badgeX, badgeY, 'icon-lock', size * 0.20, size * 0.20));
      // Price row — measured and centered as a group, kept above the card's
      // bottom corner bevel
      const priceFs = Math.max(11, Math.round(size * 0.10));
      const sparkSz = size * 0.15;
      const priceTxt = this.add.text(0, size * 0.40, `${item.price}`, {
        fontFamily: NUM_FONT,
        fontSize: `${priceFs}px`,
        color: this.sparks >= item.price ? C.GOLD : C.RED_DEEP,
        stroke: '#2B1400', strokeThickness: 2,
        shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
      }).setOrigin(0, 0.5);
      const rowW = sparkSz + 5 + priceTxt.width;
      const spark = this.add.image(-rowW / 2 + sparkSz / 2, size * 0.40, 'icon-spark')
        .setDisplaySize(sparkSz, sparkSz);
      priceTxt.setX(-rowW / 2 + sparkSz + 5);
      content.push(spark, priceTxt);
    }

    // Selected (armed-but-unowned) ring — a stroke-only rectangle instead of a
    // whole-card tint (see the C constants comment: multiply-tinting the
    // beige base can only darken it toward orange, never brighten toward an
    // actual highlight). Equipped is already signalled by the plate tint,
    // check badge, and bold green label above, so it gets no ring of its own.
    if (!equipped && selected) {
      content.push(this.add.rectangle(0, 0, size + 4, size + 4).setStrokeStyle(4, C.BORDER_SELECTED, 1));
    }

    return this.add.container(0, 0, content).setSize(size, size);
  }

  // Colors-category cards/popups paint a swatch instead of item.iconKey (an
  // unused placeholder for these entries) — a solid fill for ordinary colors,
  // or a baked gradient for the rare stops-based ones. Circle/Rectangle shape
  // GameObjects can't fill a multi-stop gradient natively, so this bakes a
  // small canvas texture (same technique as the mascot's own tint bake) and
  // caches it by item id since the same item is drawn repeatedly (grid card,
  // buy-confirm popup, and again on every scene rebuild).
  private getColorSwatchTexture(item: ShopItem): string {
    const key = `swatch-${item.id}`;
    if (this.textures.exists(key)) return key;
    const size = 96;
    const stops = item.color?.stops;
    if (stops && stops.length >= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      stops.forEach((hex, i) => grad.addColorStop(i / (stops.length - 1), hex));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();
      this.textures.addCanvas(key, canvas);
    } else {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(Phaser.Display.Color.HexStringToColor(item.color?.hex ?? '#FFFFFF').color, 1);
      g.fillCircle(size / 2, size / 2, size / 2);
      g.generateTexture(key, size, size);
      g.destroy();
    }
    return key;
  }

  // Bakes an alpha-trimmed copy of a character-part texture (cached by key,
  // same pattern as getColorSwatchTexture) so cards and popups can size the
  // actual drawn glyph instead of the mostly-transparent 128×128 frame it
  // ships in. Returns the trimmed texture's key and pixel dimensions for
  // aspect-preserving contain-fits.
  private getTrimmedIconTexture(srcKey: string): { key: string; w: number; h: number } {
    const trimKey = `trim-${srcKey}`;
    if (this.textures.exists(trimKey)) {
      const img = this.textures.get(trimKey).getSourceImage();
      return { key: trimKey, w: img.width, h: img.height };
    }
    const frame = this.textures.get(srcKey).get();
    const fallback = { key: srcKey, w: frame.width, h: frame.height };
    const src = this.textures.get(srcKey).getSourceImage();
    if (!(src instanceof HTMLImageElement || src instanceof HTMLCanvasElement)) return fallback;

    const w = src.width, h = src.height;
    const scan = document.createElement('canvas');
    scan.width = w; scan.height = h;
    const ctx = scan.getContext('2d');
    if (!ctx) return fallback;
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((data[(y * w + x) * 4 + 3] ?? 0) > 16) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return fallback; // fully transparent — nothing to trim to

    const pad = 2; // keep a sliver of breathing room around soft edges
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    const out = document.createElement('canvas');
    out.width = bw; out.height = bh;
    const outCtx = out.getContext('2d');
    if (!outCtx) return fallback;
    outCtx.drawImage(scan, minX, minY, bw, bh, 0, 0, bw, bh);
    this.textures.addCanvas(trimKey, out);
    return { key: trimKey, w: bw, h: bh };
  }

  private hitTestCard(px: number, py: number): CardRecord | null {
    if (!this.scrollContainer) return null;
    const localX = px - this.scrollContainer.x;
    const localY = py - this.scrollContainer.y;
    for (const rec of this.cardRects) {
      if (Math.abs(localX - rec.cx) <= rec.w / 2 && Math.abs(localY - rec.cy) <= rec.h / 2) return rec;
    }
    return null;
  }

  private onGlobalPointerMove(p: Phaser.Input.Pointer) {
    if (!this.dragState.active || !this.scrollContainer) return;
    const dy = p.y - this.dragState.startPointerY;
    this.dragState.moved = Math.max(this.dragState.moved, Math.abs(dy));

    if (this.dragState.moved > 6 && this.dragState.downRecord) {
      this.tweens.add({ targets: this.dragState.downRecord.container, scaleX: 1, scaleY: 1, duration: 80 });
      this.restorePreview();
      this.dragState.downRecord = null;
    }

    const newOffset = Phaser.Math.Clamp(this.dragState.startOffset + dy, -this.scrollMaxOffset, 0);
    this.scrollContainer.y = this.scrollViewport.y + newOffset;
    this.updateScrollThumb();
  }

  private onGlobalPointerUp(_p: Phaser.Input.Pointer) {
    if (!this.dragState.active) return;
    this.dragState.active = false;
    const rec = this.dragState.downRecord;
    if (rec && this.dragState.moved <= 6) {
      this.tweens.add({ targets: rec.container, scaleX: 1, scaleY: 1, duration: 80 });
      this.handleCardTap(rec);
    } else {
      this.restorePreview();
    }
    this.dragState.downRecord = null;
  }

  private onWheel(p: Phaser.Input.Pointer, dy: number) {
    if (!this.scrollContainer || this.scrollMaxOffset <= 0) return;
    const { x, y, w, h } = this.scrollViewport;
    if (p.x < x || p.x > x + w || p.y < y || p.y > y + h) return;
    const currentOffset = this.scrollContainer.y - y;
    const newOffset = Phaser.Math.Clamp(currentOffset - dy * 0.4, -this.scrollMaxOffset, 0);
    this.scrollContainer.y = y + newOffset;
    this.updateScrollThumb();
  }

  // Called any time scrollContainer.y changes — the single choke point for
  // both the visual thumb and persisting this category's scroll offset (see
  // scrollOffsetByCategory) so the next rebuild can restore it.
  private updateScrollThumb() {
    if (!this.scrollContainer) return;
    const offset = this.scrollContainer.y - this.scrollViewport.y; // in [-max, 0]
    this.scrollOffsetByCategory[this.activeCategory] = offset;
    if (!this.scrollThumb || this.scrollMaxOffset <= 0) return;
    const ratio = Phaser.Math.Clamp(-offset / this.scrollMaxOffset, 0, 1);
    this.scrollThumb.y = this.scrollViewport.y + (this.scrollViewport.h - this.scrollThumb.height) * ratio;
  }

  // ── Purchase / equip ─────────────────────────────────────────────────────

  // Every tap selects the item (detail panel + persistent try-on preview).
  // Owned items additionally equip immediately (free, reversible). A second
  // tap on an armed unowned item opens the buy confirmation — same as the
  // detail panel's Buy CTA.
  private handleCardTap(rec: CardRecord) {
    if (rec.owned) {
      this.selectedItemId = rec.item.id;
      if (!rec.equipped) {
        void this.equipItem(rec.item);
      } else {
        this.deferredRebuild();
      }
      return;
    }
    if (this.selectedItemId !== rec.item.id) {
      this.selectedItemId = rec.item.id;
      this.deferredRebuild();
      return;
    }
    this.showBuyConfirm(rec.item);
  }

  // onGlobalPointerUp (handleCardTap's caller) is a raw scene-wide 'pointerup'
  // listener, invoked synchronously while Phaser is still mid-dispatch for the
  // input event — including the scale-reset tween it just queued on the card.
  // Every other button in the app defers its onClick via a tween's onComplete
  // (see addBeigeButtonShell), which lands safely after that dispatch finishes;
  // this path has no such deferral, and rebuilding the UI (destroying the card
  // and zone) synchronously inside the dispatch crashes on the first tap.
  // time.delayedCall always fires on a later Clock.update() pass.
  private deferredRebuild() {
    this.time.delayedCall(0, () => this.buildUI());
  }

  private async equipItem(item: ShopItem, quiet = false) {
    if (this.pendingItemIds.has(item.id)) return;
    this.pendingItemIds.add(item.id);
    try {
      const res = await fetch('/api/user/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: item.slot, itemId: item.id }),
        signal: AbortSignal.timeout(8000),
      });
      // The player may have tapped Home while this request was in flight —
      // don't rebuild UI/touch the scene after it's already shut down.
      if (this.navigating) return;
      if (res.status === 401) {
        this.showToast('Log in to dress Splot!', C.RED);
        try { showLoginPrompt(); } catch { /* outside Reddit iframe */ }
        return;
      }
      if (!res.ok) {
        this.showToast('Could not equip that item.', C.RED);
        this.splot?.setExpression('sad', 1200);
        return;
      }
      const data: EquipResponse = await res.json();
      playSfx('wear');
      this.equippedItems = data.equippedItems;
      this.storeProfileCache();
      if (!quiet) this.showToast(`Equipped ${item.label}!`, C.GREEN);
      this.splot?.refresh(this.previewedEquipment());
      this.splot?.setExpression('excited', 1500);
      this.splot?.playAppliedFlash();
      this.buildUI();
    } catch {
      this.showToast('Could not equip that item.', C.RED);
      this.splot?.setExpression('sad', 1200);
    } finally {
      this.pendingItemIds.delete(item.id);
    }
  }

  private async buyItem(item: ShopItem) {
    if (this.pendingItemIds.has(item.id)) return;
    this.pendingItemIds.add(item.id);
    try {
      if (this.sparks < item.price) {
        playSfx('refuse');
        this.splot?.setExpression('sad', 1200);
        this.showToast('Not enough Sparks!', C.RED);
        return;
      }
      const res = await fetch('/api/user/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
        signal: AbortSignal.timeout(8000),
      });
      // The player may have tapped Home while this request was in flight —
      // don't rebuild UI/touch the scene after it's already shut down.
      if (this.navigating) return;
      if (res.status === 401) {
        this.showToast('Log in to claim items!', C.RED);
        try { showLoginPrompt(); } catch { /* outside Reddit iframe */ }
        return;
      }
      if (!res.ok) { this.showToast('Purchase failed.', C.RED); return; }
      const data: BuyResponse = await res.json();
      playSfx('confirm');
      this.sparks = data.sparks;
      this.unlockedItems = new Set(data.unlockedItems);
      this.storeProfileCache();
      this.showToast(`Got ${item.label}!`, C.GREEN);
      this.buildUI();
    } catch {
      this.showToast('Purchase failed.', C.RED);
      this.splot?.setExpression('sad', 1200);
    } finally {
      this.pendingItemIds.delete(item.id);
    }
  }

  // Buying a cosmetic should immediately wear it — that's why the player
  // bought it, and Splot is already previewing the look. Quiet equip so the
  // player only sees the single "Got X!" toast.
  private async buyThenEquip(item: ShopItem) {
    await this.buyItem(item);
    if (this.navigating) return;
    if (this.isOwned(item) && this.equippedItems[item.slot] !== item.id) {
      await this.equipItem(item, true);
    }
  }

  // ── Buy-confirmation popup — every offset/font is derived from popW/popH
  // instead of fixed pixels, and popH itself is clamped to the viewport so a
  // short landscape window can't push content (or the button row) off-screen ─
  private showBuyConfirm(item: ShopItem) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const popW = Math.min(width - 48, 340);
    const popH = Math.min(height - 56, Math.round(popW * 1.05));
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    const shell = addBeigeButtonShell(this, cx, cy, popW, popH, false);
    const content: Phaser.GameObjects.GameObject[] = [];

    // The button row is sized FIRST — it anchors the popup's bottom, and the
    // price/label rows stack upward off its measured top edge. The old layout
    // placed every row proportionally to popH while the buttons kept a
    // near-fixed height, so on height-clamped popups (280px-class portrait,
    // 320px-tall landscape) the price row landed underneath the buttons. Now
    // only the item art absorbs the squeeze.
    const btnGap = 12;
    const btnPad = Math.max(20, popW * 0.07);
    const btnW = (popW - btnPad * 2 - btnGap) / 2;
    const btnH = Math.max(46, Math.min(64, Math.round(popH * 0.20)));
    const btnFs = Math.max(13, Math.round(btnH * 0.30));
    const btnY = cy + popH / 2 - btnH * 0.9;

    const titleFs = Math.max(14, Math.min(20, Math.round(popW * 0.065)));
    const labelFs = Math.max(12, Math.min(16, Math.round(popW * 0.05)));
    const priceFs = Math.max(13, Math.min(18, Math.round(popW * 0.055)));
    const priceIconSz = priceFs * 1.1;

    const titleY = -popH / 2 + Math.max(22, popH * 0.10);
    const btnTopRel = popH / 2 - btnH * 1.4; // buttons' top edge, popup-relative
    const priceY = btnTopRel - 10 - priceIconSz / 2;
    const labelY = priceY - priceIconSz / 2 - 8 - labelFs * 0.6;

    content.push(this.add.text(0, titleY, 'Buy this item?', {
      fontFamily: PIXELIFY, fontSize: `${titleFs}px`, color: C.TEXT_DARK, fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    // Item art centered in whatever space the title and label rows leave.
    const areaTop = titleY + titleFs * 0.9;
    const areaBottom = labelY - labelFs * 0.9;
    const iconSize = Math.max(30, Math.min(popW * 0.28, areaBottom - areaTop - 10, 96));
    const iconY = (areaTop + areaBottom) / 2;
    if (item.category === 'colors') {
      content.push(this.add.image(0, iconY, this.getColorSwatchTexture(item)).setDisplaySize(iconSize, iconSize));
    } else {
      // Same trimmed contain-fit the grid cards use — the raw frame is mostly
      // transparent margin (see buildItemCard).
      const t = this.getTrimmedIconTexture(item.iconKey);
      const s = Math.min(iconSize / t.w, iconSize / t.h, 2.4);
      content.push(this.add.image(0, iconY, t.key).setDisplaySize(t.w * s, t.h * s));
    }

    content.push(this.add.text(0, labelY, item.label, {
      fontFamily: PIXELIFY, fontSize: `${labelFs}px`, color: C.TEXT_DARK,
    }).setOrigin(0.5));

    // Price row measured and centered as a group — the old fixed -18/-2
    // offsets assumed a 2-digit price and drifted off-center for 3 digits.
    const priceTxt = this.add.text(0, priceY, `${item.price}`, {
      fontFamily: NUM_FONT, fontSize: `${priceFs}px`, color: C.GOLD,
      stroke: '#2B1400', strokeThickness: 3,
      shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
    }).setOrigin(0, 0.5);
    const priceRowW = priceIconSz + 6 + priceTxt.width;
    const priceIcon = addDepthIcon(this, -priceRowW / 2 + priceIconSz / 2, priceY, 'icon-spark', priceIconSz, priceIconSz);
    priceTxt.setX(-priceRowW / 2 + priceIconSz + 6);
    content.push(priceIcon, priceTxt);

    shell.addContent(content);
    items.push(shell.container);

    const canAfford = this.sparks >= item.price;
    items.push(addBeigeButton(this, {
      x: cx - btnW / 2 - btnGap / 2, y: btnY, width: btnW, height: btnH,
      label: 'Cancel', fontSize: btnFs, fontFamily: PIXELIFY,
      onClick: () => this.closeActivePopup(),
    }));
    items.push(addBeigeButton(this, {
      x: cx + btnW / 2 + btnGap / 2, y: btnY, width: btnW, height: btnH,
      label: canAfford ? 'Buy' : 'Need more', fontSize: btnFs, fontFamily: PIXELIFY,
      disabled: !canAfford,
      onClick: () => { this.closeActivePopup(); void this.buyThenEquip(item); },
    }));

    this.activePopup = this.add.container(0, 0, items).setDepth(60).setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: this.activePopup, alpha: 1, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
  }

  private closeActivePopup() {
    // The compose sheet's caption/photo fields are DOM overlays, not part of the
    // popup container — pull them first so they can't linger over the canvas.
    this.clearFitInputs();
    if (!this.activePopup) return;
    const p = this.activePopup;
    this.activePopup = null;
    this.tweens.add({ targets: p, alpha: 0, duration: 120, onComplete: () => p.destroy(true) });
  }

  // Previews any item (owned or not) live on Splot while the card is held —
  // lets players see a look before spending sparks on it.
  private previewItem(item: ShopItem, owned: boolean) {
    if (!this.splot) return;
    this.splot.refresh({ ...this.equippedItems, [item.slot]: item.id });
    this.splot.setExpression(owned || this.sparks >= item.price ? 'doubt' : 'sad', 900);
  }

  private restorePreview() {
    this.splot?.refresh(this.previewedEquipment());
  }

  private showToast(msg: string, color: string) {
    const { width, height } = this.scale;
    const fs = Math.max(12, Math.min(17, Math.round(width * 0.036)));
    const txt = this.add.text(0, 0, msg, {
      fontFamily: PIXELIFY, fontSize: `${fs}px`, color,
    }).setOrigin(0.5);
    const bg = addDarkPanel(this, 0, 0, Math.ceil(txt.width) + Math.round(fs * 2.6), Math.round(fs * 3));
    const toast = this.add.container(width / 2, height * 0.92, [bg, txt])
      .setDepth(30).setAlpha(0);
    this.activeToasts.push(toast);
    this.tweens.add({ targets: toast, alpha: 1, duration: 200 });
    this.time.delayedCall(2000, () => {
      if (!toast.scene) return; // already cleared by a resize
      this.tweens.add({ targets: toast, alpha: 0, duration: 300, onComplete: () => this.destroyToast(toast) });
    });
  }

  private destroyToast(toast: Phaser.GameObjects.Container) {
    const idx = this.activeToasts.indexOf(toast);
    if (idx !== -1) this.activeToasts.splice(idx, 1);
    toast.destroy(true);
  }

  private clearToasts() {
    this.activeToasts.forEach(t => t.destroy(true));
    this.activeToasts = [];
  }

  private goToMenu() {
    if (this.navigating) return;
    this.navigating = true;
    this.splot?.stopIdleAnims();
    this.cameras.main.fadeOut(250, 10, 5, 14);
    this.time.delayedCall(260, () => this.scene.start('MainMenu'));
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    this.clearToasts();
    // The buy-confirm popup is sized/positioned once from the viewport at open
    // time and, like toasts, isn't part of uiLayer so the rebuild below won't
    // touch it — closing it here avoids the same staleness (or being pushed
    // fully off-screen on a rotation/resize) rather than leaving it frozen.
    this.closeActivePopup();
    // Full rebuild debounced — RESIZE mode streams events during a window drag.
    this.resizeRebuild?.remove();
    this.resizeRebuild = this.time.delayedCall(120, () => {
      this.resizeRebuild = null;
      this.buildUI();
    });
  }

  shutdown() {
    this.navigating = true;
    this.splot?.stopIdleAnims();
    this.scale.off('resize', this.onResize, this);
    this.input.off('pointermove', this.onPointerMoveBound);
    this.input.off('pointerup', this.onPointerUpBound);
    this.input.off('wheel', this.onWheelBound);
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.clearToasts();
    this.clearFitInputs();
    this.scrollMaskGfx?.destroy();
    this.scrollMaskGfx = null;
  }
}
