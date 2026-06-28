import { GameObjects, Scene } from 'phaser';
import { getLaunchLevelId } from '../launch';
import { PIXEL_FONT } from '../components/PixelUI';

// All asset definitions to load
type AssetDef = { key: string; path: string };

const IMG: AssetDef[] = [
  { key: 'title', path: 'title.png' },
  // ── Slime base layers ─────────────────────────────
  { key: 'slime-color',  path: 'slime/color.png' },
  { key: 'slime-border', path: 'slime/border.png' },
  { key: 'slime-shine',  path: 'slime/overlay-normal.png' },
  { key: 'slime-applied',path: 'slime/overlay-applied.png' },

  // ── Modifier overlays ─────────────────────────────
  { key: 'mod-goggles-h-thick', path: 'modifiers/horizontal-goggles-thick.png' },
  { key: 'mod-goggles-h-thin',  path: 'modifiers/horizontal-goggles-thin.png' },
  { key: 'mod-goggles-h-mono',  path: 'modifiers/horizontal-goggle.png' },
  { key: 'mod-goggles-v-thick', path: 'modifiers/vertical-goggles-thick.png' },
  { key: 'mod-goggles-v-thin',  path: 'modifiers/vertical-goggles-thin.png' },
  { key: 'mod-goggles-v-mono',  path: 'modifiers/vertical-goggle.png' },
  { key: 'mod-glasses-h-thick', path: 'modifiers/horizontal-glasses-thick.png' },
  { key: 'mod-glasses-h-thin',  path: 'modifiers/horizontal-glasses-thin.png' },
  { key: 'mod-glasses-v-thick', path: 'modifiers/vertical-glasses-thick.png' },
  { key: 'mod-glasses-v-thin',  path: 'modifiers/vertical-glasses-thin.png' },
  { key: 'mod-pendant-h',  path: 'modifiers/horizontal-pendent.png' },
  { key: 'mod-pendant-v',  path: 'modifiers/vertical-pendent.png' },
  { key: 'mod-belt-h-thick', path: 'modifiers/horizontal-belt-thick.png' },
  { key: 'mod-belt-h-thin',  path: 'modifiers/horizontal-belt-thin.png' },
  { key: 'mod-belt-v-thick', path: 'modifiers/vertical-belt-thick.png' },
  { key: 'mod-belt-v-thin',  path: 'modifiers/vertical-belt-thin.png' },
  { key: 'mod-pumpkin-25', path: 'modifiers/pumpkin-25.png' },
  { key: 'mod-pumpkin-50', path: 'modifiers/pumpkin-50.png' },
  { key: 'mod-pumpkin-75', path: 'modifiers/pumpkin-75.png' },
  { key: 'mod-underwear',  path: 'modifiers/underwear.png' },

  // ── Character / Splot ─────────────────────────────
  { key: 'char-blob',    path: 'character/blob.png' },
  { key: 'char-outline', path: 'character/outline.png' },
  { key: 'char-shadow',  path: 'character/shadow.png' },
  { key: 'char-shine',   path: 'character/overlay-normal.png' },
  { key: 'char-applied', path: 'character/overlay-applied.png' },

  { key: 'char-eye-normal', path: 'character/eyes/eye-normal.png' },
  { key: 'char-eye-doubt',  path: 'character/eyes/eye-doubt.png' },
  { key: 'char-eye-cute',   path: 'character/eyes/eye-cute.png' },
  { key: 'char-eye-pain',   path: 'character/eyes/eye-pain.png' },
  { key: 'char-eye-happy',  path: 'character/eyes/eye-happy.png' },
  { key: 'char-eye-shock',  path: 'character/eyes/eye-shock.png' },
  { key: 'char-eye-open',   path: 'character/eyes/eye-open.png' },

  { key: 'char-brow-normal',   path: 'character/eyebrows/eyebrow-normal.png' },
  { key: 'char-brow-surprise', path: 'character/eyebrows/eyebrow-surprise.png' },
  { key: 'char-brow-sad',      path: 'character/eyebrows/eyebrow-sad.png' },
  { key: 'char-brow-angry',    path: 'character/eyebrows/eyebrow-angry.png' },

  { key: 'char-mouth-happy',   path: 'character/mouth/mouth-happy.png' },
  { key: 'char-mouth-smile',   path: 'character/mouth/mouth-smile.png' },
  { key: 'char-mouth-frown',   path: 'character/mouth/mouth-frown.png' },
  { key: 'char-mouth-squiggle',path: 'character/mouth/mouth-squiggle.png' },
  { key: 'char-mouth-kiss',    path: 'character/mouth/mouth-kiss.png' },
  { key: 'char-mouth-ooo',     path: 'character/mouth/mouth-ooo.png' },
  { key: 'char-blush',         path: 'character/mouth/blush.png' },
  { key: 'char-cry',           path: 'character/mouth/cry.png' },

  { key: 'char-acc-horns',     path: 'character/accessories/horns.png' },
  { key: 'char-acc-party-hat', path: 'character/accessories/party-hat.png' },
  { key: 'char-acc-crown',     path: 'character/accessories/crown.png' },
  { key: 'char-acc-cap',       path: 'character/accessories/cap.png' },
  { key: 'char-acc-hat',       path: 'character/accessories/hat.png' },

  // ── UI panels & buttons ───────────────────────────
  { key: 'ui-panel',       path: 'ui/panel.png' },
  { key: 'ui-btn-open',    path: 'ui/button-open.png' },
  { key: 'ui-btn-hover',   path: 'ui/button-hover.png' },
  { key: 'ui-btn-disabled',path: 'ui/button-disabled.png' },
  { key: 'ui-btn-press',   path: 'ui/button-press.png' },

  // ── Navigation icons ──────────────────────────────
  { key: 'icon-arrow',    path: 'icons/navigation/arrow.png' },
  { key: 'icon-home',     path: 'icons/navigation/home.png' },
  { key: 'icon-settings', path: 'icons/navigation/settings.png' },
  { key: 'icon-cancel',   path: 'icons/navigation/cancel.png' },
  { key: 'icon-help',     path: 'icons/navigation/help.png' },
  { key: 'icon-share',    path: 'icons/navigation/share.png' },

  // ── Gameplay icons ────────────────────────────────
  { key: 'icon-play',   path: 'icons/gameplay/play.png' },
  { key: 'icon-pause',  path: 'icons/gameplay/pause.png' },
  { key: 'icon-timer',  path: 'icons/gameplay/timer.png' },
  { key: 'icon-reset',  path: 'icons/gameplay/reset.png' },

  // ── Puzzle icons (for modifier palette) ──────────
  { key: 'icon-paint',         path: 'icons/puzzle/paint.png' },
  { key: 'icon-pendant',       path: 'icons/puzzle/pendent.png' },
  { key: 'icon-glasses-thick', path: 'icons/puzzle/glasses-thick.png' },
  { key: 'icon-glasses-thin',  path: 'icons/puzzle/glasses-thin.png' },
  { key: 'icon-goggles-thin',  path: 'icons/puzzle/goggles-thin.png' },
  { key: 'icon-goggles-thick', path: 'icons/puzzle/goggles-thick.png' },
  { key: 'icon-goggle',        path: 'icons/puzzle/goggle.png' },
  { key: 'icon-pumpkin',       path: 'icons/puzzle/pumpkin.png' },
  { key: 'icon-underwear',     path: 'icons/puzzle/underwear.png' },
  { key: 'icon-belt-thick',    path: 'icons/puzzle/belt-thick.png' },
  { key: 'icon-belt-thin',     path: 'icons/puzzle/belt-thin.png' },

  // ── HUD icons ─────────────────────────────────────
  { key: 'icon-heart',   path: 'icons/hud/heart.png' },
  { key: 'icon-spark',   path: 'icons/hud/spark.png' },
  { key: 'icon-star',    path: 'icons/hud/star.png' },
  { key: 'icon-fire',    path: 'icons/hud/fire.png' },

  // ── Community icons ───────────────────────────────
  { key: 'icon-people',  path: 'icons/community/people.png' },
  { key: 'icon-trophy',  path: 'icons/community/trophy.png' },
  { key: 'icon-pencil',  path: 'icons/community/pencil.png' },
  { key: 'icon-gold',    path: 'icons/community/gold.png' },
  { key: 'icon-silver',  path: 'icons/community/silver.png' },
  { key: 'icon-bronze',  path: 'icons/community/bronze.png' },

  // ── Shop icons ────────────────────────────────────
  { key: 'icon-bag',    path: 'icons/shop/bag.png' },
  { key: 'icon-lock',   path: 'icons/shop/lock.png' },
  { key: 'icon-unlock', path: 'icons/shop/unlock.png' },
  { key: 'icon-price',  path: 'icons/shop/price.png' },

  // ── Status icons ──────────────────────────────────
  { key: 'icon-check',   path: 'icons/status/check.png' },
  { key: 'icon-cross',   path: 'icons/status/cross.png' },
  { key: 'icon-warning', path: 'icons/status/warning.png' },

  // ── Misc icons ────────────────────────────────────
  { key: 'icon-plus',    path: 'icons/misc/plus.png' },
  { key: 'icon-minus',   path: 'icons/misc/minus.png' },
  { key: 'icon-dot',     path: 'icons/misc/dot.png' },
  { key: 'icon-sparkle', path: 'icons/misc/sparkle.png' },

  // ── Backgrounds ───────────────────────────────────
  { key: 'bg1-1', path: 'background/background 1/1.png' },
  { key: 'bg1-2', path: 'background/background 1/2.png' },
  { key: 'bg1-3', path: 'background/background 1/3.png' },
  { key: 'bg1-4', path: 'background/background 1/4.png' },
  { key: 'bg2-1', path: 'background/background 2/1.png' },
  { key: 'bg2-2', path: 'background/background 2/2.png' },
  { key: 'bg2-3', path: 'background/background 2/3.png' },
  { key: 'bg2-4', path: 'background/background 2/4.png' },
  { key: 'bg3-1', path: 'background/background 3/1.png' },
  { key: 'bg3-2', path: 'background/background 3/2.png' },
  { key: 'bg3-3', path: 'background/background 3/3.png' },
  { key: 'bg3-4', path: 'background/background 3/4.png' },
  { key: 'bg4-1', path: 'background/background 4/1.png' },
  { key: 'bg4-2', path: 'background/background 4/2.png' },
  { key: 'bg4-3', path: 'background/background 4/3.png' },
  { key: 'bg4-4', path: 'background/background 4/4.png' },
];

export class Preloader extends Scene {
  private bar: GameObjects.Rectangle | null = null;
  private titleText: GameObjects.Text | null = null;
  private tipText: GameObjects.Text | null = null;

  constructor() { super('Preloader'); }

  preload() {
    this.cameras.main.setBackgroundColor(0x1a0a2e);
    this.createLoadingUI();

    this.load.setPath('assets');
    for (const { key, path } of IMG) {
      this.load.image(key, path);
    }

    this.load.on('progress', (p: number) => {
      if (this.bar) this.bar.width = 4 + 340 * p;
    });
  }

  private createLoadingUI() {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    // Title
    this.titleText = this.add.text(cx, cy - 80, 'Sqlotter', {
      fontFamily: PIXEL_FONT,
      fontSize: '28px',
      color: '#6DD400',
      stroke: '#1a0a2e',
      strokeThickness: 4,
      shadow: { offsetX: 2, offsetY: 2, color: '#000000', blur: 4, fill: true },
    }).setOrigin(0.5);

    // Breathing pulse on the title
    this.tweens.add({
      targets: this.titleText,
      scale: 1.05,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Bar background
    this.add.rectangle(cx, cy + 10, 350, 18, 0x2a1555, 1)
      .setStrokeStyle(2, 0x6dd400, 0.6);

    // Progress bar
    this.bar = this.add.rectangle(cx - 173, cy + 10, 4, 14, 0x6dd400)
      .setOrigin(0, 0.5);

    // Loading tip
    this.tipText = this.add.text(cx, cy + 45, 'Loading...', {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#a0b0c0',
    }).setOrigin(0.5);
  }

  create() {
    if (this.tipText) this.tipText.setText('Ready!');
    const launchLevelId = getLaunchLevelId();
    this.time.delayedCall(200, () => {
      if (launchLevelId) {
        this.scene.start('Game', { levelId: launchLevelId });
      } else {
        this.scene.start('MainMenu');
      }
    });
  }
}
