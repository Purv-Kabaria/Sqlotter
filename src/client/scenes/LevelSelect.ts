import * as Phaser from 'phaser';
import { addBeigeButton, addBeigeButtonShell, addBeigeIconButton, addDepthIcon } from '../components/PixelUI';
import { CURATED_LEVELS } from '../../shared/levelData';
import type { LevelData } from '../../shared/types';
import type { CommunityLevelSummary, CommunityLevelsResponse } from '../../shared/api';

const PIXELIFY = '"Pixelify Sans", sans-serif';

// Groups of 4 per world (matches the difficulty tiers curated levels are authored in)
function getWorldForLevel(level: LevelData): number {
  const idx = CURATED_LEVELS.findIndex(l => l.id === level.id);
  return Math.floor(idx / 4) + 1;
}

type GridItem = { label: string; disabled: boolean; onClick?: (() => void) | undefined };
type WorldPage = { kind: 'world'; worldNum: number; levels: LevelData[] };
type CommunityPage = { kind: 'community' };
type Page = WorldPage | CommunityPage;

export class LevelSelect extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private contentLayer: Phaser.GameObjects.Container | null = null;
  private pages: Page[] = [];
  private pageIndex = 0;
  private completedLevels: Record<string, { stars: number }> = {};
  private communityLevels: CommunityLevelSummary[] = [];

  constructor() { super('LevelSelect'); }

  init() {
    this.bgLayers = [];
    this.contentLayer = null;
    this.pages = [];
    this.pageIndex = 0;
    this.completedLevels = {};
    this.communityLevels = [];
  }

  async create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(0x2a1a4a);
    this.cameras.main.fadeIn(350, 26, 10, 46);

    this.buildBackground();

    // Load progress/community data before the first render so level buttons never
    // flash an incorrect locked state.
    await Promise.all([this.loadProgress(), this.loadCommunityLevels()]);

    this.buildPages();
    this.buildPage();
    this.scale.on('resize', this.onResize, this);
  }

  private async loadProgress() {
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) {
        const profile = await res.json();
        for (const id of (profile.completedLevels ?? [])) {
          this.completedLevels[id] = { stars: profile.levelStars?.[id] ?? 1 };
        }
      }
    } catch { /* fallback: no progress */ }
  }

  private async loadCommunityLevels() {
    try {
      const res = await fetch('/api/levels/community?limit=20');
      if (res.ok) {
        const data: CommunityLevelsResponse = await res.json();
        this.communityLevels = data.levels ?? [];
      }
    } catch { /* fallback: empty */ }
  }

  private buildPages() {
    const worlds: Map<number, LevelData[]> = new Map();
    for (const level of CURATED_LEVELS) {
      const w = getWorldForLevel(level);
      if (!worlds.has(w)) worlds.set(w, []);
      worlds.get(w)!.push(level);
    }
    this.pages = [...worlds.entries()]
      .sort(([a], [b]) => a - b)
      .map(([worldNum, levels]) => ({ kind: 'world' as const, worldNum, levels }));
    this.pages.push({ kind: 'community' });
    this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1);
  }

  // ── Background ─────────────────────────────────────────────────────────
  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg3-1', 'bg3-2', 'bg3-3', 'bg3-4'];
    const alphas = [1, 0.5, 0.7, 0.9];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.6).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
      this.startBgDrift(img, i, width);
    });
  }

  private startBgDrift(img: Phaser.GameObjects.Image, index: number, width: number) {
    const dir = index % 2 === 0 ? 1 : -1;
    this.tweens.add({
      targets: img,
      x: width / 2 + dir * 14,
      duration: 13000 + index * 3000,
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

  // ── Page content (title + grid + nav arrows + back button) ──────────────
  private buildPage() {
    this.contentLayer?.destroy(true);
    const { width, height } = this.scale;
    const isPortrait = height >= width;
    const els: Phaser.GameObjects.GameObject[] = [];

    // Back-to-menu (small, top-left corner — not part of the reference mock, but
    // needed since the world pager has no other way out of this screen)
    const backSize = 40;
    els.push(addBeigeIconButton(this, {
      x: 16 + backSize / 2, y: 16 + backSize / 2,
      size: backSize, iconKey: 'icon-arrow', iconAngle: 180,
      onClick: () => {
        this.cameras.main.fadeOut(250, 26, 10, 46);
        this.time.delayedCall(260, () => this.scene.start('MainMenu'));
      },
    }));

    const page = this.pages[this.pageIndex];
    if (!page) return;

    // Title panel — 66px floor: the beige button asset's 32px corners corrupt below 65px
    // (see docs/9-slicing.md), and every element on this screen reuses that asset.
    const titleW  = Math.min(width * 0.8, isPortrait ? 300 : 360);
    const titleH  = Math.max(66, Math.min(96, Math.round(height * (isPortrait ? 0.11 : 0.135))));
    const titleY  = Math.max(titleH / 2 + 16, height * (isPortrait ? 0.09 : 0.11));
    const titleFs = Math.max(20, Math.min(34, Math.round(titleH * 0.36)));
    const titleBtn = addBeigeButton(this, {
      x: width / 2, y: titleY, width: titleW, height: titleH,
      label: page.kind === 'world' ? `World ${page.worldNum}` : 'Community Levels',
      fontSize: page.kind === 'world' ? titleFs : Math.round(titleFs * 0.6),
      fontFamily: PIXELIFY,
    });
    titleBtn.setAlpha(0);
    this.tweens.add({ targets: titleBtn, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
    els.push(titleBtn);

    // Grid geometry — btnH/arrowSize both floor at 66px for the same corner-asset reason.
    const arrowSize  = isPortrait
      ? Math.max(66, Math.min(78, width * 0.19))
      : Math.max(66, Math.min(76, height * 0.10));
    const cols       = isPortrait ? 2 : 4;
    const outerPad   = isPortrait ? Math.max(14, width * 0.05) : Math.max(96, width * 0.10);
    const gridW      = width - outerPad * 2;
    const colGap     = isPortrait ? 12 : 24;
    const rowGap     = isPortrait ? 12 : 20;
    const btnW       = (gridW - colGap * (cols - 1)) / cols;
    const btnH       = isPortrait
      ? Math.max(66, Math.min(74, height * 0.09))
      : Math.max(66, Math.min(80, height * 0.11));
    const fs         = Math.max(11, Math.min(16, Math.round(btnH * 0.30)));
    const gridTop    = titleY + titleH / 2 + (isPortrait ? 26 : 34);

    // Portrait reserves a bottom row for the pagination arrows; landscape has them
    // in the margins beside the grid, so the grid can use the full remaining height.
    const gridBottom = isPortrait ? height - 20 - arrowSize - 16 : height - 24;
    const maxRows    = Math.max(1, Math.floor((gridBottom - gridTop + rowGap) / (btnH + rowGap)));

    // Community levels aren't capped by the API to a page-sized batch (up to 20), and
    // this screen has no scrolling — cap to whatever grid capacity actually fits so
    // buttons never overflow past the arrows/screen edge. World pages never need this;
    // curated levels are authored in small batches (4 per world) that always fit.
    const items = this.buildGridItems(page, cols * maxRows);

    if (page.kind === 'community' && items.length === 1 && items[0]!.disabled) {
      // "Coming soon" placeholder — spans the full grid width instead of one cell.
      const bw  = gridW;
      const bh  = btnH;
      const btn = addBeigeButton(this, {
        x: width / 2, y: gridTop + bh / 2, width: bw, height: bh,
        label: items[0]!.label, fontSize: fs, fontFamily: PIXELIFY, disabled: true,
      });
      btn.setAlpha(0);
      this.tweens.add({ targets: btn, alpha: 1, duration: 220, delay: 80, ease: 'Quad.easeOut' });
      els.push(btn);
    } else {
      items.forEach((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx  = outerPad + btnW / 2 + col * (btnW + colGap);
        const cy  = gridTop + btnH / 2 + row * (btnH + rowGap);
        const btn = addBeigeButton(this, {
          x: cx, y: cy, width: btnW, height: btnH,
          label: item.label, fontSize: fs, fontFamily: PIXELIFY,
          disabled: item.disabled, onClick: item.onClick,
        });
        const targetY = cy;
        btn.setAlpha(0).setY(targetY + 8);
        this.tweens.add({
          targets: btn, alpha: 1, y: targetY,
          duration: 220, delay: Math.min(i * 35, 300), ease: 'Quad.easeOut',
        });
        els.push(btn);
      });
    }

    // Pagination arrows
    const canPrev = this.pageIndex > 0;
    const canNext = this.pageIndex < this.pages.length - 1;

    let prevX: number, prevY: number, nextX: number, nextY: number;
    if (isPortrait) {
      prevX = outerPad + arrowSize / 2;
      nextX = width - outerPad - arrowSize / 2;
      prevY = nextY = height - 20 - arrowSize / 2;
    } else {
      prevX = Math.max(24, outerPad * 0.35);
      nextX = width - Math.max(24, outerPad * 0.35);
      prevY = nextY = height / 2;
    }

    els.push(this.buildArrow(prevX, prevY, arrowSize, 180, !canPrev, () => this.changePage(-1)));
    els.push(this.buildArrow(nextX, nextY, arrowSize, 0, !canNext, () => this.changePage(1)));

    this.contentLayer = this.add.container(0, 0, els).setDepth(5);
  }

  private buildGridItems(page: Page, maxItems: number): GridItem[] {
    if (page.kind === 'world') {
      return page.levels.map((level) => {
        const overallIdx = CURATED_LEVELS.findIndex(l => l.id === level.id);
        const locked = this.isLevelLocked(level);
        return {
          label: `Level ${overallIdx + 1}`,
          disabled: locked,
          onClick: locked ? undefined : () => this.openLevel(level.id),
        };
      });
    }
    if (this.communityLevels.length === 0) {
      return [{ label: 'Coming soon...', disabled: true }];
    }
    return this.communityLevels.slice(0, Math.max(1, maxItems)).map((level) => ({
      label: level.title,
      disabled: false,
      onClick: () => this.openLevel(level.id),
    }));
  }

  private buildArrow(x: number, y: number, size: number, angle: number, disabled: boolean, onClick: () => void) {
    const shell = addBeigeButtonShell(this, x, y, size, size, disabled, disabled ? undefined : onClick);
    const iconSize = Math.round(size * 0.42);
    const icon = addDepthIcon(this, 0, -1, 'icon-arrow', iconSize, iconSize).setAngle(angle);
    if (disabled) icon.setAlpha(0.4);
    shell.addContent([icon]);
    return shell.container;
  }

  private changePage(delta: number) {
    const next = Phaser.Math.Clamp(this.pageIndex + delta, 0, this.pages.length - 1);
    if (next === this.pageIndex) return;
    this.pageIndex = next;
    this.buildPage();
  }

  private openLevel(levelId: string) {
    this.cameras.main.fadeOut(250, 26, 10, 46);
    this.time.delayedCall(260, () => this.scene.start('Game', { levelId }));
  }

  private isLevelLocked(level: LevelData): boolean {
    const idx = CURATED_LEVELS.findIndex(l => l.id === level.id);
    if (idx === 0) return false;
    const prev = CURATED_LEVELS[idx - 1];
    if (!prev) return false;
    return !this.completedLevels[prev.id];
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    this.buildPage();
  }

  shutdown() {
    this.scale.off('resize', this.onResize, this);
  }
}
