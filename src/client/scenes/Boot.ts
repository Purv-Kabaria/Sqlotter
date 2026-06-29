import { Scene } from 'phaser';

export class Boot extends Scene {
  constructor() { super('Boot'); }

  preload() {
    // Load just enough to show a rich loading screen in Preloader
    this.load.setPath('assets');
    this.load.image('title',         'title.png');
    this.load.image('bg4-1',         'background/background 4/1.png');
    this.load.image('ui-flat-slot', 'more ui/UI_Flat_FrameSlot01c.png');
    // Loading bar assets
    this.load.image('loading-border', 'ui/loading-border.png');
    this.load.image('loading-filler', 'ui/loading-filler.png');
    // Slime assets for animated loading mascot
    this.load.image('slime-color',  'slime/color.png');
    this.load.image('slime-border', 'slime/border.png');
    this.load.image('slime-shine',  'slime/overlay-normal.png');
    // Pre-sliced panel cells (panel.png 96×96, corner=8px)
    const pnlPos = ['tl','tc','tr','ml','mc','mr','bl','bc','br'] as const;
    for (const pos of pnlPos) this.load.image(`pnl-${pos}`, `ui/slices/pnl-${pos}.png`);
    // Pre-sliced button cells (button 128×96, corner=12px)
    const btnStates = ['open','hover','press'] as const;
    const btnPos = ['tl','tc','tr','ml','mc','mr','bl','bc','br'] as const;
    for (const st of btnStates)
      for (const pos of btnPos) this.load.image(`btn-${st}-${pos}`, `ui/slices/btn-${st}-${pos}.png`);
    this.load.image('btn-dis-tl', 'ui/slices/btn-dis-tl.png');
    this.load.image('btn-dis-tc', 'ui/slices/btn-dis-tc.png');
    this.load.image('btn-dis-tr', 'ui/slices/btn-dis-tr.png');
    this.load.image('btn-dis-ml', 'ui/slices/btn-dis-ml.png');
    this.load.image('btn-dis-mc', 'ui/slices/btn-dis-mc.png');
    this.load.image('btn-dis-mr', 'ui/slices/btn-dis-mr.png');
    this.load.image('btn-dis-bl', 'ui/slices/btn-dis-bl.png');
    this.load.image('btn-dis-bc', 'ui/slices/btn-dis-bc.png');
    this.load.image('btn-dis-br', 'ui/slices/btn-dis-br.png');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x232323);
    this.genDarkPanelTexture();
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
}
