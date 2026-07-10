import * as Phaser from 'phaser';
import { playSfx } from '../audio';

// ── Typography ────────────────────────────────────────────────────────────
// Two families, both loaded via the Google Fonts <link> in game.html/splash.html
// and gated by fonts.ts so text never bakes a fallback face:
//   PIXEL_FONT — Press Start 2P. Blocky retro caps; the "display/numeric" voice.
//                Its digits are unambiguous, so it renders every numeric readout.
//   BODY_FONT  — Pixelify Sans. Rounder and far more legible at small sizes; the
//                "words" voice for headings, labels, hints, and body copy.
export const PIXEL_FONT = '"Press Start 2P", monospace';
export const BODY_FONT  = '"Pixelify Sans", sans-serif';

// Shared scene-header treatment (RANKINGS, SHOP, …). Bold Pixelify with a touch
// of tracking, a thin dark outline for definition on busy/beige-on-dark headers,
// and a soft drop shadow so a big header reads as chunky embossed signage rather
// than flat text. All three accents scale with the font size so it stays crisp
// from phone to desktop. Callers keep measuring `.width` after creation, so the
// extra tracking self-centers.
export function headingTextStyle(
  fontSize: number,
  color = '#DEC998',
): Phaser.Types.GameObjects.Text.TextStyle {
  return {
    fontFamily: BODY_FONT,
    fontSize: `${fontSize}px`,
    color,
    fontStyle: 'bold',
    letterSpacing: Math.max(1, Math.round(fontSize * 0.05)),
    stroke: '#2A1000',
    strokeThickness: Math.max(2, Math.round(fontSize * 0.09)),
    shadow: {
      offsetX: 0,
      offsetY: Math.max(2, Math.round(fontSize * 0.12)),
      color: 'rgba(0,0,0,0.45)',
      blur: 0,
      fill: true,
      stroke: true,
    },
  };
}

// Nine-slice constants for the NineSlice API (addPixelPanel / addBeigeSolidCard)
const PANEL_SLICE    = 32;  // panel.png 96×96, each cell = 32px
const BUTTON_SLICE_X = 32;  // button*.png 128×96, corner cell = 32px
const BUTTON_SLICE_Y = 32;

// Flat UI pack — 32×32 source textures, 10px corners
const FLAT_SLICE  = 10;
const DARK_SLICE  = 12;

// Pre-sliced corner size (pixels in source image)
// panel.png 96×96 = 3×3 grid of 32×32 cells
// button*.png 128×96 = 4×3 grid of 32×32 cells (col 2 skipped — same fill as col 1)
const PNL_CW = 32, PNL_CH = 32;
const BTN_CW = 32, BTN_CH = 32;

// Half-scale button corner — pre-downsampled 'btn-open-sm-*' textures (16px corners).
// Lets a beige-button-styled badge shrink down to ~33px instead of the 65px floor
// the full-size 32px corners require (see docs/9-slicing.md minimum-size formula).
const BTN_SM_CW = 16, BTN_SM_CH = 16;

const SLICE_POS = ['tl','tc','tr','ml','mc','mr','bl','bc','br'] as const;

type SlicePiece = Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite;

// Builds 9 pieces filling a rect of (w×h) centred at (0,0).
// Corners → Image (natural pixel size, no scaling).
// Edges + center → TileSprite (GPU-tiled, no stretching, single draw call each).
// prefix: 'pnl' | 'btn-open' | 'btn-hover' | 'btn-press' | 'btn-dis'
function build9Pieces(
  scene: Phaser.Scene, w: number, h: number, cw: number, ch: number, prefix: string,
): SlicePiece[] {
  const ox = -w / 2, oy = -h / 2;
  const mw = w - 2 * cw, mh = h - 2 * ch;
  // Order mirrors SLICE_POS: tl, tc, tr, ml, mc, mr, bl, bc, br
  return [
    scene.add.image(ox + cw / 2,      oy + ch / 2,      `${prefix}-tl`),           // 0 corner
    scene.add.tileSprite(0,            oy + ch / 2,      mw, ch,  `${prefix}-tc`),  // 1 top edge
    scene.add.image(-ox - cw / 2,     oy + ch / 2,      `${prefix}-tr`),           // 2 corner
    scene.add.tileSprite(ox + cw / 2,  0,               cw, mh,  `${prefix}-ml`),  // 3 left edge
    scene.add.tileSprite(0,            0,               mw, mh,  `${prefix}-mc`),  // 4 center
    scene.add.tileSprite(-ox - cw / 2, 0,               cw, mh,  `${prefix}-mr`),  // 5 right edge
    scene.add.image(ox + cw / 2,     -oy - ch / 2,      `${prefix}-bl`),           // 6 corner
    scene.add.tileSprite(0,           -oy - ch / 2,     mw, ch,  `${prefix}-bc`),  // 7 bottom edge
    scene.add.image(-ox - cw / 2,    -oy - ch / 2,      `${prefix}-br`),           // 8 corner
  ];
}

// ── Panel: pre-sliced, tiled nine-slice ────────────────────────────────────
export function addPanel9(
  scene: Phaser.Scene, x: number, y: number, w: number, h: number,
): Phaser.GameObjects.Container {
  // Even dimensions guarantee integer half-widths → no sub-pixel gaps between pieces
  const W = Math.round(w / 2) * 2;
  const H = Math.round(h / 2) * 2;
  const pieces = build9Pieces(scene, W, H, PNL_CW, PNL_CH, 'pnl');
  return scene.add.container(Math.round(x), Math.round(y), pieces as Phaser.GameObjects.GameObject[]);
}

// ── Depth icon (shadow copy 1-2px below for depth) ──────────────────────────

export function addDepthIcon(
  scene: Phaser.Scene,
  x: number,
  y: number,
  key: string,
  w: number,
  h: number,
  shadowOffset = 2,
  shadowAlpha = 0.50,
): Phaser.GameObjects.Container {
  const shadow = scene.add.image(shadowOffset, shadowOffset, key).setDisplaySize(w, h);
  // setTintFill() was removed in Phaser 4 — tint + FILL tint mode is the
  // replacement for a solid silhouette.
  shadow.setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
  shadow.setAlpha(shadowAlpha);
  const icon = scene.add.image(0, 0, key).setDisplaySize(w, h);
  return scene.add.container(x, y, [shadow, icon]);
}

// ── New-design components (beige card / dark panel) ───────────────────────

export function addBeigeCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(
    x, y, 'ui-flat-slot', undefined, width, height,
    FLAT_SLICE, FLAT_SLICE, FLAT_SLICE, FLAT_SLICE,
  );
}


// Opaque beige slab — the unsliced button-open texture as a single NineSlice.
// addBeigeCard's flat-slot source texture is ~80% TRANSPARENT (rgba alpha 50),
// so anything needing a solid beige face over a dark/busy background — e.g.
// shop cards inside the masked scroll grid, where multi-piece TileSprite
// backgrounds don't render reliably — should use this instead. Minimum size
// 65×65 (32px corners).
export function addBeigeSolidCard(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(
    x, y, 'ui-btn-open', undefined, width, height,
    BUTTON_SLICE_X, BUTTON_SLICE_X, BUTTON_SLICE_Y, BUTTON_SLICE_Y,
  );
}

export function addDarkPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(
    x, y, 'ui-dark-panel', undefined, width, height,
    DARK_SLICE, DARK_SLICE, DARK_SLICE, DARK_SLICE,
  );
}

// Clips `target` to a world-space rectangle. Phaser 4's WebGL renderer dropped
// geometry masks — `setMask(gfx.createGeometryMask())` is a Canvas-only API that
// just logs a warning under WebGL and clips nothing, letting "masked" scroll
// content draw over the whole scene. The replacement is a Filters Mask: the
// white-rect Graphics is rendered once into a DynamicTexture aligned with the
// main camera (external filter = camera space). The caller keeps ownership of
// `gfx` and destroys it on teardown; the filter itself dies with `target`.
export function applyRectClip(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  gfx: Phaser.GameObjects.Graphics,
  x: number, y: number, w: number, h: number,
): void {
  gfx.fillStyle(0xffffff);
  gfx.fillRect(x, y, w, h);
  target.enableFilters();
  const mask = target.filters?.external.addMask(gfx, false, scene.cameras.main);
  // The clip rect never moves after build (rebuilds recreate it), so skip the
  // per-frame DynamicTexture re-render autoUpdate would do.
  if (mask) mask.autoUpdate = false;
}

// Non-interactive beige-button-styled badge using half-scale (16px) corners — for HUD
// elements (e.g. the sparks pill) that need the button's pill look but must fit inside
// a footprint smaller than the 65px floor the full-size button corners require.
// Minimum size: 33×33 (2×16 + 1).
export function addBeigeBadge(
  scene: Phaser.Scene, x: number, y: number, width: number, height: number,
): Phaser.GameObjects.Container {
  const W = Math.round(width / 2) * 2;
  const H = Math.round(height / 2) * 2;
  const pieces = build9Pieces(scene, W, H, BTN_SM_CW, BTN_SM_CH, 'btn-open-sm');
  return scene.add.container(Math.round(x), Math.round(y), pieces as Phaser.GameObjects.GameObject[]);
}

// ── Beige button shell — background + hover/press interaction only. Callers supply
// their own content via `addContent`. `addBeigeButton` (label/icon) and level cards
// in LevelSelect both build on this so the swap/tween behavior stays in one place.
export type BeigeButtonShell = {
  container: Phaser.GameObjects.Container;
  visual: Phaser.GameObjects.Container;
  addContent: (items: Phaser.GameObjects.GameObject[]) => void;
  // Persistent tint over the shell pieces (undefined clears it). Survives
  // hover/press feedback — use it for state highlights like an active tab.
  setTint: (color?: number) => void;
};

// Hover/press tints for the small-corner variant, which only ships an 'open'
// state texture (see below).
const SM_TINT_HOVER = 0xFFE8B0;
const SM_TINT_PRESS = 0xC9975C;

export function addBeigeButtonShell(
  scene: Phaser.Scene,
  x: number, y: number, width: number, height: number,
  disabled: boolean,
  onClick?: () => void,
  forceSmall = false,
): BeigeButtonShell {
  // Even dimensions guarantee integer half-widths → no sub-pixel gaps between pieces
  const W = Math.round(width / 2) * 2;
  const H = Math.round(height / 2) * 2;
  const rx = Math.round(x), ry = Math.round(y);

  // Below the full-size assets' 65px floor (2×32px corners + 1px, see
  // docs/9-slicing.md) fall back to the half-scale 16px-corner 'btn-open-sm'
  // pieces, so small screens get proportionally small buttons instead of
  // 66px monsters or corrupted corners. Only the open state exists at this
  // scale, so hover/press feedback tints the pieces instead of swapping
  // textures (the y/scale tweens are shared by both variants). `forceSmall`
  // opts a button into the thinner corners even above the 65px floor — e.g.
  // compact controls like tabs/CTAs, whose full-size corners at tablet sizes
  // (comfortably over 65px, but still a modest button) ate proportionally
  // more of the button than a chunky 32px border should for that content.
  const small = forceSmall || W < 65 || H < 65;
  const bgPieces = small
    ? build9Pieces(scene, W, H, BTN_SM_CW, BTN_SM_CH, 'btn-open-sm')
    : build9Pieces(scene, W, H, BTN_CW, BTN_CH, disabled ? 'btn-dis' : 'btn-open');
  if (disabled) bgPieces.forEach(p => p.setAlpha(0.5));

  // Visual sub-container holds all graphics and is the only thing that animates.
  // The outer container stays at a fixed world position so the hitbox never shifts.
  const visual = scene.add.container(0, 0, bgPieces as Phaser.GameObjects.GameObject[]);
  const container = scene.add.container(rx, ry, [visual]).setSize(Math.max(W, 44), Math.max(H, 44));

  // Caller-set persistent tint (state highlight). The small variant's hover and
  // press feedback also tints, so it must restore this instead of clearTint().
  let baseTint: number | undefined;
  const applyTint = (tint: number | undefined) =>
    bgPieces.forEach(p => (tint === undefined ? p.clearTint() : p.setTint(tint)));

  const swapBg = (state: 'btn-open' | 'btn-hover' | 'btn-press') => {
    if (small) {
      const tint = state === 'btn-hover' ? SM_TINT_HOVER : state === 'btn-press' ? SM_TINT_PRESS : baseTint;
      applyTint(tint);
      return;
    }
    SLICE_POS.forEach((pos, i) =>
      (bgPieces[i] as Phaser.GameObjects.Image | undefined)?.setTexture(`${state}-${pos}`),
    );
  };

  if (!disabled && onClick) {
    // Phaser adds displayOriginX (= W/2) and displayOriginY (= H/2) to local coords before
    // testing Rectangle.Contains, so the Rectangle must use top-left-origin space (0,0 = TL).
    // 4px inset matches the full-size asset's transparent outer corner margin; the
    // downsampled small pieces only carry ~2px, and small buttons need every bit of
    // tap target they have.
    const inset = small ? 2 : 4;
    container.setInteractive(
      new Phaser.Geom.Rectangle(inset, inset, W - inset * 2, H - inset * 2),
      Phaser.Geom.Rectangle.Contains,
    );
    container.input!.cursor = 'pointer';
    container
      .on('pointerover', () => {
        swapBg('btn-hover');
        scene.tweens.add({ targets: visual, y: -3, duration: 80, ease: 'Quad.easeOut' });
      })
      .on('pointerout', () => {
        swapBg('btn-open');
        scene.tweens.add({ targets: visual, y: 0, duration: 90, ease: 'Quad.easeOut' });
      })
      .on('pointerdown', () => {
        // The one press sound for every beige button in the game — on DOWN,
        // not up-with-onClick, so the click lands the instant the finger does.
        playSfx('click');
        swapBg('btn-press');
        scene.tweens.add({ targets: visual, y: 2, scaleX: 0.97, scaleY: 0.97, duration: 60 });
      })
      .on('pointerup', () => {
        swapBg('btn-hover');
        // Release tween is purely cosmetic — the action fires on the next
        // tick (outside input dispatch, so a handler that destroys this very
        // button is safe) instead of waiting out the tween. Chaining onClick
        // off onComplete added 70ms of artificial input lag to every button
        // in the game.
        scene.tweens.add({ targets: visual, y: -3, scaleX: 1, scaleY: 1, duration: 70 });
        scene.time.delayedCall(0, onClick);
      });
  }

  return {
    container,
    visual,
    addContent: (items) => visual.add(items),
    setTint: (color?: number) => { baseTint = color; applyTint(baseTint); },
  };
}

// Beige rounded button with dark-brown text (new design language)
export type BeigeButtonOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  iconKey?: string | undefined;
  fontSize?: number;
  fontFamily?: string;
  disabled?: boolean;
  onClick?: () => void;
  // Use the thinner small-corner asset even above its 65px auto-threshold —
  // see addBeigeButtonShell's forceSmall.
  forceSmall?: boolean;
};

export function addBeigeButton(
  scene: Phaser.Scene,
  options: BeigeButtonOptions,
): Phaser.GameObjects.Container {
  const {
    x, y, width, height, label, iconKey,
    fontSize = Math.max(9, Math.round(height * 0.28)),
    fontFamily = PIXEL_FONT,
    disabled = false,
    onClick,
    forceSmall = false,
  } = options;

  const W = Math.round(width / 2) * 2;
  const H = Math.round(height / 2) * 2;
  const shell = addBeigeButtonShell(scene, x, y, width, height, disabled, onClick, forceSmall);

  const iconSize = Math.min(H * 0.50, 24);
  const hasIcon  = !!iconKey;
  const totalW   = hasIcon ? iconSize + 8 + label.length * (fontSize * 0.68) : 0;
  const iconX    = hasIcon ? -Math.min(totalW / 2, W * 0.34) : 0;
  const textX    = hasIcon ? iconX + iconSize * 0.60 + 8 : 0;

  const content: Phaser.GameObjects.GameObject[] = [];

  if (hasIcon) {
    const ic = addDepthIcon(scene, iconX, 0, iconKey!, iconSize, iconSize);
    if (disabled) ic.setAlpha(0.4);
    content.push(ic);
  }

  const txt = scene.add.text(textX, 0, label, {
    fontFamily,
    fontSize: `${fontSize}px`,
    color: disabled ? '#9A7A5A' : '#3A1A08',
    shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
  }).setOrigin(hasIcon ? 0 : 0.5, 0.5);
  // Measured clamp: callers estimate font sizes from character counts, which
  // under-measures wide labels ("Crimson Belt... · par 4" on a 120px button).
  // Downscale to the button face so no label can spill past the corner art.
  const maxTextW = hasIcon ? W / 2 - 12 - textX : W - 24;
  if (maxTextW > 0 && txt.width > maxTextW) txt.setScale(maxTextW / txt.width);
  content.push(txt);

  shell.addContent(content);
  return shell.container;
}

// ── Legacy panel (kept for LevelComplete and GameOver cards) ──────────────

export function addPixelPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(
    x, y, 'ui-panel', undefined, width, height,
    PANEL_SLICE, PANEL_SLICE, PANEL_SLICE, PANEL_SLICE,
  );
}

