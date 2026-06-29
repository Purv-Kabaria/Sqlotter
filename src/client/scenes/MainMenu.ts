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
  TEXT_DARK:  '#3A1A08',
  TEXT_BEIGE: '#DEC998',
  DIM:        '#9A8A7A',
  AMBER:      '#C8940A',
} as const;

const HEADER_H = 56;

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
    // bg4 = the sky/clouds background matching frame designs
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

    // ── Header strip ──────────────────────────────────────────────────────
    const header = this.add.rectangle(width / 2, HEADER_H / 2, width, HEADER_H, C.HEADER_BG)
      .setDepth(10);
    elements.push(header);

    if (this.textures.exists('title')) {
      const maxW = Math.min(width * 0.52, 220);
      const logo = this.add.image(width / 2, HEADER_H / 2, 'title')
        .setDisplaySize(maxW, maxW * 0.22).setDepth(11);
      elements.push(logo);
    }

    // ── Sparks counter pill (top-right in header) ─────────────────────────
    const pillW = 108, pillH = 32;
    const pillX = width - pillW / 2 - 10;
    const pillY = HEADER_H / 2;
    const sparkPill = addBeigeCard(this, pillX, pillY, pillW, pillH).setDepth(12);
    const sparkIc   = addDepthIcon(this, pillX - pillW / 2 + 18, pillY, 'icon-spark', 16, 16);
    sparkIc.setDepth(13);
    this.sparksText = this.add.text(pillX - pillW / 2 + 32, pillY, `${this.userData?.sparks ?? 0}`, {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: C.AMBER,
      shadow: { offsetX: 1, offsetY: 1, color: '#5A3A00', blur: 0, fill: true },
    }).setOrigin(0, 0.5).setDepth(13);
    elements.push(sparkPill, sparkIc, this.sparksText);

    if (isPortrait) {
      this.buildPortraitLayout(width, height, elements);
    } else {
      this.buildLandscapeLayout(width, height, elements);
    }

    this.startSparkleEffect();
    this.uiLayer = this.add.container(0, 0, elements);
  }

  // ── Portrait layout: mascot floats in sky, 5 wide stacked buttons ────────
  private buildPortraitLayout(width: number, height: number, elements: Phaser.GameObjects.GameObject[]) {
    const cx = width / 2;

    // Splot mascot — large, centered below header
    const splotSz = Math.min(width * 0.52, 200);
    const splotY  = HEADER_H + splotSz * 0.58 + 16;
    this.mascot = new SplotMascot(this, cx, splotY, splotSz);
    this.mascot.container.setDepth(5);
    elements.push(this.mascot.container);

    // Greeting + streak
    const greetY = splotY + splotSz * 0.54;
    const username = this.userData?.username ?? '';
    if (username) {
      elements.push(this.add.text(cx, greetY, `Hey ${username}!`, {
        fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DIM,
        shadow: { offsetX: 1, offsetY: 1, color: '#000', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(5));
    }
    const streakDays = this.userData?.streakDays ?? 0;
    if (streakDays > 0) {
      elements.push(this.buildStreakBadge(cx, greetY + 26, streakDays).setDepth(5));
    }

    // 5 stacked wide beige pill buttons
    const btnW   = Math.min(width - 32, 320);
    const btnH   = 52;
    const gap    = 10;
    const totalH = 5 * btnH + 4 * gap;
    const startY = Math.max(greetY + 44, height - totalH - 20);

    this.buildMenuButtons(cx, startY, btnW, btnH, gap, elements, 'portrait');
  }

  // ── Landscape layout: mascot card left, logo+buttons right ───────────────
  private buildLandscapeLayout(width: number, height: number, elements: Phaser.GameObjects.GameObject[]) {
    const splitX  = width * 0.47;
    const rightCx = splitX + (width - splitX) / 2;
    const contentY = HEADER_H;

    // Left panel: large beige card containing Splot
    const panelW = splitX - 20;
    const panelH = height - contentY - 16;
    const panelCy = contentY + panelH / 2 + 8;
    const leftCard = addBeigeCard(this, splitX / 2, panelCy, panelW, panelH).setDepth(3);
    elements.push(leftCard);

    const splotSz = Math.min(panelW * 0.72, panelH * 0.72, 200);
    const splotY  = panelCy - splotSz * 0.04;
    this.mascot = new SplotMascot(this, splitX / 2, splotY, splotSz);
    this.mascot.container.setDepth(5);
    elements.push(this.mascot.container);

    // Right panel: dark background
    const rightW = width - splitX;
    const darkBg = addDarkPanel(this, splitX + rightW / 2, contentY + (height - contentY) / 2, rightW, height - contentY)
      .setDepth(2).setAlpha(0.92);
    elements.push(darkBg);

    // SQLOTTER logo in right panel
    if (this.textures.exists('title')) {
      const maxW = Math.min(rightW * 0.58, 240);
      const logo = this.add.image(rightCx, contentY + 58, 'title')
        .setDisplaySize(maxW, maxW * 0.22).setDepth(11);
      elements.push(logo);
    }

    // Right-side username/streak below logo
    const username = this.userData?.username ?? '';
    let infoY = contentY + 82;
    if (username) {
      elements.push(this.add.text(rightCx, infoY, `Hey ${username}!`, {
        fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DIM,
      }).setOrigin(0.5).setDepth(5));
      infoY += 18;
    }
    const streakDays = this.userData?.streakDays ?? 0;
    if (streakDays > 0) {
      elements.push(this.buildStreakBadge(rightCx, infoY, streakDays).setDepth(5));
      infoY += 22;
    }

    const btnAreaTop = infoY + 14;
    const btnW = Math.min(rightW - 32, 300);
    const btnH = 48;
    this.buildMenuButtons(rightCx, btnAreaTop, btnW, btnH, 8, elements, 'landscape');
  }

  private buildMenuButtons(
    cx: number, startY: number, btnW: number, btnH: number, gap: number,
    elements: Phaser.GameObjects.GameObject[],
    mode: 'portrait' | 'landscape',
  ) {
    const defs: [string, string, string, (string | undefined)?][] = [
      ['Play',    'icon-play',   'LevelSelect'],
      ['Daily',   'icon-timer',  'Game',        'daily'],
      ['Create',  'icon-pencil', 'Editor'],
      ['Shop',    'icon-price',  'Shop'],
      ['Ranking', 'icon-trophy', 'Leaderboard'],
    ];

    if (mode === 'portrait') {
      // All 5 buttons full width, stacked
      defs.forEach(([label, icon, scene, param], i) => {
        const btn = addBeigeButton(this, {
          x: cx, y: startY + i * (btnH + gap),
          width: btnW, height: btnH,
          label, iconKey: icon,
          onClick: () => this.goToScene(scene, param),
        });
        btn.setDepth(8).setAlpha(0);
        this.tweens.add({ targets: btn, alpha: 1, duration: 280, delay: 160 + i * 70 });
        elements.push(btn);
      });
    } else {
      // Landscape: Play full-width, then 2×2 grid for Daily/Create/Shop/Ranking
      const [play, daily, create, shop, ranking] = defs;

      const playBtn = addBeigeButton(this, {
        x: cx, y: startY,
        width: btnW, height: btnH,
        label: play![0], iconKey: play![1],
        onClick: () => this.goToScene(play![2]),
      });
      playBtn.setDepth(8).setAlpha(0);
      this.tweens.add({ targets: playBtn, alpha: 1, duration: 280, delay: 160 });
      elements.push(playBtn);

      const halfW = (btnW - 8) / 2;
      const smallH = Math.round(btnH * 0.85);
      const gridTop = startY + btnH + 10;
      const gridDefs = [daily!, create!, shop!, ranking!];

      gridDefs.forEach(([label, icon, scene, param], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const bx  = cx - btnW / 2 + halfW / 2 + col * (halfW + 8);
        const by  = gridTop + row * (smallH + 8);
        const btn = addBeigeButton(this, {
          x: bx, y: by,
          width: halfW, height: smallH,
          label, iconKey: icon,
          fontSize: Math.min(9, Math.round(smallH * 0.22)),
          onClick: () => this.goToScene(scene, param),
        });
        btn.setDepth(8).setAlpha(0);
        this.tweens.add({ targets: btn, alpha: 1, duration: 280, delay: 220 + i * 60 });
        elements.push(btn);
      });
    }
  }

  private goToScene(scene: string, param?: string) {
    this.cameras.main.fadeOut(250, 10, 5, 14);
    this.time.delayedCall(260, () => {
      this.scene.start(scene, param ? { levelId: param } : undefined);
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
      delay: 1400, loop: true,
      callback: () => {
        if (!this.scene.isActive('MainMenu')) return;
        const rx = Phaser.Math.Between(40, width - 40);
        const ry = Phaser.Math.Between(height * 0.15, height * 0.70);
        const s  = this.add.image(rx, ry, 'icon-sparkle')
          .setDisplaySize(10, 10).setAlpha(0).setDepth(4).setTint(C.GOLD);
        this.tweens.add({
          targets: s, alpha: { from: 0, to: 0.7 }, y: ry - 28,
          scale: { from: 0.4, to: 1.0 }, duration: 600, yoyo: true,
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
