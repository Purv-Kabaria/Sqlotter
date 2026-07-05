import * as Phaser from 'phaser';
import {
  addBeigeButtonShell, addDarkPanel, addDepthIcon, applyRectClip, PIXEL_FONT,
} from '../components/PixelUI';
import type { LeaderboardEntry } from '../../shared/types';
import type { LeaderboardResponse } from '../../shared/api';

const PIXELIFY = '"Pixelify Sans", sans-serif';
// Press Start 2P's numerals stay legible at small sizes (Pixelify's "5" reads
// ambiguously) — every rank/score text run uses this instead.
const NUM_FONT = PIXEL_FONT;

const C = {
  BG:          0x232323,
  TEXT_DARK:   '#3A1A08',   // tabs — sits on the beige button shell, good contrast there
  TEXT_BEIGE:  '#DEC998',   // row text — sits on the near-black addDarkPanel rows
  GOLD:        '#FFD700',
  GREEN_DARK:  '#1E3D08',   // active tab — darkened from #2E5C0A, which read too close to the beige tab behind it
  GREEN_BRIGHT:'#6DD400',   // current-user row highlight — needs to read on the near-black row panel, not beige
} as const;

type BoardType = 'sparks' | 'moves' | 'played';
type BoardDef = { type: BoardType; label: string; icon: string };

// Order drives both tab render order and the default board shown on open.
const BOARDS: readonly BoardDef[] = [
  { type: 'sparks', label: 'Sparks', icon: 'icon-spark' },
  { type: 'moves',  label: 'Moves',  icon: 'icon-reset' },
  { type: 'played', label: 'Played', icon: 'icon-play' },
];

const MEDAL_KEYS = ['icon-gold', 'icon-silver', 'icon-bronze'] as const;

type Rect = { x: number; y: number; w: number; h: number };

export class Leaderboard extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private uiLayer: Phaser.GameObjects.Container | null = null;
  private activeBoard: BoardType = BOARDS[0]!.type;

  // Discards a fetch response if a newer tab switch has started since it was
  // requested — without this, rapidly switching tabs can let a slow, stale
  // response render on top of (or instead of) the tab the player is now on.
  private loadToken = 0;
  // Guards every scene.start(...) call — prevents double-tapping back, and
  // gates the in-flight fetch from touching a scene that's already shut down.
  private navigating = false;

  // Scrollable list state — same applyRectClip + drag/wheel pattern Shop.ts
  // uses for its item grid, simplified to a single column.
  private scrollContainer: Phaser.GameObjects.Container | null = null;
  private scrollMaskGfx: Phaser.GameObjects.Graphics | null = null;
  private scrollThumb: Phaser.GameObjects.Rectangle | null = null;
  private scrollTrack: Phaser.GameObjects.Rectangle | null = null;
  private scrollViewport: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private scrollMaxOffset = 0;
  private dragState = { active: false, startPointerY: 0, startOffset: 0, moved: 0 };

  private onPointerMoveBound = (p: Phaser.Input.Pointer) => this.onGlobalPointerMove(p);
  private onPointerUpBound = () => this.onGlobalPointerUp();
  private onWheelBound = (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => this.onWheel(p, dy);

  constructor() { super('Leaderboard'); }

  // Accepts (and ignores) an optional levelId — LevelComplete's "Ranks" button
  // still passes one, left over from when this scene showed per-level step/
  // time boards. The leaderboard is now purely global, so there's nothing to
  // filter by; Phaser scenes silently ignore unread init() data.
  init() {
    this.bgLayers = [];
    this.uiLayer = null;
    this.activeBoard = BOARDS[0]!.type;
    this.loadToken = 0;
    this.navigating = false;
    this.scrollContainer = null;
    this.scrollMaskGfx = null;
    this.scrollThumb = null;
    this.scrollTrack = null;
    this.scrollViewport = { x: 0, y: 0, w: 0, h: 0 };
    this.scrollMaxOffset = 0;
    this.dragState = { active: false, startPointerY: 0, startOffset: 0, moved: 0 };
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(400, 10, 5, 14);

    this.input.on('pointermove', this.onPointerMoveBound);
    this.input.on('pointerup', this.onPointerUpBound);
    this.input.on('wheel', this.onWheelBound);

    this.buildBackground();
    this.buildUI();
    void this.loadAndRender();
    this.scale.on('resize', this.onResize, this);
  }

  // ── Background — same drifting pink-cloud technique as MainMenu/Shop ─────
  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg4-1', 'bg4-2', 'bg4-3', 'bg4-4'];
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

  // ── Scene structure — one responsive layout (not a portrait/landscape
  // split like Shop's) since there's no mascot preview to give a second
  // panel content; everything just scales with width/height. ──────────────
  private buildUI() {
    this.uiLayer?.destroy(true);
    this.scrollMaskGfx?.destroy();
    this.scrollMaskGfx = null;
    this.scrollContainer = null;
    // Unlike scrollContainer (a child of the outgoing uiLayer, already killed
    // above), these two are added straight to the scene by renderEntries —
    // nulling the reference without destroying first orphaned the actual
    // rectangle, leaking a stray scrollbar sliver on every rebuild (visible
    // after a resize or tab switch, since both call buildUI()).
    this.scrollThumb?.destroy();
    this.scrollThumb = null;
    this.scrollTrack?.destroy();
    this.scrollTrack = null;

    const { width, height } = this.scale;
    const els: Phaser.GameObjects.GameObject[] = [];
    const pad = Math.max(14, Math.min(24, Math.round(width * 0.03)));

    // Header row: home button — trophy + wordmark — (nothing on the right;
    // there's no per-screen currency/status to show here like Shop's pill)
    const headerH = Math.max(50, Math.min(84, Math.round(height * 0.09)));
    const headerY = pad + headerH / 2;
    const homeSize = Math.max(44, Math.min(64, Math.round(headerH * 0.94)));
    els.push(this.buildIconButton(pad + homeSize / 2, headerY, homeSize, 'icon-arrow', () => this.goToMenu(), 180).setDepth(15));

    const titleFs = Math.max(20, Math.min(30, Math.round(headerH * 0.40)));
    const title = this.add.text(0, 0, 'RANKINGS', {
      fontFamily: PIXELIFY, fontSize: `${titleFs}px`, color: C.TEXT_BEIGE, fontStyle: 'bold',
      shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 0, fill: true },
    }).setOrigin(0, 0.5);
    const iconSz = Math.round(titleFs * 1.05);
    const totalW = iconSz + 8 + title.width;
    const icon = addDepthIcon(this, -totalW / 2 + iconSz / 2, 0, 'icon-trophy', iconSz, iconSz);
    title.setX(-totalW / 2 + iconSz + 8);
    const bar = this.add.container(width / 2, headerY, [icon, title]).setDepth(12).setAlpha(0);
    this.tweens.add({ targets: bar, alpha: 1, duration: 240, delay: 60 });
    els.push(bar);

    // Content column — capped width so it doesn't stretch edge-to-edge on
    // wide desktop windows, matching MainMenu's button-width cap.
    const contentW = Math.min(width - pad * 2, 640);
    const contentX = (width - contentW) / 2;

    // Tabs — same width+height-aware font fit as Shop's category tabs, so a
    // label never overflows its button on a wide window with narrower tabs.
    const tabGap = 10;
    const tabsTop = headerY + headerH / 2 + 14;
    const tabH = Math.max(50, Math.min(84, Math.round(height * 0.09)));
    const tabW = (contentW - tabGap * (BOARDS.length - 1)) / BOARDS.length;
    const tabRects: Rect[] = BOARDS.map((_, i) => ({
      x: contentX + tabW / 2 + i * (tabW + tabGap), y: tabsTop + tabH / 2, w: tabW, h: tabH,
    }));
    this.buildTabs(tabRects, els);

    // Scrollable list fills the rest of the column
    const gridTop = tabsTop + tabH + 14;
    const gridH = Math.max(80, height - gridTop - pad);
    this.buildScrollList(contentX, gridTop, contentW, gridH, els);

    this.uiLayer = this.add.container(0, 0, els);
  }

  private buildIconButton(
    x: number, y: number, size: number, iconKey: string, onClick: () => void, angle = 0,
  ): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, x, y, size, size, false, onClick);
    const iconSize = Math.round(size * 0.42);
    shell.addContent([addDepthIcon(this, 0, -1, iconKey, iconSize, iconSize).setAngle(angle)]);
    return shell.container;
  }

  // ── Board tabs: text-only, active tab in bold green — identical fit logic
  // to Shop's category tabs (see that file for why width matters, not just
  // height). forceSmall keeps the thinner corner asset at tablet sizes. ────
  private buildTabs(rects: Rect[], els: Phaser.GameObjects.GameObject[]) {
    BOARDS.forEach((board, i) => {
      const r = rects[i];
      if (!r) return;
      const active = board.type === this.activeBoard;
      const maxFsForWidth = Math.floor((r.w * 0.78) / (board.label.length * 0.62));
      const fs = Math.max(11, Math.min(22, Math.round(r.h * 0.30), maxFsForWidth));

      const shell = addBeigeButtonShell(this, r.x, r.y, r.w, r.h, false, () => {
        if (this.activeBoard === board.type) return;
        this.activeBoard = board.type;
        this.buildUI();
        void this.loadAndRender();
      }, true);
      shell.container.setDepth(6);

      const label = this.add.text(0, 0, board.label, {
        fontFamily: PIXELIFY,
        fontSize: `${fs}px`,
        color: active ? C.GREEN_DARK : C.TEXT_DARK,
        fontStyle: active ? 'bold' : 'normal',
        shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
      }).setOrigin(0.5);
      shell.addContent([label]);

      els.push(shell.container);
    });
  }

  // ── Scrollable list: container clipped to the viewport rect (see
  // applyRectClip — Phaser 4 WebGL needs a Filters Mask, not a geometry
  // mask) + drag/wheel scroll. Rows are populated later by renderEntries
  // once the fetch resolves, since row count depends on the response. ──────
  private buildScrollList(vx: number, vy: number, vw: number, vh: number, els: Phaser.GameObjects.GameObject[]) {
    this.scrollViewport = { x: vx, y: vy, w: vw, h: vh };
    this.scrollMaxOffset = 0;

    els.push(addDarkPanel(this, vx + vw / 2, vy + vh / 2, vw + 16, vh + 16).setDepth(4).setAlpha(0.92));

    const scrollContainer = this.add.container(vx, vy).setDepth(6);
    this.scrollMaskGfx = this.make.graphics();
    applyRectClip(this, scrollContainer, this.scrollMaskGfx, vx, vy, vw, vh);
    this.scrollContainer = scrollContainer;
    els.push(scrollContainer);

    const zone = this.add.zone(vx + vw / 2, vy + vh / 2, vw, vh).setInteractive();
    zone.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.dragState.active = true;
      this.dragState.startPointerY = p.y;
      this.dragState.startOffset = scrollContainer.y - vy;
      this.dragState.moved = 0;
    });
    els.push(zone);
  }

  private async loadAndRender() {
    const token = ++this.loadToken;

    try {
      const res = await fetch(`/api/leaderboard/global?type=${this.activeBoard}`);
      const data: LeaderboardResponse = res.ok ? await res.json() : { entries: [] };
      if (token !== this.loadToken || this.navigating) return;
      this.renderEntries(data.entries ?? []);
    } catch {
      if (token !== this.loadToken || this.navigating) return;
      this.renderEntries([]);
    }
  }

  private renderEntries(entries: LeaderboardEntry[]) {
    if (!this.scrollContainer) return;
    const { w: vw, h: vh } = this.scrollViewport;
    const board = BOARDS.find(b => b.type === this.activeBoard) ?? BOARDS[0]!;

    if (entries.length === 0) {
      const empty = this.add.text(vw / 2, vh / 2, "No entries yet — be the first!", {
        fontFamily: PIXELIFY, fontSize: `${Math.max(13, Math.round(vw * 0.035))}px`, color: C.TEXT_BEIGE,
        align: 'center', wordWrap: { width: vw - 40 },
      }).setOrigin(0.5);
      this.scrollContainer.add(empty);
      this.scrollTrack?.destroy(); this.scrollTrack = null;
      this.scrollThumb?.destroy(); this.scrollThumb = null;
      this.scrollMaxOffset = 0;
      return;
    }

    const rowGap = Math.max(6, Math.round(vh * 0.012));
    const rowH = Math.max(48, Math.min(72, Math.round((vh - rowGap * 3) / 5.4)));
    const rowW = vw - 20;

    entries.forEach((entry, i) => {
      const ry = 10 + i * (rowH + rowGap) + rowH / 2;
      const row = this.buildRow(rowW, rowH, entry, i, board.icon);
      row.setPosition(10 + rowW / 2, ry).setAlpha(0);
      this.tweens.add({ targets: row, alpha: 1, duration: 200, delay: Math.min(i * 40, 300) });
      this.scrollContainer!.add(row);
    });

    const contentH = 20 + entries.length * rowH + (entries.length - 1) * rowGap;
    this.scrollMaxOffset = Math.max(0, contentH - vh);

    this.scrollTrack?.destroy();
    this.scrollThumb?.destroy();
    if (this.scrollMaxOffset > 0) {
      const { x: vx, y: vy } = this.scrollViewport;
      const trackX = vx + vw - 5;
      this.scrollTrack = this.add.rectangle(trackX, vy + vh / 2, 4, vh, 0x000000, 0.35).setDepth(8);
      const thumbH = Math.max(28, vh * (vh / contentH));
      this.scrollThumb = this.add.rectangle(trackX, vy, 4, thumbH, 0xDEC998, 0.85).setOrigin(0.5, 0).setDepth(9);
    } else {
      this.scrollTrack = null;
      this.scrollThumb = null;
    }
  }

  // Rank/medal — username (bold green + "(You)" tag if it's the current
  // player) — score with the board's icon. Rows aren't interactive; this is
  // a read-only board, so no hover/press state is needed on them (only the
  // tabs and back button, which use addBeigeButtonShell's built-in feedback).
  private buildRow(w: number, h: number, entry: LeaderboardEntry, index: number, scoreIcon: string): Phaser.GameObjects.Container {
    const bg = addDarkPanel(this, 0, 0, w, h).setAlpha(entry.isCurrentUser ? 1 : 0.75);
    const content: Phaser.GameObjects.GameObject[] = [bg];

    const rankColW = h * 0.9;
    const rankX = -w / 2 + rankColW / 2 + 8;
    if (index < 3) {
      const medalSz = Math.min(h * 0.62, 34);
      content.push(this.add.image(rankX, 0, MEDAL_KEYS[index]!).setDisplaySize(medalSz, medalSz));
    } else {
      const rankFs = Math.max(13, Math.min(18, Math.round(h * 0.30)));
      content.push(this.add.text(rankX, 0, `${entry.rank}`, {
        fontFamily: NUM_FONT, fontSize: `${rankFs}px`, color: C.TEXT_BEIGE,
      }).setOrigin(0.5));
    }

    const nameFs = Math.max(13, Math.min(19, Math.round(h * 0.32)));
    const nameX = -w / 2 + rankColW + 14;
    const nameLabel = entry.isCurrentUser ? `${entry.username}  (You)` : entry.username;
    content.push(this.add.text(nameX, 0, nameLabel, {
      fontFamily: PIXELIFY, fontSize: `${nameFs}px`,
      color: entry.isCurrentUser ? C.GREEN_BRIGHT : C.TEXT_BEIGE,
      fontStyle: entry.isCurrentUser ? 'bold' : 'normal',
    }).setOrigin(0, 0.5));

    const scoreFs = Math.max(14, Math.min(20, Math.round(h * 0.34)));
    const scoreIconSz = scoreFs * 1.15;
    const scoreTxt = this.add.text(0, 0, `${entry.score}`, {
      fontFamily: NUM_FONT, fontSize: `${scoreFs}px`,
      color: index === 0 ? C.GOLD : C.TEXT_BEIGE,
      shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
    }).setOrigin(1, 0.5);
    const scoreRight = w / 2 - 12;
    scoreTxt.setX(scoreRight);
    const scoreIconImg = this.add.image(scoreRight - scoreTxt.width - scoreIconSz / 2 - 6, 0, scoreIcon)
      .setDisplaySize(scoreIconSz, scoreIconSz);
    content.push(scoreIconImg, scoreTxt);

    return this.add.container(0, 0, content);
  }

  private onGlobalPointerMove(p: Phaser.Input.Pointer) {
    if (!this.dragState.active || !this.scrollContainer) return;
    const dy = p.y - this.dragState.startPointerY;
    this.dragState.moved = Math.max(this.dragState.moved, Math.abs(dy));
    const newOffset = Phaser.Math.Clamp(this.dragState.startOffset + dy, -this.scrollMaxOffset, 0);
    this.scrollContainer.y = this.scrollViewport.y + newOffset;
    this.updateScrollThumb();
  }

  private onGlobalPointerUp() {
    this.dragState.active = false;
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

  private goToMenu() {
    if (this.navigating) return;
    this.navigating = true;
    this.cameras.main.fadeOut(250, 10, 5, 14);
    this.time.delayedCall(260, () => this.scene.start('MainMenu'));
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    this.buildUI();
    void this.loadAndRender();
  }

  shutdown() {
    this.navigating = true;
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
