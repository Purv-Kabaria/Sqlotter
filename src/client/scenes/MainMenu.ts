import * as Phaser from 'phaser';
import { showLoginPrompt } from '@devvit/web/client';
import { SplotMascot } from '../components/SplotMascot';
import { addBeigeBadge, addBeigeButton, addBeigeButtonShell, addDepthIcon, addPanel9, BODY_FONT, PIXEL_FONT } from '../components/PixelUI';
import type { InitResponse } from '../../shared/api';
import { getCachedUserData, setCachedUserData } from '../userData';
import { warmLevelsDuringIdle } from '../levelWarmup';
import { DEFERRED_IMG } from './Preloader';

const PIXELIFY = BODY_FONT;
// Press Start 2P's numerals stay legible at small sizes (Pixelify's "5" reads
// ambiguously) — same convention as Shop's NUM_FONT, used for the sparks count.
const NUM_FONT = PIXEL_FONT;

const C = {
  HEADER_BG: 0x232323,
  TEXT_DARK: '#3A1A08',
} as const;

export class MainMenu extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private uiLayer: Phaser.GameObjects.Container | null = null;
  private mascot: SplotMascot | null = null;
  private sparksText: Phaser.GameObjects.Text | null = null;
  private userData: InitResponse | null = null;
  // Settings popup (Splotter Flair toggle) — lives outside uiLayer, like the
  // Shop's popups, so buildUI() rebuilds don't orphan it.
  private activePopup: Phaser.GameObjects.Container | null = null;
  // Guards the flair-preference POST against double-taps on the toggle.
  private flairBusy = false;
  // Guards every scene.start(...) call — prevents double-clicking a menu
  // button (or clicking two) from queuing more than one scene transition —
  // and gates loadUserData()'s async continuation from rebuilding the UI
  // after the player has already navigated away.
  private navigating = false;

  constructor() { super('MainMenu'); }

  // Seeding from the shared cache (filled by Preloader's prefetch, then kept
  // fresh here) renders the right data on the first build; the refetch below
  // then only patches what actually changed instead of rebuilding — without
  // it, every visit home visibly "reloaded" (0 sparks, no username, then a
  // full UI rebuild when the fetch landed).
  init() {
    this.bgLayers  = [];
    this.uiLayer   = null;
    this.mascot    = null;
    this.userData  = getCachedUserData();
    this.activePopup = null;
    this.flairBusy   = false;
    this.navigating = false;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.HEADER_BG);
    this.cameras.main.fadeIn(400, 10, 5, 14);

    this.buildBackground();
    this.buildUI();
    this.scale.on('resize', this.onResize, this);

    void this.loadUserData();
    this.warmDeferredAssets();
    // Continue the curated-level build Preloader started — by the time the
    // player taps Play, LevelSelect should get the full set for free.
    warmLevelsDuringIdle(this);
  }

  // Streams the assets only Shop/Editor need while the player reads the menu —
  // they cost the boot sequence nothing, and those scenes still declare them in
  // their own preload() in case a fast click beats this download.
  private warmDeferredAssets() {
    const missing = DEFERRED_IMG.filter(({ key }) => !this.textures.exists(key));
    if (missing.length === 0) return;
    this.load.setPath('assets');
    for (const { key, path } of missing) this.load.image(key, path);
    this.load.start();
  }

  private async loadUserData() {
    try {
      const res = await fetch('/api/init');
      if (this.navigating || !res.ok) return;
      const fresh = await res.json() as InitResponse;
      if (this.navigating) return;

      const prev = this.userData;
      this.userData = fresh;
      setCachedUserData(fresh);

      // Full rebuild only when something the layout depends on changed (username
      // label, streak badge, Splot's equipment). Rebuilding unconditionally here is
      // what made the menu visibly "reload" — buttons re-fading, Splot resetting —
      // on every single visit once the fetch landed.
      const structuralChange = !prev
        || prev.username !== fresh.username
        || (prev.streakDays ?? 0) !== (fresh.streakDays ?? 0)
        // The sparks pill is sized around the rendered count, so crossing a
        // digit boundary needs a rebuild; same-width counts patch in place.
        || `${prev.sparks}`.length !== `${fresh.sparks}`.length
        || JSON.stringify(prev.equippedItems ?? {}) !== JSON.stringify(fresh.equippedItems ?? {});
      if (structuralChange) {
        this.buildUI();
      } else if (prev.sparks !== fresh.sparks) {
        this.sparksText?.setText(`${fresh.sparks}`);
      }
    } catch { /* offline / playtest fallback */ }
  }

  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg4-1', 'bg4-2', 'bg4-3', 'bg4-4'];
    const alphas = [1, 0.80, 0.55, 0.30];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.3).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
      this.startBgDrift(img, i, width);
    });
  }

  // Each layer drifts side to side around the canvas center. The tween's target x is
  // captured at creation time, so it must be re-created (from repositionBgLayers)
  // whenever the canvas width changes — otherwise a resize snaps the image to the new
  // center but the old tween keeps running and, on its next cycle, pulls it back toward
  // the STALE center, which can drag it far enough off-center to expose the background
  // color behind it (very noticeable after a large resize, e.g. portrait <-> landscape).
  private startBgDrift(img: Phaser.GameObjects.Image, index: number, width: number) {
    const dir = index % 2 === 0 ? 1 : -1;
    this.tweens.add({
      targets: img,
      x: width / 2 + dir * 18,
      duration: 13000 + index * 3500,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private buildUI() {
    this.mascot?.stopIdleAnims();
    this.mascot = null;
    this.uiLayer?.destroy(true);
    this.sparksText = null;

    const { width, height } = this.scale;
    const elements: Phaser.GameObjects.GameObject[] = [];

    if (height > width) {
      this.buildPortraitLayout(width, height, elements);
    } else {
      this.buildLandscapeLayout(width, height, elements);
    }

    this.uiLayer = this.add.container(0, 0, elements);
  }

  // ── Portrait ─────────────────────────────────────────────────────────────
  // Title strip at top → large Splot floating in sky → 5 stacked buttons
  private buildPortraitLayout(w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const cx     = w / 2;
    const pad    = 14;
    const titleH = Math.max(52, Math.min(130, Math.round(h * 0.13)));

    // Title strip (dark bar)
    els.push(this.add.rectangle(cx, titleH / 2, w, titleH, C.HEADER_BG).setDepth(10));

    // Sparks counter — sized to always fit inside the title strip, never overflow it.
    // Floor of 34 (not lower) keeps it above the 33px minimum the small badge asset needs.
    const pillH = Math.max(34, Math.min(titleH - 10, Math.round(titleH * 0.58)));
    const pill = this.buildSparksPill(w - 8, titleH / 2, pillH, 12);
    els.push(pill.container);

    // Settings gear mirrors the pill on the strip's left. Only for logged-in
    // players — its lone setting (Splotter Flair) is meaningless to guests.
    // The logo's 2×pillW cap already reserves this slot on both sides.
    if (this.userData?.username) {
      els.push(this.buildIconButton(8 + pillH / 2, titleH / 2, pillH, 'icon-settings',
        () => this.showSettingsPopup()).setDepth(12));
    }

    // SQLOTTER logo centered in the gap the gear and pill actually leave —
    // the old symmetric 2×pillW reservation shrank it to a ~34px speck on
    // 280px-wide screens even though ~95px of real gap existed. Skipped
    // entirely when even that gap can't fit a legible wordmark.
    if (this.textures.exists('title')) {
      const gearW = this.userData?.username ? pillH : 0;
      const gapL = 8 + gearW + (gearW ? 10 : 0);
      const gapR = w - 8 - pill.width - 10;
      const logoW = Math.max(0, Math.min(w * 0.58, 260, gapR - gapL));
      if (logoW >= 72) {
        const logoH = Math.round(logoW * 112 / 512);
        const logo = this.add.image((gapL + gapR) / 2, titleH / 2, 'title')
          .setDisplaySize(logoW, logoH).setDepth(11);
        els.push(logo);
        this.tweens.add({
          targets: logo, y: titleH / 2 + 4,
          duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });
      }
    }

    // Sky area: 36% of height, but never so tall that 4×66px button rows can't
    // fit below. 66 is a hard floor, not a preference — see docs/9-slicing.md
    // (32px button corners need 2×32=64px minimum before they overlap).
    const minBtnArea = 4 * 66 + 3 * 4 + pad * 2;
    const skyH    = Math.max(0, Math.min(h * 0.36, h - titleH - minBtnArea));
    const splotSz = Math.max(0, Math.min(w * 0.65, skyH * 0.80, 240));
    const splotY  = titleH + skyH * 0.44;
    this.spawnMascot(cx, splotY, splotSz, els);

    // Username below Splot in sky area
    const username = this.userData?.username ?? '';
    const usernameY = splotY + Math.round(splotSz * 0.58);
    if (username) {
      els.push(this.add.text(cx, usernameY, username, {
        fontFamily: PIXELIFY, fontSize: '18px', color: C.TEXT_DARK,
        shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(6));
    }

    // Buttons start at least 26px below the username so they never overlap
    const btnAreaStart = Math.max(titleH + skyH, usernameY + 26);
    const remaining = Math.max(0, h - btnAreaStart);
    const rawBtnH = Math.round((remaining - pad * 2) / 4) - 8;
    const btnH  = Math.min(Math.max(rawBtnH, 66), 84);
    const btnW  = Math.min(w - pad * 2, 460);
    const gap   = Math.max(4, Math.round((remaining - pad * 2 - 4 * btnH) / 3));
    const startY = btnAreaStart + pad;
    this.buildMenuButtons(cx, startY, btnW, btnH, gap, els, 'portrait');
  }

  // ── Landscape ────────────────────────────────────────────────────────────
  // Full-height left panel (ui/panel.png) with Splot + dark right area with title + buttons.
  // The right column is laid out as a top-to-bottom stack (pill → logo → streak → buttons),
  // each positioned off the previous element's actual bottom edge so nothing can overlap.
  private buildLandscapeLayout(w: number, h: number, els: Phaser.GameObjects.GameObject[]) {
    const pad     = 24;
    const splitX  = Math.round(w * 0.46);
    const rightW  = w - splitX;
    const rightCx = Math.round(splitX + rightW / 2);

    // ── Left panel — pre-sliced panel.png ──────────────────
    const panelW = splitX - pad;
    const panelH = h - pad * 2;
    els.push(addPanel9(this, splitX / 2, h / 2, panelW, panelH).setDepth(3));

    // Splot: fills ~72% of the panel
    const splotSz = Math.min(panelW * 0.72, panelH * 0.72, 440);
    const splotY  = h / 2 - splotSz * 0.04;
    this.spawnMascot(splitX / 2, splotY, splotSz, els);

    // Username label below Splot inside panel
    const username = this.userData?.username ?? '';
    if (username) {
      const usernameFs = Math.max(16, Math.round(panelW * 0.038));
      els.push(this.add.text(splitX / 2, h / 2 + panelH * 0.38, username, {
        fontFamily: PIXELIFY, fontSize: `${usernameFs}px`, color: C.TEXT_DARK,
        shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
      }).setOrigin(0.5).setDepth(6));
    }

    // ── Right area ─────────────────────────────────────────
    els.push(this.add.rectangle(splitX + rightW / 2, h / 2, rightW, h, 0x232323).setDepth(2));

    // Sparks pill — top-right corner, scaled with height so it never collides with the logo.
    const pillH = Math.max(34, Math.min(66, Math.round(h * 0.09)));
    const pillTop = 10;
    const pill = this.buildSparksPill(w - 10, pillTop + pillH / 2, pillH, 12);
    els.push(pill.container);

    // Settings gear beside the pill, same row (the logo starts below this row,
    // so nothing else competes for the corner). Logged-in players only.
    if (this.userData?.username) {
      els.push(this.buildIconButton(w - pill.width - 10 - 8 - pillH / 2, pillTop + pillH / 2, pillH,
        'icon-settings', () => this.showSettingsPopup()).setDepth(12));
    }

    // SQLOTTER title — placed below the pill's row with guaranteed clearance.
    let logoBottom = pillTop + pillH;
    if (this.textures.exists('title')) {
      const logoW   = Math.max(0, Math.min(rightW * 0.80, 420, w - pill.width - 40));
      const logoH   = Math.round(logoW * 112 / 512);
      const logoTop = logoBottom + 12;
      const logoY   = logoTop + logoH / 2;
      logoBottom    = logoTop + logoH;
      const logo = this.add.image(rightCx, logoY, 'title')
        .setDisplaySize(logoW, logoH).setDepth(11);
      els.push(logo);
      this.tweens.add({
        targets: logo, y: logoY + 5,
        duration: 2400, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // Streak badge (optional), stacked below the logo.
    const streakDays = this.userData?.streakDays ?? 0;
    let contentBottom = logoBottom + 8;
    if (streakDays > 0) {
      const streakY = logoBottom + 16 + 17;
      els.push(this.buildStreakBadge(rightCx, streakY, streakDays).setDepth(5));
      contentBottom = streakY + 17;
    }

    // Pre-compute button group dimensions for vertical centering
    const topMargin  = contentBottom + 16;
    const btnW   = Math.min(rightW - 48, Math.round(rightW * 0.88));
    const btnH   = Math.min(Math.round(h * 0.12), 110);
    const smallH = Math.round(btnH * 0.88);
    const gap    = Math.max(8, Math.round(h * 0.015));
    const groupH = btnH + gap + smallH + gap + smallH;

    const available = Math.max(0, h - topMargin - pad);
    const btnTop    = topMargin + Math.max(8, Math.round((available - groupH) / 2));

    this.buildMenuButtons(rightCx, btnTop, btnW, btnH, gap, els, 'landscape');
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private spawnMascot(
    x: number, y: number, size: number,
    els: Phaser.GameObjects.GameObject[],
  ) {
    this.mascot = new SplotMascot(
      this, x, y, size,
      this.userData?.equippedItems ?? {},
      undefined,
      true, // home screen uses the CSS-style procedural shadow instead of the sprite
    );
    this.mascot.container.setDepth(5);

    this.mascot.container.setInteractive(
      new Phaser.Geom.Circle(0, 0, size * 0.50),
      Phaser.Geom.Circle.Contains,
    );
    this.mascot.container.on('pointerdown', () => {
      this.mascot?.playSquishAnim();
      this.mascot?.setExpression('excited', 1200);
    });

    els.push(this.mascot.container);
  }

  // Sized around the measured count rather than a fixed proportional width —
  // Press Start 2P runs a full fontSize width per digit, so a fixed pill
  // overflowed past 3-4 digits (same fix as Shop.buildSparksPill). The pill's
  // RIGHT edge anchors at rightX since its width depends on the digit count;
  // callers lay out the gear/logo from the returned width.
  private buildSparksPill(
    rightX: number, y: number, h: number, depth: number,
  ): { container: Phaser.GameObjects.Container; width: number } {
    // Caps (14/20/12) keep a tall pill from inflating its contents — at the
    // proportional 18px a 5-digit count widened the pill enough to starve the
    // centered logo of its `w - 2*pill.width` budget.
    const fs = Math.max(9, Math.min(14, Math.round(h * 0.28)));
    const iconSz = Math.max(11, Math.min(20, Math.round(h * 0.38)));
    const pad = Math.max(8, Math.min(12, Math.round(h * 0.26)));

    this.sparksText = this.add.text(0, -1, `${this.userData?.sparks ?? 0}`, {
      fontFamily: NUM_FONT, fontSize: `${fs}px`, color: C.TEXT_DARK,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0, 0.5);

    const contentW = iconSz + 6 + Math.round(this.sparksText.width);
    const w = Math.max(64, contentW + pad * 2);
    const x = rightX - w / 2;
    // The 32px-corner button assets corrupt below 65px (see docs/9-slicing.md); on small
    // screens the pill can shrink past that floor, so fall back to the 16px-corner variant.
    const button = (h < 65 || w < 65
      ? addBeigeBadge(this, x, y, w, h)
      : addBeigeButton(this, { x, y, width: w, height: h, label: '', fontSize: fs, fontFamily: PIXELIFY })
    ).setDepth(depth);
    const icon = addDepthIcon(this, -contentW / 2 + iconSz / 2, -1, 'icon-spark', iconSz, iconSz);
    this.sparksText.setPosition(-contentW / 2 + iconSz + 6, -1);
    button.add([icon, this.sparksText]);
    return { container: button, width: w };
  }

  private buildIconButton(x: number, y: number, size: number, iconKey: string, onClick: () => void): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, x, y, size, size, false, onClick);
    const iconSize = Math.round(size * 0.42);
    shell.addContent([addDepthIcon(this, 0, -1, iconKey, iconSize, iconSize)]);
    return shell.container;
  }

  // ── Settings popup — currently one setting: the Splotter Flair toggle.
  // Same outside-uiLayer popup pattern as the Shop's confirms: dim overlay
  // that closes on tap, beige shell, derived-from-popW/popH metrics. ────────
  private showSettingsPopup() {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const cx = width / 2, cy = height / 2;
    const popW = Math.min(width - 48, 360);
    const popH = Math.min(height - 56, 300);
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);

    const shell = addBeigeButtonShell(this, cx, cy, popW, popH, false);
    const content: Phaser.GameObjects.GameObject[] = [];

    const titleFs = Math.max(14, Math.min(20, Math.round(popW * 0.06)));
    content.push(this.add.text(0, -popH * 0.32, 'Settings', {
      fontFamily: PIXELIFY, fontSize: `${titleFs}px`, color: C.TEXT_DARK, fontStyle: 'bold',
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const descFs = Math.max(12, Math.min(15, Math.round(popW * 0.045)));
    content.push(this.add.text(0, -popH * 0.08,
      'Splotter Flair shows your streak and slime tier next to your name in this community.', {
        // #40301F, not the lighter #75604C often seen for muted copy elsewhere —
        // this sits on the beige popup shell, where the lighter tone reads too
        // close to the background to be legible.
        fontFamily: PIXELIFY, fontSize: `${descFs}px`, color: '#40301F',
        align: 'center', wordWrap: { width: popW - 56 },
      }).setOrigin(0.5));

    shell.addContent(content);
    items.push(shell.container);

    // Toggle reads the cached preference; setFlairPref flips it optimistically
    // and reopens the popup right away (reverting if the server says no).
    const enabled = this.userData?.flairEnabled !== false;
    const btnW = Math.min(popW - 48, 220);
    const btnH = Math.max(46, Math.min(60, Math.round(popH * 0.20)));
    const btnFs = Math.max(13, Math.round(btnH * 0.30));
    items.push(addBeigeButton(this, {
      x: cx, y: cy + popH / 2 - btnH * 0.9, width: btnW, height: btnH,
      label: enabled ? 'Flair: ON' : 'Flair: OFF',
      iconKey: enabled ? 'icon-check' : 'icon-cross',
      fontSize: btnFs, fontFamily: PIXELIFY, forceSmall: true,
      onClick: () => void this.setFlairPref(!enabled),
    }));

    this.activePopup = this.add.container(0, 0, items).setDepth(60).setAlpha(0).setScale(0.9);
    this.tweens.add({ targets: this.activePopup, alpha: 1, scaleX: 1, scaleY: 1, duration: 180, ease: 'Back.easeOut' });
  }

  private async setFlairPref(enabled: boolean) {
    if (this.flairBusy) return;
    this.flairBusy = true;

    // Optimistic: flip the cached value and rebuild the toggle immediately —
    // the flair round-trip to Reddit takes seconds and the button must feel
    // instant. A failed request reverts the flip below.
    const prev = this.userData;
    if (this.userData) {
      this.userData = { ...this.userData, flairEnabled: enabled };
      setCachedUserData(this.userData);
    }
    if (this.activePopup) this.showSettingsPopup();

    let status = 0;
    try {
      const res = await fetch('/api/user/flair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      status = res.status;
    } catch { /* network failure → revert below */ }
    this.flairBusy = false;

    if (status === 200) return;
    if (prev) {
      this.userData = prev;
      setCachedUserData(prev);
    }
    if (this.navigating) return;
    if (this.activePopup) this.showSettingsPopup();
    if (status === 401) {
      try { showLoginPrompt(); } catch { /* outside Reddit iframe */ }
    }
  }

  private closeActivePopup() {
    if (!this.activePopup) return;
    const p = this.activePopup;
    this.activePopup = null;
    this.tweens.add({ targets: p, alpha: 0, duration: 120, onComplete: () => p.destroy(true) });
  }

  private buildMenuButtons(
    cx: number, startY: number, btnW: number, btnH: number, gap: number,
    els: Phaser.GameObjects.GameObject[],
    mode: 'portrait' | 'landscape',
  ) {
    type BtnDef = { label: string; icon: string; scene: string; data?: Record<string, unknown> };
    const PLAY:    BtnDef = { label: 'Play',    icon: 'icon-play',   scene: 'LevelSelect' };
    const DAILY:   BtnDef = { label: 'Daily',   icon: 'icon-timer',  scene: 'Game', data: { levelId: 'daily' } };
    const CREATE:  BtnDef = { label: 'Create',  icon: 'icon-pencil', scene: 'Editor' };
    // Level Finder — jumps straight to LevelSelect's finder page (search bar
    // over curated worlds + community levels).
    const FIND:    BtnDef = { label: 'Find',    icon: 'icon-people', scene: 'LevelSelect', data: { page: 'finder' } };
    const SHOP:    BtnDef = { label: 'Shop',    icon: 'icon-price',  scene: 'Shop' };
    const RANKING: BtnDef = { label: 'Ranking', icon: 'icon-trophy', scene: 'Leaderboard' };

    const ff = PIXELIFY;
    const fs = Math.max(12, Math.round(btnH * 0.28));

    // Both modes are row stacks; a row with two defs splits the width. The
    // pairing keeps every button at a corner-safe height while fitting six
    // destinations in the vertical budget five used to take — landscape keeps
    // its exact three-row height so 320-tall screens still fit the stack.
    let rows: { defs: BtnDef[]; h: number; fs: number }[];
    if (mode === 'portrait') {
      rows = [
        { defs: [PLAY],            h: btnH, fs },
        { defs: [DAILY],           h: btnH, fs },
        { defs: [CREATE, FIND],    h: btnH, fs },
        { defs: [SHOP, RANKING],   h: btnH, fs },
      ];
    } else {
      const smallH = Math.round(btnH * 0.88);
      const gridFs = Math.max(10, Math.round(smallH * 0.26));
      rows = [
        { defs: [PLAY, FIND],      h: btnH,   fs: fs + 2 },
        { defs: [DAILY, CREATE],   h: smallH, fs: gridFs },
        { defs: [SHOP, RANKING],   h: smallH, fs: gridFs },
      ];
    }

    let y = startY;
    let delay = 80;
    for (const row of rows) {
      const colGap = row.defs.length > 1 ? gap : 0;
      const w = (btnW - colGap * (row.defs.length - 1)) / row.defs.length;
      row.defs.forEach((def, col) => {
        const bx = cx - btnW / 2 + w / 2 + col * (w + colGap);
        const btn = addBeigeButton(this, {
          x: bx, y: y + row.h / 2,
          width: w, height: row.h,
          label: def.label, iconKey: def.icon, fontSize: row.fs, fontFamily: ff,
          onClick: () => this.goToScene(def.scene, def.data),
        });
        btn.setDepth(8).setAlpha(0);
        this.tweens.add({ targets: btn, alpha: 1, duration: 240, delay });
        delay += 50;
        els.push(btn);
      });
      y += row.h + gap;
    }
  }

  private goToScene(scene: string, data?: Record<string, unknown>) {
    if (this.navigating) return;
    this.navigating = true;
    this.cameras.main.fadeOut(250, 10, 5, 14);
    this.time.delayedCall(260, () => {
      this.scene.start(scene, data);
    });
  }

  private buildStreakBadge(x: number, y: number, days: number): Phaser.GameObjects.Container {
    // addBeigeCard's 'ui-flat-slot' texture is ~80% transparent — over this
    // scene's dark right-column rectangle it reads as almost-black, making
    // TEXT_DARK unreadable. addBeigeBadge uses the opaque button-open slices
    // instead (same fix as buildSparksPill's fallback below the 65px floor).
    const pillW = 160, pillH = 34;
    const bg   = addBeigeBadge(this, 0, 0, pillW, pillH);
    const icon = addDepthIcon(this, -pillW / 2 + 14, 0, 'icon-fire', 14, 14);
    const txt  = this.add.text(-pillW / 2 + 28, 0, `${days} day streak!`, {
      fontFamily: PIXELIFY, fontSize: '12px', color: C.TEXT_DARK,
    }).setOrigin(0, 0.5);
    return this.add.container(x, y, [bg, icon, txt]);
  }

  private repositionBgLayers(width: number, height: number) {
    this.bgLayers.forEach((img, i) => {
      this.tweens.killTweensOf(img);
      img.setPosition(width / 2, height / 2);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.startBgDrift(img, i, width);
    });
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    // The settings popup is sized from the viewport at open time and isn't
    // part of uiLayer — close it rather than leave it at stale coordinates.
    this.closeActivePopup();
    this.buildUI();
  }

  shutdown() {
    this.navigating = true;
    this.activePopup?.destroy(true);
    this.activePopup = null;
    this.mascot?.stopIdleAnims();
    this.scale.off('resize', this.onResize, this);
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
