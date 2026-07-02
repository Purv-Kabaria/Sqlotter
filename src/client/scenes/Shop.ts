import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import {
  addBeigeButton, addBeigeButtonShell, addBeigeCard, addBeigeSolidCard, addDarkPanel, addDepthIcon, addPanel9,
  applyRectClip,
} from '../components/PixelUI';
import { SHOP_ITEMS } from '../../shared/shop';
import type { ShopCategory, ShopItem } from '../../shared/shop';
import type { BuyResponse, EquipResponse, ProfileResponse } from '../../shared/api';

const PIXELIFY = '"Pixelify Sans", sans-serif';

const C = {
  BG:        0x232323,
  TEXT_DARK: '#3A1A08',
  TEXT_DIM:  '#8a7a6a',
  TEXT_BEIGE:'#DEC998',
  GOLD:      '#FFD700',
  RED:       '#ff5555',
  GREEN:     '#6DD400',
  GREEN_DARK:'#2E5C0A',
  CARD_TAN:  0xD9A66C,
  CARD_PLATE: 0xB8874E,
  CARD_EQUIP: 0xBFE08A,
  CARD_SELECTED: 0xFFD966,
} as const;

// Order drives both tab render order and default active category (first = default).
const CATEGORIES: ShopCategory[] = ['brows', 'eyes', 'mouth', 'accessories'];
const CAT_LABELS: Record<ShopCategory, string> = {
  eyes: 'Eyes',
  mouth: 'Mouths',
  brows: 'Brows',
  accessories: 'Extras',
};
// Tabs show the actual character-part textures as icons, so the label can stay
// short enough for a single 4-across tab row even in portrait.
const CAT_ICONS: Record<ShopCategory, string> = {
  eyes: 'char-eye-normal',
  mouth: 'char-mouth-happy',
  brows: 'char-brow-normal',
  accessories: 'char-acc-crown',
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

  // Currently selected item — set on every card tap. Owned items equip on tap;
  // unowned items stay "armed" (previewed on Splot + Buy CTA in the detail
  // panel) until bought, deselected, or another item is tapped.
  private selectedItemId: string | null = null;
  private activePopup: Phaser.GameObjects.Container | null = null;

  // Guards every scene.start(...) call — prevents double-tapping the home
  // button, and gates buyItem/equipItem's async continuations from rebuilding
  // the UI after the player has already navigated away mid-request.
  private navigating = false;

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
    this.selectedItemId = null;
    this.activePopup = null;
    this.navigating = false;
    this.scrollMaskGfx = null;
    this.scrollContainer = null;
    this.scrollThumb = null;
    this.scrollTrack = null;
    this.scrollViewport = { x: 0, y: 0, w: 0, h: 0 };
    this.scrollMaxOffset = 0;
    this.cardRects = [];
    this.dragState = { active: false, startPointerY: 0, startOffset: 0, moved: 0, downRecord: null };
  }

  async create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(400, 10, 5, 14);

    this.input.on('pointermove', this.onPointerMoveBound);
    this.input.on('pointerup', this.onPointerUpBound);
    this.input.on('wheel', this.onWheelBound);

    this.buildBackground();
    await this.loadProfile();

    this.buildUI();
    this.scale.on('resize', this.onResize, this);
  }

  private async loadProfile() {
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) {
        const data: ProfileResponse = await res.json();
        this.sparks = data.sparks ?? 0;
        this.unlockedItems = new Set(data.unlockedItems ?? []);
        this.equippedItems = data.equippedItems ?? {};
      }
    } catch { /* offline fallback */ }
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

  // What Splot wears right now: equipped items, plus the armed (selected but
  // unowned) item layered on top so try-ons survive UI rebuilds instead of
  // vanishing the moment the pointer lifts.
  private previewedEquipment(): Record<string, string> {
    const sel = this.selectedItem();
    if (sel && !this.unlockedItems.has(sel.id)) {
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
    // Categories hold 3–5 items — fewer, larger cards showcase the art better
    // than a wide grid of small ones.
    const cols = this.computeCols(gridW, 200, 20, 3);
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
    this.buildDetailArea(pad + panelW * 0.72, panelY, panelW * 0.50, panelH - 26, els);

    // Category tabs — one row of 4 (icons keep the labels short enough)
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
    const cols = this.computeCols(gridW, 140, 14, 3);
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
    const pillW = Math.max(90, Math.min(150, Math.round((x1 - x0) * 0.26)));
    this.buildSparksPill(x1 - pillW / 2, y, pillW, pillH, els);

    // SHOP wordmark, centered between the buttons
    const fs = Math.max(20, Math.min(30, Math.round(headerH * 0.40)));
    const title = this.add.text(0, 0, 'SHOP', {
      fontFamily: PIXELIFY, fontSize: `${fs}px`, color: C.TEXT_BEIGE, fontStyle: 'bold',
      shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 0, fill: true },
    }).setOrigin(0, 0.5);
    const iconSz = Math.round(fs * 1.05);
    const totalW = iconSz + 8 + title.width;
    const icon = addDepthIcon(this, -totalW / 2 + iconSz / 2, 0, 'icon-bag', iconSz, iconSz);
    title.setX(-totalW / 2 + iconSz + 8);
    const bar = this.add.container((x0 + x1) / 2, y, [icon, title]).setDepth(12).setAlpha(0);
    this.tweens.add({ targets: bar, alpha: 1, duration: 240, delay: 60 });
    els.push(bar);
  }

  private spawnSplot(x: number, y: number, size: number, els: Phaser.GameObjects.GameObject[]) {
    this.splot?.stopIdleAnims();
    // Soft procedural contact shadow (same as the home screen) — the sprite
    // shadow reads as a hard black blob inside the beige preview panel.
    this.splot = new SplotMascot(this, x, y, size, this.previewedEquipment(), undefined, true);
    this.splot.container.setDepth(5);
    els.push(this.splot.container);
  }

  // ── Item detail card: name, price/status row, and a Buy/Equip CTA for the
  // selected item. Gives purchases an explicit, discoverable action instead of
  // relying solely on the tap-twice-on-the-card gesture. ─────────────────────
  private buildDetailArea(cx: number, cy: number, w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const item = this.selectedItem();
    const nameFs = Math.max(14, Math.min(20, Math.round(w * 0.075)));
    const subFs  = Math.max(11, Math.min(15, Math.round(w * 0.058)));

    if (!item) {
      els.push(this.add.text(cx, cy - h * 0.14, 'Splot', {
        fontFamily: PIXELIFY, fontSize: `${nameFs}px`, color: C.TEXT_DARK,
        shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(6));
      els.push(this.add.text(cx, cy + h * 0.10, 'Tap an item to try it on!', {
        fontFamily: PIXELIFY, fontSize: `${subFs}px`, color: C.TEXT_DIM,
        align: 'center', wordWrap: { width: w - 12 },
      }).setOrigin(0.5).setDepth(6));
      return;
    }

    const owned = this.unlockedItems.has(item.id);
    const equipped = this.equippedItems[item.slot] === item.id;

    els.push(this.add.text(cx, cy - h * 0.32, item.label, {
      fontFamily: PIXELIFY, fontSize: `${nameFs}px`, color: C.TEXT_DARK,
      align: 'center', wordWrap: { width: w - 8 },
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(6));

    // Status row: equipped / owned / price
    const statusY = cy - h * 0.08;
    if (equipped) {
      const check = addDepthIcon(this, -subFs * 2.6, 0, 'icon-check', subFs * 1.1, subFs * 1.1);
      const txt = this.add.text(-subFs * 1.8, 0, 'Equipped', {
        fontFamily: PIXELIFY, fontSize: `${subFs}px`, color: C.GREEN_DARK,
      }).setOrigin(0, 0.5);
      els.push(this.add.container(cx, statusY, [check, txt]).setDepth(6));
    } else if (owned) {
      els.push(this.add.text(cx, statusY, 'Owned', {
        fontFamily: PIXELIFY, fontSize: `${subFs}px`, color: C.TEXT_DIM,
      }).setOrigin(0.5).setDepth(6));
    } else {
      const spark = this.add.image(-subFs * 2.2, 0, 'icon-spark').setDisplaySize(subFs * 1.2, subFs * 1.2);
      const txt = this.add.text(-subFs * 1.2, 0, `${item.price}`, {
        fontFamily: PIXELIFY, fontSize: `${subFs + 2}px`,
        color: this.sparks >= item.price ? C.GOLD : C.RED,
        shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
      }).setOrigin(0, 0.5);
      els.push(this.add.container(cx, statusY, [spark, txt]).setDepth(6));
    }

    // CTA scales with the detail area; the adaptive button shell handles
    // sub-65px heights with the small-corner pieces.
    const btnW = Math.min(w, Math.max(150, Math.round(w * 0.92)));
    const btnH = Math.max(50, Math.min(64, Math.round(h * 0.34)));
    const btnY = cy + h * 0.30;
    const canAfford = this.sparks >= item.price;
    let cta: Phaser.GameObjects.Container;
    if (equipped) {
      cta = addBeigeButton(this, {
        x: cx, y: btnY, width: btnW, height: btnH,
        label: 'Equipped', fontFamily: PIXELIFY, disabled: true,
      });
    } else if (owned) {
      cta = addBeigeButton(this, {
        x: cx, y: btnY, width: btnW, height: btnH,
        label: 'Equip', iconKey: 'icon-check', fontFamily: PIXELIFY,
        onClick: () => void this.equipItem(item),
      });
    } else {
      cta = addBeigeButton(this, {
        x: cx, y: btnY, width: btnW, height: btnH,
        label: canAfford ? `Buy  ${item.price}` : 'Need more',
        iconKey: canAfford ? 'icon-spark' : 'icon-lock',
        fontFamily: PIXELIFY, disabled: !canAfford,
        ...(canAfford ? { onClick: () => this.showBuyConfirm(item) } : {}),
      });
    }
    cta.setDepth(8).setAlpha(0);
    this.tweens.add({ targets: cta, alpha: 1, duration: 200, delay: 60 });
    els.push(cta);
  }

  // ── Category tabs: icon above label, active tab full-strength with green
  // label, inactive tabs dimmed ──────────────────────────────────────────────
  private buildCategoryTabs(rects: Rect[], els: Phaser.GameObjects.GameObject[]) {
    CATEGORIES.forEach((cat, i) => {
      const r = rects[i];
      if (!r) return;
      const active = cat === this.activeCategory;
      const fs = Math.max(10, Math.min(15, Math.round(r.h * 0.185)));
      const iconSz = Math.round(r.h * 0.32);

      const shell = addBeigeButtonShell(this, r.x, r.y, r.w, r.h, false, () => {
        if (this.activeCategory === cat) return;
        this.activeCategory = cat;
        this.selectedItemId = null;
        this.buildUI();
      });
      shell.container.setDepth(6);
      if (!active) shell.visual.setAlpha(0.55);

      // Icon + label side by side, vertically centered — stacked layouts push
      // content into the button's thick corner-border zone and look clipped.
      const label = this.add.text(0, 0, CAT_LABELS[cat], {
        fontFamily: PIXELIFY,
        fontSize: `${fs}px`,
        color: active ? C.GREEN_DARK : C.TEXT_DARK,
        shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
      }).setOrigin(0, 0.5);
      const totalW = iconSz + 6 + label.width;
      const icon = addDepthIcon(this, -totalW / 2 + iconSz / 2, 0, CAT_ICONS[cat], iconSz, iconSz);
      label.setX(-totalW / 2 + iconSz + 6);
      shell.addContent([icon, label]);

      els.push(shell.container);
    });
  }

  private buildSparksPill(x: number, y: number, w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const fs = Math.max(10, Math.round(h * 0.32));
    const iconSz = Math.max(12, Math.round(h * 0.42));
    // Non-interactive (no onClick) — the adaptive shell inside addBeigeButton
    // picks small-corner pieces automatically below the 65px asset floor.
    const button = addBeigeButton(this, { x, y, width: w, height: h, label: '', fontSize: fs, fontFamily: PIXELIFY })
      .setDepth(12);
    const icon = addDepthIcon(this, -w * 0.24, -1, 'icon-spark', iconSz, iconSz);
    this.sparksText = this.add.text(-w * 0.24 + iconSz * 0.6 + 5, -1, `${this.sparks}`, {
      fontFamily: PIXELIFY, fontSize: `${fs}px`, color: C.TEXT_DARK,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0, 0.5);
    button.add([icon, this.sparksText]);
    els.push(button);
  }

  private buildIconButton(x: number, y: number, size: number, iconKey: string, onClick: () => void): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, x, y, size, size, false, onClick);
    const iconSize = Math.round(size * 0.42);
    shell.addContent([addDepthIcon(this, 0, -1, iconKey, iconSize, iconSize)]);
    return shell.container;
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

    const scrollContainer = this.add.container(vx, vy).setDepth(6);
    this.scrollMaskGfx = this.make.graphics();
    applyRectClip(this, scrollContainer, this.scrollMaskGfx, vx, vy, vw, vh);
    this.scrollContainer = scrollContainer;

    filtered.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = offsetX + col * (cardSize + gap) + cardSize / 2;
      const cy = row * (cardSize + gap) + cardSize / 2;

      const owned = this.unlockedItems.has(item.id);
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
    // transparent, which read as near-black over the dark grid panel). Natural
    // button-face beige for the default state; tint only marks state.
    const bg = addBeigeSolidCard(this, 0, 0, size, size);
    if (equipped) bg.setTint(C.CARD_EQUIP);
    else if (selected) bg.setTint(C.CARD_SELECTED);

    const content: Phaser.GameObjects.GameObject[] = [bg];

    // Translucent slot inset behind the art — over the beige slab it reads as
    // a subtly darker plate that frames the customization art.
    const plate = addBeigeCard(this, 0, -size * 0.11, size * 0.82, size * 0.58);
    if (selected) plate.setTint(0xE0B550);
    content.push(plate);

    // The customization art is the card's hero — keep it as large as the
    // plate allows.
    const iconSize = size * 0.56;
    content.push(this.add.image(0, -size * 0.11, item.iconKey).setDisplaySize(iconSize, iconSize));

    const lbl = this.add.text(0, size * 0.225, item.label, {
      fontFamily: PIXELIFY,
      fontSize: `${Math.max(11, Math.round(size * 0.085))}px`,
      color: C.TEXT_DARK,
      align: 'center',
      wordWrap: { width: size - 14 },
    }).setOrigin(0.5, 0);
    content.push(lbl);

    const badgeX = size / 2 - size * 0.14;
    const badgeY = -size / 2 + size * 0.14;
    if (equipped) {
      content.push(addDepthIcon(this, badgeX, badgeY, 'icon-check', size * 0.17, size * 0.17));
    } else if (!owned) {
      content.push(addDepthIcon(this, badgeX, badgeY, 'icon-lock', size * 0.20, size * 0.20));
      // Price row — kept above the card's bottom corner bevel
      const priceFs = Math.max(10, Math.round(size * 0.09));
      const spark = this.add.image(-size * 0.10, size * 0.375, 'icon-spark')
        .setDisplaySize(size * 0.13, size * 0.13);
      const priceTxt = this.add.text(-size * 0.02, size * 0.375, `${item.price}`, {
        fontFamily: PIXELIFY,
        fontSize: `${priceFs}px`,
        color: this.sparks >= item.price ? C.GOLD : C.RED,
        shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
      }).setOrigin(0, 0.5);
      content.push(spark, priceTxt);
    }

    return this.add.container(0, 0, content).setSize(size, size);
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

  private updateScrollThumb() {
    if (!this.scrollThumb || !this.scrollContainer || this.scrollMaxOffset <= 0) return;
    const offset = this.scrollContainer.y - this.scrollViewport.y; // in [-max, 0]
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
      });
      // The player may have tapped Home while this request was in flight —
      // don't rebuild UI/touch the scene after it's already shut down.
      if (this.navigating) return;
      if (!res.ok) {
        this.showToast('Could not equip that item.', C.RED);
        this.splot?.setExpression('sad', 1200);
        return;
      }
      const data: EquipResponse = await res.json();
      this.equippedItems = data.equippedItems;
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
        this.splot?.setExpression('sad', 1200);
        this.showToast('Not enough Sparks!', C.RED);
        return;
      }
      const res = await fetch('/api/user/buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId: item.id }),
      });
      // The player may have tapped Home while this request was in flight —
      // don't rebuild UI/touch the scene after it's already shut down.
      if (this.navigating) return;
      if (!res.ok) { this.showToast('Purchase failed.', C.RED); return; }
      const data: BuyResponse = await res.json();
      this.sparks = data.sparks;
      this.unlockedItems = new Set(data.unlockedItems);
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
    if (this.unlockedItems.has(item.id) && this.equippedItems[item.slot] !== item.id) {
      await this.equipItem(item, true);
    }
  }

  // ── Buy-confirmation popup ───────────────────────────────────────────────
  private showBuyConfirm(item: ShopItem) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const popW = Math.min(width - 48, 320);
    const popH = 280;
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    const shell = addBeigeButtonShell(this, cx, cy, popW, popH, false);
    const content: Phaser.GameObjects.GameObject[] = [];
    content.push(this.add.text(0, -popH / 2 + 30, 'Buy this item?', {
      fontFamily: PIXELIFY, fontSize: '18px', color: C.TEXT_DARK,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));
    content.push(this.add.image(0, -popH / 2 + 96, item.iconKey).setDisplaySize(76, 76));
    content.push(this.add.text(0, -popH / 2 + 148, item.label, {
      fontFamily: PIXELIFY, fontSize: '14px', color: C.TEXT_DARK,
    }).setOrigin(0.5));
    content.push(addDepthIcon(this, -18, -popH / 2 + 176, 'icon-spark', 20, 20));
    content.push(this.add.text(-2, -popH / 2 + 176, `${item.price}`, {
      fontFamily: PIXELIFY, fontSize: '16px', color: C.GOLD,
      shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
    }).setOrigin(0, 0.5));
    shell.addContent(content);
    items.push(shell.container);

    const canAfford = this.sparks >= item.price;
    const btnGap = 12;
    const btnW = (popW - 48 - btnGap) / 2;
    const btnH = 66;
    const btnY = cy + popH / 2 - 44;
    items.push(addBeigeButton(this, {
      x: cx - btnW / 2 - btnGap / 2, y: btnY, width: btnW, height: btnH,
      label: 'Cancel', fontFamily: PIXELIFY,
      onClick: () => this.closeActivePopup(),
    }));
    items.push(addBeigeButton(this, {
      x: cx + btnW / 2 + btnGap / 2, y: btnY, width: btnW, height: btnH,
      label: canAfford ? 'Buy' : 'Need more', fontFamily: PIXELIFY,
      disabled: !canAfford,
      onClick: () => { this.closeActivePopup(); void this.buyThenEquip(item); },
    }));

    this.activePopup = this.add.container(0, 0, items).setDepth(60).setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: this.activePopup, alpha: 1, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
  }

  private closeActivePopup() {
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
    const txt = this.add.text(0, 0, msg, {
      fontFamily: PIXELIFY, fontSize: '14px', color,
    }).setOrigin(0.5);
    const bg = addDarkPanel(this, 0, 0, Math.ceil(txt.width) + 36, 42);
    const toast = this.add.container(width / 2, height * 0.92, [bg, txt])
      .setDepth(30).setAlpha(0);
    this.tweens.add({ targets: toast, alpha: 1, duration: 200 });
    this.time.delayedCall(2000, () => {
      this.tweens.add({ targets: toast, alpha: 0, duration: 300, onComplete: () => toast.destroy(true) });
    });
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
    this.buildUI();
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
    this.scrollMaskGfx?.destroy();
    this.scrollMaskGfx = null;
  }
}
