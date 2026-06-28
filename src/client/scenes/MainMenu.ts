import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import {
  addBeigeButton, addBeigeCard, addDepthIcon, addDarkPanel, PIXEL_FONT,
} from '../components/PixelUI';
import type { InitResponse } from '../../shared/api';

const C = {
  HEADER_BG:  0x0A0500,
  PANEL_BG:   0x180C02,
  GOLD:       0xFFD700,
  TEXT_BEIGE: '#DEC998',
  TEXT_LIGHT: '#FFFCE8',
  DIM:        '#9A8A7A',
} as const;

const HEADER_H = 52;

export class MainMenu extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private uiLayer: Phaser.GameObjects.Container | null = null;
  private mascot: SplotMascot | null = null;
  private sparksText: Phaser.GameObjects.Text | null = null;
  private sparkleTimers: Phaser.Time.TimerEvent[] = [];
  private userData: InitResponse | null = null;

  constructor() { super('MainMenu'); }

  init() {
    this.bgLayers = [];
    this.uiLayer  = null;
    this.mascot   = null;
    this.sparkleTimers = [];
    this.userData = null;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.HEADER_BG);
    this.cameras.main.fadeIn(400, 10, 5, 14);

    this.buildBackground();
    this.buildUI();
    this.scale.on('resize', this.onResize, this);

    void this.loadUserData();
  }

  private async loadUserData() {
    try {
      const res = await fetch('/api/init');
      if (res.ok) {
        this.userData = await res.json() as InitResponse;
        this.buildUI();
      }
    } catch { /* offline / playtest fallback */ }
  }

  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg4-1', 'bg4-2', 'bg4-3', 'bg4-4'];
    const alphas = [1, 0.80, 0.55, 0.30];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.3).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);

      const dir = i % 2 === 0 ? 1 : -1;
      this.tweens.add({
        targets: img,
        x: width / 2 + dir * 18,
        duration: 13000 + i * 3500,
        yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    });
  }

  private buildUI() {
    this.mascot?.stopIdleAnims();
    this.mascot = null;
    this.uiLayer?.destroy(true);
    this.sparksText = null;

    const { width, height } = this.scale;
    const isPortrait = height > width;
    const elements: Phaser.GameObjects.GameObject[] = [];

    // Header strip
    elements.push(this.add.rectangle(width / 2, HEADER_H / 2, width, HEADER_H, C.HEADER_BG).setDepth(10));

    if (this.textures.exists('title')) {
      const logoW = Math.min(width * 0.5, 200);
      const logo  = this.add.image(width / 2, HEADER_H / 2, 'title')
        .setDisplaySize(logoW, logoW * 0.22).setDepth(11);
      elements.push(logo);
    }

    // Sparks counter (top-right)
    const sparkPillW = 100, sparkPillH = 30;
    const sparkCx    = width - sparkPillW / 2 - 8;
    const sparkCy    = HEADER_H / 2;
    addBeigeCard(this, sparkCx, sparkCy, sparkPillW, sparkPillH).setDepth(12);
    const sparkIcContainer = addDepthIcon(this, sparkCx - 34, sparkCy, 'icon-spark', 14, 14);
    sparkIcContainer.setDepth(13);
    this.sparksText = this.add.text(sparkCx - 18, sparkCy, `${this.userData?.sparks ?? 0}`, {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: '#C8940A',
      shadow: { offsetX: 1, offsetY: 1, color: '#5A3A00', blur: 0, fill: true },
    }).setOrigin(0, 0.5).setDepth(13);
    elements.push(sparkIcContainer, this.sparksText);

    if (isPortrait) {
      this.buildPortraitLayout(width, height, elements);
    } else {
      this.buildLandscapeLayout(width, height, elements);
    }

    this.startSparkleEffect();
    this.uiLayer = this.add.container(0, 0, elements);
  }

  private buildPortraitLayout(width: number, height: number, elements: Phaser.GameObjects.GameObject[]) {
    const cx = width / 2;

    // Mascot (floating in game-area background)
    const splotSz  = Math.min(width * 0.38, 160);
    const splotY   = HEADER_H + splotSz * 0.65 + 20;
    this.mascot    = new SplotMascot(this, cx, splotY, splotSz);
    this.mascot.container.setDepth(5);
    elements.push(this.mascot.container);

    // Greeting
    const username = this.userData?.username ?? '';
    const greetY   = splotY + splotSz * 0.58;
    if (username) {
      const greet = this.add.text(cx, greetY, `Hey ${username}!`, {
        fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DIM,
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(5);
      elements.push(greet);
    }

    // Streak badge
    const streakDays = this.userData?.streakDays ?? 0;
    if (streakDays > 0) {
      const badge = this.buildStreakBadge(cx, greetY + 24, streakDays);
      badge.setDepth(5);
      elements.push(badge);
    }

    // Buttons: 5 tall beige pill buttons stacked vertically
    const btnW      = Math.min(width - 40, 310);
    const btnH      = 50;
    const btnGap    = btnH + 10;
    const btnStartY = Math.max(greetY + 52, height * 0.54);
    this.buildMenuButtons(cx, btnStartY, btnW, btnH, btnGap, elements);
  }

  private buildLandscapeLayout(width: number, height: number, elements: Phaser.GameObjects.GameObject[]) {
    const splitX  = width * 0.48;
    const rightCx = splitX + (width - splitX) / 2;

    // Left panel: mascot + bg
    const panelH  = height - HEADER_H - 16;
    const panelCy = HEADER_H + panelH / 2 + 8;
    addDarkPanel(this, splitX / 2, panelCy, splitX - 16, panelH).setDepth(3).setAlpha(0.75);

    const splotSz  = Math.min((splitX - 32) * 0.55, panelH * 0.55, 140);
    const splotY   = HEADER_H + splotSz * 0.7 + 16;
    this.mascot    = new SplotMascot(this, splitX / 2, splotY, splotSz);
    this.mascot.container.setDepth(5);
    elements.push(this.mascot.container);

    const username = this.userData?.username ?? '';
    const greetY   = splotY + splotSz * 0.58;
    if (username) {
      const greet = this.add.text(splitX / 2, greetY, `Hey ${username}!`, {
        fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DIM,
      }).setOrigin(0.5).setDepth(5);
      elements.push(greet);
    }
    const streakDays = this.userData?.streakDays ?? 0;
    if (streakDays > 0) {
      const badge = this.buildStreakBadge(splitX / 2, greetY + 22, streakDays);
      badge.setDepth(5);
      elements.push(badge);
    }

    // Right panel: buttons
    const btnW      = Math.min(width - splitX - 32, 260);
    const btnH      = 46;
    const btnGap    = btnH + 8;
    const totalBtnH = 5 * btnH + 4 * 8;
    const btnStartY = HEADER_H + (height - HEADER_H - totalBtnH) / 2 + btnH / 2;
    this.buildMenuButtons(rightCx, btnStartY, btnW, btnH, btnGap, elements);
  }

  private buildMenuButtons(
    x: number, startY: number, w: number, h: number, gap: number,
    elements: Phaser.GameObjects.GameObject[],
  ) {
    const defs: [string, string, string, (string | undefined)?][] = [
      ['Play',      'icon-play',   'LevelSelect'],
      ['Daily',     'icon-timer',  'Game',        'daily'],
      ['Create',    'icon-pencil', 'Editor'],
      ['Shop',      'icon-bag',    'Shop'],
      ['Ranking',   'icon-trophy', 'Leaderboard'],
    ];

    defs.forEach(([label, icon, scene, param], i) => {
      const btn = addBeigeButton(this, {
        x,
        y: startY + i * gap,
        width: w,
        height: h,
        label,
        iconKey: icon,
        onClick: () => {
          this.cameras.main.fadeOut(250, 10, 5, 14);
          this.time.delayedCall(260, () => {
            this.scene.start(scene, param ? { levelId: param } : undefined);
          });
        },
      });
      btn.setDepth(8).setAlpha(0);
      this.tweens.add({ targets: btn, alpha: 1, duration: 280, delay: 200 + i * 70 });
      elements.push(btn);
    });
  }

  private buildStreakBadge(x: number, y: number, days: number): Phaser.GameObjects.Container {
    const pillW = 180, pillH = 26;
    const bg   = addBeigeCard(this, 0, 0, pillW, pillH);
    const icon = addDepthIcon(this, -pillW / 2 + 18, 0, 'icon-fire', 14, 14);
    const txt  = this.add.text(-pillW / 2 + 32, 0, `${days} day streak!`, {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: '#5A2A00',
      shadow: { offsetX: 1, offsetY: 1, color: '#C8940A', blur: 0, fill: true },
    }).setOrigin(0, 0.5);
    return this.add.container(x, y, [bg, icon, txt]);
  }

  private startSparkleEffect() {
    this.sparkleTimers.forEach(t => t.destroy());
    this.sparkleTimers = [];
    const { width, height } = this.scale;
    const t = this.time.addEvent({
      delay: 1200, loop: true,
      callback: () => {
        if (!this.scene.isActive('MainMenu')) return;
        const rx = Phaser.Math.Between(40, width - 40);
        const ry = Phaser.Math.Between(height * 0.38, height * 0.92);
        const s  = this.add.image(rx, ry, 'icon-sparkle')
          .setDisplaySize(10, 10).setAlpha(0).setDepth(4).setTint(C.GOLD);
        this.tweens.add({
          targets: s, alpha: { from: 0, to: 0.65 }, y: ry - 32,
          scale: { from: 0.4, to: 1.0 }, duration: 620, yoyo: true,
          onComplete: () => s.destroy(),
        });
      },
    });
    this.sparkleTimers.push(t);
  }

  private repositionBgLayers(width: number, height: number) {
    this.bgLayers.forEach(img => {
      img.setPosition(width / 2, height / 2);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
    });
  }

  private onResize(gs: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gs instanceof Phaser.Scale.ScaleManager ? gs : gs;
    this.cameras.resize(width, height);
    this.repositionBgLayers(width, height);
    this.buildUI();
  }

  shutdown() {
    this.sparkleTimers.forEach(t => t.destroy());
    this.mascot?.stopIdleAnims();
    this.scale.off('resize', this.onResize, this);
  }
}
