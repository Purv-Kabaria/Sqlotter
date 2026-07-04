import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() { super('Boot'); }

  preload() {
    // Absolute minimum for Preloader's loading screen — every file here delays
    // the FIRST thing the player sees, so the UI slices and everything else
    // stream in behind the progress bar (Preloader) instead.
    this.load.setPath('assets');
    this.load.image('title',         'title.png');
    this.load.image('bg4-1',         'background/background 4/1.png');
    // Loading bar assets
    this.load.image('loading-border', 'ui/loading-border.png');
    this.load.image('loading-filler', 'ui/loading-filler.png');
    // Slime assets for animated loading mascot
    this.load.image('slime-color',  'slime/color.png');
    this.load.image('slime-border', 'slime/border.png');
    this.load.image('slime-shine',  'slime/overlay-normal.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x232323);
    this.genDarkPanelTexture();
    this.genSplotShadowTexture();
    this.scene.start('Preloader');
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

  // Soft blurred contact-shadow ellipse for Splot — replaces the character/shadow.png
  // sprite with a procedurally generated "CSS drop-shadow" look (concentric fading
  // ellipses fake the gaussian blur Graphics can't draw directly).
  private genSplotShadowTexture() {
    if (this.textures.exists('splot-shadow')) return;
    const w = 256, h = 96;
    const cx = w / 2, cy = h / 2;
    const g = this.add.graphics();
    const steps = 8;
    for (let i = steps; i >= 1; i--) {
      const t = i / steps;
      g.fillStyle(0x000000, 0.05);
      g.fillEllipse(cx, cy, w * t, h * t);
    }
    g.generateTexture('splot-shadow', w, h);
    g.destroy();
  }
}
