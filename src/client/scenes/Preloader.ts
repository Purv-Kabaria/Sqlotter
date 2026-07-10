import { GameObjects, Scene, Structs, TintModes, Tweens } from 'phaser';
import { getLaunchLevelId } from '../launch';
import { warmLevelsDuringIdle } from '../levelWarmup';
import { paintOverlayShine } from '../components/overlayShine';
import type { InitResponse } from '../../shared/api';
import { prefetchUserData } from '../userData';
import { loadGameFonts } from '../fonts';
import { applyStoredSettings, CORE_SFX, initAudio, SFX_FILES } from '../audio';

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
  // Newer modifiers. Nose grows small→medium→big (see slimeSim); bubble is a
  // reusable inner-circle opacity dip; plate/cone/scarf are plain stencils.
  { key: 'mod-nose-small',  path: 'modifiers/nose-small.png' },
  { key: 'mod-nose-medium', path: 'modifiers/nose-medium.png' },
  { key: 'mod-nose-big',    path: 'modifiers/nose-big.png' },
  { key: 'mod-bubble',      path: 'modifiers/bubble.png' },
  { key: 'mod-plate',       path: 'modifiers/plate.png' },
  { key: 'mod-cone',        path: 'modifiers/cone.png' },
  { key: 'mod-scarf',       path: 'modifiers/scarf-right.png' },

  // ── Character / Splot ─────────────────────────────
  // character/shadow.png is intentionally NOT loaded — every Splot uses the
  // procedural 'splot-shadow' ellipse Boot.ts bakes (see genSplotShadowTexture).
  { key: 'char-blob',    path: 'character/blob.png' },
  { key: 'char-outline', path: 'character/outline.png' },
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
  // Whole-image button state textures — every beige shell is one NineSlice of
  // these (hover/press swap the texture on the same object; see PixelUI).
  { key: 'ui-btn-open',    path: 'ui/button-open.png' },
  { key: 'ui-btn-hover',   path: 'ui/button-hover.png' },
  { key: 'ui-btn-press',   path: 'ui/button-press.png' },
  { key: 'ui-btn-dis',     path: 'ui/button-disabled.png' },

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
  // bg2 (Shop/Editor) and bg1 (LevelSelect/Leaderboard) are NOT here — those
  // scenes sit behind a click, so MainMenu warms them in the background and
  // the scenes preload them as a safety net (see DEFERRED_IMG).
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
// streams these in the background once it is interactive; the scenes that use
// them also declare them in their own preload() so a fast click can't outrun them.
export const DEFERRED_IMG: AssetDef[] = [
  // bg2 — pink clouds (Shop, Editor)
  { key: 'bg2-1', path: 'background/background 2/1.png' },
  { key: 'bg2-2', path: 'background/background 2/2.png' },
  { key: 'bg2-3', path: 'background/background 2/3.png' },
  { key: 'bg2-4', path: 'background/background 2/4.png' },
  // bg1 — night sky with crescent moon (LevelSelect, Leaderboard)
  { key: 'bg1-1', path: 'background/background 1/1.png' },
  { key: 'bg1-2', path: 'background/background 1/2.png' },
  { key: 'bg1-3', path: 'background/background 1/3.png' },
  { key: 'bg1-4', path: 'background/background 1/4.png' },
];

// ── Reserved slots: dedicated puzzle icons for the newer modifiers ──────────
// The art is incoming — these load OPTIONALLY: a missing file logs a loader
// warning and the texture stays absent, and every tile then falls back to the
// modifier's own mask art (modIconKey / getIconKey check textures.exists).
// Drop the PNGs into icons/puzzle/ under these names and they light up with
// no code changes. The scarf ships ONE direction-neutral icon — tiles add the
// same orientation arrow the h/v stencils use, angled along the diagonal.
// icon-nose also has a baked fallback: Preloader zooms mod-nose-big into the
// key only when the real file didn't load (makeZoomIcon yields to it).
export const OPTIONAL_PUZZLE_ICONS: AssetDef[] = [
  { key: 'icon-scarf',  path: 'icons/puzzle/scarf.png' },
  { key: 'icon-cone',   path: 'icons/puzzle/cone.png' },
  { key: 'icon-bubble', path: 'icons/puzzle/bubble.png' },
  { key: 'icon-nose',   path: 'icons/puzzle/nose.png' },
  { key: 'icon-plate',  path: 'icons/puzzle/plate.png' },
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
  private fontsPromise: Promise<void> | null = null;

  constructor() { super('Preloader'); }

  preload() {
    this.cameras.main.setBackgroundColor(0x232323);
    this.createLoadingUI();
    this.scale.on('resize', this.onResize, this);

    // Player profile fetch runs alongside the asset stream — by the time the
    // bar fills, MainMenu's data is (usually) already cached, so its first
    // build shows the real username/sparks/equipment instead of placeholders.
    this.userDataPromise = prefetchUserData();
    // Web fonts stream in parallel too, so they're ready before any scene bakes
    // text — see fonts.ts for why an unresolved font would ship the wrong face.
    this.fontsPromise = loadGameFonts();

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
    for (const { key, path } of OPTIONAL_PUZZLE_ICONS) this.load.image(key, path);

    // Small-corner (16px) half-scale button cells — composed into the single
    // 'ui-btn-open-sm' NineSlice source in create() (no full-size downsampled
    // file ships; these pieces ARE the hand-tuned art). The full-size pnl/btn
    // piece sets are no longer loaded — the shells NineSlice the whole-image
    // textures above instead (see PixelUI).
    const slicePos = ['tl','tc','tr','ml','mc','mr','bl','bc','br'] as const;
    for (const pos of slicePos) this.load.image(`btn-open-sm-${pos}`, `ui/slices/btn-open-sm-${pos}.png`);

    // ── Sounds — only the tiny CORE UI set (~130KB) rides the boot critical
    // path, so the first tap clicks even on slow connections. The remaining
    // SFX and the 2MB music loop stream in the background once a scene is
    // interactive (audio.streamAudio, called from MainMenu/Game/LevelSelect)
    // — on a slow network the full audio set was 5x the entire art payload.
    // WAVs decode into Web Audio buffers at load, so every playSfx() starts
    // on the exact audio tick (no fetch, no decode, no head silence).
    this.load.setPath('sounds');
    for (const name of CORE_SFX) this.load.audio(`sfx-${name}`, SFX_FILES[name]);
    this.load.setPath('assets');

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

  // The nose art is a few percent of its 256×256 canvas, so scaled straight
  // into a palette tile it's an unreadable speck. Bake a zoomed, centered icon
  // once (cropped to the art's alpha bounding box) for the nose tiles to use.
  private makeZoomIcon(srcKey: string, dstKey: string) {
    if (this.textures.exists(dstKey) || !this.textures.exists(srcKey)) return;
    const src = this.textures.get(srcKey).getSourceImage() as CanvasImageSource & { width: number; height: number };
    const w = src.width, h = src.height;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return;
    cx.drawImage(src, 0, 0);
    const px = cx.getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if ((px[(y * w + x) * 4 + 3] ?? 0) > 20) {
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return;
    const pad = Math.round(Math.max(maxX - minX, maxY - minY) * 0.18);
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    const bw = maxX - minX + 1, bh = maxY - minY + 1, side = Math.max(bw, bh);
    const size = 128;
    const out = this.textures.createCanvas(dstKey, size, size);
    if (!out) return;
    const octx = out.context;
    octx.imageSmoothingEnabled = false;
    const scale = size / side;
    octx.drawImage(cv, minX, minY, bw, bh, (size - bw * scale) / 2, (size - bh * scale) / 2, bw * scale, bh * scale);
    out.refresh();
  }

  // Stitches the nine pre-downsampled 'btn-open-sm-*' cells back into one
  // 64×48 texture so the small-corner shells can be a single NineSlice (see
  // PixelUI). The pieces are exact halves of button-open.png, so compositing
  // them at their natural sizes is pixel-identical to the old piece assembly.
  private composeSmallButtonTexture() {
    if (this.textures.exists('ui-btn-open-sm') || !this.textures.exists('btn-open-sm-tl')) return;
    const piece = (pos: string) =>
      this.textures.get(`btn-open-sm-${pos}`).getSourceImage() as CanvasImageSource & { width: number; height: number };
    const tl = piece('tl'), tc = piece('tc'), ml = piece('ml');
    const x1 = tl.width, x2 = tl.width + tc.width;
    const y1 = tl.height, y2 = tl.height + ml.height;
    const out = this.textures.createCanvas('ui-btn-open-sm', x2 + piece('tr').width, y2 + piece('bl').height);
    if (!out) return;
    const ctx = out.context;
    ctx.drawImage(tl, 0, 0);          ctx.drawImage(tc, x1, 0);          ctx.drawImage(piece('tr'), x2, 0);
    ctx.drawImage(ml, 0, y1);         ctx.drawImage(piece('mc'), x1, y1); ctx.drawImage(piece('mr'), x2, y1);
    ctx.drawImage(piece('bl'), 0, y2); ctx.drawImage(piece('bc'), x1, y2); ctx.drawImage(piece('br'), x2, y2);
    out.refresh();
  }

  create() {
    this.scale.off('resize', this.onResize, this);
    this.makeZoomIcon('mod-nose-big', 'icon-nose');
    this.composeSmallButtonTexture();
    initAudio(this.game);
    const launchLevelId = getLaunchLevelId();

    // Start chewing through the curated-level build while we wait on the
    // profile/fonts below — otherwise the first scene to ask for levels
    // (a Play tap, or a deep-linked level) pays the whole build in one frame.
    warmLevelsDuringIdle(this);

    // Assets are done; give the profile fetch started in preload() a moment
    // to land so the menu opens with real data — but race it against a short
    // timeout: MainMenu refetches and patches itself anyway, so a slow server
    // (mobile + cold start) must not hold the player on this screen.
    if (this.tipText) this.tipText.setText('Waking up Splot...');
    void (async () => {
      // Hold the menu until fonts AND profile are ready, but never longer than
      // the timeout — MainMenu refetches its own data, and text falls back to
      // system fonts, so a slow CDN or cold server can't strand the loader.
      await Promise.race([
        Promise.all([
          this.fontsPromise ?? Promise.resolve(),
          this.userDataPromise ?? Promise.resolve(null),
        ]),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      // Sound prefs ride the same init fetch. If the race timed out, the
      // late-landing promise still applies them (first writer wins — a toggle
      // the player presses meanwhile takes precedence, see audio.ts).
      void this.userDataPromise?.then((init) => {
        if (init) applyStoredSettings(init.sfxEnabled, init.musicEnabled);
      });
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
