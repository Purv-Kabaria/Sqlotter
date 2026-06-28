import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() { super('Boot'); }

  preload() {
    // Load just enough to show a rich loading screen in Preloader
    this.load.setPath('assets');
    this.load.image('title',        'title.png');
    this.load.image('bg4-1',        'background/background 4/1.png');
    this.load.image('ui-banner',    'more ui/UI_Flat_Banner02a.png');
    this.load.image('ui-frame-blue','more ui/UI_Flat_Frame02a.png');
    this.load.image('ui-bar-fill',  'more ui/UI_Flat_BarFill01a.png');
    this.load.image('ui-bar-track', 'more ui/UI_Flat_Bar01a.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x1a0a2e);
    this.scene.start('Preloader');
  }
}
