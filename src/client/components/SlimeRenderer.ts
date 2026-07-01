import * as Phaser from 'phaser';
import type { SlimeState } from '../../shared/types';
import { paintOverlayShine } from './overlayShine';

let nextInstanceId = 0;

export class SlimeRenderer {
  readonly container: Phaser.GameObjects.Container;
  private topImg: Phaser.GameObjects.Image;
  private bottomImg: Phaser.GameObjects.Image;
  private pumpkinImg: Phaser.GameObjects.Image;
  private underwearImg: Phaser.GameObjects.Image;
  private beltImg: Phaser.GameObjects.Image;
  private pendantImg: Phaser.GameObjects.Image;
  private eyeImg: Phaser.GameObjects.Image;
  private borderImg: Phaser.GameObjects.Image;
  private appliedFlash: Phaser.GameObjects.Image;

  private scene: Phaser.Scene;
  private size: number;
  private texW = 256;
  private texH = 256;
  private currentState: SlimeState | null = null;

  // Unique per-instance texture keys — the top/bottom color zones are genuine
  // overlay-blended (color + slime-shine) textures baked at runtime, see setState().
  private readonly topShineKey: string;
  private readonly bottomShineKey: string;

  constructor(scene: Phaser.Scene, x: number, y: number, size: number) {
    this.scene = scene;
    this.size = size;
    this.container = scene.add.container(x, y);

    const id = nextInstanceId++;
    this.topShineKey = `slime-shine-tex-${id}-top`;
    this.bottomShineKey = `slime-shine-tex-${id}-bottom`;

    // Cache texture dimensions (standalone PNG so frame = full texture)
    const src = scene.textures.get('slime-color')?.source[0];
    if (src) { this.texW = src.width; this.texH = src.height; }

    // Layer -1: two-colour bottom zone (hidden when single-colour)
    this.bottomImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(-1).setVisible(false);

    // Layer 0: top colour (or full single colour)
    this.topImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(0);

    // Modifier overlay layers
    this.pumpkinImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(1).setVisible(false);
    this.underwearImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(2).setVisible(false);
    this.beltImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(3).setVisible(false);
    this.pendantImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(4).setVisible(false);
    this.eyeImg = scene.add.image(0, 0, 'slime-color')
      .setDisplaySize(size, size).setDepth(5).setVisible(false);

    this.borderImg = scene.add.image(0, 0, 'slime-border')
      .setDisplaySize(size, size).setDepth(7);
    this.appliedFlash = scene.add.image(0, 0, 'slime-applied')
      .setDisplaySize(size, size).setDepth(8).setAlpha(0).setVisible(false)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.container.add([
      this.bottomImg, this.topImg, this.pumpkinImg, this.underwearImg,
      this.beltImg, this.pendantImg, this.eyeImg, this.borderImg, this.appliedFlash,
    ]);
  }

  setState(state: SlimeState) {
    this.currentState = { ...state };

    // Top/bottom color zones are baked (tint + genuine overlay-blended shine) into a
    // texture rather than tinted live — see overlayShine.ts for why a plain
    // Phaser tint + BlendModes.OVERLAY can't do this under WebGL.
    const topColor = Phaser.Display.Color.HexStringToColor(state.color).color;
    paintOverlayShine(this.scene, this.topShineKey, 'slime-color', 'slime-shine', topColor, 0.5);
    this.topImg.setTexture(this.topShineKey);

    if (state.colorBottom !== undefined && state.pumpkin !== null) {
      // Two-colour rendering: split into top zone (exposed) and bottom zone (pumpkin-protected)
      const fraction = state.pumpkin / 100;
      const topFraction = 1 - fraction;

      // Bottom zone image: bottomColor, bottom fraction only
      const bottomColor = Phaser.Display.Color.HexStringToColor(state.colorBottom).color;
      paintOverlayShine(this.scene, this.bottomShineKey, 'slime-color', 'slime-shine', bottomColor, 0.5);
      this.bottomImg
        .setTexture(this.bottomShineKey)
        .setDisplaySize(this.size, this.size)
        .setOrigin(0.5, 0)
        .setPosition(0, this.size * (topFraction - 0.5))
        .setCrop(0, Math.floor(this.texH * topFraction), this.texW, Math.ceil(this.texH * fraction))
        .setVisible(true);

      // Top zone image: topColor, top fraction only
      this.topImg
        .setDisplaySize(this.size, this.size)
        .setOrigin(0.5, 0)
        .setPosition(0, -this.size / 2)
        .setCrop(0, 0, this.texW, Math.ceil(this.texH * topFraction));

    } else {
      // Single colour: full slime
      this.bottomImg.setVisible(false);
      this.topImg
        .setDisplaySize(this.size, this.size)
        .setOrigin(0.5, 0.5)
        .setPosition(0, 0)
        .setCrop(0, 0, this.texW, this.texH);
    }

    // Pumpkin overlay (decoration on top of colour zones)
    this.setLayer(this.pumpkinImg, state.pumpkin !== null ? `mod-pumpkin-${state.pumpkin}` : null);

    // Other modifier overlays
    this.setLayer(this.underwearImg, state.underwear ? 'mod-underwear' : null);
    this.setLayer(this.beltImg, state.belt ? `mod-belt-${state.belt}` : null);
    this.setLayer(this.pendantImg, state.pendant ? `mod-pendant-${state.pendant}` : null);

    const eyeKey = state.goggles
      ? `mod-goggles-${state.goggles}`
      : state.glasses
        ? `mod-glasses-${state.glasses}`
        : null;
    this.setLayer(this.eyeImg, eyeKey);
  }

  private setLayer(img: Phaser.GameObjects.Image, textureKey: string | null) {
    if (textureKey) {
      img.setTexture(textureKey).setDisplaySize(this.size, this.size)
        .setOrigin(0.5, 0.5).setPosition(0, 0).setVisible(true);
    } else {
      img.setVisible(false);
    }
  }

  // Squish-and-bounce when a modifier is applied
  playApplyAnim(scene: Phaser.Scene) {
    this.appliedFlash.setVisible(true).setAlpha(0.72).setScale(1);
    scene.tweens.add({
      targets: this.appliedFlash,
      alpha: 0, scaleX: 1.18, scaleY: 1.18,
      duration: 280, ease: 'Quad.easeOut',
      onComplete: () => this.appliedFlash.setVisible(false).setScale(1),
    });
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
      duration: 45, yoyo: true, repeat: 3, ease: 'Sine.easeInOut',
      onComplete: () => { this.container.x = ox; },
    });
  }

  // Win scale burst
  playWinAnim(scene: Phaser.Scene, onComplete?: () => void) {
    const tween = scene.tweens.add({
      targets: this.container,
      scale: 1.3, duration: 200, ease: 'Back.easeOut', yoyo: true,
    });
    if (onComplete) tween.on('complete', onComplete);
  }

  setSize(size: number) {
    this.size = size;
    if (this.currentState) {
      this.setState(this.currentState);
    }
    this.borderImg.setDisplaySize(size, size);
    this.appliedFlash.setDisplaySize(size, size);
  }
}
