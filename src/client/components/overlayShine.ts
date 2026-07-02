import * as Phaser from 'phaser';
import { overlay } from 'color-blend';

// Genuinely overlay-blends a tinted source texture with a "shine" texture, baking the
// result into a Phaser CanvasTexture. Phaser's own `Phaser.BlendModes.OVERLAY` is
// Canvas-only — setting it on a WebGL-rendered Image silently falls back to NORMAL — so
// there's no per-GameObject way to get a real Photoshop-style overlay blend under WebGL.
// This computes the actual overlay formula on the CPU (via the `color-blend` library,
// which implements proper alpha-aware Porter-Duff compositing, not naive per-channel
// math) and uploads the finished pixels as a texture, which any renderer can display.
//
// Output is always generated at the *source* texture's native resolution (not the
// on-screen display size) so callers can keep using `setDisplaySize()` for scaling and
// `setCrop()` for the slime's two-color mode exactly as before — both operate in
// texture-pixel space, which stays correct only if the generated texture matches the
// original's native dimensions.

let scratch: HTMLCanvasElement | null = null;
function getScratchCanvas(size: number): CanvasRenderingContext2D {
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== size || scratch.height !== size) {
    scratch.width = size;
    scratch.height = size;
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

function readPixels(scene: Phaser.Scene, textureKey: string, size: number): ImageData {
  const source = scene.textures.get(textureKey).getSourceImage() as CanvasImageSource;
  const ctx = getScratchCanvas(size);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(source, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size);
}

/**
 * Bakes `shineKey` onto `baseKey` (multiplicatively tinted to `tint`, matching Phaser's
 * own tint formula) using a real overlay blend, at `amount` opacity (0 = only the tint
 * shows, 1 = the full overlay effect). Writes into (creating if needed) the Phaser
 * CanvasTexture named `outKey`, sized to match `baseKey`'s native resolution.
 *
 * Returns `outKey` so callers can `image.setTexture(outKey)`.
 */
export function paintOverlayShine(
  scene: Phaser.Scene,
  outKey: string,
  baseKey: string,
  shineKey: string,
  tint: number,
  amount: number,
): string {
  const nativeSize = scene.textures.get(baseKey).getSourceImage().width;

  const baseData  = readPixels(scene, baseKey, nativeSize);
  const shineData = readPixels(scene, shineKey, nativeSize);

  const existing = scene.textures.exists(outKey) ? scene.textures.get(outKey) : null;
  const tex = (existing && existing.key !== '__MISSING')
    ? existing as Phaser.Textures.CanvasTexture
    : scene.textures.createCanvas(outKey, nativeSize, nativeSize)!;
  if (tex.width !== nativeSize || tex.height !== nativeSize) tex.setSize(nativeSize, nativeSize);

  const tr = ((tint >> 16) & 0xff) / 255;
  const tg = ((tint >> 8) & 0xff) / 255;
  const tb = (tint & 0xff) / 255;

  const bd = baseData.data;
  const sd = shineData.data;
  const out = tex.context.createImageData(nativeSize, nativeSize);
  const od = out.data;

  for (let i = 0; i < bd.length; i += 4) {
    const backdrop = { r: bd[i]! * tr, g: bd[i + 1]! * tg, b: bd[i + 2]! * tb, a: bd[i + 3]! / 255 };
    const source   = { r: sd[i]!,      g: sd[i + 1]!,      b: sd[i + 2]!,      a: sd[i + 3]! / 255 };
    const blended  = overlay(backdrop, source);

    od[i]     = backdrop.r + (blended.r - backdrop.r) * amount;
    od[i + 1] = backdrop.g + (blended.g - backdrop.g) * amount;
    od[i + 2] = backdrop.b + (blended.b - backdrop.b) * amount;
    od[i + 3] = (backdrop.a + (blended.a - backdrop.a) * amount) * 255;
  }

  tex.context.putImageData(out, 0, 0);
  tex.refresh();
  return outKey;
}

// Same idea as paintOverlayShine, but the "tint" is a top-to-bottom multi-stop
// gradient instead of one flat color — used for the shop's rare gradient/
// rainbow color variants, where a single hex can't represent the effect.
// Renders the gradient into a same-size scratch canvas via the standard 2D
// Canvas API (createLinearGradient), then reads it back as a per-pixel tint
// source for the identical overlay-blend loop paintOverlayShine uses.
export function paintGradientShine(
  scene: Phaser.Scene,
  outKey: string,
  baseKey: string,
  shineKey: string,
  stops: string[],
  amount: number,
): string {
  const nativeSize = scene.textures.get(baseKey).getSourceImage().width;

  const gradCanvas = document.createElement('canvas');
  gradCanvas.width = nativeSize;
  gradCanvas.height = nativeSize;
  const gradCtx = gradCanvas.getContext('2d')!;
  const grad = gradCtx.createLinearGradient(0, 0, 0, nativeSize);
  stops.forEach((hex, i) => grad.addColorStop(i / (stops.length - 1), hex));
  gradCtx.fillStyle = grad;
  gradCtx.fillRect(0, 0, nativeSize, nativeSize);
  const gradData = gradCtx.getImageData(0, 0, nativeSize, nativeSize).data;

  const baseData  = readPixels(scene, baseKey, nativeSize);
  const shineData = readPixels(scene, shineKey, nativeSize);

  const existing = scene.textures.exists(outKey) ? scene.textures.get(outKey) : null;
  const tex = (existing && existing.key !== '__MISSING')
    ? existing as Phaser.Textures.CanvasTexture
    : scene.textures.createCanvas(outKey, nativeSize, nativeSize)!;
  if (tex.width !== nativeSize || tex.height !== nativeSize) tex.setSize(nativeSize, nativeSize);

  const bd = baseData.data;
  const sd = shineData.data;
  const out = tex.context.createImageData(nativeSize, nativeSize);
  const od = out.data;

  for (let i = 0; i < bd.length; i += 4) {
    const backdrop = {
      r: bd[i]! * (gradData[i]! / 255),
      g: bd[i + 1]! * (gradData[i + 1]! / 255),
      b: bd[i + 2]! * (gradData[i + 2]! / 255),
      a: bd[i + 3]! / 255,
    };
    const source  = { r: sd[i]!, g: sd[i + 1]!, b: sd[i + 2]!, a: sd[i + 3]! / 255 };
    const blended = overlay(backdrop, source);

    od[i]     = backdrop.r + (blended.r - backdrop.r) * amount;
    od[i + 1] = backdrop.g + (blended.g - backdrop.g) * amount;
    od[i + 2] = backdrop.b + (blended.b - backdrop.b) * amount;
    od[i + 3] = (backdrop.a + (blended.a - backdrop.a) * amount) * 255;
  }

  tex.context.putImageData(out, 0, 0);
  tex.refresh();
  return outKey;
}
