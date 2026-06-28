import * as Phaser from 'phaser';
import type { SlimeState } from '../../shared/types';

type Layer = {
  key: string;
  img: Phaser.GameObjects.Image;
};

const LAYERS: { key: string; stateKey: keyof SlimeState | null; depth: number }[] = [
  { key: 'slime-color',    stateKey: null,         depth: 0 },
  { key: 'mod-pumpkin',    stateKey: 'pumpkin',    depth: 1 },
  { key: 'mod-underwear',  stateKey: 'underwear',  depth: 2 },
  { key: 'mod-belt',       stateKey: 'belt',       depth: 3 },
  { key: 'mod-pendant',    stateKey: 'pendant',    depth: 4 },
  { key: 'mod-eye',        stateKey: 'goggles',    depth: 5 }, // also glasses
  { key: 'slime-shine',    stateKey: null,         depth: 6 },
  { key: 'slime-border',   stateKey: null,         depth: 7 },
];

export class SlimeRenderer {
  readonly container: Phaser.GameObjects.Container;
  private layers: Map<string, Phaser.GameObjects.Image> = new Map();
  private size: number;

  constructor(scene: Phaser.Scene, x: number, y: number, size: number) {
    this.size = size;
    this.container = scene.add.container(x, y);

    for (const def of LAYERS) {
      // use a placeholder key — we'll update texture in setState
      const img = scene.add.image(0, 0, 'slime-color')
        .setDisplaySize(size, size)
        .setDepth(def.depth)
        .setVisible(def.stateKey === null); // always-on layers visible by default
      this.layers.set(def.key, img);
      this.container.add(img);
    }

    // Set correct textures for always-on layers
    this.layers.get('slime-color')!.setTexture('slime-color');
    this.layers.get('slime-shine')!.setTexture('slime-shine');
    this.layers.get('slime-border')!.setTexture('slime-border');
  }

  setState(state: SlimeState) {
    // Base colour tint
    const color = Phaser.Display.Color.HexStringToColor(state.color);
    this.layers.get('slime-color')!.setTint(color.color);

    // Pumpkin layer
    this.setConditionalLayer('mod-pumpkin',
      state.pumpkin !== null ? `mod-pumpkin-${state.pumpkin}` : null);

    // Underwear layer
    this.setConditionalLayer('mod-underwear',
      state.underwear ? 'mod-underwear' : null);

    // Belt layer
    this.setConditionalLayer('mod-belt',
      state.belt ? `mod-belt-${state.belt}` : null);

    // Pendant layer
    this.setConditionalLayer('mod-pendant',
      state.pendant ? `mod-pendant-${state.pendant}` : null);

    // Eye slot (goggles OR glasses)
    const eyeKey = state.goggles
      ? `mod-goggles-${state.goggles}`
      : state.glasses
        ? `mod-glasses-${state.glasses}`
        : null;
    this.setConditionalLayer('mod-eye', eyeKey);
  }

  private setConditionalLayer(layerKey: string, textureKey: string | null) {
    const img = this.layers.get(layerKey);
    if (!img) return;
    if (textureKey) {
      img.setTexture(textureKey).setDisplaySize(this.size, this.size).setVisible(true);
    } else {
      img.setVisible(false);
    }
  }

  // Squish-and-bounce animation when a modifier is applied
  playApplyAnim(scene: Phaser.Scene) {
    scene.tweens.chain({
      targets: this.container,
      tweens: [
        { scaleX: 1.15, scaleY: 0.88, duration: 80, ease: 'Quad.easeOut' },
        { scaleX: 0.92, scaleY: 1.12, duration: 80, ease: 'Quad.easeOut' },
        { scaleX: 1.0,  scaleY: 1.0,  duration: 120, ease: 'Elastic.easeOut' },
      ],
    });
  }

  // Horizontal shake on conflict
  playShakeAnim(scene: Phaser.Scene) {
    const ox = this.container.x;
    scene.tweens.add({
      targets: this.container,
      x: { from: ox - 10, to: ox + 10 },
      duration: 45,
      yoyo: true,
      repeat: 3,
      ease: 'Sine.easeInOut',
      onComplete: () => { this.container.x = ox; },
    });
  }

  // Win scale burst
  playWinAnim(scene: Phaser.Scene, onComplete?: () => void) {
    scene.tweens.add({
      targets: this.container,
      scale: 1.3,
      duration: 200,
      ease: 'Back.easeOut',
      yoyo: true,
      onComplete,
    });
  }

  setSize(size: number) {
    this.size = size;
    this.layers.forEach(img => img.setDisplaySize(size, size));
  }
}
