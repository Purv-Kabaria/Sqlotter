import * as Phaser from 'phaser';
import type { LeaderboardEntry } from '../../shared/types';

const C = {
  BG:    0x1a0a2e,
  PANEL: 0x2d1b4e,
  GOLD:  0xffd700,
  GREEN: 0x6dd400,
  TEXT:  '#ffffff',
  DIM:   '#7a8a9a',
} as const;


type Tab = 'steps' | 'time' | 'global';

export class Leaderboard extends Phaser.Scene {
  private activeTab: Tab = 'steps';
  private levelId = 'L01';
  private listContainer: Phaser.GameObjects.Container | null = null;
  private tabBtns: Phaser.GameObjects.Container[] = [];
  private bgLayers: Phaser.GameObjects.Image[] = [];

  constructor() { super('Leaderboard'); }

  init(data: { levelId?: string }) {
    this.activeTab = 'steps';
    this.levelId = data?.levelId ?? 'L01';
    this.listContainer = null;
    this.tabBtns = [];
    this.bgLayers = [];
  }

  create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(350, 26, 10, 46);

    this.buildBackground();
    this.buildHeader(width, height);
    this.buildTabs(width);
    void this.loadAndRender();
  }

  private buildBackground() {
    const { width, height } = this.scale;
    ['bg4-1', 'bg4-2'].forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.5 : 0.2).setDepth(-10);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
    });
  }

  private buildHeader(width: number, _height: number) {
    // Back
    this.buildIconBtn(30, 30, '‹', 36, () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start('MainMenu'));
    });

    this.add.image(width / 2 - 80, 30, 'icon-trophy').setDisplaySize(28, 28).setDepth(10);
    const headLabel = `Leaderboard — ${this.levelId}`;
    this.add.text(width / 2 + 4, 30, headLabel, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '18px',
      color: '#FFD700',
      stroke: '#1a0a2e',
      strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(10);

    const div = this.add.graphics().setDepth(10);
    div.lineStyle(1, C.GOLD, 0.3);
    div.lineBetween(0, 54, width, 54);
  }

  private buildTabs(width: number) {
    const tabs: [Tab, string][] = [['steps', 'Steps'], ['time', 'Time'], ['global', 'Global']];
    const tabW = (width - 32) / tabs.length;

    tabs.forEach(([id, label], i) => {
      const tx = 16 + i * tabW + tabW / 2;
      const ty = 72;

      const bg = this.add.graphics();
      const drawTab = (active: boolean) => {
        bg.clear();
        bg.fillStyle(active ? C.GREEN : 0x1a1030, active ? 1 : 0.7);
        bg.fillRoundedRect(-tabW / 2 + 4, -16, tabW - 8, 32, 8);
        if (!active) {
          bg.lineStyle(1, 0x3a2560, 0.8);
          bg.strokeRoundedRect(-tabW / 2 + 4, -16, tabW - 8, 32, 8);
        }
      };
      drawTab(id === this.activeTab);

      const txt = this.add.text(0, 0, label, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '14px',
        color: id === this.activeTab ? '#1a0a2e' : C.TEXT,
      }).setOrigin(0.5);

      const c = this.add.container(tx, ty, [bg, txt]).setDepth(10).setSize(tabW - 8, 32);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerup', () => {
        if (this.activeTab === id) return;
        this.activeTab = id;
        this.tabBtns.forEach((btn, j) => {
          const bBg = btn.list[0] as Phaser.GameObjects.Graphics;
          const bTxt = btn.list[1] as Phaser.GameObjects.Text;
          const isActive = tabs[j]?.[0] === id;
          bBg.clear();
          bBg.fillStyle(isActive ? C.GREEN : 0x1a1030, isActive ? 1 : 0.7);
          bBg.fillRoundedRect(-tabW / 2 + 4, -16, tabW - 8, 32, 8);
          if (!isActive) {
            bBg.lineStyle(1, 0x3a2560, 0.8);
            bBg.strokeRoundedRect(-tabW / 2 + 4, -16, tabW - 8, 32, 8);
          }
          bTxt.setColor(isActive ? '#1a0a2e' : C.TEXT);
        });
        void this.loadAndRender();
      });
      c.on('pointerover', () => this.tweens.add({ targets: c, scaleX: 1.04, scaleY: 1.04, duration: 80 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 80 }));
      this.tabBtns.push(c);
    });
  }

  private async loadAndRender() {
    const { width } = this.scale;

    this.listContainer?.destroy();
    this.listContainer = this.add.container(0, 96).setDepth(5);

    const loading = this.add.text(width / 2, 140, 'Loading…', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: C.DIM,
    }).setOrigin(0.5).setDepth(5);
    this.listContainer.add(loading);

    try {
      let url = '/api/leaderboard/global';
      if (this.activeTab === 'steps') url = `/api/leaderboard/level/${this.levelId}?type=steps`;
      if (this.activeTab === 'time')  url = `/api/leaderboard/level/${this.levelId}?type=time`;

      const res = await fetch(url);
      const data = res.ok ? await res.json() : { entries: [] };
      const entries: LeaderboardEntry[] = data.entries ?? [];
      loading.destroy();
      this.renderEntries(entries);
    } catch {
      loading.setText('Unable to load leaderboard.');
    }
  }

  private renderEntries(entries: LeaderboardEntry[]) {
    if (!this.listContainer) return;
    const { width } = this.scale;
    const rowH = 52;
    const rowW = width - 24;

    if (entries.length === 0) {
      const empty = this.add.text(width / 2, 80, 'No entries yet — be the first!', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '15px',
        color: C.DIM,
      }).setOrigin(0.5);
      this.listContainer.add(empty);
      return;
    }

    entries.forEach((entry, i) => {
      const ry = i * (rowH + 6);

      const rbg = this.add.graphics();
      const isMe = entry.isCurrentUser;
      rbg.fillStyle(isMe ? 0x2a4a1a : C.PANEL, isMe ? 1 : 0.8);
      rbg.lineStyle(1, isMe ? C.GREEN : 0x3a2560, isMe ? 0.9 : 0.4);
      rbg.fillRoundedRect(12, ry, rowW, rowH, 10);
      rbg.strokeRoundedRect(12, ry, rowW, rowH, 10);

      const rankX = 12 + 30;
      const rankY = ry + rowH / 2;

      // Medal or rank number
      if (i < 3) {
        const medals = ['🥇', '🥈', '🥉'] as const;
        const medal = this.add.text(rankX, rankY, medals[i] ?? medals[2], {
          fontSize: '22px',
        }).setOrigin(0.5);
        this.listContainer!.add(medal);
      } else {
        const rankTxt = this.add.text(rankX, rankY, `${entry.rank}`, {
          fontFamily: '"Arial Black", sans-serif',
          fontSize: '15px',
          color: C.DIM,
        }).setOrigin(0.5);
        this.listContainer!.add(rankTxt);
      }

      // Username
      const nameTxt = this.add.text(12 + 60, rankY, entry.username, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '15px',
        color: isMe ? '#6DD400' : C.TEXT,
      }).setOrigin(0, 0.5);
      this.listContainer!.add(nameTxt);

      // Score
      const scoreTxt = this.add.text(12 + rowW - 16, rankY, `${entry.score}`, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '16px',
        color: i === 0 ? '#FFD700' : C.TEXT,
      }).setOrigin(1, 0.5);
      this.listContainer!.add(scoreTxt);

      const row = this.add.container(0, 0, [rbg]);
      row.setAlpha(0);
      this.tweens.add({ targets: row, alpha: 1, duration: 200, delay: i * 60 });
      this.listContainer!.add(row);
    });
  }

  private buildIconBtn(x: number, y: number, icon: string, size: number, cb: () => void) {
    const g = this.add.graphics().setDepth(15);
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(x - size / 2, y - size / 2, size, size, 8);
    const txt = this.add.text(x, y, icon, {
      fontSize: `${Math.round(size * 0.65)}px`,
      color: '#ffffff',
    }).setOrigin(0.5, 0.45).setDepth(16);
    this.add.zone(x, y, size, size).setDepth(16).setInteractive({ useHandCursor: true })
      .on('pointerup', cb)
      .on('pointerover', () => this.tweens.add({ targets: [g, txt], scaleX: 1.12, scaleY: 1.12, duration: 80 }))
      .on('pointerout', () => this.tweens.add({ targets: [g, txt], scaleX: 1, scaleY: 1, duration: 80 }));
  }
}
