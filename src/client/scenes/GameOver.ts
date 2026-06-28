import * as Phaser from 'phaser';
import { addPixelPanel, addPixelButton, PIXEL_FONT } from '../components/PixelUI';

export class GameOver extends Phaser.Scene {
  constructor() { super('GameOver'); }

  create() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    this.cameras.main.setBackgroundColor(0x1a0a2e);
    this.cameras.main.fadeIn(400);

    const panelW = Math.min(width - 32, 360);
    addPixelPanel(this, cx, cy, panelW, 140);

    this.add.image(cx, cy - 30, 'icon-warning').setDisplaySize(32, 32);

    this.add.text(cx, cy + 10, 'Something went wrong', {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#ff4444',
      stroke: '#1a0a2e',
      strokeThickness: 3,
      align: 'center',
      wordWrap: { width: panelW - 32 },
    }).setOrigin(0.5);

    addPixelButton(this, {
      x: cx,
      y: cy + 50,
      width: 160,
      height: 40,
      label: 'Main Menu',
      iconKey: 'icon-home',
      onClick: () => this.scene.start('MainMenu'),
    });
  }
}
