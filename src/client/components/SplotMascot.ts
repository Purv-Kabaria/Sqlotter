import * as Phaser from 'phaser';
import { paintOverlayShine, paintGradientShine } from './overlayShine';
import { getShopItem } from '../../shared/shop';
import type { ShopColor } from '../../shared/shop';

export type SplotExpression = 'happy' | 'excited' | 'sad' | 'shocked' | 'doubt' | 'pain' | 'kiss' | 'squiggle';

type ExpressionConfig = {
  eye:     string;
  eyebrow: string;
  mouth:   string;
  blush?:  boolean;
  cry?:    boolean;
};

// Default blob tint when no blobColor is passed — matches the slime tint on the splash/loading screen.
const DEFAULT_BLOB_COLOR = 0x6DD400;

const EXPRESSIONS: Record<SplotExpression, ExpressionConfig> = {
  happy:   { eye: 'char-eye-normal', eyebrow: 'char-brow-normal',   mouth: 'char-mouth-smile' },
  excited: { eye: 'char-eye-cute',   eyebrow: 'char-brow-surprise', mouth: 'char-mouth-kiss', blush: true },
  sad:     { eye: 'char-eye-pain',   eyebrow: 'char-brow-sad',      mouth: 'char-mouth-frown', cry: true },
  shocked: { eye: 'char-eye-shock',  eyebrow: 'char-brow-surprise', mouth: 'char-mouth-ooo' },
  doubt:   { eye: 'char-eye-doubt',  eyebrow: 'char-brow-normal',   mouth: 'char-mouth-squiggle' },
  pain:    { eye: 'char-eye-pain',   eyebrow: 'char-brow-angry',    mouth: 'char-mouth-frown' },
  kiss:    { eye: 'char-eye-cute',   eyebrow: 'char-brow-normal',   mouth: 'char-mouth-kiss', blush: true },
  squiggle:{ eye: 'char-eye-open',   eyebrow: 'char-brow-normal',   mouth: 'char-mouth-squiggle' },
};

export class SplotMascot {
  readonly container: Phaser.GameObjects.Container;
  private blob:    Phaser.GameObjects.Image;
  private outline: Phaser.GameObjects.Image;
  private applied: Phaser.GameObjects.Image;
  private shadow:  Phaser.GameObjects.Image;
  private eye:     Phaser.GameObjects.Image;
  private eyebrow: Phaser.GameObjects.Image;
  private mouth:   Phaser.GameObjects.Image;
  private blush:   Phaser.GameObjects.Image;
  private cry:     Phaser.GameObjects.Image;
  private accessory: Phaser.GameObjects.Image;

  private bobTween: Phaser.Tweens.Tween | null = null;
  private blinkTimer: Phaser.Time.TimerEvent | null = null;
  private squishTween: Phaser.Tweens.Tween | null = null;
  private revertTimer: Phaser.Time.TimerEvent | null = null;
  private scene: Phaser.Scene;
  private size: number;

  private useCssShadow: boolean;

  // Scenes rebuild their UI (destroying the mascot's container and images) while
  // scene-level timers scheduled by this mascot are still pending — e.g. the
  // expression revert in setExpression(), or blink's un-hide delayedCall. Firing
  // those against destroyed images calls setTexture()/setVisible() on objects
  // whose scene is already null and crashes. Every mutating method is gated on
  // this flag, which flips as soon as the container is destroyed.
  private destroyed = false;

  // The tint this mascot was constructed with — the fallback whenever no
  // shop color item is equipped (or the equipped one is somehow missing).
  private defaultBlobColorNum: number;

  private sparkleImgs: Phaser.GameObjects.Image[] = [];
  private sparkleActive = false;

  constructor(
    scene: Phaser.Scene, x: number, y: number, size: number,
    equipped: Record<string, string> = {},
    blobColor?: number,
    useCssShadow = false,
  ) {
    this.scene = scene;
    this.useCssShadow = useCssShadow;
    this.size = size;
    this.defaultBlobColorNum = blobColor ?? DEFAULT_BLOB_COLOR;

    const s = size;
    const mk = (key: string, depth: number, vis = true) =>
      scene.add.image(0, 0, key).setDisplaySize(s, s).setDepth(depth).setVisible(vis);

    if (useCssShadow) {
      // Soft procedural "CSS-style" contact shadow (see Boot.ts genSplotShadowTexture) —
      // a flat blurred ellipse under the character instead of the shadow-shaped sprite,
      // which reads as a hard black blob against flat panel backgrounds.
      this.shadow = scene.add.image(0, s * 0.40, 'splot-shadow')
        .setDisplaySize(s * 0.85, s * 0.30).setDepth(0);
    } else {
      this.shadow = mk('char-shadow', 5);
    }
    // Body is baked (tint + genuine overlay-blended shine) into a texture rather than
    // tinted live — see overlayShine.ts for why a plain Phaser tint + BlendModes.OVERLAY
    // can't do this under WebGL. Keyed by color (or gradient stops) and shared across
    // instances — scenes rebuild their mascot on every resize/data refresh, and
    // re-baking a 512×512 texture per rebuild leaked textures and janked the rebuild.
    this.blob      = mk(this.bakeBlobTexture(undefined), 10);
    this.mouth     = mk('char-mouth-smile',  20);
    this.blush     = mk('char-blush',        22, false);
    this.cry       = mk('char-cry',          22, false);
    this.eye       = mk('char-eye-normal',   30);
    this.eyebrow   = mk('char-brow-normal',  40);
    this.accessory = mk('char-acc-horns',    50, false);
    this.applied   = mk('char-applied',      58, false).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
    this.outline   = mk('char-outline',      65);

    this.container = scene.add.container(x, y, [
      this.shadow, this.blob, this.mouth, this.blush, this.cry,
      this.eye, this.eyebrow, this.accessory, this.applied, this.outline,
    ]);

    this.container.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.destroyed = true;
      this.stopIdleAnims();
      this.stopSparkle();
      this.revertTimer?.remove();
      this.revertTimer = null;
    });

    this.applyEquipped(equipped);
    this.startIdleAnims();
  }

  // setTexture() on a key the Preloader never loaded renders Phaser's green
  // "missing" square — guard every equip-driven swap so a stale/bad item id
  // stored server-side can never break the mascot's face.
  private setPartTexture(img: Phaser.GameObjects.Image, key: string, fallback: string) {
    img.setTexture(this.scene.textures.exists(key) ? key : fallback);
  }

  // Resolves — baking and caching if needed — the blob texture for a color
  // slot value. `color` undefined (no color item equipped, or an unknown
  // item id) falls back to the tint this mascot was constructed with.
  private bakeBlobTexture(color: ShopColor | undefined): string {
    if (color?.stops && color.stops.length >= 2) {
      const key = `char-shine-tex-grad-${color.stops.map(s => s.replace('#', '')).join('-')}`;
      if (!this.scene.textures.exists(key)) {
        paintGradientShine(this.scene, key, 'char-blob', 'char-shine', color.stops, 0.5);
      }
      return key;
    }
    const hexNum = color?.hex ? parseInt(color.hex.replace('#', ''), 16) : this.defaultBlobColorNum;
    const key = `char-shine-tex-${hexNum.toString(16).padStart(6, '0')}`;
    if (!this.scene.textures.exists(key)) {
      paintOverlayShine(this.scene, key, 'char-blob', 'char-shine', hexNum, 0.5);
    }
    return key;
  }

  private applyEquipped(items: Record<string, string>) {
    if (items.eye)   this.setPartTexture(this.eye, `char-${items.eye}`, 'char-eye-normal');
    this.setPartTexture(this.eyebrow, items.eyebrow ? `char-${items.eyebrow}` : 'char-brow-normal', 'char-brow-normal');
    if (items.mouth) this.setPartTexture(this.mouth, `char-${items.mouth}`, 'char-mouth-smile');
    if (items.accessory) {
      // item IDs are already prefixed: 'acc-crown' → 'char-acc-crown'
      const key = `char-${items.accessory}`;
      if (this.scene.textures.exists(key)) {
        this.accessory.setTexture(key).setVisible(true);
      }
    }

    const colorItem = items.color ? getShopItem(items.color) : undefined;
    this.blob.setTexture(this.bakeBlobTexture(colorItem?.color));
    this.setSparkle(colorItem?.color?.sparkle === true);
  }

  refresh(equipped: Record<string, string>) {
    if (this.destroyed) return;
    this.accessory.setVisible(false);
    this.applyEquipped(equipped);
  }

  setExpression(expr: SplotExpression, revertAfterMs?: number) {
    if (this.destroyed) return;
    const cfg = EXPRESSIONS[expr];
    this.eye.setTexture(cfg.eye);
    this.eyebrow.setTexture(cfg.eyebrow);
    this.mouth.setTexture(cfg.mouth);
    this.animateFacePart(this.blush, cfg.blush === true);
    this.animateFacePart(this.cry, cfg.cry === true);

    // One pending revert at a time — a newer expression supersedes the old
    // revert rather than fighting it. remove(), not destroy() — destroy() only
    // nulls the callback and leaves the dead event in the scene clock forever.
    this.revertTimer?.remove();
    this.revertTimer = null;
    if (revertAfterMs) {
      this.revertTimer = this.scene.time.delayedCall(revertAfterMs, () => {
        this.revertTimer = null;
        this.setExpression('happy');
      });
    }
  }

  // Fades blush/cry in or out instead of an abrupt visibility cut.
  private animateFacePart(layer: Phaser.GameObjects.Image, show: boolean) {
    this.scene.tweens.killTweensOf(layer);
    if (show) {
      layer.setVisible(true).setAlpha(0);
      this.scene.tweens.add({ targets: layer, alpha: 1, duration: 180, ease: 'Quad.easeOut' });
    } else if (layer.visible) {
      this.scene.tweens.add({
        targets: layer, alpha: 0, duration: 140, ease: 'Quad.easeIn',
        onComplete: () => layer.setVisible(false).setAlpha(1),
      });
    }
  }

  private startIdleAnims() {
    // Slow float
    this.bobTween = this.scene.tweens.add({
      targets: this.container,
      y: this.container.y - 6,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Eye blink — skipped for expressions where eyes are already shut or styled
    this.blinkTimer = this.scene.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        if (this.destroyed) return;
        const key = this.eye.texture.key;
        if (key === 'char-eye-pain' || key === 'char-eye-happy') return;
        this.eye.setVisible(false);
        this.scene.time.delayedCall(130, () => {
          if (!this.destroyed) this.eye.setVisible(true);
        });
      },
    });
  }

  stopIdleAnims() {
    this.bobTween?.destroy();
    this.bobTween = null;
    // remove(), not destroy() — destroy() leaves the (looping) event in the
    // scene clock, so one dead timer accumulated on every UI rebuild.
    this.blinkTimer?.remove();
    this.blinkTimer = null;
  }

  playSquishAnim() {
    if (this.destroyed) return;
    this.squishTween?.destroy();
    this.squishTween = this.scene.tweens.add({
      targets: this.container,
      scaleX: 1.15,
      scaleY: 0.88,
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => { this.container.setScale(1); },
    });
  }

  playPressAnim() {
    if (this.destroyed) return;
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 0.95,
      scaleY: 0.95,
      duration: 60,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => { this.container.setScale(1); },
    });
  }

  playWin() {
    if (this.destroyed) return;
    this.setExpression('excited');
    this.playAppliedFlash();
    this.scene.tweens.add({
      targets: this.container,
      scaleX: 1.25, scaleY: 1.25,
      duration: 200,
      yoyo: true,
      ease: 'Back.easeOut',
      onComplete: () => this.setExpression('kiss', 2000),
    });
  }

  playConflict() {
    if (this.destroyed) return;
    this.setExpression('shocked', 1500);
    const ox = this.container.x;
    this.scene.tweens.add({
      targets: this.container,
      x: { from: ox - 8, to: ox + 8 },
      duration: 50,
      yoyo: true,
      repeat: 3,
      onComplete: () => { this.container.x = ox; },
    });
  }

  playAppliedFlash() {
    if (this.destroyed) return;
    // Reset via display size, not setScale(1) — scale 1 is the texture's native
    // resolution (512px), which blew the flash overlay up far past the mascot.
    this.scene.tweens.killTweensOf(this.applied);
    this.applied.setVisible(true).setAlpha(0.7).setDisplaySize(this.size, this.size);
    const base = this.applied.scaleX;
    this.scene.tweens.add({
      targets: this.applied,
      alpha: 0,
      scaleX: base * 1.16,
      scaleY: base * 1.16,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => this.applied.setVisible(false).setDisplaySize(this.size, this.size),
    });
  }

  setSize(s: number) {
    this.size = s;
    [this.blob, this.mouth, this.blush, this.cry,
     this.eye, this.eyebrow, this.accessory, this.applied, this.outline]
      .forEach(img => img.setDisplaySize(s, s));
    if (this.useCssShadow) {
      this.shadow.setDisplaySize(s * 0.85, s * 0.30).setY(s * 0.40);
    } else {
      this.shadow.setDisplaySize(s, s);
    }
    // Sparkle positions/sizes are computed once from `size` at spawn time —
    // restart them so a rare color's shimmer stays anchored after a resize.
    if (this.sparkleActive) {
      this.stopSparkle();
      this.startSparkle();
    }
  }

  // Toggles the shimmering particle flourish rare color variants (Silver
  // Sparkle, Opal Shimmer, Golden) add on top of their tint.
  private setSparkle(on: boolean) {
    if (on === this.sparkleActive) return;
    this.sparkleActive = on;
    if (on) this.startSparkle(); else this.stopSparkle();
  }

  private startSparkle() {
    if (this.destroyed || !this.scene.textures.exists('icon-sparkle')) return;
    const count = 4;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const radius = this.size * (0.32 + Math.random() * 0.14);
      const sx = Math.cos(angle) * radius;
      const sy = Math.sin(angle) * radius * 0.7; // flatten to the blob's rounder silhouette
      const spark = this.scene.add.image(sx, sy, 'icon-sparkle')
        .setDisplaySize(this.size * 0.09, this.size * 0.09)
        .setDepth(62).setAlpha(0).setBlendMode(Phaser.BlendModes.ADD);
      this.container.add(spark);
      this.sparkleImgs.push(spark);
      this.scene.tweens.add({
        targets: spark,
        alpha: { from: 0, to: 0.9 }, scaleX: { from: 0.4, to: 1 }, scaleY: { from: 0.4, to: 1 },
        duration: 550, yoyo: true, repeat: -1, delay: i * 260 + Math.random() * 300, ease: 'Sine.easeInOut',
      });
    }
  }

  private stopSparkle() {
    this.sparkleImgs.forEach(s => { this.scene.tweens.killTweensOf(s); s.destroy(); });
    this.sparkleImgs = [];
  }
}
