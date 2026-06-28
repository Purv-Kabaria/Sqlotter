import * as Phaser from 'phaser';

const PANEL_SLICE = 8;
const BUTTON_SLICE_X = 8;
const BUTTON_SLICE_Y = 8;

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

export function addPixelPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  width: number,
  height: number,
): Phaser.GameObjects.NineSlice {
  return scene.add.nineslice(
    x,
    y,
    'ui-panel',
    undefined,
    width,
    height,
    PANEL_SLICE,
    PANEL_SLICE,
    PANEL_SLICE,
    PANEL_SLICE,
  );
}

export function addPixelButton(
  scene: Phaser.Scene,
  options: PixelButtonOptions,
): Phaser.GameObjects.Container {
  const {
    x,
    y,
    width,
    height,
    label,
    iconKey,
    fontSize = Math.min(18, Math.round(height * 0.38)),
    disabled = false,
    onClick,
  } = options;

  const bg = scene.add.nineslice(
    0,
    0,
    disabled ? 'ui-btn-disabled' : 'ui-btn-open',
    undefined,
    width,
    height,
    BUTTON_SLICE_X,
    BUTTON_SLICE_X,
    BUTTON_SLICE_Y,
    BUTTON_SLICE_Y,
  );

  const items: Phaser.GameObjects.GameObject[] = [bg];
  const iconOffset = iconKey ? -width * 0.34 : 0;
  const labelOffset = iconKey ? 14 : 0;

  if (iconKey) {
    const icon = scene.add.image(iconOffset, 0, iconKey)
      .setDisplaySize(Math.min(24, height * 0.52), Math.min(24, height * 0.52));
    if (disabled) icon.setAlpha(0.45);
    items.push(icon);
  }

  const txt = scene.add.text(labelOffset, -1, label, {
    fontFamily: '"Arial Black", Arial, sans-serif',
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
        scene.tweens.add({
          targets: container,
          y: y - 2,
          scaleX: 1,
          scaleY: 1,
          duration: 70,
          onComplete: onClick,
        });
      });
  }

  return container;
}
