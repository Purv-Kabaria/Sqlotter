import * as Phaser from 'phaser';

export const PIXEL_FONT = '"Press Start 2P", monospace';

// Legacy panel/button slice constants (keep for existing usage)
const PANEL_SLICE = 8;
const BUTTON_SLICE_X = 8;
const BUTTON_SLICE_Y = 8;

// New design constants
const BEIGE_SLICE = 20;
const DARK_SLICE  = 12;

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
    x, y, 'ui-beige-card', undefined, width, height,
    BEIGE_SLICE, BEIGE_SLICE, BEIGE_SLICE, BEIGE_SLICE,
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

// Beige rounded button with dark-brown text (new design language)
export type BeigeButtonOptions = {
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

export function addBeigeButton(
  scene: Phaser.Scene,
  options: BeigeButtonOptions,
): Phaser.GameObjects.Container {
  const {
    x, y, width, height, label, iconKey,
    fontSize = Math.min(10, Math.round(height * 0.25)),
    disabled = false,
    onClick,
  } = options;

  const bg = scene.add.nineslice(
    0, 0, 'ui-beige-card', undefined, width, height,
    BEIGE_SLICE, BEIGE_SLICE, BEIGE_SLICE, BEIGE_SLICE,
  );
  if (disabled) bg.setAlpha(0.5);

  const items: Phaser.GameObjects.GameObject[] = [bg];

  const iconSize = Math.min(22, height * 0.48);
  const hasIcon  = !!iconKey;
  // Icon + label layout: icon left of center, label right of icon
  const totalW   = hasIcon ? iconSize + 6 + label.length * (fontSize * 0.7) : 0;
  const iconX    = hasIcon ? -Math.min(totalW / 2, width * 0.32) : 0;
  const textX    = hasIcon ? iconX + iconSize * 0.6 + 6 : 0;

  if (hasIcon) {
    const ic = addDepthIcon(scene, iconX, 0, iconKey!, iconSize, iconSize);
    if (disabled) ic.setAlpha(0.4);
    items.push(ic);
  }

  const txt = scene.add.text(textX, 0, label, {
    fontFamily: PIXEL_FONT,
    fontSize: `${fontSize}px`,
    color: disabled ? '#9A7A5A' : '#3A1A08',
    shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
  }).setOrigin(hasIcon ? 0 : 0.5, 0.5);
  items.push(txt);

  const container = scene.add.container(x, y, items).setSize(Math.max(width, 44), Math.max(height, 44));

  if (!disabled) {
    container.setInteractive({ useHandCursor: true });
    container
      .on('pointerover', () => {
        bg.setAlpha(0.85);
        scene.tweens.add({ targets: container, y: y - 3, duration: 80, ease: 'Quad.easeOut' });
      })
      .on('pointerout', () => {
        bg.setAlpha(1);
        scene.tweens.add({ targets: container, y, duration: 90, ease: 'Quad.easeOut' });
      })
      .on('pointerdown', () => {
        bg.setAlpha(0.7);
        scene.tweens.add({ targets: container, y: y + 2, scaleX: 0.97, scaleY: 0.97, duration: 60 });
      })
      .on('pointerup', () => {
        bg.setAlpha(1);
        scene.tweens.add({ targets: container, y: y - 3, scaleX: 1, scaleY: 1, duration: 70, onComplete: onClick });
      });
  }

  return container;
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
