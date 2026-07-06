import * as Phaser from 'phaser';
import type { ModifierDef } from '../../shared/types';
import { CELL_OPAQUE, DIP_FACTOR, replayOps } from '../../shared/slimeSim';
import { MASK_GRID } from '../../shared/maskData';

// ── Pattern renderer for the stencil-paint gameplay ─────────────────────────
// The slime's look is a PAINT PATTERN: each paint op colors the body except
// where the then-worn stencils protected it. This renderer replays an action
// list and composites the result with the real PNGs on a canvas texture:
//
//   for each paint op:  stamp = body tinted op.color, minus worn stencils
//   pattern            = base body + stamps in order (+ shine, alpha-clamped)
//
// Currently-worn stencils are then drawn on top as regular images (above the
// outline), so the player sees what's protecting what.
// Win logic never reads pixels — src/shared/slimeSim.ts runs the same
// geometry on baked bitmaps; this class is presentation only.

// Must match THRESHOLD in scripts/generate_masks.py: translucent goggle
// lenses PROTECT in the sim, so paint erasure flattens mask alpha to the same
// binary coverage — otherwise paint would peek through lenses the sim says
// are covered.
const STENCIL_ALPHA_THRESHOLD = 100;

let nextInstanceId = 0;

// maskId → binary-alpha stencil canvas, shared by every renderer instance.
const stencilCache = new Map<string, HTMLCanvasElement>();

function getStencil(scene: Phaser.Scene, maskId: string, size: number): HTMLCanvasElement | null {
  const cached = stencilCache.get(maskId);
  if (cached) return cached;
  const key = `mod-${maskId}`;
  if (!scene.textures.exists(key)) return null;
  const src = scene.textures.get(key).getSourceImage() as CanvasImageSource;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  for (let i = 3; i < px.length; i += 4) {
    px[i] = (px[i] ?? 0) >= STENCIL_ALPHA_THRESHOLD ? 255 : 0;
  }
  ctx.putImageData(data, 0, 0);
  stencilCache.set(maskId, canvas);
  return canvas;
}

// One shared scratch canvas for building per-op stamps.
let scratch: HTMLCanvasElement | null = null;
function getScratch(size: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== size || scratch.height !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

export class SlimeRenderer {
  readonly container: Phaser.GameObjects.Container;
  private patternImg: Phaser.GameObjects.Image;
  private borderImg: Phaser.GameObjects.Image;
  private appliedFlash: Phaser.GameObjects.Image;
  private wornImgs: Phaser.GameObjects.Image[] = [];

  private scene: Phaser.Scene;
  private size: number;
  private native = 256;
  private readonly texKey: string;
  private canvasTex: Phaser.Textures.CanvasTexture;

  // Kept so setSize() can re-render at the same state.
  private lastPalette: readonly ModifierDef[] = [];
  private lastActions: readonly string[] = [];

  // Reused offscreen canvases for the opacity veil (only rebuilt when a level
  // actually dips) — the 64×64 alpha grid, and its body-clipped upscale.
  private gridCanvas: HTMLCanvasElement | null = null;
  private veilCanvas: HTMLCanvasElement | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, size: number) {
    this.scene = scene;
    this.size = size;
    this.container = scene.add.container(x, y);

    const src = scene.textures.get('slime-color')?.source[0];
    if (src) this.native = src.width;

    this.texKey = `slime-pattern-${nextInstanceId++}`;
    const created = scene.textures.createCanvas(this.texKey, this.native, this.native);
    if (!created) throw new Error('Could not create slime pattern texture');
    this.canvasTex = created;

    this.patternImg = scene.add.image(0, 0, this.texKey).setDisplaySize(size, size);
    this.borderImg = scene.add.image(0, 0, 'slime-border').setDisplaySize(size, size);
    this.appliedFlash = scene.add.image(0, 0, 'slime-applied')
      .setDisplaySize(size, size).setAlpha(0).setVisible(false)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Containers render children in list order — worn stencils are inserted
    // just before appliedFlash (above the border) in setPattern().
    this.container.add([this.patternImg, this.borderImg, this.appliedFlash]);

    // Per-instance canvas texture — release it with the container, otherwise
    // every scene rebuild leaks a 256x256 canvas into the texture manager.
    this.container.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.scene.textures.remove(this.texKey);
    });

    this.setPattern([], []);
  }

  /**
   * Renders the pattern produced by replaying `actions` against `palette`,
   * plus whatever stencils are worn at the end of the replay.
   */
  setPattern(palette: readonly ModifierDef[], actions: readonly string[]) {
    this.lastPalette = palette;
    this.lastActions = [...actions];

    const { ops, worn, alpha } = replayOps(palette, actions);
    const N = this.native;
    const body = this.scene.textures.get('slime-color').getSourceImage() as CanvasImageSource;
    const shine = this.scene.textures.exists('slime-shine')
      ? this.scene.textures.get('slime-shine').getSourceImage() as CanvasImageSource
      : null;

    const ctx = this.canvasTex.context;
    ctx.save();
    ctx.clearRect(0, 0, N, N);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(body, 0, 0, N, N);

    for (const op of ops) {
      const s = getScratch(N);
      s.save();
      s.clearRect(0, 0, N, N);
      // Tinted body silhouette: multiply matches Phaser's tint of the white
      // body art, destination-in restores the body alpha the fill flattened.
      s.globalCompositeOperation = 'source-over';
      s.drawImage(body, 0, 0, N, N);
      s.globalCompositeOperation = 'multiply';
      s.fillStyle = op.color;
      s.fillRect(0, 0, N, N);
      s.globalCompositeOperation = 'destination-in';
      s.drawImage(body, 0, 0, N, N);
      // Punch out every stencil worn at paint time.
      s.globalCompositeOperation = 'destination-out';
      for (const maskId of op.maskedBy) {
        const stencil = getStencil(this.scene, maskId, N);
        if (stencil) s.drawImage(stencil, 0, 0, N, N);
      }
      s.restore();
      if (scratch) ctx.drawImage(scratch, 0, 0);
    }

    // Opacity veil: fade the cells the sim marked dipped (alpha grid) toward
    // white by (1 - DIP_FACTOR). Drawn from the FINAL grid — a later colour
    // splash already reset its cells to opaque there — so a reusable bubble
    // never compounds. A 25% white wash over a cell == that cell's colour
    // composited at 75% over white, matching cellEffectiveColor exactly.
    if (this.hasDip(alpha)) {
      const veil = this.buildDipVeil(alpha, N, body);
      if (veil) {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1 - DIP_FACTOR;
        ctx.drawImage(veil, 0, 0, N, N);
        ctx.globalAlpha = 1;
      }
    }

    // Gloss shine, overlay-blended then alpha-clamped back to the body shape.
    if (shine) {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(shine, 0, 0, N, N);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(body, 0, 0, N, N);
    }
    ctx.restore();
    this.canvasTex.refresh();

    // Worn stencil overlays, in wear order, ABOVE the outline (but under the
    // apply flash) — accessories sit on the slime, so the border must not cut
    // across their art.
    this.wornImgs.forEach((img) => img.destroy());
    this.wornImgs = [];
    for (const maskId of worn) {
      const key = `mod-${maskId}`;
      if (!this.scene.textures.exists(key)) continue;
      const img = this.scene.add.image(0, 0, key).setDisplaySize(this.size, this.size);
      this.container.addAt(img, this.container.getIndex(this.appliedFlash));
      this.wornImgs.push(img);
    }
  }

  private hasDip(alpha: Uint8Array): boolean {
    for (let i = 0; i < alpha.length; i++) if (alpha[i] !== CELL_OPAQUE) return true;
    return false;
  }

  // A white silhouette (transparent elsewhere) of the dipped body cells at
  // native size: the 64×64 alpha grid drawn one white pixel per dipped cell,
  // upscaled blocky (pixelArt), then clipped to the body alpha so the wash can
  // never bleed past the slime edge.
  private buildDipVeil(alpha: Uint8Array, N: number, body: CanvasImageSource): HTMLCanvasElement | null {
    if (!this.gridCanvas) this.gridCanvas = document.createElement('canvas');
    const g = this.gridCanvas;
    g.width = MASK_GRID;
    g.height = MASK_GRID;
    const gctx = g.getContext('2d', { willReadFrequently: true });
    if (!gctx) return null;
    const img = gctx.createImageData(MASK_GRID, MASK_GRID);
    const px = img.data;
    for (let i = 0; i < alpha.length; i++) {
      if (alpha[i] === CELL_OPAQUE) continue;
      const o = i * 4;
      px[o] = 255; px[o + 1] = 255; px[o + 2] = 255; px[o + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);

    if (!this.veilCanvas) this.veilCanvas = document.createElement('canvas');
    const veil = this.veilCanvas;
    veil.width = N;
    veil.height = N;
    const vctx = veil.getContext('2d');
    if (!vctx) return null;
    vctx.clearRect(0, 0, N, N);
    vctx.imageSmoothingEnabled = false;
    vctx.drawImage(g, 0, 0, N, N);
    vctx.globalCompositeOperation = 'destination-in';
    vctx.drawImage(body, 0, 0, N, N);
    vctx.globalCompositeOperation = 'source-over';
    return veil;
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
    this.patternImg.setDisplaySize(size, size);
    this.borderImg.setDisplaySize(size, size);
    this.appliedFlash.setDisplaySize(size, size);
    this.setPattern(this.lastPalette, this.lastActions);
  }
}
