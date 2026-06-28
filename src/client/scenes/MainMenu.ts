import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import type { InitResponse } from '../../shared/api';

// ── Design tokens ─────────────────────────────────────────────
const C = {
  BG_DEEP:   0x1a0a2e,
  BG_MID:    0x2d1b4e,
  GREEN:     0x6dd400,
  GOLD:      0xffd700,
  ORANGE:    0xff6b35,
  TEXT:      '#ffffff',
  DIM:       '#a0b0c0',
  PANEL:     0x2d1b4e,
} as const;

// ── Reusable button helper ────────────────────────────────────
function makeButton(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  label: string, iconKey: string | null,
  color: number, cb: () => void,
): Phaser.GameObjects.Container {
  const g = scene.add.graphics();
  const drawNormal = () => {
    g.clear();
    g.fillStyle(color, 1);
    g.fillRoundedRect(-w/2, -h/2, w, h, 14);
    g.lineStyle(2, 0xffffff, 0.15);
    g.strokeRoundedRect(-w/2, -h/2, w, h, 14);
  };
  const drawPress = () => {
    g.clear();
    g.fillStyle(Phaser.Display.Color.IntegerToColor(color).darken(30).color, 1);
    g.fillRoundedRect(-w/2, -h/2 + 2, w, h, 14);
  };
  drawNormal();

  const items: Phaser.GameObjects.GameObject[] = [g];
  let textX = 0;

  if (iconKey) {
    const icon = scene.add.image(-w/2 + 26, 0, iconKey)
      .setDisplaySize(22, 22).setOrigin(0.5);
    items.push(icon);
    textX = 10;
  }

  const txt = scene.add.text(textX, 0, label, {
    fontFamily: '"Arial Black", sans-serif',
    fontSize: `${Math.round(h * 0.38)}px`,
    color: C.TEXT,
    shadow: { offsetX: 1, offsetY: 2, color: '#000000', blur: 4, fill: true },
  }).setOrigin(0.5);
  items.push(txt);

  const c = scene.add.container(x, y, items);
  c.setSize(w, h);
  c.setInteractive({ useHandCursor: true });

  c.on('pointerover',  () => scene.tweens.add({ targets: c, scaleX: 1.04, scaleY: 1.04, duration: 80 }));
  c.on('pointerout',   () => { drawNormal(); scene.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 80 }); });
  c.on('pointerdown',  () => { drawPress(); scene.tweens.add({ targets: c, scaleX: 0.96, scaleY: 0.96, duration: 60 }); });
  c.on('pointerup',    () => { drawNormal(); scene.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 60, onComplete: cb }); });
  return c;
}

// ── Scene ──────────────────────────────────────────────────────
export class MainMenu extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private sparksText: Phaser.GameObjects.Text | null = null;
  private usernameText: Phaser.GameObjects.Text | null = null;
  private streakText: Phaser.GameObjects.Text | null = null;
  private streakBadge: Phaser.GameObjects.Container | null = null;
  private buttons: Phaser.GameObjects.Container[] = [];
  private sparkleTimers: Phaser.Time.TimerEvent[] = [];
  private userData: InitResponse | null = null;

  constructor() { super('MainMenu'); }

  init() {
    this.bgLayers = [];
    this.buttons = [];
    this.sparkleTimers = [];
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG_DEEP);
    this.cameras.main.fadeIn(400, 10, 5, 46);

    void this.loadUserData();

    this.buildBackground();
    this.buildUI();
    this.scale.on('resize', this.onResize, this);
    this.onResize(this.scale);
  }

  private async loadUserData() {
    try {
      const res = await fetch('/api/init');
      if (res.ok) {
        this.userData = await res.json() as InitResponse;
        if (this.streakText && this.streakBadge) {
          const streakDays = this.userData.streakDays ?? 0;
          this.streakText.setText(streakDays > 0 ? `${streakDays} day streak` : 'Daily streak starts today');
          this.streakBadge.setVisible(true).setAlpha(0);
          this.tweens.add({
            targets: this.streakBadge,
            alpha: 1,
            y: this.streakBadge.y - 4,
            duration: 220,
            ease: 'Back.easeOut',
          });
        }
        if (this.usernameText && this.userData.username) {
          this.usernameText.setText(`Hey ${this.userData.username}! 👋`);
        }
        if (this.sparksText) {
          this.sparksText.setText(`✨ ${this.userData.sparks}`);
        }
      }
    } catch { /* offline / playtest fallback */ }
  }

  private buildBackground() {
    const { width, height } = this.scale;
    const keys = ['bg1-1', 'bg1-2', 'bg1-3', 'bg1-4'];
    const alphas = [1, 0.85, 0.7, 0.5];

    keys.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i])
        .setDepth(-10 + i);
      // Cover the canvas
      const scaleX = width  / img.width;
      const scaleY = height / img.height;
      img.setScale(Math.max(scaleX, scaleY) * 1.05);
      this.bgLayers.push(img);

      // Slow parallax drift
      const dir = i % 2 === 0 ? 1 : -1;
      this.tweens.add({
        targets: img,
        x: width / 2 + dir * 18,
        duration: 12000 + i * 3000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    });

    // Subtle vignette overlay
    const vignette = this.add.graphics().setDepth(0);
    vignette.fillGradientStyle(0x1a0a2e, 0x1a0a2e, 0x1a0a2e, 0x1a0a2e, 0.8, 0.8, 0, 0);
    vignette.fillRect(0, 0, width, height * 0.3);
    vignette.fillGradientStyle(0x1a0a2e, 0x1a0a2e, 0x1a0a2e, 0x1a0a2e, 0, 0, 0.8, 0.8);
    vignette.fillRect(0, height * 0.7, width, height * 0.3);
  }

  private buildUI() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const isPortrait = height > width;

    // Splot mascot position
    const splotY = isPortrait ? height * 0.32 : height * 0.35;
    const splotSize = isPortrait ? Math.min(width * 0.38, 180) : Math.min(height * 0.35, 170);

    new SplotMascot(this, cx, splotY, splotSize);

    // SPLOT! title
    const title = this.add.text(cx, splotY - splotSize * 0.72, 'Splot!', {
      fontFamily: '"Arial Black", Impact, sans-serif',
      fontSize: `${Math.round(splotSize * 0.56)}px`,
      color: '#6DD400',
      stroke: '#1a0a2e',
      strokeThickness: 7,
      shadow: { offsetX: 3, offsetY: 4, color: '#000000', blur: 10, fill: true },
    }).setOrigin(0.5).setDepth(5);

    // Subtle pulse on title
    this.tweens.add({
      targets: title,
      scale: 1.04,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Username greeting
    this.usernameText = this.add.text(cx, splotY + splotSize * 0.62, 'Hey there! 👋', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '18px',
      color: C.DIM,
    }).setOrigin(0.5).setDepth(5);

    this.streakBadge = this.buildStreakBadge(cx, splotY + splotSize * 0.82);
    this.streakBadge.setDepth(5).setVisible(false);

    // Sparks counter
    const sparksContainer = this.buildSparksCounter(width - 16, 16);
    sparksContainer.setDepth(10);

    // Main action buttons
    const btnW = isPortrait ? Math.min(width - 48, 320) : 280;
    const btnX = isPortrait ? cx : cx + width * 0.15;
    const btnStartY = isPortrait ? height * 0.6 : height * 0.38;

    const btnH2  = 48;
    const btnGap2 = btnH2 + 10;

    const btns: [string, string | null, number, string, string?][] = [
      ['▶  Play Levels',    'icon-play', C.GREEN,  'LevelSelect'],
      ['📅  Daily Puzzle',  null,        0x7b2ff7, 'Game',        'daily'],
      ['✏️  Create Level',  null,        0x1a6fbf, 'Editor'],
      ['🏆  Leaderboard',   null,        0x0d4a8f, 'Leaderboard'],
      ['🛍  Shop',          'icon-bag',  0xff6b35, 'Shop'],
    ];

    btns.forEach(([label, icon, color, scene, param], i) => {
      const btn = makeButton(this, btnX, btnStartY + i * btnGap2, btnW, btnH2,
        label, icon, color, () => {
          this.cameras.main.fadeOut(250, 10, 5, 46);
          this.time.delayedCall(260, () => {
            if (param) {
              this.scene.start(scene, { levelId: param });
            } else {
              this.scene.start(scene);
            }
          });
        });
      btn.setDepth(5);
      btn.setAlpha(0);
      this.tweens.add({ targets: btn, alpha: 1, y: btnStartY + i * btnGap2, duration: 300, delay: 200 + i * 80 });
      this.buttons.push(btn);
    });

    // Floating sparkles
    this.startSparkleEffect();
  }

  private buildSparksCounter(x: number, y: number): Phaser.GameObjects.Container {
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.45);
    bg.fillRoundedRect(0, 0, 110, 36, 18);
    bg.lineStyle(1, C.GOLD, 0.5);
    bg.strokeRoundedRect(0, 0, 110, 36, 18);

    const icon = this.add.image(20, 18, 'icon-spark').setDisplaySize(20, 20);
    this.sparksText = this.add.text(38, 18, '✨ 0', {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '16px',
      color: '#FFD700',
    }).setOrigin(0, 0.5);

    const c = this.add.container(x - 116, y, [bg, icon, this.sparksText]);
    return c;
  }

  private buildStreakBadge(x: number, y: number): Phaser.GameObjects.Container {
    const bg = this.add.graphics();
    bg.fillStyle(0x000000, 0.38);
    bg.fillRoundedRect(-86, -16, 172, 32, 16);
    bg.lineStyle(1, 0xff6b35, 0.45);
    bg.strokeRoundedRect(-86, -16, 172, 32, 16);

    const icon = this.add.image(-64, 0, 'icon-fire').setDisplaySize(18, 18);
    this.streakText = this.add.text(-42, 0, 'Daily streak starts today', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: '#ffb347',
    }).setOrigin(0, 0.5);

    return this.add.container(x, y, [bg, icon, this.streakText]);
  }

  private startSparkleEffect() {
    // Small sparkle particles drifting upward
    const { width, height } = this.scale;
    const timer = this.time.addEvent({
      delay: 1200,
      loop: true,
      callback: () => {
        const rx = Phaser.Math.Between(50, width - 50);
        const ry = Phaser.Math.Between(height * 0.4, height * 0.9);
        const star = this.add.image(rx, ry, 'icon-sparkle')
          .setDisplaySize(12, 12)
          .setAlpha(0)
          .setDepth(4)
          .setTint(C.GOLD);
        this.tweens.add({
          targets: star,
          alpha:   { from: 0, to: 0.8 },
          y:       ry - 40,
          scale:   { from: 0.5, to: 1.2 },
          duration: 700,
          yoyo: true,
          onComplete: () => star.destroy(),
        });
      },
    });
    this.sparkleTimers.push(timer);
  }

  private onResize(gameSize: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gameSize instanceof Phaser.Scale.ScaleManager
      ? gameSize : gameSize;

    this.cameras.resize(width, height);

    // Stretch background layers
    this.bgLayers.forEach(img => {
      img.setPosition(width / 2, height / 2);
      const scX = width  / (img.width  || 1);
      const scY = height / (img.height || 1);
      img.setScale(Math.max(scX, scY) * 1.05);
    });
  }

  shutdown() {
    this.sparkleTimers.forEach(t => t.destroy());
    this.scale.off('resize', this.onResize, this);
  }
}
