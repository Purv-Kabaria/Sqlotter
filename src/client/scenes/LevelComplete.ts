import * as Phaser from 'phaser';
import { showLoginPrompt } from '@devvit/web/client';
import { addBeigeButton, addDarkPanel, addPixelPanel, BODY_FONT, PIXEL_FONT } from '../components/PixelUI';
import { SplotMascot } from '../components/SplotMascot';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { getCachedUserData } from '../userData';
import { getCuratedLevels } from '../../shared/levelData';
import type { FirstSplatRequest, ShareCardRequest } from '../../shared/api';
import type { ModifierDef } from '../../shared/types';

const PIXELIFY = BODY_FONT;

const C = {
  BG:     0x1a0a2e,
  GREEN:  0x6dd400,
  GOLD:   0xffd700,
  TEXT:   '#ffffff',
  DIM:    '#7a8a9a',
  PANEL:  0x2d1b4e,
} as const;

type CompleteData = {
  levelId: string; title?: string; steps: number; timeMs: number; stars: number;
  sparks: number; streakDays?: number; actions?: string[]; firstSplat?: boolean;
  goalPalette?: ModifierDef[]; goalActions?: readonly string[];
  // Home-page walkthrough chain: Next runs through the first Splash Course
  // lessons, then the final lesson's button leads back home.
  walkthrough?: boolean;
};

// The walkthrough covers the first three Splash Course lessons — enough to
// know paints, repaints and the stencil trick before free play.
const WALKTHROUGH_LAST_LEVEL = 'w00-l03';

// What the Splat Card preview needs to render itself — a subset of the win
// data, plus the palette the player's own `actions` (ShareCardRequest) replay
// against to draw the solved slime.
type SplatCardVisual = { title: string; stars: number; steps: number; palette: ModifierDef[] };

export class LevelComplete extends Phaser.Scene {
  private splot: SplotMascot | null = null;
  private sparkleEvent: Phaser.Time.TimerEvent | null = null;
  // Everything here is a one-shot celebration laid out at absolute positions,
  // so a resize (rotation, window drag) restarts the scene with the same data
  // instead of making every tween relayout-aware. Debounced — resizes stream.
  private createData: CompleteData | null = null;
  private resizeTimer: Phaser.Time.TimerEvent | null = null;
  // Guards the three nav buttons — without it, clicking Next then Ranks before
  // the first fadeOut completes queues two scene.start() calls.
  private navigating = false;
  private shareBtn: Phaser.GameObjects.Container | null = null;
  private shareBusy = false;
  private shareDone = false;
  // Caption prompt shown before posting a Splat Card (DOM input overlay)
  private cardPromptLayer: Phaser.GameObjects.Container | null = null;
  private cardInput: HTMLInputElement | null = null;
  // First Splat Crown overlay state
  private crownLayer: Phaser.GameObjects.Container | null = null;
  private crownSplot: SplotMascot | null = null;
  private crownClaimBtn: Phaser.GameObjects.Container | null = null;
  private crownLaterBtn: Phaser.GameObjects.Container | null = null;
  private crownBtnRow: { claimX: number; claimW: number; laterX: number; laterW: number; y: number } | null = null;
  // World-space rect of the trophy card — the region snapshotted into the
  // PNG that gets posted. Excludes the buttons below the card.
  private crownRect: { x: number; y: number; w: number; h: number } | null = null;
  private crownBusy = false;
  private crownDone = false;

  constructor() { super('LevelComplete'); }

  init() {
    this.splot = null;
    this.sparkleEvent = null;
    this.resizeTimer = null;
    this.navigating = false;
    this.shareBtn = null;
    this.shareBusy = false;
    this.shareDone = false;
    this.cardPromptLayer = null;
    this.cardInput = null;
    this.crownLayer = null;
    this.crownSplot = null;
    this.crownClaimBtn = null;
    this.crownLaterBtn = null;
    this.crownBtnRow = null;
    this.crownRect = null;
    this.crownBusy = false;
    this.crownDone = false;
  }

  create(data: CompleteData) {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.createData = data ?? null;
    this.scale.on('resize', this.onSceneResize, this);
    const { width, height } = this.scale;
    const cx = width / 2;
    const { levelId, steps, timeMs, stars, sparks, streakDays, actions } = data ?? { levelId: '?', steps: 0, timeMs: 0, stars: 1, sparks: 10 };

    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(400, 26, 10, 46);

    // Starfield background
    for (let i = 0; i < 60; i++) {
      const x = Phaser.Math.Between(0, width);
      const y = Phaser.Math.Between(0, height);
      this.add.circle(x, y, Phaser.Math.Between(1, 3), 0xffffff, Phaser.Math.FloatBetween(0.2, 0.7));
    }

    // Panel — centered when the rows below it (~108px with the Splat Card
    // row, ~60px without) still fit; otherwise slid up toward the top edge so
    // a short landscape viewport doesn't push the nav buttons off-screen.
    // Below ~376px of height even that isn't enough — the panel itself gives
    // up height (floor 240: title 40 + stars + stats block 200 stay intact).
    const panelW = Math.min(width - 32, 380);
    const panelH = Math.max(240, Math.min(320, height - 56));
    const rowsH = Array.isArray(actions) && actions.length > 0 ? 108 : 60;
    const panelY = height / 2 + panelH / 2 + rowsH > height
      ? Math.max(panelH / 2 + 8, height - rowsH - panelH / 2)
      : height / 2;
    addPixelPanel(this, cx, panelY, panelW, panelH).setAlpha(0.95);

    // "LEVEL CLEAR!" title
    const titleTxt = this.add.text(cx, panelY - panelH / 2 + 40, 'LEVEL CLEAR!', {
      fontFamily: PIXEL_FONT,
      fontSize: '20px',
      color: '#6DD400',
      stroke: '#1a0a2e',
      strokeThickness: 5,
      letterSpacing: 2,
      shadow: { offsetX: 0, offsetY: 3, color: 'rgba(0,0,0,0.4)', blur: 0, fill: true, stroke: true },
    }).setOrigin(0.5).setAlpha(0);
    this.tweens.add({ targets: titleTxt, alpha: 1, y: panelY - panelH / 2 + 34, duration: 500, ease: 'Back.easeOut' });

    // Stars using icon-star images (pop in one by one). setDisplaySize just
    // sets scale, so tweens must target that DISPLAY scale — tweening to
    // scale 1 would blow the icon up to its native texture size.
    for (let s = 0; s < 3; s++) {
      const filled = s < stars;
      const starImg = this.add.image(cx - 40 + s * 40, panelY - panelH / 2 + 82, 'icon-star')
        .setDisplaySize(32, 32)
        .setTint(filled ? 0xFFD700 : 0x3a2560)
        .setOrigin(0.5);
      const starScale = starImg.scaleX;
      starImg.setScale(0);

      this.tweens.add({
        targets: starImg,
        scale: starScale,
        duration: 350,
        delay: 500 + s * 180,
        ease: 'Back.easeOut',
      });

      if (filled) {
        this.time.delayedCall(850 + s * 180, () => {
          this.tweens.add({ targets: starImg, scale: starScale * 1.2, duration: 100, yoyo: true });
        });
      }
    }

    // Stats — a 3-column scoreboard (icon over big value over small label)
    // instead of a flat label/value list. The old rows topped out at 10px
    // with no icon of their own; a stat block this central to the win screen
    // shouldn't read smaller than the buttons below it.
    const secs = Math.floor(timeMs / 1000);
    const timeStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    const statsY = panelY - panelH / 2 + 152;
    const statDefs: { key: string; label: string; value: string; icon: string }[] = [
      { key: 'steps',  label: 'STEPS',  value: `${steps}`,  icon: 'icon-check' },
      { key: 'time',   label: 'TIME',   value: timeStr,     icon: 'icon-timer' },
      { key: 'sparks', label: 'SPARKS', value: `+${sparks}`, icon: 'icon-spark' },
    ];
    const colGap = Math.min(118, (panelW - 40) / 3);
    statDefs.forEach((stat, i) => {
      const sx = cx + (i - 1) * colGap;
      const isSparks = stat.key === 'sparks';

      const icon = this.add.image(sx, statsY - 22, stat.icon).setDisplaySize(20, 20).setAlpha(0);
      const val = this.add.text(sx, statsY + 2, stat.value, {
        fontFamily: PIXEL_FONT,
        fontSize: '17px',
        color: isSparks ? '#B8860B' : '#3A1A08',
        // The darkgoldenrod Sparks value is close in luminance to the panel's
        // terracotta background — an outline keeps it legible without losing
        // the gold color that sets it apart from the plain stat columns.
        ...(isSparks
          ? { stroke: '#2B1400', strokeThickness: 3 }
          : { shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true } }),
      }).setOrigin(0.5).setAlpha(0);
      const lbl = this.add.text(sx, statsY + 24, stat.label, {
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
        color: '#5A3A1A',
      }).setOrigin(0.5).setAlpha(0);

      this.tweens.add({ targets: [icon, val, lbl], alpha: 1, duration: 300, delay: 900 + i * 120 });

      // The Sparks payout rolls up from 0 as it fades in, with a settle-pop —
      // earning is the win screen's headline moment, not a static caption.
      if (isSparks && sparks > 0) {
        val.setText('+0');
        const counter = { v: 0 };
        this.tweens.add({
          targets: counter, v: sparks,
          duration: 650, delay: 900 + i * 120, ease: 'Cubic.easeOut',
          onUpdate: () => val.setText(`+${Math.round(counter.v)}`),
          onComplete: () => {
            val.setText(`+${sparks}`);
            this.tweens.add({
              targets: val, scaleX: 1.25, scaleY: 1.25,
              duration: 110, yoyo: true, ease: 'Quad.easeOut',
            });
          },
        });
      }
    });
    this.playRewardBurst(cx, panelY - panelH / 2 + 90, stars);

    if (streakDays !== undefined) {
      const streakY = statsY + 46;
      const streak = this.add.text(0, streakY, `${streakDays} day streak!`, {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: '#ffb347',
        stroke: '#1a0a2e',
        strokeThickness: 3,
      }).setOrigin(0.5).setAlpha(0);
      // Center flame + text as one row, spacing the flame off the measured text
      // width so long streaks ("100 day streak!") never run under the icon.
      const flameW = 18;
      const gap = 8;
      const rowW = flameW + gap + streak.width;
      const flame = this.add.image(cx - rowW / 2 + flameW / 2, streakY + 1, 'icon-fire')
        .setDisplaySize(flameW, flameW).setAlpha(0);
      streak.setX(cx + rowW / 2 - streak.width / 2);
      // Fade-in is its own tween — riding alpha on the scale pop's yoyo faded
      // the row back OUT, leaving an orphaned flame with no text.
      this.tweens.add({ targets: [streak, flame], alpha: 1, duration: 220, delay: 1250 });
      this.tweens.add({
        targets: streak,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 220,
        yoyo: true,
        delay: 1250,
      });
    }

    // Splot mascot — only when the panel kept enough height that he doesn't
    // sit on the streak row (everything above him uses fixed top offsets, so
    // a shrunken panel eats his slot first).
    if (panelH >= 300) {
      this.splot = new SplotMascot(this, cx, panelY + panelH / 2 - 50, 80);
      this.time.delayedCall(400, () => this.splot?.playWin());
    }

    // "Splat Card" share row — a one-tap brag comment on this post. Only shown
    // when the win flow handed us the action sequence (the server re-verifies it).
    // Row offsets compress on short viewports so the nav row never clips.
    const panelBottom = panelY + panelH / 2;
    const room = height - panelBottom;
    const canShare = Array.isArray(actions) && actions.length > 0;
    // Even slid to the top, a ~390px-tall landscape window leaves under 100px
    // below the panel — not enough to stack the Splat Card row above the nav
    // row. Merge everything into one centered row there instead of clipping.
    const singleRow = canShare && room < 100;
    const shareVisual: SplatCardVisual = { title: data?.title ?? '', stars, steps, palette: data?.goalPalette ?? [] };

    let btnW  = Math.min((panelW - 24) / 3, 110);
    let navCx = cx;
    const btnY = singleRow
      ? panelBottom + room / 2
      : Math.min(panelBottom + (canShare ? Math.min(98, room * 0.68) : 50), height - 26);

    if (canShare) {
      if (singleRow) {
        const shareW = 132;
        btnW = Math.min(btnW, (width - 40 - shareW - 24) / 3);
        const rowW = shareW + 8 + btnW * 3 + 16;
        this.buildShareButton(cx - rowW / 2 + shareW / 2, btnY, shareW,
          { levelId, timeMs, actions }, shareVisual);
        navCx = cx + rowW / 2 - (btnW * 3 + 16) / 2;
      } else {
        this.buildShareButton(cx, panelBottom + Math.min(44, room * 0.30), Math.min(panelW - 24, 250),
          { levelId, timeMs, actions }, shareVisual);
      }
    }

    // Nav buttons — three in a row
    const btnGap = btnW + 8;

    const nextId = this.getNextLevelId(levelId);
    const hasNext = nextId !== null;

    // Row order: Levels (back out) on the LEFT, Ranks center, and the
    // forward action — Next / Ready! / All Done! — on the RIGHT, where a
    // "continue" button is expected to live.
    this.buildBtn(navCx - btnGap, btnY, btnW, 44, 'Levels', 'icon-play', () => {
      this.goToScene('LevelSelect');
    });
    this.buildBtn(navCx, btnY, btnW, 44, 'Ranks', 'icon-trophy', () => {
      this.goToScene('Leaderboard', { levelId });
    });

    // Walkthrough chain: lessons 1-2 lead into the next lesson (still in
    // walkthrough mode); finishing the last one graduates back home.
    const walkDone = data?.walkthrough === true && (levelId === WALKTHROUGH_LAST_LEVEL || !hasNext);
    if (data?.walkthrough === true && !walkDone) {
      this.buildBtn(navCx + btnGap, btnY, btnW, 44, 'Next', 'icon-arrow', () => {
        this.goToScene('Game', { levelId: nextId, walkthrough: true });
      });
    } else if (walkDone) {
      this.buildBtn(navCx + btnGap, btnY, btnW, 44, 'Ready!', 'icon-home', () => {
        this.goToScene('MainMenu');
      });
    } else {
      this.buildBtn(navCx + btnGap, btnY, btnW, 44, hasNext ? 'Next' : 'All Done!', hasNext ? 'icon-arrow' : 'icon-home', () => {
        this.goToScene(hasNext ? 'Game' : 'LevelSelect', hasNext ? { levelId: nextId } : undefined);
      });
    }

    // First Splat Crown — the server says this player holds the level's
    // first-solve record and the crown comment hasn't been posted yet. Let
    // the win stats land first, then take over with the claimable trophy.
    const goalPalette = data?.goalPalette;
    const goalActions = data?.goalActions;
    if (data?.firstSplat === true && goalPalette && goalActions) {
      const crownInfo = { levelId, goalPalette, goalActions, title: data.title ?? '', steps, timeMs };
      this.time.delayedCall(1700, () => {
        if (!this.navigating && this.sys.isActive()) this.buildCrownOverlay(crownInfo);
      });
    }

    // Floating sparks — tween to the display scale, not native scale 1
    this.sparkleEvent = this.time.addEvent({
      delay: 300,
      repeat: 12,
      callback: () => {
        const px = Phaser.Math.Between(cx - 120, cx + 120);
        const py = Phaser.Math.Between(panelY - 80, panelY + 80);
        const s = this.add.image(px, py, 'icon-sparkle')
          .setDisplaySize(14, 14).setAlpha(0).setTint(C.GOLD).setDepth(20);
        this.tweens.add({
          targets: s, alpha: 1, y: py - 50, scale: s.scaleX * 1.4,
          duration: 600, yoyo: true, onComplete: () => s.destroy(),
        });
      },
    });
  }

  // Centralizes every scene.start(...) call — guards against double-clicking
  // one of the three nav buttons, or clicking two of them in quick succession.
  private goToScene(key: string, data?: Record<string, unknown>) {
    if (this.navigating) return;
    this.navigating = true;
    this.cameras.main.fadeOut(250, 26, 10, 46);
    this.time.delayedCall(260, () => this.scene.start(key, data));
  }

  private onSceneResize() {
    this.resizeTimer?.destroy();
    this.resizeTimer = this.time.delayedCall(250, () => {
      if (!this.navigating && this.createData) this.scene.restart(this.createData);
    });
  }

  shutdown() {
    this.navigating = true;
    this.scale.off('resize', this.onSceneResize, this);
    this.cardInput?.remove();
    this.cardInput = null;
    this.splot?.stopIdleAnims();
    this.crownSplot?.stopIdleAnims();
    this.sparkleEvent?.destroy();
    this.tweens.killAll();
    this.time.removeAllEvents();
  }

  private buildBtn(x: number, y: number, w: number, h: number, label: string, iconKey: string, cb: () => void) {
    addBeigeButton(this, {
      x,
      y,
      width: w,
      height: h,
      label,
      iconKey,
      fontSize: Math.max(12, Math.round(h * 0.28)),
      fontFamily: PIXELIFY,
      onClick: cb,
    });
  }

  // ── Splat Card sharing ────────────────────────────────────────────────────
  private buildShareButton(
    x: number, y: number, w: number, payload: ShareCardRequest, visual: SplatCardVisual,
  ) {
    this.shareBtn = addBeigeButton(this, {
      x, y, width: w, height: 44,
      label: 'Splat Card', iconKey: 'icon-share',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => this.showCardPrompt(payload, x, y, w, visual),
    });

    // Entrance pop after the stats settle, then a golden shimmer to draw the eye
    this.shareBtn.setAlpha(0).setScale(0.9);
    this.tweens.add({
      targets: this.shareBtn, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 320, delay: 1200, ease: 'Back.easeOut',
    });
    this.time.delayedCall(1550, () => this.playShareSparkles(x, y, w));
  }

  private playShareSparkles(x: number, y: number, w: number, depth = 25) {
    for (let i = 0; i < 6; i++) {
      const px = x + Phaser.Math.Between(-w / 2, w / 2);
      const s = this.add.image(px, y + Phaser.Math.Between(-16, 16), 'icon-sparkle')
        .setDisplaySize(12, 12).setTint(C.GOLD).setDepth(depth).setAlpha(0);
      this.tweens.add({
        targets: s, alpha: 0.9, y: s.y - 22, scale: s.scaleX * 1.3,
        duration: 480, delay: i * 70, yoyo: true, ease: 'Quad.easeOut',
        onComplete: () => s.destroy(),
      });
    }
  }

  // Caption prompt: shows a live preview of the actual card that gets posted
  // (title/stars/solved slime/stats), with a DOM <input> overlay below it for
  // the optional caption (same pattern as the Editor's title field, so the
  // mobile keyboard works) — typing echoes into a Phaser text line inside the
  // card so the caption is part of what gets snapshotted and posted.
  private showCardPrompt(payload: ShareCardRequest, x: number, y: number, w: number, visual: SplatCardVisual) {
    if (this.cardPromptLayer || this.shareBusy || this.shareDone || this.navigating) return;
    const { width, height } = this.scale;
    const cx = width / 2;

    const cardW = Math.min(width - 48, 300);
    const cardH = 262;
    const cardY = Math.max(cardH / 2 + 16, height / 2 - 42);

    const layer = this.add.container(0, 0).setDepth(70);
    this.cardPromptLayer = layer;

    const dim = this.add.rectangle(cx, height / 2, width, height, 0x000000, 0.6).setInteractive();
    dim.on('pointerup', () => this.closeCardPrompt());
    layer.add(dim);

    // The card itself — everything inside this container lands in the PNG.
    const card = this.add.container(cx, cardY);
    // Opaque backing so the snapshot has no see-through panel corners
    // (addPixelPanel's source art isn't a solid rect outside its rounded face).
    card.add(this.add.rectangle(0, 0, cardW - 8, cardH - 8, C.BG));
    card.add(addPixelPanel(this, 0, 0, cardW, cardH));

    const heading = this.add.text(0, -cardH / 2 + 22, 'SPLAT CARD', {
      fontFamily: PIXEL_FONT, fontSize: '14px', color: '#FFD700',
      stroke: '#1a0a2e', strokeThickness: 4,
    }).setOrigin(0.5);
    const iconL = this.add.image(-heading.width / 2 - 18, -cardH / 2 + 22, 'icon-paint').setDisplaySize(20, 20);
    const iconR = this.add.image(heading.width / 2 + 18, -cardH / 2 + 22, 'icon-paint').setDisplaySize(20, 20);
    card.add([heading, iconL, iconR]);

    const levelName = visual.title.length > 24 ? `${visual.title.slice(0, 23)}...` : visual.title;
    if (levelName) {
      card.add(this.add.text(0, -cardH / 2 + 43, `"${levelName}"`, {
        fontFamily: PIXEL_FONT, fontSize: '11px', color: '#241C33',
      }).setOrigin(0.5));
    }

    for (let s = 0; s < 3; s++) {
      card.add(this.add.image(-26 + s * 26, -cardH / 2 + 64, 'icon-star')
        .setDisplaySize(18, 18).setTint(s < visual.stars ? 0xFFD700 : 0x8a6a52));
    }

    const slimeSz = 60;
    const slime = new SlimeRenderer(this, 0, -cardH / 2 + 64 + 12 + slimeSz / 2, slimeSz);
    slime.setPattern(visual.palette, payload.actions);
    card.add(slime.container);

    const secs = Math.floor(payload.timeMs / 1000);
    const timeStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    const statY = cardH / 2 - 60;
    const statLabel = `${visual.steps} ${visual.steps === 1 ? 'move' : 'moves'} · ${timeStr}`;
    const statTxt = this.add.text(0, statY, statLabel, {
      fontFamily: PIXEL_FONT, fontSize: '11px', color: '#2B1400',
    }).setOrigin(0, 0.5);
    const statIconSz = 13, statGap = 6;
    const statGroupW = statIconSz + statGap + statTxt.width;
    const statIcon = this.add.image(-statGroupW / 2 + statIconSz / 2, statY, 'icon-timer')
      .setDisplaySize(statIconSz, statIconSz);
    statTxt.setX(-statGroupW / 2 + statIconSz + statGap);
    card.add([statIcon, statTxt]);

    // Live caption echo — hidden until the player types something, so an
    // uncaptioned card doesn't leave an empty quote line. Anchored top-down
    // (not centered) so a wrapped 2-line caption grows toward the brand strip
    // instead of away from the stats line above it.
    const captionText = this.add.text(0, cardH / 2 - 42, '', {
      fontFamily: PIXELIFY, fontSize: '10px', color: '#2B1400', fontStyle: 'italic',
      align: 'center', wordWrap: { width: cardW - 44 },
    }).setOrigin(0.5, 0).setVisible(false);
    card.add(captionText);

    const brand = this.add.text(0, cardH / 2 - 10, 'SQLOTTER · SPLAT CARD', {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: '#2B1400',
    }).setOrigin(0.5);
    const sparkL = this.add.image(-brand.width / 2 - 12, cardH / 2 - 10, 'icon-spark').setDisplaySize(10, 10);
    const sparkR = this.add.image(brand.width / 2 + 12, cardH / 2 - 10, 'icon-spark').setDisplaySize(10, 10);
    card.add([brand, sparkL, sparkR]);

    layer.add(card);
    const cardRect = { x: cx - cardW / 2, y: cardY - cardH / 2, w: cardW, h: cardH };

    // Caption input + Post button live below the card, outside the snapshot rect.
    const labelY = cardY + cardH / 2 + 18;
    layer.add(this.add.text(cx, labelY, 'Caption (optional):', {
      fontFamily: PIXELIFY, fontSize: '12px', color: '#DEC998',
      shadow: { offsetX: 1, offsetY: 1, color: '#000000', blur: 0, fill: true },
    }).setOrigin(0.5));

    const inputY = labelY + 22;
    this.cardInput = this.createCardInput(cx, inputY, Math.min(cardW, width - 64));
    this.cardInput.addEventListener('input', () => {
      const v = (this.cardInput?.value ?? '').trim();
      captionText.setText(v ? `"${v}"` : '').setVisible(v.length > 0);
    });

    layer.add(addBeigeButton(this, {
      x: cx, y: inputY + 42, width: Math.min(cardW - 40, 200), height: 44,
      label: 'Post It!', iconKey: 'icon-share',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => {
        const caption = (this.cardInput?.value ?? '').trim();
        void this.postSplatCard(caption ? { ...payload, cardTitle: caption } : payload, x, y, w, cardRect);
      },
    }));

    layer.setAlpha(0);
    this.tweens.add({ targets: layer, alpha: 1, duration: 160 });
  }

  private closeCardPrompt() {
    this.cardInput?.remove();
    this.cardInput = null;
    const layer = this.cardPromptLayer;
    this.cardPromptLayer = null;
    if (layer) {
      this.tweens.add({ targets: layer, alpha: 0, duration: 120, onComplete: () => layer.destroy(true) });
    }
  }

  private createCardInput(cx: number, cy: number, w: number): HTMLInputElement {
    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = 'e.g. Nailed it first try!';
    input.maxLength   = 60;

    // Phaser also listens for mouse/pointer events on the window (to catch
    // releases outside the canvas), so a tap on this input would still hit
    // the dim overlay underneath and close the prompt. Keep them to ourselves.
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend']) {
      input.addEventListener(ev, (e) => e.stopPropagation());
    }

    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx     = rect.width  / this.scale.width;
    const sy     = rect.height / this.scale.height;

    Object.assign(input.style, {
      position:     'fixed',
      padding:      '0 8px',
      boxSizing:    'border-box',
      background:   '#FFF6DF',
      color:        '#3A1A08',
      border:       '2px solid #7A4A20',
      borderRadius: '6px',
      outline:      'none',
      zIndex:       '100',
      fontFamily:   'Arial, sans-serif',
      left:         `${rect.left + (cx - w / 2) * sx}px`,
      top:          `${rect.top  + (cy - 16) * sy}px`,
      width:        `${w * sx}px`,
      height:       `${32 * sy}px`,
      fontSize:     `${14 * Math.min(sx, sy)}px`,
    });

    (canvas.parentElement ?? document.body).appendChild(input);
    return input;
  }

  private async postSplatCard(
    payload: ShareCardRequest, x: number, y: number, w: number,
    cardRect: { x: number; y: number; w: number; h: number },
  ) {
    if (this.shareBusy || this.shareDone || this.navigating) return;
    this.shareBusy = true;
    this.shareBtn?.setAlpha(0.6);
    // Snapshot + upload can take seconds — acknowledge the tap immediately.
    this.showToast('Posting your Splat Card…', '#DEC998');

    // Snapshot the card preview while it's still on screen — best-effort,
    // same as the crown flow: a null result still posts, just as plain text.
    let imageDataUrl: string | undefined;
    const src = await this.snapshotCard(cardRect.x, cardRect.y, cardRect.w, cardRect.h);
    // Stay under the server's 1.5M-char cap with margin to spare
    if (src !== null && src.length <= 1_400_000) imageDataUrl = src;
    if (!this.sys.isActive() || this.navigating) { this.shareBusy = false; return; }
    this.closeCardPrompt();

    const body: ShareCardRequest = imageDataUrl ? { ...payload, imageDataUrl } : payload;

    let status = 0;
    try {
      const res = await fetch('/api/share/card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
      status = res.status;
    } catch { /* network failure → generic retry toast below */ }

    this.shareBusy = false;
    // The player may have navigated away while the request was in flight
    if (!this.sys.isActive() || this.navigating) return;

    if (status === 200) {
      this.markShared(x, y, w);
      this.showToast('Splat Card posted to comments!', '#6DD400');
      this.splot?.playWin();
    } else if (status === 401) {
      this.shareBtn?.setAlpha(1);
      this.showToast('Log in to drop a Splat Card!', '#ffb347');
      try { showLoginPrompt(); } catch { /* not running inside Reddit */ }
    } else if (status === 409) {
      // Already carded this level (e.g. a replay) — reflect it, don't error
      this.markShared(x, y, w);
      this.showToast('Your card is already on this post!', '#ffb347');
    } else if (status === 429) {
      this.shareBtn?.setAlpha(1);
      this.showToast('Easy there, try again in a moment!', '#ffb347');
    } else {
      this.shareBtn?.setAlpha(1);
      this.showToast('Could not post, try again!', '#ff6b6b');
    }
  }

  private markShared(x: number, y: number, w: number) {
    this.shareDone = true;
    this.shareBtn?.destroy();
    this.shareBtn = addBeigeButton(this, {
      x, y, width: w, height: 44,
      label: 'Posted!', iconKey: 'icon-check', disabled: true,
      fontSize: 13, fontFamily: PIXELIFY,
    });
    this.playShareSparkles(x, y, w);
  }

  // ── First Splat Crown ─────────────────────────────────────────────────────
  // The first-ever solver of a daily/UGC level gets a claimable trophy card:
  // Splot (in the player's own cosmetics, crowned for the occasion) presenting
  // the solved slime. Claiming snapshots the card into a PNG and posts it to
  // the comments — the server re-verifies who holds the first-solve record.
  private buildCrownOverlay(info: { levelId: string; goalPalette: ModifierDef[]; goalActions: readonly string[]; title: string; steps: number; timeMs: number }) {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cardW = Math.min(width - 40, 340);
    const cardH = 292;
    const cardY = Math.max(cardH / 2 + 16, height / 2 - 42);

    const layer = this.add.container(0, 0).setDepth(60);
    this.crownLayer = layer;

    // Input-blocking dim — with Phaser's default topOnly input, nothing
    // beneath the overlay receives taps while it is up.
    const dim = this.add.rectangle(cx, height / 2, width, height, 0x000000, 0.68)
      .setAlpha(0).setInteractive();
    this.tweens.add({ targets: dim, alpha: 1, duration: 280 });
    layer.add(dim);

    // The card itself — everything inside this container lands in the PNG.
    const card = this.add.container(cx, cardY);
    // Opaque backing so the snapshot has no see-through panel corners
    card.add(this.add.rectangle(0, 0, cardW - 8, cardH - 8, C.BG));
    card.add(addPixelPanel(this, 0, 0, cardW, cardH));

    const heading = this.add.text(0, -cardH / 2 + 36, 'FIRST SPLAT!', {
      fontFamily: PIXEL_FONT, fontSize: '14px', color: '#FFD700',
      stroke: '#1a0a2e', strokeThickness: 4,
    }).setOrigin(0.5);
    const trophyL = this.add.image(-heading.width / 2 - 24, -cardH / 2 + 36, 'icon-trophy').setDisplaySize(22, 22);
    const trophyR = this.add.image(heading.width / 2 + 24, -cardH / 2 + 36, 'icon-trophy').setDisplaySize(22, 22);
    card.add([heading, trophyL, trophyR]);

    // Level title, hard-capped to one line (UGC titles run up to 60 chars)
    const levelName = info.title.length > 24 ? `${info.title.slice(0, 23)}...` : info.title;
    // '#c9b8e8' was a light lavender tuned for a dark backdrop; the card's
    // actual panel (addPixelPanel) is a warm terracotta, so darken while
    // keeping the purple hue rather than switching to a brown/gold already
    // used elsewhere on this card. Reaches ~5.9:1 against the terracotta —
    // this card is the exact image the scene exports and posts to Reddit.
    card.add(this.add.text(0, -cardH / 2 + 62, `"${levelName}"`, {
      fontFamily: PIXEL_FONT, fontSize: '11px', color: '#241C33',
    }).setOrigin(0.5));

    // Splot presents the solved slime
    const equipped = { ...(getCachedUserData()?.equippedItems ?? {}), accessory: 'acc-crown' };
    this.crownSplot = new SplotMascot(this, -74, 10, 92, equipped);
    this.crownSplot.setExpression('excited');
    card.add(this.crownSplot.container);

    const slime = new SlimeRenderer(this, 72, 6, 82);
    slime.setPattern(info.goalPalette, info.goalActions);
    card.add(slime.container);

    // Credit + run stats
    const username = getCachedUserData()?.username ?? '';
    const nameLabel = username ? `u/${username}` : 'First solver!';
    card.add(this.add.text(0, cardH / 2 - 82, nameLabel, {
      fontFamily: PIXEL_FONT, fontSize: nameLabel.length > 16 ? '9px' : '11px', color: '#FFD700',
      stroke: '#1a0a2e', strokeThickness: 3,
    }).setOrigin(0.5));

    const secs = Math.floor(info.timeMs / 1000);
    const timeStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    // C.DIM ('#7a8a9a') and the branding strip's original '#9a8a5a' were both
    // tuned for a near-black background — against this card's terracotta
    // panel (addPixelPanel) they sat at ~1.2:1 contrast, invisible on the
    // very image this scene exports and posts to Reddit. '#2B1400' (already
    // used as the Sparks stroke on the main win panel) reaches ~6.3:1 here.
    const crownStatY = cardH / 2 - 60;
    const crownStatLabel = `${info.steps} ${info.steps === 1 ? 'move' : 'moves'} · ${timeStr}`;
    const crownStatTxt = this.add.text(0, crownStatY, crownStatLabel, {
      fontFamily: PIXEL_FONT, fontSize: '11px', color: '#2B1400',
    }).setOrigin(0, 0.5);
    const crownStatIconSz = 13, crownStatGap = 6;
    const crownStatGroupW = crownStatIconSz + crownStatGap + crownStatTxt.width;
    const crownStatIcon = this.add.image(-crownStatGroupW / 2 + crownStatIconSz / 2, crownStatY, 'icon-timer')
      .setDisplaySize(crownStatIconSz, crownStatIconSz);
    crownStatTxt.setX(-crownStatGroupW / 2 + crownStatIconSz + crownStatGap);
    card.add([crownStatIcon, crownStatTxt]);

    // Branding strip — this card IS the shared image, so sign it
    const brand = this.add.text(0, cardH / 2 - 26, 'SQLOTTER · FIRST SPLAT CROWN', {
      fontFamily: PIXEL_FONT, fontSize: '9px', color: '#2B1400',
    }).setOrigin(0.5);
    const sparkL = this.add.image(-brand.width / 2 - 14, cardH / 2 - 26, 'icon-spark').setDisplaySize(12, 12);
    const sparkR = this.add.image(brand.width / 2 + 14, cardH / 2 - 26, 'icon-spark').setDisplaySize(12, 12);
    card.add([brand, sparkL, sparkR]);

    layer.add(card);
    this.crownRect = { x: cx - cardW / 2, y: cardY - cardH / 2, w: cardW, h: cardH };

    // Buttons live below the card, outside the snapshot rect
    const btnY = cardY + cardH / 2 + 34;
    const laterW = 96;
    const claimW = Math.min(cardW - laterW - 26, 186);
    const rowW = claimW + 8 + laterW;
    const claimX = cx - rowW / 2 + claimW / 2;
    const laterX = cx + rowW / 2 - laterW / 2;
    this.crownBtnRow = { claimX, claimW, laterX, laterW, y: btnY };

    this.crownClaimBtn = addBeigeButton(this, {
      x: claimX, y: btnY, width: claimW, height: 44,
      // Full label + icon collide inside the button below ~170px
      label: claimW < 170 ? 'Claim' : 'Claim Crown', iconKey: 'icon-trophy',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => { void this.claimCrown(info.levelId); },
    });
    this.crownLaterBtn = addBeigeButton(this, {
      x: laterX, y: btnY, width: laterW, height: 44,
      label: 'Later', fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => this.dismissCrownOverlay(),
    });
    layer.add([this.crownClaimBtn, this.crownLaterBtn]);

    // Entrance: pop the card in, then a golden shimmer across the heading
    card.setAlpha(0).setScale(0.75);
    this.tweens.add({
      targets: card, alpha: 1, scaleX: 1, scaleY: 1,
      duration: 420, delay: 120, ease: 'Back.easeOut',
    });
    this.time.delayedCall(620, () => {
      if (this.crownLayer) this.playShareSparkles(cx, cardY - cardH / 2 + 36, cardW - 90, 62);
    });
  }

  private async claimCrown(levelId: string) {
    if (this.crownBusy || this.crownDone || this.navigating || !this.crownLayer) return;
    this.crownBusy = true;
    this.crownClaimBtn?.setAlpha(0.6);
    // The claim round-trips Reddit's media upload (up to ~15s) — acknowledge
    // the tap immediately so the dimmed button doesn't read as a freeze.
    this.showToast('Claiming your crown…', '#FFD700');

    // Snapshot the settled card into a PNG data URI. Best-effort: a null
    // result still posts the crown, just as a text comment.
    let imageDataUrl: string | undefined;
    const rect = this.crownRect;
    if (rect) {
      const src = await this.snapshotCard(rect.x, rect.y, rect.w, rect.h);
      // Stay under the server's 1.5M-char cap with margin to spare
      if (src !== null && src.length <= 1_400_000) imageDataUrl = src;
    }
    if (!this.sys.isActive() || this.navigating) return;

    let status = 0;
    try {
      const body: FirstSplatRequest = imageDataUrl !== undefined ? { levelId, imageDataUrl } : { levelId };
      const res = await fetch('/api/share/first-splat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Generous timeout — the server round-trips Reddit's media upload
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      status = res.status;
    } catch { /* network failure → generic retry toast below */ }

    this.crownBusy = false;
    if (!this.sys.isActive() || this.navigating || !this.crownLayer) return;

    if (status === 200) {
      this.markCrowned();
      this.showToast('Crown posted to comments!', '#FFD700');
      this.crownSplot?.playWin();
    } else if (status === 401) {
      this.crownClaimBtn?.setAlpha(1);
      this.showToast('Log in to claim your crown!', '#ffb347');
      try { showLoginPrompt(); } catch { /* not running inside Reddit */ }
    } else if (status === 409) {
      // Already posted (e.g. this player in another session) — reflect it
      this.markCrowned();
      this.showToast('This crown is already on the post!', '#ffb347');
    } else if (status === 403) {
      // Server disagrees that we hold the record — don't invite retries
      this.crownDone = true;
      this.showToast('Only the first solver can claim this!', '#ff6b6b');
    } else if (status === 429) {
      this.crownClaimBtn?.setAlpha(1);
      this.showToast('Easy there, try again in a moment!', '#ffb347');
    } else {
      this.crownClaimBtn?.setAlpha(1);
      this.showToast('Could not post, try again!', '#ff6b6b');
    }
  }

  private markCrowned() {
    this.crownDone = true;
    const row = this.crownBtnRow;
    const layer = this.crownLayer;
    if (!row || !layer) return;
    this.crownClaimBtn?.destroy();
    this.crownLaterBtn?.destroy();
    this.crownClaimBtn = addBeigeButton(this, {
      x: row.claimX, y: row.y, width: row.claimW, height: 44,
      label: 'Crowned!', iconKey: 'icon-check', disabled: true,
      fontSize: 13, fontFamily: PIXELIFY,
    });
    this.crownLaterBtn = addBeigeButton(this, {
      x: row.laterX, y: row.y, width: row.laterW, height: 44,
      label: 'Close', fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => this.dismissCrownOverlay(),
    });
    layer.add([this.crownClaimBtn, this.crownLaterBtn]);
    this.playShareSparkles(row.claimX, row.y, row.claimW, 62);
  }

  private dismissCrownOverlay() {
    if (this.crownBusy) return; // let an in-flight claim settle first
    const layer = this.crownLayer;
    if (!layer) return;
    this.crownLayer = null;
    this.crownRect = null;
    this.crownBtnRow = null;
    this.crownSplot?.stopIdleAnims();
    this.crownSplot = null;
    this.tweens.add({
      targets: layer, alpha: 0, duration: 220, ease: 'Quad.easeIn',
      onComplete: () => layer.destroy(),
    });
  }

  // Resolves to a PNG data URI of the given world-space rect, or null. In
  // RESIZE mode with no zoom/resolution scaling, world pixels map 1:1 onto
  // canvas pixels, so the rect passes straight through to the renderer.
  private snapshotCard(x: number, y: number, w: number, h: number): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (!settled) { settled = true; resolve(value); }
      };
      try {
        this.game.renderer.snapshotArea(Math.round(x), Math.round(y), Math.round(w), Math.round(h), (snap) => {
          finish(snap instanceof HTMLImageElement && snap.src.startsWith('data:image/png;base64,') ? snap.src : null);
        });
      } catch {
        finish(null);
      }
      // Snapshots deliver on the next rendered frame — bail if one never comes
      this.time.delayedCall(2000, () => finish(null));
    });
  }

  private showToast(msg: string, color: string) {
    const { width, height } = this.scale;
    const txt = this.add.text(0, 0, msg, {
      fontFamily: PIXEL_FONT, fontSize: '9px', color,
    }).setOrigin(0.5);
    const bg = addDarkPanel(this, 0, 0, Math.ceil(txt.width) + 28, 34);
    // Depth 70: toasts must stay readable above the crown overlay's dim (60).
    const toast = this.add.container(width / 2, height - 26, [bg, txt])
      .setDepth(70).setAlpha(0);
    this.tweens.add({ targets: toast, alpha: 1, y: height - 34, duration: 200 });
    this.time.delayedCall(2200, () => {
      if (!toast.scene) return; // scene already shut down
      this.tweens.add({ targets: toast, alpha: 0, duration: 300, onComplete: () => toast.destroy(true) });
    });
  }

  private playRewardBurst(cx: number, cy: number, stars: number) {
    const count = 10 + stars * 4;
    for (let i = 0; i < count; i++) {
      const useSpark = i % 3 === 0;
      const particle = useSpark
        ? this.add.image(cx, cy, 'icon-spark').setDisplaySize(14, 14)
        : this.add.image(cx, cy, 'icon-sparkle').setDisplaySize(12, 12);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.Between(42, 130);
      particle.setDepth(22).setTint(useSpark ? C.GOLD : 0xffffff).setAlpha(0);
      this.tweens.add({
        targets: particle,
        alpha: { from: 0, to: 1 },
        x: cx + Math.cos(angle) * distance,
        y: cy + Math.sin(angle) * distance,
        scaleX: particle.scaleX * 1.35,
        scaleY: particle.scaleY * 1.35,
        angle: Phaser.Math.Between(-120, 120),
        duration: 520,
        delay: 480 + i * 18,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.tweens.add({
            targets: particle,
            alpha: 0,
            y: particle.y - 18,
            duration: 220,
            onComplete: () => particle.destroy(),
          });
        },
      });
    }
  }

  private getNextLevelId(currentId: string): string | null {
    const curated = getCuratedLevels();
    const idx = curated.findIndex(l => l.id === currentId);
    if (idx < 0 || idx >= curated.length - 1) return null;
    return curated[idx + 1]?.id ?? null;
  }
}
