import * as Phaser from 'phaser';
import { CURATED_LEVELS, WORLD_LABELS } from '../../shared/levelData';
import type { LevelData } from '../../shared/types';
import type { CommunityLevelSummary, CommunityLevelsResponse } from '../../shared/api';

const C = {
  BG:      0x1a0a2e,
  CARD:    0x2d1b4e,
  LOCKED:  0x1a1030,
  GREEN:   0x6dd400,
  GOLD:    0xffd700,
  ORANGE:  0xff6b35,
  TEXT:    '#ffffff',
  DIM:     '#7a8a9a',
  ACCENT:  '#6DD400',
  STAR_ON: '#FFD700',
  STAR_OFF:'#3a2560',
} as const;

// World difficulty colour accents
const WORLD_COLORS = [0x6dd400, 0x7b2ff7, 0xff6b35, 0xe91e63];

// Groups of 4 per world
function getWorldForLevel(level: LevelData): number {
  const idx = CURATED_LEVELS.findIndex(l => l.id === level.id);
  return Math.floor(idx / 4) + 1;
}

export class LevelSelect extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private scrollContainer: Phaser.GameObjects.Container | null = null;
  private scrollBar: Phaser.GameObjects.Graphics | null = null;
  private isDragging = false;
  private dragMoved = false;
  private dragStartY = 0;
  private pointerDownY = 0;
  private scrollY = 0;
  private maxScrollY = 0;
  private contentHeight = 0;
  private completedLevels: Record<string, { stars: number }> = {};
  private communityLevels: CommunityLevelSummary[] = [];

  constructor() { super('LevelSelect'); }

  init() {
    this.bgLayers = [];
    this.scrollContainer = null;
    this.scrollBar = null;
    this.scrollY = 0;
    this.dragMoved = false;
    this.completedLevels = {};
    this.communityLevels = [];
  }

  async create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(350, 26, 10, 46);

    await Promise.all([this.loadProgress(), this.loadCommunityLevels()]);

    this.buildBackground();
    this.buildHeader();
    this.buildScrollContent();
    this.setupScrollInput();
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

  private buildBackground() {
    const { width, height } = this.scale;
    ['bg2-1', 'bg2-2'].forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.6 : 0.3)
        .setDepth(-10);
      const sc = Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05;
      img.setScale(sc);
      this.bgLayers.push(img);
    });
  }

  private buildHeader() {
    const { width } = this.scale;

    // Back button
    const backBtn = this.add.container(46, 30);
    const backBg = this.add.graphics();
    backBg.fillStyle(0x000000, 0.5);
    backBg.fillRoundedRect(-20, -20, 40, 40, 10);
    const backArrow = this.add.text(0, 0, '‹', {
      fontSize: '28px', color: '#ffffff',
    }).setOrigin(0.5, 0.45);
    backBtn.add([backBg, backArrow]);
    backBtn.setSize(44, 44).setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        this.cameras.main.fadeOut(250, 26, 10, 46);
        this.time.delayedCall(260, () => this.scene.start('MainMenu'));
      })
      .on('pointerover', () => this.tweens.add({ targets: backBtn, scaleX: 1.1, scaleY: 1.1, duration: 80 }))
      .on('pointerout',  () => this.tweens.add({ targets: backBtn, scaleX: 1, scaleY: 1, duration: 80 }));
    backBtn.setDepth(20);

    // Title
    this.add.text(width / 2, 30, 'Select Level', {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '24px',
      color: '#ffffff',
      stroke: '#1a0a2e',
      strokeThickness: 4,
    }).setOrigin(0.5).setDepth(20);

    // Divider
    const div = this.add.graphics().setDepth(20);
    div.lineStyle(1, 0x6dd400, 0.3);
    div.lineBetween(0, 54, width, 54);
  }

  private buildScrollContent() {
    const { width, height } = this.scale;

    this.scrollContainer = this.add.container(0, 60).setDepth(5);
    let cursorY = 20;

    // Group levels by world
    const worlds: Map<number, LevelData[]> = new Map();
    for (const level of CURATED_LEVELS) {
      const w = getWorldForLevel(level);
      if (!worlds.has(w)) worlds.set(w, []);
      worlds.get(w)!.push(level);
    }

    worlds.forEach((levels, worldNum) => {
      // World header
      const wColor = WORLD_COLORS[(worldNum - 1) % WORLD_COLORS.length] ?? 0x6dd400;
      const worldHeader = this.buildWorldHeader(width / 2, cursorY, wColor, WORLD_LABELS[worldNum] ?? `World ${worldNum}`);
      this.scrollContainer!.add(worldHeader);
      cursorY += 52;

      // Level cards grid — 2 per row
      const cardW = (width - 60) / 2;
      const cardH = 88;
      const colGap = 12;
      const rowGap = 12;

      levels.forEach((level, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = 20 + col * (cardW + colGap) + cardW / 2;
        const cy = cursorY + row * (cardH + rowGap) + cardH / 2;

        const progress = this.completedLevels[level.id];
        const isLocked = this.isLevelLocked(level);
        const card = this.buildLevelCard(cx, cy, cardW, cardH, level, worldNum, progress?.stars ?? 0, isLocked);
        this.scrollContainer!.add(card);
      });

      const rows = Math.ceil(levels.length / 2);
      cursorY += rows * (cardH + rowGap) + 24;
    });

    // Community section
    const communityHeader = this.buildSectionHeader(width / 2, cursorY, '🌐  Community Levels', 0x1a6fbf);
    this.scrollContainer!.add(communityHeader);
    cursorY += 52;

    if (this.communityLevels.length === 0) {
      const comingCard = this.buildComingSoonCard(width / 2, cursorY, width - 40, 64);
      this.scrollContainer!.add(comingCard);
      cursorY += 80;
    } else {
      const cardW = (width - 60) / 2;
      const cardH = 88;
      const colGap = 12;
      const rowGap = 12;

      this.communityLevels.forEach((level, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const cx = 20 + col * (cardW + colGap) + cardW / 2;
        const cy = cursorY + row * (cardH + rowGap) + cardH / 2;
        const card = this.buildCommunityCard(cx, cy, cardW, cardH, level);
        this.scrollContainer!.add(card);
      });

      const rows = Math.ceil(this.communityLevels.length / 2);
      cursorY += rows * (cardH + rowGap) + 24;
    }

    this.contentHeight = cursorY;
    this.maxScrollY = Math.max(0, this.contentHeight - (height - 60));
    this.scrollBar = this.add.graphics().setDepth(30);
    this.drawScrollBar();
  }

  private setScrollY(nextY: number) {
    this.scrollY = Phaser.Math.Clamp(nextY, -this.maxScrollY, 0);
    if (this.scrollContainer) this.scrollContainer.y = 60 + this.scrollY;
    this.drawScrollBar();
  }

  private drawScrollBar() {
    if (!this.scrollBar) return;
    this.scrollBar.clear();
    if (this.maxScrollY <= 0) return;

    const { width, height } = this.scale;
    const trackX = width - 8;
    const trackY = 66;
    const trackH = height - 78;
    const visibleH = height - 60;
    const thumbH = Math.max(32, trackH * (visibleH / Math.max(this.contentHeight, visibleH)));
    const progress = -this.scrollY / this.maxScrollY;
    const thumbY = trackY + (trackH - thumbH) * progress;

    this.scrollBar.fillStyle(0xffffff, 0.12);
    this.scrollBar.fillRoundedRect(trackX, trackY, 4, trackH, 2);
    this.scrollBar.fillStyle(C.GREEN, 0.72);
    this.scrollBar.fillRoundedRect(trackX - 1, thumbY, 6, thumbH, 3);
  }

  private buildWorldHeader(x: number, y: number, color: number, label: string) {
    const g = this.add.graphics();
    const { width } = this.scale;
    const bw = width - 40;
    g.fillStyle(color, 0.15);
    g.fillRoundedRect(x - bw / 2, y - 20, bw, 40, 8);
    g.lineStyle(2, color, 0.5);
    g.strokeRoundedRect(x - bw / 2, y - 20, bw, 40, 8);

    const t = this.add.text(x, y, label, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '16px',
      color: `#${color.toString(16).padStart(6, '0')}`,
    }).setOrigin(0.5);

    const c = this.add.container(0, 0, [g, t]);
    return c;
  }

  private buildSectionHeader(x: number, y: number, label: string, color: number) {
    const g = this.add.graphics();
    const { width } = this.scale;
    const bw = width - 40;
    g.fillStyle(color, 0.12);
    g.fillRoundedRect(x - bw / 2, y - 20, bw, 40, 8);

    const t = this.add.text(x, y, label, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '15px',
      color: `#${color.toString(16).padStart(6, '0')}`,
    }).setOrigin(0.5);

    return this.add.container(0, 0, [g, t]);
  }

  private buildLevelCard(
    cx: number, cy: number, w: number, h: number,
    level: LevelData, worldNum: number,
    stars: number, locked: boolean,
  ) {
    const wColor = WORLD_COLORS[(worldNum - 1) % WORLD_COLORS.length] ?? 0x6dd400;

    const bg = this.add.graphics();
    if (locked) {
      bg.fillStyle(C.LOCKED, 1);
      bg.lineStyle(1, 0x3a2560, 0.8);
    } else {
      bg.fillStyle(C.CARD, 1);
      bg.lineStyle(2, wColor, stars > 0 ? 0.7 : 0.3);
    }
    bg.fillRoundedRect(-w/2, -h/2, w, h, 12);
    bg.strokeRoundedRect(-w/2, -h/2, w, h, 12);

    const items: Phaser.GameObjects.GameObject[] = [bg];

    if (locked) {
      const lockTxt = this.add.text(0, 0, '🔒', { fontSize: '24px' }).setOrigin(0.5).setAlpha(0.5);
      items.push(lockTxt);
    } else {
      // Level number
      const numTxt = this.add.text(-w/2 + 12, -h/2 + 10, level.id, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '11px',
        color: `#${wColor.toString(16).padStart(6, '0')}`,
      }).setOrigin(0, 0);
      items.push(numTxt);

      // Difficulty dots
      for (let d = 0; d < 5; d++) {
        const dot = this.add.circle(w/2 - 14 - d * 10, -h/2 + 14, 3,
          d < level.difficulty ? wColor : 0x3a2560);
        items.push(dot);
      }

      // Title
      const titleTxt = this.add.text(0, -4, level.title, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '14px',
        color: '#ffffff',
        wordWrap: { width: w - 20 },
      }).setOrigin(0.5, 0.5);
      items.push(titleTxt);

      // Stars row
      for (let s = 0; s < 3; s++) {
        const starTxt = this.add.text(-16 + s * 16, h/2 - 18, '★', {
          fontSize: '16px',
          color: s < stars ? C.STAR_ON : C.STAR_OFF,
        }).setOrigin(0.5);
        items.push(starTxt);
      }

      // Optimal badge
      if (stars === 3) {
        const badge = this.add.text(w/2 - 10, h/2 - 12, '✓', {
          fontSize: '12px',
          color: C.ACCENT,
        }).setOrigin(1, 1);
        items.push(badge);
      }
    }

    const c = this.add.container(cx, cy, items);
    if (!locked) {
      c.setSize(w, h).setInteractive({ useHandCursor: true });
      c.on('pointerover', () => {
        this.tweens.add({ targets: c, scaleX: 1.04, scaleY: 1.04, duration: 80 });
      });
      c.on('pointerout', () => {
        this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 80 });
      });
      c.on('pointerup', () => {
        if (this.dragMoved) return;
        this.cameras.main.fadeOut(250, 26, 10, 46);
        this.time.delayedCall(260, () => {
          this.scene.start('Game', { levelId: level.id });
        });
      });
    }
    return c;
  }

  private buildComingSoonCard(cx: number, cy: number, w: number, h: number) {
    const bg = this.add.graphics();
    bg.fillStyle(0x1a2040, 0.8);
    bg.lineStyle(1, 0x1a6fbf, 0.4);
    bg.fillRoundedRect(-w/2, -h/2, w, h, 10);
    bg.strokeRoundedRect(-w/2, -h/2, w, h, 10);

    const txt = this.add.text(0, 0, 'Community levels coming soon…', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: C.DIM,
    }).setOrigin(0.5);

    return this.add.container(cx, cy, [bg, txt]);
  }

  private buildCommunityCard(
    cx: number,
    cy: number,
    w: number,
    h: number,
    level: CommunityLevelSummary,
  ) {
    const bg = this.add.graphics();
    const draw = (hovered: boolean) => {
      bg.clear();
      bg.fillStyle(hovered ? 0x263c68 : 0x1a2040, 0.95);
      bg.lineStyle(hovered ? 2 : 1, 0x35a7ff, hovered ? 0.9 : 0.5);
      bg.fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    };
    draw(false);

    const title = this.add.text(-w / 2 + 10, -h / 2 + 10, level.title, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '13px',
      color: '#ffffff',
      wordWrap: { width: w - 20 },
      maxLines: 1,
    });
    const author = this.add.text(-w / 2 + 10, 2, `u/${level.authorName ?? 'anonymous'}`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '11px',
      color: '#9acfff',
    });
    const details = this.add.text(-w / 2 + 10, h / 2 - 12, `${level.difficulty}/5  |  ${level.optimalSteps} steps`, {
      fontFamily: 'Arial, sans-serif',
      fontSize: '11px',
      color: C.DIM,
    }).setOrigin(0, 1);

    const card = this.add.container(cx, cy, [bg, title, author, details]);
    card.setSize(w, h).setInteractive({ useHandCursor: true });
    card.on('pointerover', () => draw(true));
    card.on('pointerout', () => draw(false));
    card.on('pointerup', () => {
      if (this.dragMoved) return;
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start('Game', { levelId: level.id }));
    });
    return card;
  }

  private isLevelLocked(level: LevelData): boolean {
    const idx = CURATED_LEVELS.findIndex(l => l.id === level.id);
    if (idx === 0) return false;
    const prev = CURATED_LEVELS[idx - 1];
    if (!prev) return false;
    return !this.completedLevels[prev.id];
  }

  private setupScrollInput() {
    const headerH = 60;

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < headerH) return;
      this.isDragging = true;
      this.dragMoved = false;
      this.dragStartY = p.y - this.scrollY;
      this.pointerDownY = p.y;
    });

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      if (Math.abs(p.y - this.pointerDownY) > 8) this.dragMoved = true;
      const newY = p.y - this.dragStartY;
      this.setScrollY(newY);
    });

    this.input.on('pointerup', () => { this.isDragging = false; });

    // Mouse wheel
    this.input.on('wheel', (_p: unknown, _gos: unknown, _dx: number, dy: number) => {
      this.setScrollY(this.scrollY - dy * 0.8);
    });
  }

  shutdown() {
    this.scrollBar?.destroy();
    this.input.removeAllListeners();
  }
}
