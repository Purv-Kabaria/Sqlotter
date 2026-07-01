import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import {
  addBeigeBadge, addBeigeButton, addBeigeButtonShell, addDepthIcon, addPanel9,
} from '../components/PixelUI';
import { SHOP_ITEMS } from '../../shared/shop';
import type { ShopCategory, ShopItem } from '../../shared/shop';
import type { BuyResponse, EquipResponse, ProfileResponse } from '../../shared/api';

const PIXELIFY = '"Pixelify Sans", sans-serif';

const C = {
  BG:        0x232323,
  TEXT_DARK: '#3A1A08',
  TEXT_DIM:  '#8a7a6a',
  GOLD:      '#FFD700',
  RED:       '#ff5555',
  GREEN:     '#6DD400',
} as const;

// Order drives both tab render order and default active category (first = default).
const CATEGORIES: ShopCategory[] = ['brows', 'eyes', 'mouth', 'accessories'];
const CAT_LABELS: Record<ShopCategory, string> = {
  eyes: 'Eyes',
  mouth: 'Mouths',
  brows: 'Eyebrows',
  accessories: 'Accessories',
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

  // Unowned item "armed" for purchase — first tap previews + arms it, a second
  // tap on the same item opens the buy-confirmation popup.
  private selectedItemId: string | null = null;
  private activePopup: Phaser.GameObjects.Container | null = null;

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

    const { width, height } = this.scale;
    const els: Phaser.GameObjects.GameObject[] = [];

    if (height > width) {
      this.buildPortraitLayout(width, height, els);
    } else {
      this.buildLandscapeLayout(width, height, els);
    }

    this.uiLayer = this.add.container(0, 0, els);
  }

  // ── Landscape: left beige panel (Splot preview, addPanel9 — same component
  // MainMenu uses) + right dark column with header, category tabs, and a
  // scrollable item grid stacked top-to-bottom ─────────────────────────────
  private buildLandscapeLayout(w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const pad = 24;
    const splitX = Math.round(w * 0.42);
    const rightW = w - splitX;

    // Left panel — Splot preview
    const panelW = splitX - pad;
    const panelH = h - pad * 2;
    els.push(addPanel9(this, splitX / 2, h / 2, panelW, panelH).setDepth(3));
    const splotSz = Math.min(panelW * 0.72, panelH * 0.72, 440);
    this.spawnSplot(splitX / 2, h / 2 - splotSz * 0.04, splotSz, els);

    // Right dark column
    els.push(this.add.rectangle(splitX + rightW / 2, h / 2, rightW, h, C.BG).setDepth(2));

    // Header row: home (left) + sparks pill (right), vertically aligned
    const homeSize = Math.max(66, Math.min(80, Math.round(rightW * 0.16)));
    const pillH = Math.max(34, Math.min(56, Math.round(h * 0.08)));
    const pillW = Math.max(90, Math.min(120, Math.round(rightW * 0.28)));
    const headerH = Math.max(homeSize, pillH);
    const headerY = pad + headerH / 2;
    els.push(this.buildIconButton(splitX + pad + homeSize / 2, headerY, homeSize, 'icon-home', () => this.goToMenu()).setDepth(15));
    this.buildSparksPill(w - pillW / 2 - pad, headerY, pillW, pillH, els);

    // SQLOTTER logo, centered under the header row
    let contentBottom = headerY + headerH / 2 + 10;
    if (this.textures.exists('title')) {
      const logoW = Math.max(0, Math.min(rightW * 0.75, 380, rightW - pad * 2));
      const logoH = Math.round(logoW * 112 / 512);
      const logoY = contentBottom + logoH / 2;
      const logo = this.add.image(splitX + rightW / 2, logoY, 'title').setDisplaySize(logoW, logoH).setDepth(11);
      els.push(logo);
      this.tweens.add({ targets: logo, y: logoY + 4, duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      contentBottom = logoY + logoH / 2 + 12;
    }

    // Category tabs — single row spanning the full right column width
    const tabGap = 10;
    const tabW = (rightW - pad * 2 - tabGap * (CATEGORIES.length - 1)) / CATEGORIES.length;
    const tabH = Math.max(66, Math.min(80, Math.round(h * 0.09)));
    const tabRects: Rect[] = CATEGORIES.map((_, i) => ({
      x: splitX + pad + tabW / 2 + i * (tabW + tabGap), y: contentBottom + tabH / 2, w: tabW, h: tabH,
    }));
    this.buildCategoryTabs(tabRects, els);
    contentBottom += tabH + 14;

    // Scrollable item grid, filling the rest of the right column
    const gridX = splitX + pad;
    const gridW = rightW - pad * 2;
    const gridH = Math.max(80, h - contentBottom - pad);
    const cols = this.computeCols(gridW, 160, 16, 4);
    this.buildScrollGrid(gridX, contentBottom, gridW, gridH, cols, els);
  }

  // ── Portrait: home + sparks pill overlay the top corners of a full-width
  // Splot preview panel, a 2×2 category tab grid follows, then a scrollable
  // item grid ────────────────────────────────────────────────────────────
  private buildPortraitLayout(w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const pad = 12;

    const panelW = w - pad * 2;
    const panelH = Math.min(h * 0.42, panelW * 0.95);
    const panelX = w / 2;
    const panelY = pad + panelH / 2;
    els.push(addPanel9(this, panelX, panelY, panelW, panelH).setDepth(3));
    const splotSz = Math.min(panelW * 0.72, panelH * 0.72, 320);
    this.spawnSplot(panelX, panelY - panelH * 0.02, splotSz, els);

    const homeSize = Math.max(66, Math.min(72, Math.round(w * 0.20)));
    els.push(this.buildIconButton(
      pad + homeSize / 2 + 4, pad + homeSize / 2 + 4, homeSize, 'icon-home', () => this.goToMenu(),
    ).setDepth(15));

    const pillW = Math.max(76, Math.min(100, w * 0.28));
    const pillH = Math.max(30, Math.min(40, homeSize * 0.7));
    this.buildSparksPill(w - pad - pillW / 2 - 4, pad + pillH / 2 + 4, pillW, pillH, els);

    // Category tabs — 2×2 grid below the panel (compact labels don't fit a single row)
    const tabsTop = panelY + panelH / 2 + 14;
    const tabGap = 10;
    const tabW = (panelW - tabGap) / 2;
    const tabH = Math.max(66, Math.min(80, h * 0.09));
    const tabRects: Rect[] = CATEGORIES.map((_, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      return {
        x: pad + tabW / 2 + col * (tabW + tabGap),
        y: tabsTop + tabH / 2 + row * (tabH + tabGap),
        w: tabW, h: tabH,
      };
    });
    this.buildCategoryTabs(tabRects, els);

    const gridTop = tabsTop + tabH * 2 + tabGap + 14;
    const gridW = w - pad * 2;
    const gridH = Math.max(120, h - gridTop - pad);
    const cols = this.computeCols(gridW, 160, 16, 2);
    this.buildScrollGrid(pad, gridTop, gridW, gridH, cols, els);
  }

  private spawnSplot(x: number, y: number, size: number, els: Phaser.GameObjects.GameObject[]) {
    this.splot?.stopIdleAnims();
    this.splot = new SplotMascot(this, x, y, size, this.equippedItems);
    this.splot.container.setDepth(5);
    els.push(this.splot.container);
  }

  // ── Category tabs: caller supplies exact rects (single row in landscape,
  // 2×2 grid in portrait) ──────────────────────────────────────────────────
  private buildCategoryTabs(rects: Rect[], els: Phaser.GameObjects.GameObject[]) {
    CATEGORIES.forEach((cat, i) => {
      const r = rects[i];
      if (!r) return;
      const active = cat === this.activeCategory;
      const fs = Math.max(11, Math.min(16, Math.round(r.h * 0.24)));

      const shell = addBeigeButtonShell(this, r.x, r.y, r.w, r.h, false, () => {
        if (this.activeCategory === cat) return;
        this.activeCategory = cat;
        this.selectedItemId = null;
        this.buildUI();
      });
      shell.container.setDepth(6);
      if (!active) shell.visual.setAlpha(0.6);

      const label = this.add.text(0, 0, CAT_LABELS[cat], {
        fontFamily: PIXELIFY,
        fontSize: `${fs}px`,
        color: active ? '#2E5C0A' : C.TEXT_DARK,
        shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
      }).setOrigin(0.5);
      shell.addContent([label]);

      els.push(shell.container);
    });
  }

  private buildSparksPill(x: number, y: number, w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const fs = Math.max(10, Math.round(h * 0.32));
    const iconSz = Math.max(12, Math.round(h * 0.42));
    const button = (h < 65 || w < 65
      ? addBeigeBadge(this, x, y, w, h)
      : addBeigeButton(this, { x, y, width: w, height: h, label: '', fontSize: fs, fontFamily: PIXELIFY })
    ).setDepth(12);
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

  // ── Scrollable item grid: masked container (mask applied to the Container,
  // matching Game.ts's proven modifier-palette scroll pattern) + drag/wheel
  // scroll + manual tap dispatch (cards aren't interactive themselves, which
  // avoids drag/tap conflicts — see hitTestCard) ───────────────────────────
  private buildScrollGrid(vx: number, vy: number, vw: number, vh: number, cols: number, els: Phaser.GameObjects.GameObject[]) {
    const gap = Math.max(10, Math.round(vw * 0.04));
    const cardSize = Math.min(220, Math.floor((vw - gap * (cols - 1)) / cols));
    const contentW = cardSize * cols + gap * (cols - 1);
    const offsetX = Math.max(0, (vw - contentW) / 2);

    const filtered = SHOP_ITEMS.filter(it => it.category === this.activeCategory);
    const rows = Math.max(1, Math.ceil(filtered.length / cols));
    const contentH = rows * cardSize + (rows - 1) * gap;
    const maxScroll = Math.max(0, contentH - vh);

    this.scrollViewport = { x: vx, y: vy, w: vw, h: vh };
    this.scrollMaxOffset = maxScroll;
    this.cardRects = [];

    this.scrollMaskGfx = this.make.graphics();
    this.scrollMaskGfx.fillStyle(0xffffff);
    this.scrollMaskGfx.fillRect(vx, vy, vw, vh);
    const mask = this.scrollMaskGfx.createGeometryMask();

    const scrollContainer = this.add.container(vx, vy).setMask(mask).setDepth(6);
    this.scrollContainer = scrollContainer;

    filtered.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = offsetX + col * (cardSize + gap) + cardSize / 2;
      const cy = row * (cardSize + gap) + cardSize / 2;

      const owned = this.unlockedItems.has(item.id);
      const equipped = Object.values(this.equippedItems).includes(item.id);
      const selected = !owned && this.selectedItemId === item.id;

      const card = this.buildItemCard(cardSize, item, owned, equipped, selected);
      card.setPosition(cx, cy);
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
      this.scrollTrack = this.add.rectangle(trackX, vy + vh / 2, 4, vh, 0x000000, 0.2).setDepth(8);
      const thumbH = Math.max(28, vh * (vh / contentH));
      this.scrollThumb = this.add.rectangle(trackX, vy, 4, thumbH, 0xffffff, 0.55).setOrigin(0.5, 0).setDepth(9);
      els.push(this.scrollTrack, this.scrollThumb);
    } else {
      this.scrollTrack = null;
      this.scrollThumb = null;
    }
  }

  // Cards use the same beige *button* asset as category tabs / level-select
  // cards (addBeigeButtonShell) — not addBeigeCard, whose source texture is a
  // plain pale-gray slot, not a warm panel. Art is shown full-color/size
  // regardless of ownership so players can see exactly what they'd get.
  private buildItemCard(size: number, item: ShopItem, owned: boolean, equipped: boolean, selected: boolean): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, 0, 0, size, size, false);
    if (equipped) {
      this.tintShellBg(shell, 0xBFE08A);
    } else if (selected) {
      this.tintShellBg(shell, 0xFFD966);
    }

    const content: Phaser.GameObjects.GameObject[] = [];

    const iconSize = size * 0.58;
    content.push(this.add.image(0, -size * 0.08, item.iconKey).setDisplaySize(iconSize, iconSize));

    const lbl = this.add.text(0, size * 0.24, item.label, {
      fontFamily: PIXELIFY,
      fontSize: `${Math.max(11, Math.round(size * 0.085))}px`,
      color: C.TEXT_DARK,
      align: 'center',
      wordWrap: { width: size - 14 },
    }).setOrigin(0.5, 0);
    content.push(lbl);

    if (equipped) {
      content.push(addDepthIcon(this, size / 2 - size * 0.13, -size / 2 + size * 0.13, 'icon-check', size * 0.16, size * 0.16));
    } else if (!owned) {
      content.push(addDepthIcon(this, size / 2 - size * 0.13, -size / 2 + size * 0.13, 'icon-lock', size * 0.14, size * 0.14));
      content.push(this.add.image(-size * 0.10, size * 0.42, 'icon-spark').setDisplaySize(size * 0.13, size * 0.13));
      const priceTxt = this.add.text(size * 0.02, size * 0.42, `${item.price}`, {
        fontFamily: PIXELIFY,
        fontSize: `${Math.max(10, Math.round(size * 0.09))}px`,
        color: this.sparks >= item.price ? C.GOLD : C.RED,
      }).setOrigin(0, 0.5);
      content.push(priceTxt);
    }

    shell.addContent(content);
    return shell.container;
  }

  // Tints just the beige background pieces (not the icon/label/badges added
  // afterward via addContent) — see docs/9-slicing.md's addBeigeButtonShell notes.
  private tintShellBg(shell: { visual: Phaser.GameObjects.Container }, color: number) {
    shell.visual.list
      .filter((o): o is Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite =>
        o instanceof Phaser.GameObjects.Image || o instanceof Phaser.GameObjects.TileSprite)
      .forEach(p => p.setTint(color));
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

  // Owned items equip immediately (free, reversible). Unowned items need two
  // taps: the first arms + previews the item on Splot, the second (on the
  // same still-armed item) opens the buy-confirmation popup — see showBuyConfirm.
  private handleCardTap(rec: CardRecord) {
    if (rec.owned) {
      if (!rec.equipped) void this.equipItem(rec.item);
      return;
    }
    if (this.selectedItemId !== rec.item.id) {
      this.selectedItemId = rec.item.id;
      this.buildUI();
      return;
    }
    this.showBuyConfirm(rec.item);
  }

  private async equipItem(item: ShopItem) {
    if (this.pendingItemIds.has(item.id)) return;
    this.pendingItemIds.add(item.id);
    try {
      const res = await fetch('/api/user/equip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: item.slot, itemId: item.id }),
      });
      if (!res.ok) {
        this.showToast('Could not equip that item.', C.RED);
        this.splot?.setExpression('sad', 1200);
        return;
      }
      const data: EquipResponse = await res.json();
      this.equippedItems = data.equippedItems;
      this.showToast(`Equipped ${item.label}!`, C.GREEN);
      this.splot?.refresh(this.equippedItems);
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
      if (!res.ok) { this.showToast('Purchase failed.', C.RED); return; }
      const data: BuyResponse = await res.json();
      this.sparks = data.sparks;
      this.unlockedItems = new Set(data.unlockedItems);
      this.showToast(`Got ${item.label}!`, C.GREEN);
      this.selectedItemId = null;
      this.buildUI();
    } catch {
      this.showToast('Purchase failed.', C.RED);
      this.splot?.setExpression('sad', 1200);
    } finally {
      this.pendingItemIds.delete(item.id);
    }
  }

  // ── Buy-confirmation popup ───────────────────────────────────────────────
  private showBuyConfirm(item: ShopItem) {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const popW = Math.min(width - 48, 320);
    const popH = 260;
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
    content.push(addDepthIcon(this, -18, -popH / 2 + 180, 'icon-spark', 20, 20));
    content.push(this.add.text(-2, -popH / 2 + 180, `${item.price}`, {
      fontFamily: PIXELIFY, fontSize: '16px', color: C.GOLD,
    }).setOrigin(0, 0.5));
    shell.addContent(content);
    items.push(shell.container);

    const canAfford = this.sparks >= item.price;
    const btnGap = 12;
    const btnW = (popW - 48 - btnGap) / 2;
    const btnH = 52;
    const btnY = cy + popH / 2 - 40;
    items.push(addBeigeButton(this, {
      x: cx - btnW / 2 - btnGap / 2, y: btnY, width: btnW, height: btnH,
      label: 'Cancel', fontFamily: PIXELIFY,
      onClick: () => this.closeActivePopup(),
    }));
    items.push(addBeigeButton(this, {
      x: cx + btnW / 2 + btnGap / 2, y: btnY, width: btnW, height: btnH,
      label: canAfford ? 'Buy' : 'Need more', fontFamily: PIXELIFY,
      disabled: !canAfford,
      onClick: () => { this.closeActivePopup(); void this.buyItem(item); },
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

  // Previews any item (owned or not) live on Splot — lets players see a look
  // before spending sparks on it.
  private previewItem(item: ShopItem, owned: boolean) {
    if (!this.splot) return;
    this.splot.refresh({ ...this.equippedItems, [item.slot]: item.id });
    this.splot.setExpression(owned || this.sparks >= item.price ? 'doubt' : 'sad', 900);
  }

  private restorePreview() {
    this.splot?.refresh(this.equippedItems);
  }

  private showToast(msg: string, color: string) {
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height * 0.92, msg, {
      fontFamily: PIXELIFY, fontSize: '14px', color,
      backgroundColor: '#0d0620', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 200 });
    this.time.delayedCall(2000, () => {
      this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => t.destroy() });
    });
  }

  private goToMenu() {
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
    this.splot?.stopIdleAnims();
    this.scale.off('resize', this.onResize, this);
    this.input.off('pointermove', this.onPointerMoveBound);
    this.input.off('pointerup', this.onPointerUpBound);
    this.input.off('wheel', this.onWheelBound);
    this.scrollMaskGfx?.destroy();
    this.scrollMaskGfx = null;
  }
}
