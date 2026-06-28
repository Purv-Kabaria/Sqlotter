import * as Phaser from 'phaser';
import { addPixelButton, addPixelPanel } from '../components/PixelUI';
import { SplotMascot } from '../components/SplotMascot';
import { CURATED_LEVELS } from '../../shared/levelData';

const C = {
  BG:     0x1a0a2e,
  GREEN:  0x6dd400,
  GOLD:   0xffd700,
  TEXT:   '#ffffff',
  DIM:    '#7a8a9a',
  PANEL:  0x2d1b4e,
} as const;

export class LevelComplete extends Phaser.Scene {
  private splot: SplotMascot | null = null;

  constructor() { super('LevelComplete'); }

  create(data: { levelId: string; title?: string; steps: number; timeMs: number; stars: number; sparks: number; streakDays?: number }) {
    const { width, height } = this.scale;
    const cx = width / 2;
    const { levelId, steps, timeMs, stars, sparks, streakDays } = data ?? { levelId: '?', steps: 0, timeMs: 0, stars: 1, sparks: 10 };

    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(400, 26, 10, 46);

    // Starfield background
    for (let i = 0; i < 60; i++) {
      const x = Phaser.Math.Between(0, width);
      const y = Phaser.Math.Between(0, height);
      this.add.circle(x, y, Phaser.Math.Between(1, 3), 0xffffff, Phaser.Math.FloatBetween(0.2, 0.7));
    }

    // Panel
    const panelW = Math.min(width - 32, 380);
    const panelH = 320;
    const panelY = height / 2;
    addPixelPanel(this, cx, panelY, panelW, panelH).setAlpha(0.95);

    // "LEVEL CLEAR!" title
    const titleTxt = this.add.text(cx, panelY - panelH / 2 + 40, 'LEVEL CLEAR! 🎉', {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '28px',
      color: '#6DD400',
      stroke: '#1a0a2e',
      strokeThickness: 5,
    }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: titleTxt, alpha: 1, y: panelY - panelH / 2 + 34, duration: 500, ease: 'Back.easeOut' });

    // Stars (pop in one by one)
    for (let s = 0; s < 3; s++) {
      const filled = s < stars;
      const starTxt = this.add.text(cx - 32 + s * 32, panelY - panelH / 2 + 85, '★', {
        fontSize: '40px',
        color: filled ? '#FFD700' : '#3a2560',
        stroke: '#1a0a2e',
        strokeThickness: 3,
      }).setOrigin(0.5).setScale(0);

      this.tweens.add({
        targets: starTxt,
        scale: 1,
        duration: 350,
        delay: 500 + s * 180,
        ease: 'Back.easeOut',
      });

      if (filled) {
        this.time.delayedCall(500 + s * 180, () => {
          this.tweens.add({ targets: starTxt, scale: 1.2, duration: 100, yoyo: true });
        });
      }
    }

    // Stats
    const secs = Math.floor(timeMs / 1000);
    const timeStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    const statsY = panelY - panelH / 2 + 145;
    const statItems: [string, string][] = [
      ['Steps', `${steps}`],
      ['Time', timeStr],
      ['Sparks', `+${sparks} ✨`],
    ];
    statItems.forEach(([label, value], i) => {
      const sy = statsY + i * 36;

      const lbl = this.add.text(cx - panelW / 2 + 30, sy, label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '16px',
        color: C.DIM,
      }).setAlpha(0);
      const val = this.add.text(cx + panelW / 2 - 30, sy, value, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '17px',
        color: C.TEXT,
      }).setOrigin(1, 0).setAlpha(0);

      this.tweens.add({ targets: [lbl, val], alpha: 1, duration: 300, delay: 900 + i * 100 });
    });
    this.playRewardBurst(cx, panelY - panelH / 2 + 90, stars);

    if (streakDays !== undefined) {
      const streak = this.add.text(cx, statsY + statItems.length * 36 + 4, `🔥 Daily streak: ${streakDays} day${streakDays === 1 ? '' : 's'}`, {
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '15px',
        color: '#ffb347',
        stroke: '#1a0a2e',
        strokeThickness: 3,
      }).setOrigin(0.5).setAlpha(0);
      this.tweens.add({
        targets: streak,
        alpha: 1,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 220,
        yoyo: true,
        delay: 1250,
      });
    }

    // Splot mascot
    this.splot = new SplotMascot(this, cx, panelY + panelH / 2 - 50, 80);
    this.time.delayedCall(400, () => this.splot?.playWin());

    // Buttons — three in a row
    const btnY  = panelY + panelH / 2 + 50;
    const btnW  = Math.min((panelW - 24) / 3, 110);
    const btnGap = btnW + 8;

    const nextId = this.getNextLevelId(levelId);
    const hasNext = nextId !== null;

    this.buildBtn(cx - btnGap, btnY, btnW, 44, hasNext ? 'Next' : 'All Done!', () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => {
        if (hasNext) {
          this.scene.start('Game', { levelId: nextId });
        } else {
          this.scene.start('LevelSelect');
        }
      });
    });
    this.buildBtn(cx, btnY, btnW, 44, 'Ranks', () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start('Leaderboard', { levelId }));
    });
    this.buildBtn(cx + btnGap, btnY, btnW, 44, 'Levels', () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start('LevelSelect'));
    });

    // Floating sparks
    this.time.addEvent({
      delay: 300,
      repeat: 12,
      callback: () => {
        const px = Phaser.Math.Between(cx - 120, cx + 120);
        const py = Phaser.Math.Between(panelY - 80, panelY + 80);
        const s = this.add.image(px, py, 'icon-sparkle')
          .setDisplaySize(14, 14).setAlpha(0).setTint(C.GOLD).setDepth(20);
        this.tweens.add({ targets: s, alpha: 1, y: py - 50, scale: 1.4, duration: 600, yoyo: true, onComplete: () => s.destroy() });
      },
    });
  }

  private buildBtn(x: number, y: number, w: number, h: number, label: string, cb: () => void) {
    addPixelButton(this, {
      x,
      y,
      width: w,
      height: h,
      label,
      fontSize: 14,
      onClick: cb,
    });
  }

  private playRewardBurst(cx: number, cy: number, stars: number) {
    const count = 10 + stars * 4;
    for (let i = 0; i < count; i++) {
      const useSpark = i % 3 === 0;
      const particle = useSpark
        ? this.add.image(cx, cy, 'icon-spark').setDisplaySize(14, 14)
        : this.add.image(cx, cy, 'icon-sparkle').setDisplaySize(12, 12);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(42, 130);
      particle.setDepth(22).setTint(useSpark ? C.GOLD : 0xffffff).setAlpha(0);
      this.tweens.add({
        targets: particle,
        alpha: { from: 0, to: 1 },
        x: cx + Math.cos(angle) * distance,
        y: cy + Math.sin(angle) * distance,
        scaleX: 1.35,
        scaleY: 1.35,
        angle: Phaser.Math.Between(-120, 120),
        duration: 520,
        delay: 480 + i * 18,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: particle,
            alpha: 0,
            y: particle.y - 18,
            duration: 220,
            onComplete: () => particle.destroy(),
          });
        },
      });
    }
  }

  private getNextLevelId(currentId: string): string | null {
    const idx = CURATED_LEVELS.findIndex(l => l.id === currentId);
    if (idx < 0 || idx >= CURATED_LEVELS.length - 1) return null;
    return CURATED_LEVELS[idx + 1]?.id ?? null;
  }
}
