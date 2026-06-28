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
  private shadow:  Phaser.GameObjects.Image;
  private eye:     Phaser.GameObjects.Image;
  private eyebrow: Phaser.GameObjects.Image;
  private mouth:   Phaser.GameObjects.Image;
  private blush:   Phaser.GameObjects.Image;
  private cry:     Phaser.GameObjects.Image;
  private accessory: Phaser.GameObjects.Image;

  private bobTween: Phaser.Tweens.Tween | null = null;
  private blinkTimer: Phaser.Time.TimerEvent | null = null;
  private currentExpr: SplotExpression = 'happy';
  private equippedItems: Record<string, string> = {};
  private size: number;
  private scene: Phaser.Scene;

  constructor(
    scene: Phaser.Scene, x: number, y: number, size: number,
    equipped: Record<string, string> = {},
  ) {
    this.scene = scene;
    this.size = size;
    this.equippedItems = equipped;

    const s = size;
    const mk = (key: string, depth: number, vis = true) =>
      scene.add.image(0, 0, key).setDisplaySize(s, s).setDepth(depth).setVisible(vis);

    this.shadow    = mk('char-shadow',        0);
    this.blob      = mk('char-blob',         10);
    this.mouth     = mk('char-mouth-happy',  20);
    this.blush     = mk('char-blush',        22, false);
    this.cry       = mk('char-cry',          22, false);
    this.eye       = mk('char-eye-normal',   30);
    this.eyebrow   = mk('char-brow-normal',  40);
    this.accessory = mk('char-acc-horns',    50, false);
    this.shine     = mk('char-shine',        60);
    this.outline   = mk('char-outline',      65);

    this.container = scene.add.container(x, y, [
      this.shadow, this.blob, this.mouth, this.blush, this.cry,
      this.eye, this.eyebrow, this.accessory, this.shine, this.outline,
    ]);

    this.applyEquipped(equipped);
    this.startIdleAnims();
  }

  private applyEquipped(items: Record<string, string>) {
    if (items.eye)       this.eye.setTexture(`char-${items.eye}`);
    if (items.eyebrow)   this.eyebrow.setTexture(`char-${items.eyebrow}`);
    if (items.mouth)     this.mouth.setTexture(`char-${items.mouth}`);
    if (items.accessory) {
      this.accessory.setTexture(`char-acc-${items.accessory}`).setVisible(true);
    }
  }

  setExpression(expr: SplotExpression, revertAfterMs?: number) {
    const cfg = EXPRESSIONS[expr];
    this.eye.setTexture(cfg.eye);
    this.eyebrow.setTexture(cfg.eyebrow);
    this.mouth.setTexture(cfg.mouth);
    this.blush.setVisible(cfg.blush === true);
    this.cry.setVisible(cfg.cry === true);
    this.currentExpr = expr;

    if (revertAfterMs) {
      this.scene.time.delayedCall(revertAfterMs, () => {
        this.setExpression('happy');
      });
    }
  }

  private startIdleAnims() {
    // Gentle bob
    this.bobTween = this.scene.tweens.add({
      targets: this.container,
      y: this.container.y - 7,
      duration: 1300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Eye blink
    this.blinkTimer = this.scene.time.addEvent({
      delay: 3200,
      loop: true,
      callback: () => {
        const orig = this.eye.texture.key;
        this.eye.setVisible(false);
        this.scene.time.delayedCall(130, () => this.eye.setVisible(true).setTexture(orig));
      },
    });
  }

  stopIdleAnims() {
    this.bobTween?.destroy();
    this.blinkTimer?.destroy();
  }

  playWin() {
    this.setExpression('excited');
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

  setSize(s: number) {
    this.size = s;
    [this.shadow, this.blob, this.mouth, this.blush, this.cry,
     this.eye, this.eyebrow, this.accessory, this.shine, this.outline]
      .forEach(img => img.setDisplaySize(s, s));
  }
}
