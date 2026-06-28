import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() { super('Boot'); }

  preload() {
    // Load just enough to show a rich loading screen in Preloader
    this.load.setPath('assets');
    this.load.image('title',         'title.png');
    this.load.image('bg4-1',         'background/background 4/1.png');
    this.load.image('ui-banner',     'more ui/UI_Flat_Banner02a.png');
    this.load.image('ui-frame-blue', 'more ui/UI_Flat_Frame02a.png');
    this.load.image('ui-bar-fill',   'more ui/UI_Flat_BarFill01a.png');
    this.load.image('ui-bar-track',  'more ui/UI_Flat_Bar01a.png');
    // Slime assets for animated loading mascot
    this.load.image('slime-color',  'slime/color.png');
    this.load.image('slime-border', 'slime/border.png');
    this.load.image('slime-shine',  'slime/overlay-normal.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x0A0500);
    this.genBeigeCardTexture();
    this.genDarkPanelTexture();
    this.scene.start('Preloader');
  }

  // Warm-beige rounded card with dark-brown border (modifier slots, slime panels)
  private genBeigeCardTexture() {
    if (this.textures.exists('ui-beige-card')) return;
    const g = this.add.graphics();
    g.fillStyle(0x3D1808); // dark border
    g.fillRoundedRect(0, 0, 64, 64, 14);
    g.fillStyle(0xDEC998); // warm beige fill
    g.fillRoundedRect(4, 4, 56, 56, 11);
    g.generateTexture('ui-beige-card', 64, 64);
    g.destroy();
  }

  // Near-black panel (modifier palette background, right-side panels)
  private genDarkPanelTexture() {
    if (this.textures.exists('ui-dark-panel')) return;
    const g = this.add.graphics();
    g.fillStyle(0x0E0700);
    g.fillRoundedRect(0, 0, 64, 64, 8);
    g.fillStyle(0x180C02);
    g.fillRoundedRect(2, 2, 60, 60, 7);
    g.generateTexture('ui-dark-panel', 64, 64);
    g.destroy();
  }
}
