import * as Phaser from 'phaser';

export type SplotExpression = 'happy' | 'excited' | 'sad' | 'shocked' | 'doubt' | 'pain' | 'kiss' | 'squiggle';

type ExpressionConfig = {
  eye:     string;
  eyebrow: string;
  mouth:   string;
  blush?:  boolean;
  cry?:    boolean;
};

const EXPRESSIONS: Record<SplotExpression, ExpressionConfig> = {
  happy:   { eye: 'char-eye-happy',  eyebrow: 'char-brow-normal',   mouth: 'char-mouth-happy' },
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
  private shine:   Phaser.GameObjects.Image;
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
  private scene: Phaser.Scene;

  constructor(
    scene: Phaser.Scene, x: number, y: number, size: number,
    equipped: Record<string, string> = {},
    blobColor?: number,
  ) {
    this.scene = scene;

    const s = size;
    const mk = (key: string, depth: number, vis = true) =>
      scene.add.image(0, 0, key).setDisplaySize(s, s).setDepth(depth).setVisible(vis);

    this.shadow    = mk('char-shadow',        0).setAlpha(0.6);
    this.blob      = mk('char-blob',         10);
    if (blobColor !== undefined) {
      this.blob.setTint(blobColor);
      this.blob.setTintFill();
    }
    this.mouth     = mk('char-mouth-happy',  20);
    this.blush     = mk('char-blush',        22, false);
    this.cry       = mk('char-cry',          22, false);
    this.eye       = mk('char-eye-normal',   30);
    this.eyebrow   = mk('char-brow-normal',  40);
    this.accessory = mk('char-acc-horns',    50, false);
    this.applied   = mk('char-applied',      58, false).setAlpha(0);
    this.shine     = mk('char-shine',        60).setAlpha(0.82);
    this.outline   = mk('char-outline',      65);

    this.container = scene.add.container(x, y, [
      this.shadow, this.blob, this.mouth, this.blush, this.cry,
      this.eye, this.eyebrow, this.accessory, this.applied, this.shine, this.outline,
    ]);

    this.applyEquipped(equipped);
    this.startIdleAnims();
  }

  private applyEquipped(items: Record<string, string>) {
    if (items.eye)       this.eye.setTexture(`char-${items.eye}`);
    if (items.eyebrow)   this.eyebrow.setTexture(`char-${items.eyebrow}`);
    if (items.mouth)     this.mouth.setTexture(`char-${items.mouth}`);
    if (items.accessory) {
      // item IDs are already prefixed: 'acc-crown' → 'char-acc-crown'
      this.accessory.setTexture(`char-${items.accessory}`).setVisible(true);
    }
  }

  refresh(equipped: Record<string, string>) {
    this.accessory.setVisible(false);
    this.applyEquipped(equipped);
  }

  setExpression(expr: SplotExpression, revertAfterMs?: number) {
    const cfg = EXPRESSIONS[expr];
    this.eye.setTexture(cfg.eye);
    this.eyebrow.setTexture(cfg.eyebrow);
    this.mouth.setTexture(cfg.mouth);
    this.blush.setVisible(cfg.blush === true);
    this.cry.setVisible(cfg.cry === true);

    if (revertAfterMs) {
      this.scene.time.delayedCall(revertAfterMs, () => {
        this.setExpression('happy');
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
        const key = this.eye.texture.key;
        if (key === 'char-eye-pain' || key === 'char-eye-happy') return;
        this.eye.setVisible(false);
        this.scene.time.delayedCall(130, () => this.eye.setVisible(true));
      },
    });
  }

  stopIdleAnims() {
    this.bobTween?.destroy();
    this.blinkTimer?.destroy();
  }

  playSquishAnim() {
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
    this.applied.setVisible(true).setAlpha(0.7).setScale(1);
    this.scene.tweens.add({
      targets: this.applied,
      alpha: 0,
      scaleX: 1.16,
      scaleY: 1.16,
      duration: 300,
      ease: 'Quad.easeOut',
      onComplete: () => this.applied.setVisible(false).setScale(1),
    });
  }

  setSize(s: number) {
    [this.shadow, this.blob, this.mouth, this.blush, this.cry,
     this.eye, this.eyebrow, this.accessory, this.applied, this.shine, this.outline]
      .forEach(img => img.setDisplaySize(s, s));
  }
}
