import * as Phaser from 'phaser';
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

  create(data: { levelId: string; title?: string; steps: number; timeMs: number; stars: number; sparks: number }) {
    const { width, height } = this.scale;
    const cx = width / 2;
    const { levelId, steps, timeMs, stars, sparks } = data ?? { levelId: '?', steps: 0, timeMs: 0, stars: 1, sparks: 10 };

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
    const bg = this.add.graphics();
    bg.fillStyle(C.PANEL, 0.92);
    bg.fillRoundedRect(cx - panelW / 2, panelY - panelH / 2, panelW, panelH, 20);
    bg.lineStyle(2, C.GREEN, 0.6);
    bg.strokeRoundedRect(cx - panelW / 2, panelY - panelH / 2, panelW, panelH, 20);

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

    // Splot mascot
    this.splot = new SplotMascot(this, cx, panelY + panelH / 2 - 50, 80);
    this.time.delayedCall(400, () => this.splot?.playWin());

    // Buttons — three in a row
    const btnY  = panelY + panelH / 2 + 50;
    const btnW  = Math.min((panelW - 24) / 3, 110);
    const btnGap = btnW + 8;

    const nextId = this.getNextLevelId(levelId);
    const hasNext = nextId !== null;

    this.buildBtn(cx - btnGap, btnY, btnW, 44, hasNext ? 'Next' : 'All Done!', C.GREEN, () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => {
        if (hasNext) {
          this.scene.start('Game', { levelId: nextId });
        } else {
          this.scene.start('LevelSelect');
        }
      });
    });
    this.buildBtn(cx, btnY, btnW, 44, 'Ranks', 0xe8c234, () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start('Leaderboard', { levelId }));
    });
    this.buildBtn(cx + btnGap, btnY, btnW, 44, 'Levels', 0x1a6fbf, () => {
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

  private buildBtn(x: number, y: number, w: number, h: number, label: string, color: number, cb: () => void) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 12);
    const txt = this.add.text(x, y, label, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '16px',
      color: '#ffffff',
    }).setOrigin(0.5);

    const zone = this.add.zone(x, y, w, h).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => this.tweens.add({ targets: [g, txt], scaleX: 1.05, scaleY: 1.05, duration: 80 }));
    zone.on('pointerout',  () => this.tweens.add({ targets: [g, txt], scaleX: 1, scaleY: 1, duration: 80 }));
    zone.on('pointerup', cb);
  }

  private getNextLevelId(currentId: string): string | null {
    const idx = CURATED_LEVELS.findIndex(l => l.id === currentId);
    if (idx < 0 || idx >= CURATED_LEVELS.length - 1) return null;
    return CURATED_LEVELS[idx + 1]?.id ?? null;
  }
}
