import * as Phaser from 'phaser';

export class GameOver extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    this.cameras.main.setBackgroundColor(0x1a0a2e);
    this.cameras.main.fadeIn(400);

    this.add.text(cx, cy - 40, '💥 Something went wrong', {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '22px',
      color: '#ff4444',
      stroke: '#1a0a2e',
      strokeThickness: 4,
      align: 'center',
    }).setOrigin(0.5);

    this.add.text(cx, cy + 16, 'Tap to return to the menu', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#a0b0c0',
    }).setOrigin(0.5);

    this.input.once('pointerdown', () => this.scene.start('MainMenu'));
  }
}
