import * as Phaser from 'phaser';

export const PIXEL_FONT = '"Press Start 2P", monospace';

// Nine-slice constants for legacy NineSlice API (addPixelPanel / addPixelButton)
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
  shadow.setTint(0x000000);
  shadow.setTintFill();
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
};

export function addBeigeButtonShell(
  scene: Phaser.Scene,
  x: number, y: number, width: number, height: number,
  disabled: boolean,
  onClick?: () => void,
): BeigeButtonShell {
  // Even dimensions guarantee integer half-widths → no sub-pixel gaps between pieces
  const W = Math.round(width / 2) * 2;
  const H = Math.round(height / 2) * 2;
  const rx = Math.round(x), ry = Math.round(y);

  const btnState = disabled ? 'btn-dis' : 'btn-open';
  const bgPieces = build9Pieces(scene, W, H, BTN_CW, BTN_CH, btnState);
  if (disabled) bgPieces.forEach(p => (p as Phaser.GameObjects.Image).setAlpha(0.5));

  // Visual sub-container holds all graphics and is the only thing that animates.
  // The outer container stays at a fixed world position so the hitbox never shifts.
  const visual = scene.add.container(0, 0, bgPieces as Phaser.GameObjects.GameObject[]);
  const container = scene.add.container(rx, ry, [visual]).setSize(Math.max(W, 44), Math.max(H, 44));

  const swapBg = (state: 'btn-open' | 'btn-hover' | 'btn-press') =>
    SLICE_POS.forEach((pos, i) =>
      (bgPieces[i] as Phaser.GameObjects.Image | undefined)?.setTexture(`${state}-${pos}`),
    );

  if (!disabled && onClick) {
    // Phaser adds displayOriginX (= W/2) and displayOriginY (= H/2) to local coords before
    // testing Rectangle.Contains, so the Rectangle must use top-left-origin space (0,0 = TL).
    // 4px inset matches the button asset's 4px transparent outer corner margin exactly.
    container.setInteractive(
      new Phaser.Geom.Rectangle(4, 4, W - 8, H - 8),
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
        swapBg('btn-press');
        scene.tweens.add({ targets: visual, y: 2, scaleX: 0.97, scaleY: 0.97, duration: 60 });
      })
      .on('pointerup', () => {
        swapBg('btn-hover');
        scene.tweens.add({ targets: visual, y: -3, scaleX: 1, scaleY: 1, duration: 70, onComplete: onClick });
      });
  }

  return { container, visual, addContent: (items) => visual.add(items) };
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
  } = options;

  const W = Math.round(width / 2) * 2;
  const H = Math.round(height / 2) * 2;
  const shell = addBeigeButtonShell(scene, x, y, width, height, disabled, onClick);

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
  content.push(txt);

  shell.addContent(content);
  return shell.container;
}

// ── Legacy components (kept for Editor, LevelComplete, etc.) ──────────────

export type PixelButtonOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  iconKey?: string | undefined;
  fontSize?: number;
  disabled?: boolean;
  onClick: () => void;
};

export type PixelIconButtonOptions = {
  x: number;
  y: number;
  size: number;
  iconKey: string;
  iconAngle?: number;
  disabled?: boolean;
  onClick: () => void;
};

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

export function addPixelButton(
  scene: Phaser.Scene,
  options: PixelButtonOptions,
): Phaser.GameObjects.Container {
  const {
    x, y, width, height, label, iconKey,
    fontSize = Math.min(11, Math.round(height * 0.28)),
    disabled = false,
    onClick,
  } = options;

  const bg = scene.add.nineslice(
    0, 0, disabled ? 'ui-btn-disabled' : 'ui-btn-open', undefined, width, height,
    BUTTON_SLICE_X, BUTTON_SLICE_X, BUTTON_SLICE_Y, BUTTON_SLICE_Y,
  );

  const items: Phaser.GameObjects.GameObject[] = [bg];
  const iconOffset = iconKey ? -width * 0.34 : 0;
  const labelOffset = iconKey ? 14 : 0;

  if (iconKey) {
    const icon = scene.add.image(iconOffset, 0, iconKey)
      .setDisplaySize(Math.min(20, height * 0.48), Math.min(20, height * 0.48));
    if (disabled) icon.setAlpha(0.45);
    items.push(icon);
  }

  const txt = scene.add.text(labelOffset, -1, label, {
    fontFamily: PIXEL_FONT,
    fontSize: `${fontSize}px`,
    color: disabled ? '#7a6c8f' : '#ffffff',
    stroke: '#1a0a2e',
    strokeThickness: 3,
  }).setOrigin(0.5);
  items.push(txt);

  const container = scene.add.container(x, y, items).setSize(Math.max(width, 44), Math.max(height, 44));

  if (!disabled) {
    container.setInteractive({ useHandCursor: true });
    container
      .on('pointerover', () => {
        bg.setTexture('ui-btn-hover');
        scene.tweens.add({ targets: container, y: y - 2, duration: 80, ease: 'Quad.easeOut' });
      })
      .on('pointerout', () => {
        bg.setTexture('ui-btn-open');
        scene.tweens.add({ targets: container, y, scaleX: 1, scaleY: 1, duration: 90, ease: 'Quad.easeOut' });
      })
      .on('pointerdown', () => {
        bg.setTexture('ui-btn-press');
        scene.tweens.add({ targets: container, y: y + 2, scaleX: 0.98, scaleY: 0.98, duration: 60 });
      })
      .on('pointerup', () => {
        bg.setTexture('ui-btn-hover');
        scene.tweens.add({ targets: container, y: y - 2, scaleX: 1, scaleY: 1, duration: 70, onComplete: onClick });
      });
  }

  return container;
}

export function addPixelIconButton(
  scene: Phaser.Scene,
  options: PixelIconButtonOptions,
): Phaser.GameObjects.Container {
  const { x, y, size, iconKey, iconAngle = 0, disabled = false, onClick } = options;
  const bg = scene.add.nineslice(
    0, 0, disabled ? 'ui-btn-disabled' : 'ui-btn-open', undefined, size, size,
    BUTTON_SLICE_X, BUTTON_SLICE_X, BUTTON_SLICE_Y, BUTTON_SLICE_Y,
  );
  const icon = scene.add.image(0, -1, iconKey)
    .setDisplaySize(size * 0.48, size * 0.48)
    .setAngle(iconAngle)
    .setAlpha(disabled ? 0.45 : 1);
  const container = scene.add.container(x, y, [bg, icon]).setSize(Math.max(size, 44), Math.max(size, 44));

  if (!disabled) {
    container.setInteractive({ useHandCursor: true });
    container
      .on('pointerover', () => {
        bg.setTexture('ui-btn-hover');
        scene.tweens.add({ targets: container, y: y - 1, duration: 70 });
      })
      .on('pointerout', () => {
        bg.setTexture('ui-btn-open');
        scene.tweens.add({ targets: container, y, scaleX: 1, scaleY: 1, duration: 80 });
      })
      .on('pointerdown', () => {
        bg.setTexture('ui-btn-press');
        scene.tweens.add({ targets: container, y: y + 1, scaleX: 0.96, scaleY: 0.96, duration: 50 });
      })
      .on('pointerup', () => {
        bg.setTexture('ui-btn-hover');
        scene.tweens.add({ targets: container, y: y - 1, scaleX: 1, scaleY: 1, duration: 60, onComplete: onClick });
      });
  }

  return container;
}
