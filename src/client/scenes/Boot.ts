import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() { super('Boot'); }

  preload() {
    // Load just enough to show a rich loading screen in Preloader
    this.load.setPath('assets');
    this.load.image('title',  'title.png');
    this.load.image('bg4-1',  'background/background 4/1.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x1a0a2e);
    this.scene.start('Preloader');
  }
}
