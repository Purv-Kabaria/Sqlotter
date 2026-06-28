import * as Phaser from 'phaser';
import { LevelEngine, calcStars } from '../engine/LevelEngine';
import { addPixelButton, addPixelIconButton, addPixelPanel, PIXEL_FONT } from '../components/PixelUI';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import type { LevelData, ModifierDef } from '../../shared/types';
import type { CompleteRequest, CompleteResponse } from '../../shared/api';
import { CURATED_LEVELS } from '../../shared/levelData';

const C = {
  BG:     0x1a0a2e,
  PANEL:  0x2d1b4e,
  GREEN:  0x6dd400,
  GOLD:   0xffd700,
  RED:    0xff3333,
  TEXT:   '#ffffff',
  DIM:    '#7a8a9a',
  ACCENT: '#6DD400',
} as const;

const VARIANT_LABEL: Record<string, string> = {
  'h-thick': 'Wide', 'h-thin': 'Thin', 'h-mono': 'Monocle',
  'v-thick': 'V Wide', 'v-thin': 'V Thin', 'v-mono': 'V Mono',
  'h': 'H', 'v': 'V',
};

function modLabel(mod: ModifierDef): string {
  const v = mod.variant ? (VARIANT_LABEL[mod.variant] ?? mod.variant) : '';
  if (mod.type === 'paint')    return 'Paint';
  if (mod.type === 'goggles')  return `Goggles${v ? ' ' + v : ''}`;
  if (mod.type === 'glasses')  return `Glasses${v ? ' ' + v : ''}`;
  if (mod.type === 'belt')     return `Belt${v ? ' ' + v : ''}`;
  if (mod.type === 'pendant')  return `Pendant${v ? ' ' + v : ''}`;
  if (mod.type === 'pumpkin')  return `Pumpkin ${mod.coverage ?? 50}%`;
  if (mod.type === 'underwear') return 'Underwear';
  return mod.id;
}

function modIconKey(mod: ModifierDef): string | null {
  if (mod.type === 'paint')    return 'icon-paint';
  if (mod.type === 'goggles')  return mod.variant?.includes('thin') ? 'icon-goggles-thin' : 'icon-goggles-thick';
  if (mod.type === 'glasses')  return mod.variant?.includes('thin') ? 'icon-glasses-thin' : 'icon-glasses-thick';
  if (mod.type === 'belt')     return mod.variant?.includes('thin') ? 'icon-belt-thin' : 'icon-belt-thick';
  if (mod.type === 'pendant')  return 'icon-pendant';
  if (mod.type === 'pumpkin')  return 'icon-pumpkin';
  if (mod.type === 'underwear') return 'icon-underwear';
  return null;
}

export class Game extends Phaser.Scene {
  private engine: LevelEngine | null = null;
  private level:  LevelData  | null = null;
  private levelId = 'L01';
  private isPreview = false;
  private winHandled = false;
  private loadToken = 0;

  private goalRenderer:    SlimeRenderer | null = null;
  private currentRenderer: SlimeRenderer | null = null;
  private splot:           SplotMascot  | null = null;

  private timerText:    Phaser.GameObjects.Text      | null = null;
  private stepsText:    Phaser.GameObjects.Text      | null = null;
  private hintText:     Phaser.GameObjects.Text      | null = null;
  private conflictPopup: Phaser.GameObjects.Container | null = null;
  private goggleWarning: Phaser.GameObjects.Text     | null = null;
  private timerEvent:   Phaser.Time.TimerEvent       | null = null;
  private loadingText:  Phaser.GameObjects.Text      | null = null;

  private paletteCards: Phaser.GameObjects.Container[] = [];
  private paletteContainer: Phaser.GameObjects.Container | null = null;
  private bgLayers:     Phaser.GameObjects.Image[]    = [];

  constructor() { super('Game'); }

  // ── Scene lifecycle ───────────────────────────────────────
  init(data: { levelId?: string; previewData?: LevelData }) {
    this.engine       = null;
    this.level        = data?.previewData ?? null;
    this.levelId      = data?.levelId ?? 'L01';
    this.isPreview    = !!data?.previewData;
    this.winHandled   = false;
    this.loadToken    += 1;
    this.paletteCards = [];
    this.paletteContainer = null;
    this.bgLayers     = [];
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(300, 26, 10, 46);
    this.scale.on('resize', this.onResize, this);
    this.buildBackground();

    if (this.level) {
      // Preview mode: level data supplied directly from Editor
      this.engine = new LevelEngine(this.level);
      this.buildHUD();
      this.buildSlimeDisplays();
      this.buildPalette();
      this.startTimer();
    } else if (this.levelId === 'daily') {
      this.showLoading();
      void this.fetchDailyAndStart(this.loadToken);
    } else {
      this.startWithLevelId(this.levelId);
    }
  }

  private showLoading() {
    const { width, height } = this.scale;
    this.loadingText = this.add.text(width / 2, height / 2, 'Loading daily puzzle...', {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#a0b0c0',
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: this.loadingText, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
  }

  private async fetchDailyAndStart(token: number) {
    try {
      const res = await fetch('/api/daily');
      if (res.ok) {
        const data = await res.json() as { levelId: string; level: LevelData };
        this.levelId = data.levelId;
        this.level   = data.level;
      } else {
        const dow = new Date().getDay();
        const fallback = CURATED_LEVELS[dow % CURATED_LEVELS.length] ?? CURATED_LEVELS[0] ?? null;
        this.level   = fallback;
        this.levelId = fallback?.id ?? 'L01';
      }
    } catch {
      const dow = new Date().getDay();
      const fallback = CURATED_LEVELS[dow % CURATED_LEVELS.length] ?? CURATED_LEVELS[0] ?? null;
      this.level   = fallback;
      this.levelId = fallback?.id ?? 'L01';
    }

    if (token !== this.loadToken) return;
    this.loadingText?.destroy();
    if (!this.level) {
      this.showLoadError('Daily puzzle is unavailable.', () => {
        this.scene.restart({ levelId: 'daily' });
      });
      return;
    }
    this.engine = new LevelEngine(this.level);
    this.buildHUD();
    this.buildSlimeDisplays();
    this.buildPalette();
    this.startTimer();
  }

  private startWithLevelId(id: string) {
    const curated = CURATED_LEVELS.find(l => l.id === id);
    if (curated) {
      this.level  = curated;
      this.engine = new LevelEngine(this.level);
      this.buildHUD();
      this.buildSlimeDisplays();
      this.buildPalette();
      this.startTimer();
      return;
    }

    // UGC / unknown level — fetch from server
    this.showLoading();
    const token = this.loadToken;
    void (async () => {
      try {
        const res = await fetch(`/api/level/${id}`);
        if (res.ok) {
          const data = await res.json() as { level: LevelData };
          this.level = data.level;
        } else {
          this.level = CURATED_LEVELS[0] ?? null;
        }
      } catch {
        this.level = CURATED_LEVELS[0] ?? null;
      }
      if (token !== this.loadToken) return;
      this.loadingText?.destroy();
      if (!this.level) {
        this.showLoadError('Could not load this level.', () => {
          this.scene.start('LevelSelect');
        });
        return;
      }
      this.engine = new LevelEngine(this.level);
      this.buildHUD();
      this.buildSlimeDisplays();
      this.buildPalette();
      this.startTimer();
    })();
  }

  // ── Background ────────────────────────────────────────────
  private showLoadError(message: string, retry: () => void) {
    const { width, height } = this.scale;
    const panelW = Math.min(width - 40, 320);
    const panelH = 160;
    const cx = width / 2;
    const cy = height / 2;

    const bg = addPixelPanel(this, 0, 0, panelW, panelH).setDepth(80);

    const icon = this.add.image(0, -48, 'icon-warning').setDisplaySize(32, 32).setDepth(81);
    const text = this.add.text(0, -10, message, {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
      color: '#ffb3b3',
      align: 'center',
      wordWrap: { width: panelW - 36 },
    }).setOrigin(0.5).setDepth(81);

    const button = addPixelButton(this, {
      x: 0,
      y: 59,
      width: 148,
      height: 44,
      label: 'Try Again',
      onClick: retry,
    }).setDepth(81);

    const panel = this.add.container(cx, cy, [bg, icon, text, button])
      .setDepth(80)
      .setAlpha(0)
      .setScale(0.96);

    this.tweens.add({
      targets: panel,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 220,
      ease: 'Back.easeOut',
    });
  }

  private buildBackground() {
    const { width, height } = this.scale;
    ['bg4-1', 'bg4-2'].forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(i === 0 ? 0.55 : 0.25)
        .setDepth(-10);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
    });
  }

  // ── HUD ───────────────────────────────────────────────────
  private buildHUD() {
    const { width } = this.scale;

    this.buildIconBtn(30, 30, 'icon-arrow', 36, () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start(this.isPreview ? 'Editor' : 'LevelSelect'));
    }, 180);

    if (this.level) {
      const prefix = this.isPreview ? 'PREVIEW: ' : this.level.isDaily ? 'Daily: ' : '';
      const titleLabel = `${prefix}${this.level.title}`;
      this.add.text(width / 2, 16, titleLabel, {
        fontFamily: PIXEL_FONT,
        fontSize: '9px',
        color: '#ffffff',
        stroke: '#1a0a2e',
        strokeThickness: 3,
      }).setOrigin(0.5, 0).setDepth(15);
    }

    this.add.image(width - 92, 22, 'icon-timer').setDisplaySize(18, 18).setDepth(15);
    this.timerText = this.add.text(width - 74, 22, '0:00', {
      fontFamily: PIXEL_FONT,
      fontSize: '11px',
      color: '#ffffff',
    }).setOrigin(0, 0.5).setDepth(15);

    this.stepsText = this.add.text(width / 2, 38, 'Steps: 0', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.DIM,
    }).setOrigin(0.5, 0).setDepth(15);

    this.buildIconBtn(width - 36, 58, 'icon-reset', 30, () => this.handleReset());
    this.buildIconBtn(36, 58, 'icon-help', 30, () => this.showHint());

    const div = this.add.graphics().setDepth(15);
    div.lineStyle(1, 0x6dd400, 0.2);
    div.lineBetween(0, 74, width, 74);

    this.goggleWarning = this.add.text(width / 2, 62, 'Goggles used!', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: '#FF851B',
      stroke: '#1a0a2e',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(15).setVisible(false);
  }

  private buildIconBtn(x: number, y: number, iconKey: string, size: number, cb: () => void, iconAngle = 0) {
    addPixelIconButton(this, {
      x,
      y,
      size,
      iconKey,
      iconAngle,
      onClick: cb,
    }).setDepth(15);
  }

  // ── Slime displays ────────────────────────────────────────
  private buildSlimeDisplays() {
    if (!this.engine) return;
    const { width, height } = this.scale;
    const isPortrait = height > width;
    const slimeSize  = isPortrait ? Math.min(width * 0.30, 130) : Math.min(height * 0.26, 130);
    const panelY     = isPortrait ? height * 0.22 : height * 0.32;
    const panelW     = slimeSize + 48;
    const panelH     = slimeSize + 56;

    const goalX = isPortrait ? width * 0.25 : width * 0.22;
    this.buildSlimePanel(goalX, panelY, panelW, panelH, 'Goal');
    this.goalRenderer = new SlimeRenderer(this, goalX, panelY, slimeSize);
    this.goalRenderer.container.setDepth(4);
    this.goalRenderer.setState(this.engine.goalState);

    const curX = isPortrait ? width * 0.75 : width * 0.55;
    this.buildSlimePanel(curX, panelY, panelW, panelH, 'Yours');
    this.currentRenderer = new SlimeRenderer(this, curX, panelY, slimeSize);
    this.currentRenderer.container.setDepth(4);
    this.currentRenderer.setState(this.engine.currentState);

    if (!isPortrait) {
      this.splot = new SplotMascot(this, width * 0.83, panelY, slimeSize * 0.65);
      this.splot.container.setDepth(4);
    }
  }

  private buildSlimePanel(cx: number, cy: number, w: number, h: number, label: string) {
    addPixelPanel(this, cx, cy, w, h).setDepth(2).setAlpha(0.94);
    this.add.text(cx, cy - h / 2 + 14, label, {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.ACCENT,
    }).setOrigin(0.5).setDepth(5);
  }

  // ── Modifier palette ──────────────────────────────────────
  private buildPalette() {
    if (!this.level) return;
    this.paletteContainer?.destroy(true);
    this.paletteCards = [];

    const { width, height } = this.scale;
    const isPortrait = height > width;
    this.paletteContainer = this.add.container(0, 0).setDepth(4);

    const paletteY = isPortrait ? height * 0.52 : 80;
    const paletteX = isPortrait ? 0 : width * 0.65;
    const paletteW = isPortrait ? width : width * 0.35;
    const paletteH = isPortrait ? height * 0.48 : height - 80;

    const pbg = addPixelPanel(this, paletteX + paletteW / 2, paletteY + paletteH / 2, paletteW, paletteH)
      .setDepth(4)
      .setAlpha(isPortrait ? 0.94 : 0.9);
    this.paletteContainer.add(pbg);

    const title = this.add.text(paletteX + paletteW / 2, paletteY + 18, 'Modifiers', {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
      color: C.ACCENT,
    }).setOrigin(0.5).setDepth(5);
    this.paletteContainer.add(title);

    this.hintText = this.add.text(paletteX + paletteW / 2, paletteY + paletteH - 20, '', {
      fontFamily: PIXEL_FONT,
      fontSize: '8px',
      color: C.DIM,
      wordWrap: { width: paletteW - 20 },
      align: 'center',
    }).setOrigin(0.5, 1).setDepth(5).setAlpha(0);
    this.paletteContainer.add(this.hintText);

    const cols    = isPortrait ? 3 : 2;
    const cardW   = isPortrait ? (paletteW - 32) / cols : paletteW - 24;
    const cardH   = 56;
    const gap     = 8;
    const startY  = paletteY + 38;

    this.level.palette.forEach((mod, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx  = paletteX + 16 + col * (cardW + gap) + cardW / 2;
      const cy  = startY + row * (cardH + gap) + cardH / 2;
      const card = this.buildModCard(cx, cy, cardW, cardH, mod);
      this.paletteCards.push(card);
      this.paletteContainer?.add(card);
    });
  }

  private buildModCard(cx: number, cy: number, w: number, h: number, mod: ModifierDef) {
    const isGoggle = mod.type === 'goggles';
    const spent    = isGoggle && (this.engine?.isGogglesSpent ?? false);

    const bg = this.add.nineslice(
      0,
      0,
      spent ? 'ui-btn-disabled' : 'ui-btn-open',
      undefined,
      w,
      h,
      8,
      8,
      8,
      8,
    );
    const setNormal = () => bg.setTexture(spent ? 'ui-btn-disabled' : 'ui-btn-open');
    const setHover = () => bg.setTexture('ui-btn-hover');
    const setPressed = () => bg.setTexture('ui-btn-press');

    const items: Phaser.GameObjects.GameObject[] = [bg];

    if (mod.type === 'paint' && mod.color) {
      const col = parseInt(mod.color.replace('#', ''), 16);
      items.push(this.add.circle(-w / 2 + 24, 0, 15).setStrokeStyle(1, 0xffffff, 0.4));
      items.push(this.add.circle(-w / 2 + 24, 0, 14, col));
    } else {
      const iconKey = modIconKey(mod);
      if (iconKey && this.textures.exists(iconKey)) {
        const icon = this.add.image(-w / 2 + 24, 0, iconKey).setDisplaySize(24, 24);
        if (spent) icon.setAlpha(0.3);
        items.push(icon);
      }
    }

    const lbl = spent ? '(used)' : modLabel(mod);
    items.push(this.add.text(4, 0, lbl, {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.min(Math.round(w * 0.08), 9)}px`,
      color: spent ? C.DIM : C.TEXT,
      wordWrap: { width: w - 56 },
    }).setOrigin(0, 0.5));

    const c = this.add.container(cx, cy, items).setDepth(5).setSize(w, h);
    c.setInteractive({ useHandCursor: !spent });
    if (!spent) {
      c.on('pointerover', () => {
        setHover();
        this.tweens.add({ targets: c, y: cy - 2, duration: 80, ease: 'Quad.easeOut' });
      });
      c.on('pointerout', () => {
        setNormal();
        this.tweens.add({ targets: c, y: cy, scaleX: 1, scaleY: 1, duration: 90, ease: 'Quad.easeOut' });
      });
      c.on('pointerdown', () => {
        setPressed();
        this.tweens.add({ targets: c, y: cy + 1, scaleX: 0.97, scaleY: 0.97, duration: 60 });
      });
      c.on('pointerup', () => {
        setHover();
        this.tweens.add({
          targets: c,
          y: cy - 2,
          scaleX: 1,
          scaleY: 1,
          duration: 70,
          onComplete: () => this.applyModifier(mod),
        });
      });
    }
    return c;
  }

  // ── Apply modifier ────────────────────────────────────────
  private applyModifier(mod: ModifierDef) {
    if (!this.engine || !this.currentRenderer) return;

    const result = this.engine.applyModifier(mod);

    if (!result.ok) {
      this.currentRenderer.playShakeAnim(this);
      this.splot?.playConflict();
      this.showConflictPopup(result.message);
      return;
    }

    this.currentRenderer.setState(result.newState);
    this.currentRenderer.playApplyAnim(this);
    this.playModifierBurst(mod);
    this.splot?.playAppliedFlash();
    this.stepsText?.setText(`Steps: ${this.engine.steps}`);

    if (this.engine.isGogglesSpent) {
      this.goggleWarning?.setVisible(true);
      this.time.delayedCall(2500, () => this.goggleWarning?.setVisible(false));
      // Rebuild palette so goggle cards show the "used" state.
      this.buildPalette();
    }

    if (result.isWin) void this.handleWin();
  }

  // ── Win ───────────────────────────────────────────────────
  private playModifierBurst(mod: ModifierDef) {
    if (!this.currentRenderer) return;
    const origin = this.currentRenderer.container;
    const iconKey = modIconKey(mod);
    const tint = mod.type === 'paint' && mod.color
      ? parseInt(mod.color.replace('#', ''), 16)
      : C.GOLD;

    for (let i = 0; i < 7; i++) {
      const angle = Phaser.Math.DegToRad(-120 + i * 40 + Phaser.Math.Between(-8, 8));
      const distance = Phaser.Math.Between(30, 58);
      const targetX = origin.x + Math.cos(angle) * distance;
      const targetY = origin.y + Math.sin(angle) * distance;
      const particle = iconKey && this.textures.exists(iconKey) && i % 2 === 0
        ? this.add.image(origin.x, origin.y, iconKey).setDisplaySize(16, 16)
        : this.add.image(origin.x, origin.y, 'icon-sparkle').setDisplaySize(12, 12).setTint(tint);

      particle.setDepth(30).setAlpha(0.9).setScale(0.45);
      this.tweens.add({
        targets: particle,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 1.2,
        scaleY: 1.2,
        angle: Phaser.Math.Between(-45, 45),
        duration: 420,
        ease: 'Quad.easeOut',
        onComplete: () => particle.destroy(),
      });
    }
  }

  private async handleWin() {
    if (!this.engine || !this.level || this.winHandled) return;
    this.winHandled = true;
    this.timerEvent?.destroy();

    const elapsed = this.engine.elapsedMs();
    const steps   = this.engine.steps;
    const stars   = calcStars(steps, this.level.optimalSteps);

    this.currentRenderer?.playWinAnim(this);
    this.splot?.playWin();

    if (this.isPreview) {
      this.time.delayedCall(900, () => {
        this.cameras.main.fadeOut(300, 26, 10, 46);
        this.time.delayedCall(320, () => this.scene.start('Editor'));
      });
      return;
    }

    const payload: CompleteRequest = {
      levelId: this.levelId,
      timeMs: elapsed,
      actions: this.engine.actions,
    };

    // Await the server response to get the actual sparks earned
    const t0 = Date.now();
    let sparks = 0;
    let streakDays: number | undefined;
    try {
      const res = await fetch('/api/complete', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data: CompleteResponse = await res.json();
        sparks = data.sparksEarned;
        streakDays = data.streakDays;
      }
    } catch { /* completion can be retried by replaying the level */ }

    // Guarantee at least 700ms of win animation before transitioning
    const minDelay = Math.max(0, 700 - (Date.now() - t0));
    const lid = this.levelId;
    const lvl = this.level;
    this.time.delayedCall(minDelay, () => {
      this.cameras.main.fadeOut(300, 26, 10, 46);
      this.time.delayedCall(320, () => {
        this.scene.start('LevelComplete', {
          levelId: lid,
          title:   lvl.title,
          steps,
          timeMs:  elapsed,
          stars,
          sparks,
          streakDays,
        });
      });
    });
  }

  // ── Reset ─────────────────────────────────────────────────
  private handleReset() {
    if (!this.engine) return;
    this.engine.reset();
    if (this.currentRenderer) {
      this.currentRenderer.setState(this.engine.currentState);
      this.currentRenderer.playShakeAnim(this);
    }
    this.stepsText?.setText('Steps: 0');
    this.goggleWarning?.setVisible(false);
    this.buildPalette();
  }

  // ── Hint ──────────────────────────────────────────────────
  private showHint() {
    if (!this.level?.hint || !this.hintText) return;
    this.hintText.setText(this.level.hint).setAlpha(1);
    this.time.delayedCall(3500, () => {
      this.tweens.add({ targets: this.hintText, alpha: 0, duration: 400 });
    });
  }

  // ── Conflict popup ────────────────────────────────────────
  private showConflictPopup(message: string) {
    this.conflictPopup?.destroy();
    const { width, height } = this.scale;
    const popW = Math.min(width - 40, 300);
    const popH = 64;

    const bg = addPixelPanel(this, 0, 0, popW, popH);
    const icon = this.add.image(-popW / 2 + 28, 0, 'icon-warning').setDisplaySize(22, 22);
    const txt = this.add.text(-popW / 2 + 52, 0, message, {
      fontFamily: PIXEL_FONT,
      fontSize:   '8px',
      color:      '#ff8888',
      wordWrap:   { width: popW - 72 },
      align:      'left',
    }).setOrigin(0, 0.5);

    this.conflictPopup = this.add.container(width / 2, height * 0.46, [bg, icon, txt])
      .setDepth(50).setAlpha(0);
    this.tweens.add({ targets: this.conflictPopup, alpha: 1, duration: 150 });
    this.time.delayedCall(2200, () => {
      this.tweens.add({
        targets: this.conflictPopup, alpha: 0, duration: 300,
        onComplete: () => this.conflictPopup?.destroy(),
      });
    });
  }

  // ── Timer ─────────────────────────────────────────────────
  private startTimer() {
    this.timerEvent = this.time.addEvent({
      delay: 1000,
      loop:  true,
      callback: () => {
        if (!this.engine || !this.timerText) return;
        const s = Math.floor(this.engine.elapsedMs() / 1000);
        this.timerText.setText(
          `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`,
        );
      },
    });
  }

  private onResize(gameSize: Phaser.Scale.ScaleManager | { width: number; height: number }) {
    const { width, height } = gameSize instanceof Phaser.Scale.ScaleManager ? gameSize : gameSize;
    this.cameras.resize(width, height);
    this.bgLayers.forEach(img => {
      img.setPosition(width / 2, height / 2);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
    });
  }

  shutdown() {
    this.loadToken += 1;
    this.timerEvent?.destroy();
    this.paletteContainer?.destroy(true);
    this.scale.off('resize', this.onResize, this);
  }
}
