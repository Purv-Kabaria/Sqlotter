import { GameObjects, Scene, Structs, TintModes, Tweens } from 'phaser';
import { getLaunchLevelId } from '../launch';
import { paintOverlayShine } from '../components/overlayShine';
import type { InitResponse } from '../../shared/api';
import { prefetchUserData } from '../userData';

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
  // Whole-image button texture — only addBeigeSolidCard slabs use it now; the
  // interactive buttons all run on the pre-sliced btn-* pieces loaded below.
  { key: 'ui-btn-open',    path: 'ui/button-open.png' },

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
  // bg2 (Shop/Editor) is NOT here — those scenes sit behind a click, so
  // MainMenu warms it in the background and the scenes preload it as a
  // safety net (see DEFERRED_IMG). There is no bg1 user anywhere.
  { key: 'bg3-1', path: 'background/background 3/1.png' },
  { key: 'bg3-2', path: 'background/background 3/2.png' },
  { key: 'bg3-3', path: 'background/background 3/3.png' },
  { key: 'bg3-4', path: 'background/background 3/4.png' },
  { key: 'bg4-1', path: 'background/background 4/1.png' },
  { key: 'bg4-2', path: 'background/background 4/2.png' },
  { key: 'bg4-3', path: 'background/background 4/3.png' },
  { key: 'bg4-4', path: 'background/background 4/4.png' },

  // ── Flat UI slot (beige card nine-slice source) ───────────────────────────
  { key: 'ui-flat-slot', path: 'more ui/UI_Flat_FrameSlot01c.png' },
];

// Assets no scene needs before the player clicks through the menu. MainMenu
// streams these in the background once it is interactive; Shop/Editor also
// declare them in their own preload() so a fast click still can't outrun them.
export const DEFERRED_IMG: AssetDef[] = [
  { key: 'bg2-1', path: 'background/background 2/1.png' },
  { key: 'bg2-2', path: 'background/background 2/2.png' },
  { key: 'bg2-3', path: 'background/background 2/3.png' },
  { key: 'bg2-4', path: 'background/background 2/4.png' },
];

export class Preloader extends Scene {
  // Loading UI object refs — created once, repositioned on resize
  private logo: GameObjects.Image | null = null;
  private logoFallback: GameObjects.Text | null = null;
  private slimeShadow: GameObjects.Image | null = null;
  private slime: GameObjects.Image | null = null;
  private slimeBorder: GameObjects.Image | null = null;
  private filler: GameObjects.Image | null = null;
  private fillerBorder: GameObjects.Image | null = null;
  private tipText: GameObjects.Text | null = null;
  private titlePulseTween: Tweens.Tween | null = null;
  private bobTween: Tweens.Tween | null = null;
  private squishTween: Tweens.TweenChain | null = null;
  private currentProgress = 0;
  private userDataPromise: Promise<InitResponse | null> | null = null;

  constructor() { super('Preloader'); }

  preload() {
    this.cameras.main.setBackgroundColor(0x232323);
    this.createLoadingUI();
    this.scale.on('resize', this.onResize, this);

    // Player profile fetch runs alongside the asset stream — by the time the
    // bar fills, MainMenu's data is (usually) already cached, so its first
    // build shows the real username/sparks/equipment instead of placeholders.
    this.userDataPromise = prefetchUserData();

    const BOOT_KEYS = new Set([
      'title', 'bg4-1',
      'loading-border', 'loading-filler',
      'slime-color', 'slime-border', 'slime-shine',
    ]);

    this.load.setPath('assets');
    for (const { key, path } of IMG) {
      if (BOOT_KEYS.has(key)) continue; // already loaded by Boot
      this.load.image(key, path);
    }

    // Pre-sliced panel + button cells (moved out of Boot so they stream in
    // behind the progress bar instead of delaying the first paint)
    const slicePos = ['tl','tc','tr','ml','mc','mr','bl','bc','br'] as const;
    for (const pos of slicePos) this.load.image(`pnl-${pos}`, `ui/slices/pnl-${pos}.png`);
    for (const st of ['open','hover','press'] as const)
      for (const pos of slicePos) this.load.image(`btn-${st}-${pos}`, `ui/slices/btn-${st}-${pos}.png`);
    for (const pos of slicePos) this.load.image(`btn-dis-${pos}`, `ui/slices/btn-dis-${pos}.png`);
    // Small-corner (16px) variant of btn-open — for badges that must shrink below
    // the 65px floor the 32px-corner assets require (e.g. the HUD sparks pill)
    for (const pos of slicePos) this.load.image(`btn-open-sm-${pos}`, `ui/slices/btn-open-sm-${pos}.png`);

    this.load.on('progress', (p: number) => {
      this.currentProgress = p;
      if (this.filler) {
        this.filler.setCrop(0, 0, Math.max(1, Math.round(128 * p)), 16);
      }
    });
  }

  // Creates all display objects at placeholder positions, then lays them out.
  private createLoadingUI() {
    const cx = this.scale.width / 2;

    if (this.textures.exists('title')) {
      this.logo = this.add.image(cx, 0, 'title');
    } else {
      this.logoFallback = this.add.text(cx, 0, 'Sqlotter', {
        fontFamily: '"Pixelify Sans", sans-serif', fontSize: '24px', color: '#DEC998',
      }).setOrigin(0.5);
    }

    if (this.textures.exists('slime-color')) {
      this.slimeShadow = this.add.image(cx, 0, 'slime-color');
      // setTintFill() was removed in Phaser 4 — tint + FILL tint mode instead
      this.slimeShadow.setTint(0x000000).setTintMode(TintModes.FILL);
      this.slimeShadow.setAlpha(0.30);

      // Body is baked (tint + genuine overlay-blended shine) into a texture rather
      // than tinted live — see overlayShine.ts for why a plain Phaser tint +
      // BlendModes.OVERLAY can't do this under WebGL. The tint here never changes,
      // so this only needs to run once.
      const slimeShineKey = paintOverlayShine(this, 'preloader-slime-shine-tex', 'slime-color', 'slime-shine', 0x6DD400, 0.5);
      this.slime = this.add.image(cx, 0, slimeShineKey);

      this.slimeBorder = this.add.image(cx, 0, 'slime-border');
    }

    this.filler = this.add.image(cx, 0, 'loading-filler').setOrigin(0, 0.5);
    this.filler.setCrop(0, 0, 1, 16);
    this.fillerBorder = this.add.image(cx, 0, 'loading-border');
    this.tipText = this.add.text(cx, 0, 'Loading...', {
      fontFamily: '"Pixelify Sans", sans-serif', fontSize: '16px', color: '#a8a090',
    }).setOrigin(0.5);

    this.layoutLoadingUI();
  }

  // Recalculates and applies sizes + positions for the current canvas dimensions.
  // Safe to call repeatedly — stops old tweens and restarts them with updated values.
  private layoutLoadingUI() {
    const { width, height } = this.scale;
    const cx = width / 2;

    const slimeSz = Math.min(width * 0.50, height * 0.32, 280);
    const logoW   = Math.min(width * 0.75, 350);
    const logoH   = Math.round(logoW * 112 / 512);
    const barW    = Math.min(width * 0.80, 380);
    const barH    = Math.round(barW * 16 / 128);

    // Pack the 3 elements into the top 65% with equal gaps between them
    const topMargin = Math.round(height * 0.06);
    const totalElH  = logoH + slimeSz + barH;
    const gap       = Math.max(16, Math.round((height * 0.65 - topMargin - totalElH) / 2));

    const titleY = topMargin + Math.ceil(logoH / 2);
    const slimeY = topMargin + logoH + gap + Math.ceil(slimeSz / 2);
    const barY   = topMargin + logoH + gap + slimeSz + gap + Math.ceil(barH / 2);

    this.titlePulseTween?.stop();
    this.logo?.setPosition(cx, titleY).setDisplaySize(logoW, logoH);
    this.logoFallback?.setPosition(cx, titleY);
    const titleTarget = this.logo ?? this.logoFallback;
    if (titleTarget) {
      const baseScaleX = titleTarget.scaleX;
      const baseScaleY = titleTarget.scaleY;
      this.titlePulseTween = this.tweens.add({
        targets: titleTarget,
        scaleX: baseScaleX * 1.04,
        scaleY: baseScaleY * 1.04,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }

    if (this.slime && this.slimeBorder && this.slimeShadow) {
      // Stop running tweens before snapping positions (prevents mid-tween offsets)
      this.bobTween?.stop();
      this.squishTween?.stop();

      this.slimeShadow.setPosition(cx + 3, slimeY + 3).setDisplaySize(slimeSz, slimeSz);
      this.slime      .setPosition(cx,     slimeY    ).setDisplaySize(slimeSz, slimeSz);
      this.slimeBorder.setPosition(cx,     slimeY    ).setDisplaySize(slimeSz, slimeSz);

      // Capture base scale AFTER setDisplaySize — tween values are absolute in Phaser
      const bs = this.slime.scaleX;

      this.bobTween = this.tweens.add({
        targets: [this.slime, this.slimeBorder, this.slimeShadow],
        y: `+=${slimeSz * 0.08}`,
        duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
      this.squishTween = this.tweens.chain({
        targets: [this.slime, this.slimeBorder],
        tweens: [
          { scaleX: bs * 1.06, scaleY: bs * 0.94, duration: 300, ease: 'Sine.easeInOut' },
          { scaleX: bs * 0.97, scaleY: bs * 1.05, duration: 300, ease: 'Sine.easeInOut' },
          { scaleX: bs,        scaleY: bs,         duration: 200, ease: 'Sine.easeInOut' },
          { scaleX: bs,        scaleY: bs,         duration: 400 },
        ],
        repeat: -1,
      });
    }

    if (this.filler) {
      this.filler.setPosition(cx - barW / 2, barY).setDisplaySize(barW, barH);
      // Re-apply progress crop in case resize happens mid-load
      this.filler.setCrop(0, 0, Math.max(1, Math.round(128 * this.currentProgress)), 16);
    }
    this.fillerBorder?.setPosition(cx, barY).setDisplaySize(barW, barH);
    this.tipText?.setPosition(cx, barY + Math.ceil(barH / 2) + 14);
  }

  private onResize(gameSize: Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.layoutLoadingUI();
  }

  create() {
    this.scale.off('resize', this.onResize, this);
    const launchLevelId = getLaunchLevelId();

    // Assets are done; give the profile fetch started in preload() a moment
    // to land so the menu opens with real data — but race it against a short
    // timeout: MainMenu refetches and patches itself anyway, so a slow server
    // (mobile + cold start) must not hold the player on this screen.
    if (this.tipText) this.tipText.setText('Waking up Splot...');
    void (async () => {
      await Promise.race([
        this.userDataPromise ?? Promise.resolve(null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      if (this.tipText) this.tipText.setText('Ready!');
      this.time.delayedCall(200, () => {
        if (launchLevelId) {
          this.scene.start('Game', { levelId: launchLevelId });
        } else {
          this.scene.start('MainMenu');
        }
      });
    })();
  }
}
