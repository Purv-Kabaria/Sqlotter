import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() { super('Boot'); }

  create() {
    // Minimal boot — just set background colour and jump to Preloader
    this.cameras.main.setBackgroundColor(0x1a0a2e);
    this.scene.start('Preloader');
  }
}
