import * as Phaser from 'phaser';
import { showLoginPrompt } from '@devvit/web/client';
import { addBeigeButton, addBeigeButtonShell, addDarkPanel, addPixelPanel, PIXEL_FONT } from '../components/PixelUI';
import { SplotMascot } from '../components/SplotMascot';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { getCachedUserData } from '../userData';
import { getCuratedLevels } from '../../shared/levelData';
import type { FirstSplatRequest, ShareCardRequest } from '../../shared/api';
import type { ModifierDef } from '../../shared/types';

const PIXELIFY = '"Pixelify Sans", sans-serif';

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
};

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

    // Panel
    const panelW = Math.min(width - 32, 380);
    const panelH = 320;
    const panelY = height / 2;
    addPixelPanel(this, cx, panelY, panelW, panelH).setAlpha(0.95);

    // "LEVEL CLEAR!" title
    const titleTxt = this.add.text(cx, panelY - panelH / 2 + 40, 'LEVEL CLEAR!', {
      fontFamily: PIXEL_FONT,
      fontSize: '16px',
      color: '#6DD400',
      stroke: '#1a0a2e',
      strokeThickness: 4,
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

    // Stats
    const secs = Math.floor(timeMs / 1000);
    const timeStr = `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
    const statsY = panelY - panelH / 2 + 145;
    const statItems: [string, string][] = [
      ['Steps', `${steps}`],
      ['Time', timeStr],
      ['Sparks', `+${sparks}`],
    ];
    statItems.forEach(([label, value], i) => {
      const sy = statsY + i * 32;

      const lbl = this.add.text(cx - panelW / 2 + 30, sy, label, {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: '#4A2A10',
      }).setAlpha(0);
      const val = this.add.text(cx + panelW / 2 - 30, sy, value, {
        fontFamily: PIXEL_FONT,
        fontSize: '10px',
        color: label === 'Sparks' ? '#B8860B' : '#3A1A08',
        // The darkgoldenrod Sparks value is close in luminance to the panel's
        // terracotta background — an outline keeps it legible without losing
        // the gold color that sets it apart from the plain stat rows.
        ...(label === 'Sparks' ? { stroke: '#2B1400', strokeThickness: 2 } : {}),
      }).setOrigin(1, 0).setAlpha(0);

      if (label === 'Sparks') {
        const sparkIcon = this.add.image(cx + panelW / 2 - 14, sy + 5, 'icon-spark')
          .setDisplaySize(14, 14).setAlpha(0);
        this.tweens.add({ targets: sparkIcon, alpha: 1, duration: 300, delay: 900 + i * 100 });
      }

      this.tweens.add({ targets: [lbl, val], alpha: 1, duration: 300, delay: 900 + i * 100 });
    });
    this.playRewardBurst(cx, panelY - panelH / 2 + 90, stars);

    if (streakDays !== undefined) {
      const streakY = statsY + statItems.length * 32 + 4;
      this.add.image(cx - 72, streakY + 7, 'icon-fire').setDisplaySize(16, 16);
      const streak = this.add.text(cx + 4, streakY, `${streakDays} day streak!`, {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: '#ffb347',
        stroke: '#1a0a2e',
        strokeThickness: 3,
      }).setOrigin(0.5).setAlpha(0);
      this.tweens.add({
        targets: streak,
        alpha: 1,
        scaleX: 1.06,
        scaleY: 1.06,
        duration: 220,
        yoyo: true,
        delay: 1250,
      });
    }

    // Splot mascot
    this.splot = new SplotMascot(this, cx, panelY + panelH / 2 - 50, 80);
    this.time.delayedCall(400, () => this.splot?.playWin());

    // "Splat Card" share row — a one-tap brag comment on this post. Only shown
    // when the win flow handed us the action sequence (the server re-verifies it).
    // Row offsets compress on short viewports so the nav row never clips.
    const panelBottom = panelY + panelH / 2;
    const room = height - panelBottom;
    const canShare = Array.isArray(actions) && actions.length > 0;
    if (canShare) {
      this.buildShareButton(cx, panelBottom + Math.min(44, room * 0.30), Math.min(panelW - 24, 250),
        { levelId, timeMs, actions });
    }

    // Buttons — three in a row
    const btnY  = panelBottom + (canShare ? Math.min(98, room * 0.68) : 50);
    const btnW  = Math.min((panelW - 24) / 3, 110);
    const btnGap = btnW + 8;

    const nextId = this.getNextLevelId(levelId);
    const hasNext = nextId !== null;

    this.buildBtn(cx - btnGap, btnY, btnW, 44, hasNext ? 'Next' : 'All Done!', () => {
      this.goToScene(hasNext ? 'Game' : 'LevelSelect', hasNext ? { levelId: nextId } : undefined);
    });
    this.buildBtn(cx, btnY, btnW, 44, 'Ranks', () => {
      this.goToScene('Leaderboard', { levelId });
    });
    this.buildBtn(cx + btnGap, btnY, btnW, 44, 'Levels', () => {
      this.goToScene('LevelSelect');
    });

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

  private buildBtn(x: number, y: number, w: number, h: number, label: string, cb: () => void) {
    addBeigeButton(this, {
      x,
      y,
      width: w,
      height: h,
      label,
      fontSize: Math.max(12, Math.round(h * 0.28)),
      fontFamily: PIXELIFY,
      onClick: cb,
    });
  }

  // ── Splat Card sharing ────────────────────────────────────────────────────
  private buildShareButton(x: number, y: number, w: number, payload: ShareCardRequest) {
    this.shareBtn = addBeigeButton(this, {
      x, y, width: w, height: 44,
      label: 'Splat Card', iconKey: 'icon-share',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => this.showCardPrompt(payload, x, y, w),
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

  // Caption prompt: the player can title their card before it posts. DOM
  // <input> overlay (same pattern as the Editor's title field) so the mobile
  // keyboard works; posting with it empty is fine — the caption is optional.
  private showCardPrompt(payload: ShareCardRequest, x: number, y: number, w: number) {
    if (this.cardPromptLayer || this.shareBusy || this.shareDone || this.navigating) return;
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const popW = Math.min(width - 40, 320);
    const popH = 196;

    const layer = this.add.container(0, 0).setDepth(70);
    this.cardPromptLayer = layer;

    const dim = this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive();
    dim.on('pointerup', () => this.closeCardPrompt());
    layer.add(dim);

    layer.add(addBeigeButtonShell(this, cx, cy, popW, popH, false).container);
    layer.add(this.add.text(cx, cy - popH / 2 + 30, 'Drop a Splat Card', {
      fontFamily: PIXEL_FONT, fontSize: '11px', color: '#3A1A08',
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5));
    layer.add(this.add.text(cx, cy - popH / 2 + 56, 'Add your own caption (optional):', {
      fontFamily: PIXELIFY, fontSize: '13px', color: '#40301F',
    }).setOrigin(0.5));

    this.cardInput = this.createCardInput(cx, cy - 6, popW - 48);

    layer.add(addBeigeButton(this, {
      x: cx, y: cy + popH / 2 - 36, width: Math.min(popW - 60, 200), height: 44,
      label: 'Post It!', iconKey: 'icon-share',
      fontSize: 13, fontFamily: PIXELIFY,
      onClick: () => {
        const caption = (this.cardInput?.value ?? '').trim();
        this.closeCardPrompt();
        void this.postSplatCard(caption ? { ...payload, cardTitle: caption } : payload, x, y, w);
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

  private async postSplatCard(payload: ShareCardRequest, x: number, y: number, w: number) {
    if (this.shareBusy || this.shareDone || this.navigating) return;
    this.shareBusy = true;
    this.shareBtn?.setAlpha(0.6);

    let status = 0;
    try {
      const res = await fetch('/api/share/card', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(6000),
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
      this.showToast('Easy there — try again in a moment!', '#ffb347');
    } else {
      this.shareBtn?.setAlpha(1);
      this.showToast('Could not post — try again!', '#ff6b6b');
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
    // used elsewhere on this card.
    card.add(this.add.text(0, -cardH / 2 + 62, `"${levelName}"`, {
      fontFamily: PIXEL_FONT, fontSize: '8px', color: '#362D4D',
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
    // very image this scene exports and posts to Reddit. '#40301F' matches
    // the muted-brown fix used elsewhere on this same panel texture.
    card.add(this.add.text(0, cardH / 2 - 60,
      `${info.steps} ${info.steps === 1 ? 'move' : 'moves'} · ${timeStr}`, {
        fontFamily: PIXEL_FONT, fontSize: '8px', color: '#40301F',
      }).setOrigin(0.5));

    // Branding strip — this card IS the shared image, so sign it
    const brand = this.add.text(0, cardH / 2 - 26, 'SQLOTTER · FIRST SPLAT CROWN', {
      fontFamily: PIXEL_FONT, fontSize: '7px', color: '#40301F',
    }).setOrigin(0.5);
    const sparkL = this.add.image(-brand.width / 2 - 14, cardH / 2 - 26, 'icon-spark').setDisplaySize(11, 11);
    const sparkR = this.add.image(brand.width / 2 + 14, cardH / 2 - 26, 'icon-spark').setDisplaySize(11, 11);
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
      this.showToast('Easy there — try again in a moment!', '#ffb347');
    } else {
      this.crownClaimBtn?.setAlpha(1);
      this.showToast('Could not post — try again!', '#ff6b6b');
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
