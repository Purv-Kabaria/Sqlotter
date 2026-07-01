import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import { addBeigeBadge, addBeigeButton, addBeigeCard, addDepthIcon, addPanel9 } from '../components/PixelUI';
import type { InitResponse } from '../../shared/api';

const PIXELIFY = '"Pixelify Sans", sans-serif';

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

  constructor() { super('MainMenu'); }

  init() {
    this.bgLayers  = [];
    this.uiLayer   = null;
    this.mascot    = null;
    this.userData  = null;
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.HEADER_BG);
    this.cameras.main.fadeIn(400, 10, 5, 14);

    this.buildBackground();
    this.buildUI();
    this.scale.on('resize', this.onResize, this);

    void this.loadUserData();
  }

  private async loadUserData() {
    try {
      const res = await fetch('/api/init');
      if (res.ok) {
        this.userData = await res.json() as InitResponse;
        this.buildUI();
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
    const pillW = Math.max(64, Math.min(100, Math.round(w * 0.24)));
    els.push(this.buildSparksPill(w - pillW / 2 - 8, titleH / 2, pillW, pillH, 12));

    // SQLOTTER logo centered in strip — capped so it can never run into the pill. Bobs gently.
    if (this.textures.exists('title')) {
      const logoW = Math.max(0, Math.min(w * 0.58, 260, w - 2 * pillW - 36));
      const logoH = Math.round(logoW * 112 / 512);
      const logo = this.add.image(cx, titleH / 2, 'title')
        .setDisplaySize(logoW, logoH).setDepth(11);
      els.push(logo);
      this.tweens.add({
        targets: logo, y: titleH / 2 + 4,
        duration: 2200, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
      });
    }

    // Sky area: 36% of height, but never so tall that 5×66px buttons can't fit below.
    // 66 is a hard floor, not a preference — see docs/9-slicing.md (32px button corners
    // need 2×32=64px minimum before they overlap).
    const minBtnArea = 5 * 66 + 4 * 4 + pad * 2;
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
    const rawBtnH = Math.round((remaining - pad * 2) / 5) - 8;
    const btnH  = Math.min(Math.max(rawBtnH, 66), 84);
    const btnW  = Math.min(w - pad * 2, 460);
    const gap   = Math.max(4, Math.round((remaining - pad * 2 - 5 * btnH) / 4));
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
    const pillW = Math.max(90, Math.min(122, Math.round(rightW * 0.30)));
    const pillTop = 10;
    els.push(this.buildSparksPill(w - pillW / 2 - 10, pillTop + pillH / 2, pillW, pillH, 12));

    // SQLOTTER title — placed below the pill's row with guaranteed clearance.
    let logoBottom = pillTop + pillH;
    if (this.textures.exists('title')) {
      const logoW   = Math.max(0, Math.min(rightW * 0.80, 420, w - pillW - 40));
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
      const streakY = logoBottom + 16 + 12;
      els.push(this.buildStreakBadge(rightCx, streakY, streakDays).setDepth(5));
      contentBottom = streakY + 12;
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

  private buildSparksPill(
    x: number, y: number, w: number, h: number, depth: number,
  ): Phaser.GameObjects.Container {
    const fs = Math.max(9, Math.round(h * 0.28));
    const iconSz = Math.max(11, Math.round(h * 0.38));
    // The 32px-corner button assets corrupt below 65px (see docs/9-slicing.md); on small
    // screens the pill can shrink past that floor, so fall back to the 16px-corner variant.
    const button = (h < 65 || w < 65
      ? addBeigeBadge(this, x, y, w, h)
      : addBeigeButton(this, { x, y, width: w, height: h, label: '', fontSize: fs, fontFamily: PIXELIFY })
    ).setDepth(depth);
    const icon = addDepthIcon(this, -w * 0.24, -1, 'icon-spark', iconSz, iconSz);
    this.sparksText = this.add.text(
      -w * 0.24 + iconSz * 0.60 + 5, -1,
      `${this.userData?.sparks ?? 0}`,
      { fontFamily: PIXELIFY, fontSize: `${fs}px`, color: C.TEXT_DARK,
        shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true } },
    ).setOrigin(0, 0.5);
    button.add([icon, this.sparksText]);
    return button;
  }

  private buildMenuButtons(
    cx: number, startY: number, btnW: number, btnH: number, gap: number,
    els: Phaser.GameObjects.GameObject[],
    mode: 'portrait' | 'landscape',
  ) {
    type BtnDef = [string, string, string, (string | undefined)?];
    const defs: BtnDef[] = [
      ['Play',    'icon-play',   'LevelSelect'],
      ['Daily',   'icon-timer',  'Game',       'daily'],
      ['Create',  'icon-pencil', 'Editor'],
      ['Shop',    'icon-price',  'Shop'],
      ['Ranking', 'icon-trophy', 'Leaderboard'],
    ];

    const ff   = PIXELIFY;
    const fs   = Math.max(12, Math.round(btnH * 0.28));

    if (mode === 'portrait') {
      defs.forEach(([label, icon, scene, param], i) => {
        const btn = addBeigeButton(this, {
          x: cx, y: startY + i * (btnH + gap),
          width: btnW, height: btnH,
          label, iconKey: icon, fontSize: fs, fontFamily: ff,
          onClick: () => this.goToScene(scene, param),
        });
        btn.setDepth(8).setAlpha(0);
        this.tweens.add({ targets: btn, alpha: 1, duration: 240, delay: 80 + i * 50 });
        els.push(btn);
      });
    } else {
      // Play — full-width
      const playBtn = addBeigeButton(this, {
        x: cx, y: startY,
        width: btnW, height: btnH,
        label: 'Play', iconKey: 'icon-play',
        fontSize: fs + 2, fontFamily: ff,
        onClick: () => this.goToScene('LevelSelect'),
      });
      playBtn.setDepth(8).setAlpha(0);
      this.tweens.add({ targets: playBtn, alpha: 1, duration: 240, delay: 80 });
      els.push(playBtn);

      // 2×2 grid
      const halfW  = (btnW - gap) / 2;
      const smallH = Math.round(btnH * 0.88);
      const gridTop = startY + btnH + gap;
      const gridFs  = Math.max(10, Math.round(smallH * 0.26));
      const gridDefs: BtnDef[] = [defs[1]!, defs[2]!, defs[3]!, defs[4]!];

      gridDefs.forEach(([label, icon, scene, param], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const bx  = cx - btnW / 2 + halfW / 2 + col * (halfW + gap);
        const by  = gridTop + row * (smallH + gap);
        const btn = addBeigeButton(this, {
          x: bx, y: by,
          width: halfW, height: smallH,
          label, iconKey: icon,
          fontSize: gridFs, fontFamily: ff,
          onClick: () => this.goToScene(scene, param),
        });
        btn.setDepth(8).setAlpha(0);
        this.tweens.add({ targets: btn, alpha: 1, duration: 240, delay: 160 + i * 50 });
        els.push(btn);
      });
    }
  }

  private goToScene(scene: string, param?: string) {
    this.cameras.main.fadeOut(250, 10, 5, 14);
    this.time.delayedCall(260, () => {
      this.scene.start(scene, param ? { levelId: param } : undefined);
    });
  }

  private buildStreakBadge(x: number, y: number, days: number): Phaser.GameObjects.Container {
    const pillW = 160, pillH = 24;
    const bg   = addBeigeCard(this, 0, 0, pillW, pillH);
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
    this.buildUI();
  }

  shutdown() {
    this.mascot?.stopIdleAnims();
    this.scale.off('resize', this.onResize, this);
  }
}
