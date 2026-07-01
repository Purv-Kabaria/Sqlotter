import * as Phaser from 'phaser';
import { addPixelIconButton, addPixelPanel, PIXEL_FONT } from '../components/PixelUI';
import type { LeaderboardEntry } from '../../shared/types';

const C = {
  BG:    0x1a0a2e,
  PANEL: 0x2d1b4e,
  GOLD:  0xffd700,
  GREEN: 0x6dd400,
  TEXT:  '#ffffff',
  DIM:   '#7a8a9a',
} as const;

const MEDAL_KEYS = ['icon-gold', 'icon-silver', 'icon-bronze'] as const;

type Tab = 'steps' | 'time' | 'global';

export class Leaderboard extends Phaser.Scene {
  private activeTab: Tab = 'steps';
  private levelId = 'L01';
  private uiLayer: Phaser.GameObjects.Container | null = null;
  private listContainer: Phaser.GameObjects.Container | null = null;
  private tabBtns: Phaser.GameObjects.Container[] = [];
  private bgLayers: Phaser.GameObjects.Image[] = [];
  // Discards a fetch response if a newer tab switch has started since it was
  // requested — without this, rapidly switching tabs can let a slow, stale
  // response render on top of (or instead of) the tab the player is now on.
  private loadToken = 0;
  // Set once the back button is pressed — guards the same in-flight fetch from
  // touching listContainer/loading text after the scene has shut down.
  private navigating = false;

  constructor() { super('Leaderboard'); }

  init(data: { levelId?: string }) {
    this.activeTab = 'steps';
    this.levelId = data?.levelId ?? 'L01';
    this.uiLayer = null;
    this.listContainer = null;
    this.tabBtns = [];
    this.bgLayers = [];
    this.loadToken = 0;
    this.navigating = false;
  }

  create() {
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(350, 26, 10, 46);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);

    this.buildBackground();
    this.buildStaticUI();
    void this.loadAndRender();
    this.scale.on('resize', this.onResize, this);
  }

  private buildBackground() {
    const { width, height } = this.scale;
    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];
    ['bg4-1', 'bg4-2'].forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.5 : 0.2).setDepth(-10);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
    });
  }

  private buildStaticUI() {
    this.uiLayer?.destroy(true);
    this.tabBtns = [];

    const { width } = this.scale;
    const elements: Phaser.GameObjects.GameObject[] = [];

    // Back button
    const backBtn = addPixelIconButton(this, {
      x: 30, y: 30, size: 40,
      iconKey: 'icon-arrow', iconAngle: 180,
      onClick: () => {
        if (this.navigating) return;
        this.navigating = true;
        this.cameras.main.fadeOut(250, 26, 10, 46);
        this.time.delayedCall(260, () => this.scene.start('MainMenu'));
      },
    }).setDepth(15);
    elements.push(backBtn);

    // Trophy icon + header
    const trophy = this.add.image(width / 2 - 72, 30, 'icon-trophy').setDisplaySize(24, 24).setDepth(10);
    elements.push(trophy);

    const headLabel = `Board - ${this.levelId}`;
    const headTxt = this.add.text(width / 2 + 4, 30, headLabel, {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
      color: '#FFD700',
      stroke: '#1a0a2e',
      strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(10);
    elements.push(headTxt);

    // Divider line
    const div = this.add.graphics().setDepth(10);
    div.lineStyle(1, C.GOLD, 0.3);
    div.lineBetween(0, 54, width, 54);
    elements.push(div);

    // Tabs
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
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
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
      elements.push(c);
    });

    this.uiLayer = this.add.container(0, 0, elements);
  }

  private async loadAndRender() {
    const token = ++this.loadToken;
    const { width } = this.scale;

    this.listContainer?.destroy();
    this.listContainer = this.add.container(0, 96).setDepth(5);

    const loading = this.add.text(width / 2, 140, 'Loading...', {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
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
      // A newer tab switch may have superseded this request, or the player may
      // have already backed out — either way the container this response was
      // meant for no longer exists (or isn't the current one), so bail.
      if (token !== this.loadToken || this.navigating) return;
      loading.destroy();
      this.renderEntries(entries);
    } catch {
      if (token !== this.loadToken || this.navigating) return;
      loading.setText('Unable to load leaderboard.');
    }
  }

  private renderEntries(entries: LeaderboardEntry[]) {
    if (!this.listContainer) return;
    const { width } = this.scale;
    const rowH = 52;
    const rowW = width - 24;

    if (entries.length === 0) {
      const empty = this.add.text(width / 2, 80, 'No entries yet - be the first!', {
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
        color: C.DIM,
      }).setOrigin(0.5);
      this.listContainer.add(empty);
      return;
    }

    entries.forEach((entry, i) => {
      const ry = i * (rowH + 6);
      const isMe = entry.isCurrentUser;

      const rbg = addPixelPanel(this, 12 + rowW / 2, ry + rowH / 2, rowW, rowH)
        .setTint(isMe ? 0x2a4a1a : C.PANEL)
        .setAlpha(isMe ? 1 : 0.8);

      const rankX = 12 + 30;
      const rankY = ry + rowH / 2;
      const rowItems: Phaser.GameObjects.GameObject[] = [rbg];

      if (i < 3) {
        const medalKey = MEDAL_KEYS[i] ?? MEDAL_KEYS[2];
        const medal = this.add.image(rankX, rankY, medalKey).setDisplaySize(24, 24);
        rowItems.push(medal);
      } else {
        const rankTxt = this.add.text(rankX, rankY, `${entry.rank}`, {
          fontFamily: PIXEL_FONT,
          fontSize: '9px',
          color: C.DIM,
        }).setOrigin(0.5);
        rowItems.push(rankTxt);
      }

      const nameTxt = this.add.text(12 + 60, rankY, entry.username, {
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
        color: isMe ? '#6DD400' : C.TEXT,
      }).setOrigin(0, 0.5);
      rowItems.push(nameTxt);

      const scoreTxt = this.add.text(12 + rowW - 16, rankY, `${entry.score}`, {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: i === 0 ? '#FFD700' : C.TEXT,
      }).setOrigin(1, 0.5);
      rowItems.push(scoreTxt);

      const row = this.add.container(0, 0, rowItems);
      row.setAlpha(0);
      this.tweens.add({ targets: row, alpha: 1, duration: 200, delay: i * 60 });
      this.listContainer!.add(row);
    });
  }

  private repositionBgLayers(width: number, height: number) {
    this.bgLayers.forEach(img => {
      img.setPosition(width / 2, height / 2);
      const sc = Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05;
      img.setScale(sc);
    });
  }

  private onResize(gameSize: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gameSize instanceof Phaser.Scale.ScaleManager ? gameSize : gameSize;
    this.cameras.resize(width, height);
    this.repositionBgLayers(width, height);
    this.buildStaticUI();
    void this.loadAndRender();
  }

  shutdown() {
    this.navigating = true;
    this.scale.off('resize', this.onResize, this);
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
