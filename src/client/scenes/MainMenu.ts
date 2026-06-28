import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import { addPixelButton, addPixelPanel, PIXEL_FONT } from '../components/PixelUI';
import type { InitResponse } from '../../shared/api';

const C = {
  BG_DEEP: 0x1a0a2e,
  GREEN:   0x6dd400,
  GOLD:    0xffd700,
  ORANGE:  0xff6b35,
  TEXT:    '#ffffff',
  DIM:     '#a0b0c0',
} as const;

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
    this.uiLayer = null;
    this.mascot = null;
    this.sparkleTimers = [];
    this.userData = null;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG_DEEP);
    this.cameras.main.fadeIn(400, 10, 5, 46);

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
    const alphas = [1, 0.85, 0.65, 0.45];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.4)
        .setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);

      const dir = i % 2 === 0 ? 1 : -1;
      this.tweens.add({
        targets: img,
        x: width / 2 + dir * 20,
        duration: 13000 + i * 3500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });
  }

  private buildUI() {
    // Destroy old mascot + UI layer before rebuild
    this.mascot?.stopIdleAnims();
    this.mascot = null;
    this.uiLayer?.destroy(true);
    this.sparksText = null;

    const { width, height } = this.scale;
    const cx         = width / 2;
    const isPortrait = height > width;
    const elements: Phaser.GameObjects.GameObject[] = [];

    // ── Sparks counter (always top-right) ───────────────────
    const sparksPanel = addPixelPanel(this, width - 8, 10, 116, 34)
      .setOrigin(1, 0).setDepth(10);
    const sparkIcon = this.add.image(width - 100, 27, 'icon-spark').setDisplaySize(18, 18).setDepth(11);
    this.sparksText = this.add.text(width - 82, 27, `${this.userData?.sparks ?? 0}`, {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#FFD700',
    }).setOrigin(0, 0.5).setDepth(11);
    elements.push(sparksPanel, sparkIcon, this.sparksText);

    if (isPortrait) {
      this.buildPortraitLayout(cx, width, height, elements);
    } else {
      this.buildLandscapeLayout(cx, width, height, elements);
    }

    this.startSparkleEffect();
    this.uiLayer = this.add.container(0, 0, elements);
  }

  private buildPortraitLayout(cx: number, width: number, height: number, elements: Phaser.GameObjects.GameObject[]) {
    const splotSize  = Math.min(width * 0.40, 180);
    const titleH     = splotSize * 0.28;
    const titleW     = splotSize * 1.6;
    const topPad     = height * 0.06;

    // Title image
    const title = this.add.image(cx, topPad + titleH / 2, 'title')
      .setDisplaySize(titleW, titleH).setOrigin(0.5).setDepth(5);
    this.tweens.add({ targets: title, scale: 1.04, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    elements.push(title);

    // Mascot
    const mascotY = topPad + titleH + splotSize * 0.6 + 8;
    this.mascot = new SplotMascot(this, cx, mascotY, splotSize);
    this.mascot.container.setDepth(5);
    elements.push(this.mascot.container);

    // Greeting
    const username = this.userData?.username ?? '';
    const greetY   = mascotY + splotSize * 0.56;
    const greetTxt = this.add.text(cx, greetY, username ? `Hey ${username}!` : 'Hey there!', {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: C.DIM,
    }).setOrigin(0.5).setDepth(5);
    elements.push(greetTxt);

    // Streak badge
    const streakDays = this.userData?.streakDays ?? 0;
    if (streakDays > 0) {
      const badge = this.buildStreakBadge(cx, greetY + 28, streakDays);
      badge.setDepth(5);
      elements.push(badge);
    }

    // Buttons
    const btnW      = Math.min(width - 48, 300);
    const btnH      = 46;
    const btnGap    = btnH + 10;
    const btnStartY = Math.max(greetY + 56, height * 0.57);
    this.buildButtons(cx, btnStartY, btnW, btnH, btnGap, elements);
  }

  private buildLandscapeLayout(cx: number, width: number, height: number, elements: Phaser.GameObjects.GameObject[]) {
    const leftCx   = width * 0.25;
    const rightCx  = width * 0.67;
    const splotSize = Math.min(height * 0.32, 150);
    const titleH   = splotSize * 0.30;
    const titleW   = splotSize * 1.8;
    const topPad   = height * 0.07;
    void cx;

    // Title image (above mascot on left column)
    const title = this.add.image(leftCx, topPad + titleH / 2, 'title')
      .setDisplaySize(titleW, titleH).setOrigin(0.5).setDepth(5);
    this.tweens.add({ targets: title, scale: 1.04, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    elements.push(title);

    // Mascot (centered left column)
    const mascotY = topPad + titleH + splotSize * 0.58 + 12;
    this.mascot = new SplotMascot(this, leftCx, mascotY, splotSize);
    this.mascot.container.setDepth(5);
    elements.push(this.mascot.container);

    // Greeting + streak (below mascot in left column)
    const username  = this.userData?.username ?? '';
    const greetY    = mascotY + splotSize * 0.58;
    const greetTxt  = this.add.text(leftCx, greetY, username ? `Hey ${username}!` : 'Hey there!', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: C.DIM,
    }).setOrigin(0.5).setDepth(5);
    elements.push(greetTxt);

    const streakDays = this.userData?.streakDays ?? 0;
    if (streakDays > 0) {
      const badge = this.buildStreakBadge(leftCx, greetY + 24, streakDays);
      badge.setDepth(5);
      elements.push(badge);
    }

    // Buttons (right column, vertically centered)
    const btnW      = Math.min(width * 0.40, 260);
    const btnH      = 44;
    const btnGap    = btnH + 8;
    const totalBtnH = 5 * btnH + 4 * 8;
    const btnStartY = (height - totalBtnH) / 2 + btnH / 2;
    this.buildButtons(rightCx, btnStartY, btnW, btnH, btnGap, elements);
  }

  private buildButtons(
    x: number, startY: number, w: number, h: number, gap: number,
    elements: Phaser.GameObjects.GameObject[],
  ) {
    const defs: [string, string, string, string?][] = [
      ['Play Levels',  'icon-play',   'LevelSelect'],
      ['Daily Puzzle', 'icon-timer',  'Game',         'daily'],
      ['Create Level', 'icon-pencil', 'Editor'],
      ['Leaderboard',  'icon-trophy', 'Leaderboard'],
      ['Shop',         'icon-bag',    'Shop'],
    ];

    defs.forEach(([label, icon, scene, param], i) => {
      const btn = addPixelButton(this, {
        x,
        y: startY + i * gap,
        width: w,
        height: h,
        label,
        iconKey: icon,
        onClick: () => {
          this.cameras.main.fadeOut(250, 10, 5, 46);
          this.time.delayedCall(260, () => {
            this.scene.start(scene, param ? { levelId: param } : undefined);
          });
        },
      });
      btn.setDepth(5).setAlpha(0);
      this.tweens.add({ targets: btn, alpha: 1, duration: 280, delay: 180 + i * 70 });
      elements.push(btn);
    });
  }

  private buildStreakBadge(x: number, y: number, days: number): Phaser.GameObjects.Container {
    const panelW = 180;
    const panelH = 28;
    const bg     = addPixelPanel(this, 0, 0, panelW, panelH);
    const icon   = this.add.image(-panelW / 2 + 20, 0, 'icon-fire').setDisplaySize(14, 14);
    const txt    = this.add.text(-panelW / 2 + 32, 0, `${days} day streak!`, {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: '#ffb347',
    }).setOrigin(0, 0.5);
    return this.add.container(x, y, [bg, icon, txt]);
  }

  private startSparkleEffect() {
    this.sparkleTimers.forEach(t => t.destroy());
    this.sparkleTimers = [];

    const { width, height } = this.scale;
    const t = this.time.addEvent({
      delay: 1100,
      loop: true,
      callback: () => {
        if (!this.scene.isActive('MainMenu')) return;
        const rx  = Phaser.Math.Between(40, width - 40);
        const ry  = Phaser.Math.Between(height * 0.35, height * 0.92);
        const s   = this.add.image(rx, ry, 'icon-sparkle')
          .setDisplaySize(10, 10).setAlpha(0).setDepth(4).setTint(C.GOLD);
        this.tweens.add({
          targets: s,
          alpha: { from: 0, to: 0.7 },
          y: ry - 36,
          scale: { from: 0.4, to: 1.1 },
          duration: 650,
          yoyo: true,
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

  private onResize(gameSize: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gameSize instanceof Phaser.Scale.ScaleManager ? gameSize : gameSize;
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
