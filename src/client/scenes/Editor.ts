import * as Phaser from 'phaser';
import { playSfx } from '../audio';
import type { ModifierDef } from '../../shared/types';
import { isBreakableMask, MAX_WORN, replayOps, standardPaints } from '../../shared/slimeSim';
import { MAX_SOLUTION_STEPS } from '../../shared/gameRules';
import { SlimeRenderer } from '../components/SlimeRenderer';
import { SplotMascot } from '../components/SplotMascot';
import { bakeSwatchShine } from '../components/overlayShine';
import type { LevelData } from '../../shared/types';
import type { LevelCreateResponse } from '../../shared/api';
import {
  BODY_FONT, PIXEL_FONT, addBeigeBadge, addBeigeButton, addBeigeButtonShell,
  addBeigeSolidCard, addDarkPanel, addDepthIcon,
} from '../components/PixelUI';
import { DEFERRED_IMG } from './Preloader';

const PIXELIFY = BODY_FONT;

// ── Modifier palette available in the editor ──────────────
// The same 16-color rack the game's paint pot offers (slimeSim's catalog), so
// published palettes reference the canonical paint ids and colors.
const PAINT_COLORS: readonly ModifierDef[] = standardPaints();

// The FULL modifier catalog the sim knows — every stencil, plus the three
// special mechanics (nose / bubble / alpha dip). Maximum creative range for
// creators; grouped tiles (see GRID_SLOTS) keep it fitting any screen.
const ALL_MODS: ModifierDef[] = [
  { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick' },
  { id: 'goggles-h-thin',  type: 'goggles', variant: 'h-thin'  },
  { id: 'goggles-h-mono',  type: 'goggles', variant: 'h-mono'  },
  { id: 'goggles-v-thick', type: 'goggles', variant: 'v-thick' },
  { id: 'goggles-v-thin',  type: 'goggles', variant: 'v-thin'  },
  { id: 'goggles-v-mono',  type: 'goggles', variant: 'v-mono'  },
  { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
  { id: 'glasses-h-thin',  type: 'glasses', variant: 'h-thin'  },
  { id: 'glasses-v-thick', type: 'glasses', variant: 'v-thick' },
  { id: 'glasses-v-thin',  type: 'glasses', variant: 'v-thin'  },
  { id: 'belt-h-thick',    type: 'belt',    variant: 'h-thick' },
  { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin'  },
  { id: 'belt-v-thick',    type: 'belt',    variant: 'v-thick' },
  { id: 'belt-v-thin',     type: 'belt',    variant: 'v-thin'  },
  { id: 'pendant-h',       type: 'pendant', variant: 'h'       },
  { id: 'pendant-v',       type: 'pendant', variant: 'v'       },
  { id: 'plate',           type: 'plate'                       },
  { id: 'cone',            type: 'cone'                        },
  { id: 'scarf',           type: 'scarf'                       },
  { id: 'nose',            type: 'nose'                        },
  { id: 'bubble',          type: 'bubble'                      },
  { id: 'alpha-dip',       type: 'alpha'                       },
  { id: 'pumpkin-25',      type: 'pumpkin', coverage: 25       },
  { id: 'pumpkin-50',      type: 'pumpkin', coverage: 50       },
  { id: 'pumpkin-75',      type: 'pumpkin', coverage: 75       },
  { id: 'underwear',       type: 'underwear'                   },
];

// Everything the editor can record — paints splash color, the rest are
// stencils that toggle on/off (tap again to remove). The creator literally
// PLAYS their level here; the recorded action list becomes its solution and
// its goal pattern at once.
const EDITOR_DEFS: ModifierDef[] = [...PAINT_COLORS, ...ALL_MODS];

// The build grid mirrors the Game palette's grouping: one paint-pot tile
// (opens the 16-color picker), one pumpkin tile (opens the 3-size picker),
// and one tile per remaining stencil. Grouping is what lets the full catalog
// fit every screen size without micro-tiles.
type GridSlot = { kind: 'paint' } | { kind: 'pumpkin' } | { kind: 'stencil'; mod: ModifierDef };
const GRID_SLOTS: GridSlot[] = [
  { kind: 'paint' },
  { kind: 'pumpkin' },
  ...ALL_MODS.filter((m) => m.type !== 'pumpkin').map((mod) => ({ kind: 'stencil' as const, mod })),
];

// "h-thick" → "H thick" — orientation loud, thickness quiet.
function variantLabel(variant: string | undefined): string {
  if (!variant) return '';
  const [axis, thickness] = variant.split('-');
  return thickness ? `${(axis ?? '').toUpperCase()} ${thickness}` : (axis ?? '').toUpperCase();
}

function modLabel(mod: ModifierDef): string {
  if (mod.type === 'goggles')   return `Goggles ${variantLabel(mod.variant)}`;
  if (mod.type === 'glasses')   return `Glasses ${variantLabel(mod.variant)}`;
  if (mod.type === 'belt')      return `Belt ${variantLabel(mod.variant)}`;
  if (mod.type === 'pendant')   return `Pendant ${variantLabel(mod.variant)}`;
  if (mod.type === 'pumpkin')   return `Pumpkin ${mod.coverage}%`;
  if (mod.type === 'underwear') return 'Underwear';
  if (mod.type === 'plate')     return 'Plate';
  if (mod.type === 'cone')      return 'Cone';
  if (mod.type === 'scarf')     return 'Scarf';
  if (mod.type === 'nose')      return 'Nose';
  if (mod.type === 'bubble')    return 'Bubble';
  if (mod.type === 'alpha')     return 'Alpha Dip';
  return mod.id;
}

function computeDifficulty(steps: number): 1 | 2 | 3 | 4 | 5 {
  if (steps <= 1) return 1;
  if (steps <= 3) return 2;
  if (steps <= 4) return 3;
  if (steps <= 6) return 4;
  return 5;
}

function getIconKey(scene: Phaser.Scene, mod: ModifierDef): string | null {
  if (mod.type === 'goggles') {
    if (mod.variant?.includes('mono')) return 'icon-goggle';
    return mod.variant?.includes('thin') ? 'icon-goggles-thin' : 'icon-goggles-thick';
  }
  if (mod.type === 'glasses')   return mod.variant?.includes('thin') ? 'icon-glasses-thin' : 'icon-glasses-thick';
  if (mod.type === 'belt')      return mod.variant?.includes('thin') ? 'icon-belt-thin' : 'icon-belt-thick';
  if (mod.type === 'pendant')   return 'icon-pendant';
  if (mod.type === 'pumpkin')   return 'icon-pumpkin';
  if (mod.type === 'underwear') return 'icon-underwear';
  // Newer mods: dedicated puzzle icons when the art has landed (reserved
  // slots — see Preloader's OPTIONAL_PUZZLE_ICONS), else the mod's own mask
  // art. icon-nose always resolves (real file, or the Preloader's zoomed bake
  // of mod-nose-big — the raw art is a tiny speck).
  const pick = (icon: string, art: string) => (scene.textures.exists(icon) ? icon : art);
  if (mod.type === 'nose')      return 'icon-nose';
  if (mod.type === 'bubble')    return pick('icon-bubble', 'mod-bubble');
  if (mod.type === 'plate')     return pick('icon-plate', 'mod-plate');
  if (mod.type === 'cone')      return pick('icon-cone', 'mod-cone');
  if (mod.type === 'scarf')     return pick('icon-scarf', 'mod-scarf');
  if (mod.type === 'alpha')     return 'icon-paint';
  return null;
}

const C = {
  BG:         0x1a0a2e,
  HEADER_BG:  0x0A0500,
  TEXT_LIGHT: '#FFFCE8',
  DARK_BROWN: '#3A1A08',
  TEXT_BEIGE: '#DEC998',
  ACCENT:     '#6DD400',
  WORN_RING:  0x6DD400,
} as const;

const HEADER_H = 64;

// The creator's in-progress work, carried through a Test Play round-trip
// (Editor → Game preview → back) so returning never wipes the recording.
export type EditorDraft = {
  title: string;
  hint: string;
  actions: string[];
  decoyCount: number;
};

// Tile design sizes — the grid is laid out at these sizes then scaled as a
// block to fit whatever space the screen leaves (see buildModPanel), so no
// screen size ever gets a broken grid, just a proportionally smaller one.
const TILE_W = 86, TILE_H = 44, TILE_SQ = 48, TILE_GAP = 6;

// ── Editor Scene ───────────────────────────────────────────
export class Editor extends Phaser.Scene {
  // The recorded action-id sequence — solution AND goal in one.
  private actions: string[] = [];
  private titleValue = 'My Custom Level';
  private hintValue = '';
  // Creator-chosen decoy count (0-3): unused stencils/colors padded into the
  // published palette so it doesn't spell out the recipe.
  private decoyCount = 2;

  // Everything buildUI creates goes in here so a resize can rebuild from
  // scratch (same pattern as Game/LevelSelect — the scene is fully
  // re-laid-out for the new size, not patched).
  private uiObjs: Phaser.GameObjects.GameObject[] = [];
  private goalRenderer: SlimeRenderer | null = null;
  private stepsText: Phaser.GameObjects.Text | null = null;
  private feedbackText: Phaser.GameObjects.Text | null = null;
  private decoyBtn: Phaser.GameObjects.Container | null = null;
  private splot: SplotMascot | null = null;
  private activePopup: Phaser.GameObjects.Container | null = null;

  private titleInput: HTMLInputElement | null = null;
  private hintInput: HTMLInputElement | null = null;
  // Where the current layout wants the DOM inputs (set by buildUI).
  private inputCx = 0;
  private inputW = 260;
  private titleInputY = 84;
  private hintInputY = 116;

  // Position the decoy button rebuilds itself at (it re-creates on every tap
  // to re-bake its label).
  private decoyX = 0;
  private decoyY = 0;

  // Guards every scene.start(...) call — prevents double-clicking back/Test
  // Play/Publish (or clicking one while another's transition is in flight)
  // from queuing more than one scene transition.
  private navigating = false;
  // True while a publish POST is in flight (or has succeeded) — publishing
  // creates a Reddit post, so a double-tap must never fire twice.
  private publishing = false;
  // Debounces the heavy relayout during continuous RESIZE events (window drag).
  private resizeRebuild: Phaser.Time.TimerEvent | null = null;

  // Text scale factor. The design's fixed 9-13px text is sized for phones;
  // tablets render the same canvas units on a much larger physical screen,
  // where it reads illegibly small. Every text size (and the chrome that has
  // to contain the text — header bar, badges, control buttons) multiplies by
  // this; phones (min dimension ≤ 480) stay exactly as designed.
  private tsf = 1;
  // The header bar height at the current text scale (HEADER_H × tsf).
  private hh = HEADER_H;

  constructor() { super('Editor'); }

  init(data?: { draft?: EditorDraft }) {
    // A Test Play round-trip hands the draft back — restore it so the creator
    // returns to exactly the recording they left, not an empty editor.
    const draft = data?.draft;
    // Phaser re-delivers the LAST scene data whenever the scene is started
    // without any — consume the draft here so it restores exactly once, and a
    // later fresh open (menu → Create, or after publishing) starts clean
    // instead of resurrecting a stale recording.
    this.sys.settings.data = {};
    this.actions    = draft ? [...draft.actions] : [];
    this.titleValue = draft?.title ?? 'My Custom Level';
    this.hintValue  = draft?.hint ?? '';
    this.decoyCount = draft?.decoyCount ?? 2;
    this.uiObjs     = [];
    this.decoyBtn   = null;
    this.splot      = null;
    this.activePopup = null;
    this.navigating = false;
    this.publishing = false;
  }

  // Safety net for the deferred background set — normally MainMenu has already
  // streamed it in the background and this queues nothing.
  preload() {
    this.load.setPath('assets');
    for (const { key, path } of DEFERRED_IMG) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(300, 26, 10, 46);

    this.titleInput = this.createOverlayInput('Level title...', this.titleValue, 60,
      (v) => { this.titleValue = v; });
    this.hintInput = this.createOverlayInput('Hint for players (optional)...', this.hintValue, 160,
      (v) => { this.hintValue = v; });

    this.buildUI();
    this.scale.on('resize', this.onResize, this);
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    // Full rebuild debounced — RESIZE mode streams events during a window drag.
    this.resizeRebuild?.remove();
    this.resizeRebuild = this.time.delayedCall(120, () => {
      this.resizeRebuild = null;
      this.buildUI();
    });
  }

  // ── Full layout (re)build ───────────────────────────────────
  private buildUI() {
    this.closeActivePopup();
    this.uiObjs.forEach((o) => o.destroy());
    this.uiObjs = [];
    this.decoyBtn?.destroy();
    this.decoyBtn = null;
    this.splot?.stopIdleAnims();
    this.splot = null;
    this.goalRenderer = null; // its container was in uiObjs

    const { width, height } = this.scale;
    this.tsf = Phaser.Math.Clamp(Math.min(width, height) / 480, 1, 1.5);
    this.hh = Math.round(HEADER_H * this.tsf);

    // Background — the full bg2 cloud stack, cover-scaled like every other
    // scene's backdrop.
    const bgKeys   = ['bg2-1', 'bg2-2', 'bg2-3', 'bg2-4'];
    const bgAlphas = [1, 0.8, 0.55, 0.3];
    bgKeys.forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(bgAlphas[i] ?? 0.3).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.uiObjs.push(img);
    });

    // Landscape gets a two-column layout (goal+controls left, build grid
    // right) with the inputs riding in the header's empty right half —
    // stacking everything vertically can never fit a 320-tall screen.
    const isLandscape = width > height && width >= 560;
    if (isLandscape) this.buildLandscape(width, height);
    else this.buildPortrait(width, height);

    // Reposition the DOM inputs for the new layout.
    if (this.titleInput) this.positionOverlayInput(this.titleInput, this.inputCx, this.titleInputY, this.inputW);
    if (this.hintInput)  this.positionOverlayInput(this.hintInput,  this.inputCx, this.hintInputY,  this.inputW);
  }

  private buildPortrait(width: number, height: number) {
    const cx = width / 2;
    const t = this.tsf;
    this.buildHeader(width, true);

    // Inputs sit on two rows just under the header.
    this.inputCx = cx;
    this.inputW = Math.min(width - 96, Math.round(300 * t));
    this.titleInputY = this.hh + Math.round(20 * t);
    this.hintInputY = this.titleInputY + Math.round(32 * t);

    const top = this.hintInputY + Math.round(26 * t);
    const bottomZone = height - Math.round(62 * t); // bottom buttons live below this line

    // Height budget: shrink the goal card first, the tile grid scales itself
    // to whatever remains (buildModPanel), so the layout can't overflow.
    // The panel's floor scales with the screen — on short phones a fixed 150px
    // panel squeezed the 25-tile grid into ~26px micro-tiles while the goal
    // card kept 90px; trading ~15px of goal size buys visibly larger tiles.
    const blockFixed = Math.round((10 + 36 + 8 + 28 + 22) * t); // controls + steps + feedback rows
    let goalSz = Math.min(Math.round(width * 0.28), 120);
    const minPanel = Math.max(150, Math.round((bottomZone - top) * 0.45));
    while (goalSz > 56 && (goalSz + 24) + blockFixed + minPanel > bottomZone - top) goalSz -= 4;

    const cardH = goalSz + 24;
    this.buildGoalCard(cx, top + cardH / 2, goalSz, width);

    const ctrlY = top + cardH + Math.round((10 + 18) * t);
    this.buildControlsRow(cx, ctrlY);

    const stepsY = ctrlY + Math.round((18 + 8 + 14) * t);
    this.buildStepsPill(cx, stepsY, width - 24);
    this.buildFeedback(cx, stepsY + Math.round((14 + 4 + 8) * t), width - 32);

    const panelTop = stepsY + Math.round((14 + 22) * t);
    this.buildModPanel(cx, panelTop, width - 12, bottomZone - panelTop, width >= 520 ? 5 : 4);

    this.buildBottomButtons(cx, height, width);

    // Splot beside the card on wide portrait (tablets).
    if (width >= 620) {
      this.spawnSplot(cx - (Math.min(width - 24, Math.round(goalSz * 2.3)) / 2) - 60, top + cardH - 40, 84);
    }
  }

  private buildLandscape(width: number, height: number) {
    const t = this.tsf;
    // Inputs stacked in the header's right half — sized before the header so
    // the wordmark knows where it must stop (they collided at 568w). The two
    // rows keep their 64px-header proportions as the bar grows with tsf.
    this.inputW = Math.min(width - 240, Math.round(330 * t));
    this.inputCx = width - 12 - this.inputW / 2;
    this.titleInputY = Math.round(this.hh * 0.345);
    this.hintInputY = Math.round(this.hh * 0.78);
    this.buildHeader(width, false, width - 12 - this.inputW - 10);

    const leftW  = Math.min(Math.round(width * 0.42), Math.round(340 * t));
    const leftCx = 12 + leftW / 2;
    const rightX0 = leftW + 24;
    const rightW  = width - rightX0 - 12;
    const rightCx = rightX0 + rightW / 2;

    const top = this.hh + 12;
    const bottomZone = height - Math.round(62 * t);

    // Left column: goal card + controls + steps + feedback, bottom buttons
    // pinned at the column's foot.
    const blockFixed = Math.round((10 + 36 + 8 + 28 + 20) * t);
    const goalSz = Phaser.Math.Clamp((bottomZone - top) - blockFixed - 24, 56, 120);
    const cardH = goalSz + 24;
    this.buildGoalCard(leftCx, top + cardH / 2, goalSz, leftW);

    const ctrlY = top + cardH + Math.round((10 + 18) * t);
    this.buildControlsRow(leftCx, ctrlY);

    const stepsY = ctrlY + Math.round((18 + 8 + 14) * t);
    this.buildStepsPill(leftCx, stepsY, leftW - 8);
    this.buildFeedback(leftCx, stepsY + Math.round((14 + 4 + 8) * t), leftW - 16);

    this.buildBottomButtons(leftCx, height, leftW + 24);

    // Splot in the slack between the left block and the buttons, if any.
    const slack = bottomZone - (stepsY + Math.round(36 * t));
    if (slack >= 104) {
      this.spawnSplot(leftCx, stepsY + Math.round(36 * t) + slack / 2, Math.min(96, slack - 12));
    }

    // Right column: the build panel gets the full height, capped on huge
    // desktops — the grid tops out at 1.5× scale, so an uncapped panel there
    // is mostly empty black. Centered in whatever the cap leaves over.
    const panelW = Math.min(rightW, 780);
    const panelH = Math.min(bottomZone - top, 700);
    const panelTop = top + ((bottomZone - top) - panelH) / 2;
    const cols = panelW >= 400 ? 4 : 3;
    this.buildModPanel(rightCx, panelTop, panelW, panelH, cols);
  }

  // Header strip matching the Game scene: dark bar, beige icon button for
  // back, pencil-badged title. In landscape the title hugs the left so the
  // DOM inputs can occupy the right half.
  private buildHeader(width: number, centered: boolean, maxRight = width) {
    const t = this.tsf;
    this.uiObjs.push(this.add.rectangle(width / 2, this.hh / 2, width, this.hh, C.HEADER_BG).setDepth(10));

    const backSz = Math.round(48 * Math.min(t, 1.25));
    const back = addBeigeButtonShell(this, 10 + backSz / 2, this.hh / 2, backSz, backSz, false,
      () => this.goToScene('MainMenu'));
    back.addContent([addDepthIcon(this, 0, -1, 'icon-arrow', Math.round(21 * t), Math.round(21 * t)).setAngle(180)]);
    back.container.setDepth(11);
    this.uiObjs.push(back.container);

    const title = this.add.text(0, this.hh / 2, 'LEVEL EDITOR', {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.round(11 * t)}px`,
      color: C.TEXT_LIGHT,
      stroke: '#000000',
      strokeThickness: 4,
      letterSpacing: 1,
    }).setOrigin(0, 0.5).setDepth(11);
    const iconSz = Math.round(18 * t);
    const totalW = iconSz + 8 + title.width;
    const startX = centered ? width / 2 - totalW / 2 : 10 + backSz + 10;
    // In landscape the DOM inputs occupy the header's right half — the
    // wordmark shrinks rather than running underneath them (maxRight).
    const maxTextW = maxRight - (startX + iconSz + 8);
    if (title.width > maxTextW && maxTextW > 0) title.setScale(maxTextW / title.width);
    const icon = addDepthIcon(this, startX + iconSz / 2, this.hh / 2 - 1, 'icon-pencil', iconSz, iconSz).setDepth(11);
    title.setX(startX + iconSz + 8);
    this.uiObjs.push(title, icon);
  }

  // The goal preview: beige solid card (same asset as the Game scene's
  // Goal/Current cards) with a badge-pill label riding its top edge.
  private buildGoalCard(cx: number, cy: number, goalSz: number, maxW: number) {
    const cardW = Math.min(maxW - 24, Math.max(150, Math.round(goalSz * 2.3)));
    const cardH = goalSz + 24;

    this.uiObjs.push(addBeigeSolidCard(this, cx, cy, cardW, cardH).setDepth(2));
    this.uiObjs.push(addBeigeBadge(this, cx, cy - cardH / 2,
      Math.round(132 * this.tsf), Math.round(28 * this.tsf)).setDepth(4));
    this.uiObjs.push(this.add.text(cx, cy - cardH / 2, 'GOAL SLIME', {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.round(9 * this.tsf)}px`,
      color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(5));

    this.goalRenderer = new SlimeRenderer(this, cx, cy, goalSz);
    // Above the depth-2 card — at the default depth 0 the opaque card draws
    // over the slime and it renders as a barely-visible ghost.
    this.goalRenderer.container.setDepth(3);
    this.goalRenderer.setPattern(EDITOR_DEFS, this.actions);
    this.uiObjs.push(this.goalRenderer.container);
  }

  private buildControlsRow(cx: number, cy: number) {
    // Undo (64) + Reset (64) + Decoys (104), 8px gaps → 248 total, all × tsf.
    const t = this.tsf;
    this.buildSmallBtn(cx - Math.round(92 * t), cy, Math.round(64 * t), Math.round(36 * t), 'Undo',  () => this.undo());
    this.buildSmallBtn(cx - Math.round(20 * t), cy, Math.round(64 * t), Math.round(36 * t), 'Reset', () => this.reset());
    this.decoyX = cx + Math.round(72 * t);
    this.decoyY = cy;
    this.buildDecoyButton();
  }

  // Badge sized around the measured worst-case readout — Press Start 2P runs
  // a full fontSize width per character, so the old fixed 236px badge was
  // narrower than "Steps: 20/20  |  Diff: 5/5" at 10px and the text overflowed
  // the pill on every screen. Shrinks the font first when even the badge
  // wouldn't fit maxW (thin landscape left columns).
  private buildStepsPill(cx: number, cy: number, maxW: number) {
    const worst = `Steps: ${MAX_SOLUTION_STEPS}/${MAX_SOLUTION_STEPS}  |  Diff: 5/5`;
    this.stepsText = this.add.text(cx, cy, worst, {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.round(10 * this.tsf)}px`,
      color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
    }).setOrigin(0.5).setDepth(5);
    let fs = Math.round(10 * this.tsf);
    while (fs > 7 && this.stepsText.width + 20 > maxW) {
      fs -= 1;
      this.stepsText.setFontSize(fs);
    }
    const badgeW = Math.min(maxW, Math.round(this.stepsText.width) + 20);
    this.uiObjs.push(addBeigeBadge(this, cx, cy, badgeW, Math.round(28 * this.tsf)).setDepth(4));
    this.uiObjs.push(this.stepsText);
    this.updateMeta();
  }

  private buildFeedback(cx: number, cy: number, wrapW: number) {
    this.feedbackText = this.add.text(cx, cy, '', {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.round(10 * this.tsf)}px`,
      color: '#ff8888',
      stroke: '#1a0a2e',
      strokeThickness: 3,
      wordWrap: { width: wrapW },
      align: 'center',
    }).setOrigin(0.5).setDepth(20);
    this.uiObjs.push(this.feedbackText);
  }

  private spawnSplot(x: number, y: number, size: number) {
    this.splot = new SplotMascot(this, x, y, size);
    this.splot.container.setDepth(3);
    this.uiObjs.push(this.splot.container);
  }

  // Cycles 0→3. addBeigeButton bakes its label, so the button is rebuilt on
  // every tap — cheap, and it keeps the label/state in one place.
  private buildDecoyButton() {
    this.decoyBtn?.destroy();
    this.decoyBtn = addBeigeButton(this, {
      x: this.decoyX, y: this.decoyY,
      width: Math.round(104 * this.tsf), height: Math.round(36 * this.tsf),
      label: `Decoys: ${this.decoyCount}`,
      fontSize: Math.round(10 * this.tsf), fontFamily: PIXELIFY,
      onClick: () => {
        this.decoyCount = (this.decoyCount + 1) % 4;
        this.buildDecoyButton();
        this.showFeedback(
          this.decoyCount === 0
            ? 'No decoys. The palette shows exactly what the solve uses.'
            : `${this.decoyCount} decoy ${this.decoyCount === 1 ? 'item pads' : 'items pad'} the palette to hide the recipe.`,
          false,
        );
      },
    }).setDepth(5);
  }

  // ── Build panel — the 19-slot tile grid on the dark palette panel ─────────
  // The grid is laid out at design size then uniformly scaled to fit the
  // panel, so any panel dimensions produce a complete, proportional grid.
  private buildModPanel(cx: number, topY: number, panelW: number, panelH: number, cols: number) {
    if (panelH < 90) return; // pathological screens: skip rather than smear
    this.uiObjs.push(addDarkPanel(this, cx, topY + panelH / 2, panelW, panelH).setDepth(2));

    this.uiObjs.push(this.add.text(cx, topY + Math.round(15 * this.tsf), 'BUILD YOUR GOAL', {
      fontFamily: PIXEL_FONT,
      fontSize: `${Math.round(9 * this.tsf)}px`,
      color: C.TEXT_BEIGE,
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setDepth(5));

    const innerTop = topY + Math.round(28 * this.tsf);
    const innerH   = panelH - Math.round(40 * this.tsf);
    const innerW   = panelW - 24;

    // Prefer labeled tiles; fall back to compact icon tiles (the Game
    // palette's visual language: icon + orientation arrow) when labeled ones
    // would have to shrink too far. Scale is allowed above 1 (capped) so the
    // grid fills a roomy tablet/desktop panel instead of hugging the top.
    const layout = (tw: number, th: number, nCols: number) => {
      const rows = Math.ceil(GRID_SLOTS.length / nCols);
      const w = nCols * tw + (nCols - 1) * TILE_GAP;
      const h = rows * th + (rows - 1) * TILE_GAP;
      return { rows, w, h, scale: Math.min(innerW / w, innerH / h, 1.5) };
    };
    const labeled = layout(TILE_W, TILE_H, cols);
    // Compact packs by best fit, not by width alone: when HEIGHT is the
    // binding constraint (short phones), more columns → fewer rows → bigger
    // tiles, so sweep the plausible column counts and keep the largest scale.
    let compactCols = 4;
    let compact = layout(TILE_SQ, TILE_SQ, compactCols);
    for (let c = 5; c <= 12; c++) {
      const cand = layout(TILE_SQ, TILE_SQ, c);
      if (cand.scale > compact.scale) { compact = cand; compactCols = c; }
    }
    // Only drop to compact tiles when labeled ones would have to shrink below
    // legibility AND compact genuinely buys more room. The label's 10px design
    // size needs to stay close to 1:1 to read at all on a phone screen — the
    // old 0.62 threshold let it shrink past 6px before bailing to icons.
    const useCompact = labeled.scale < 0.85 && compact.scale > labeled.scale + 0.08;
    const mode = useCompact ? compact : labeled;
    const nCols = useCompact ? compactCols : cols;
    const tw = useCompact ? TILE_SQ : TILE_W;
    const th = useCompact ? TILE_SQ : TILE_H;
    const scale = Math.max(0.5, mode.scale);

    // Vertically center the scaled block in the available inner height.
    const gridH = mode.h * scale;
    const grid = this.add.container(cx, innerTop + Math.max(gridH, innerH) / 2).setScale(scale).setDepth(5);
    this.uiObjs.push(grid);

    GRID_SLOTS.forEach((slot, i) => {
      const col = i % nCols;
      const row = Math.floor(i / nCols);
      const x = (col - (nCols - 1) / 2) * (tw + TILE_GAP);
      const y = (row - (mode.rows - 1) / 2) * (th + TILE_GAP);
      grid.add(this.buildGridTile(x, y, tw, th, slot, useCompact));
    });
  }

  private buildGridTile(
    x: number, y: number, w: number, h: number, slot: GridSlot, compact: boolean,
  ): Phaser.GameObjects.Container {
    const onClick = () => {
      if (slot.kind === 'paint') this.showColorPicker();
      else if (slot.kind === 'pumpkin') this.showPumpkinPicker();
      else this.applyGoalMod(slot.mod);
    };
    const shell = addBeigeButtonShell(this, x, y, w, h, false, onClick, true);

    const iconKey = slot.kind === 'paint' ? 'icon-paint'
      : slot.kind === 'pumpkin' ? 'icon-pumpkin'
      : getIconKey(this, slot.mod);
    const content: Phaser.GameObjects.GameObject[] = [];

    if (compact) {
      if (iconKey && this.textures.exists(iconKey)) {
        content.push(addDepthIcon(this, 0, 0, iconKey, 30, 30, 1, 0.4));
      }
      // Orientation arrow, bottom-right — the same disambiguation the Game
      // palette tiles use (thickness is already carried by the icon art).
      // The scarf joins in once its direction-neutral icon is in use: one
      // icon serves both diagonals, the arrow says which one.
      const variant = slot.kind === 'stencil' ? slot.mod.variant : undefined;
      const scarfArrow = slot.kind === 'stencil' && slot.mod.type === 'scarf'
        && this.textures.exists('icon-scarf');
      if (variant?.startsWith('h') || variant?.startsWith('v') || scarfArrow) {
        const arrow = addDepthIcon(this, w * 0.28, h * 0.28, 'icon-arrow', 11, 11, 1, 0.4);
        if (scarfArrow) arrow.setAngle(variant === 'left' ? 135 : -45);
        else if (variant?.startsWith('v')) arrow.setAngle(90);
        content.push(arrow);
      }
    } else {
      if (iconKey && this.textures.exists(iconKey)) {
        content.push(addDepthIcon(this, -w / 2 + 16, 0, iconKey, 20, 20, 1, 0.4));
      }
      const label = slot.kind === 'paint' ? 'Paint...'
        : slot.kind === 'pumpkin' ? 'Pumpkin...'
        : modLabel(slot.mod);
      // Pixelify, not PIXEL_FONT — Press Start 2P runs a full fontSize width
      // per character, so "Goggles"/"Underwear" would overflow the wrap width
      // (single words don't wrap, they spill past the tile edge).
      // Matches the words-in-Pixelify / numerals-in-PS2P convention anyway.
      // 12px design: the grid block scales itself to fit (0.5-1.5×), and at
      // tablet scale the old 10px design left tiles mostly empty beige with a
      // squint-sized label in the corner.
      const labelTxt = this.add.text(-w / 2 + 28, 0, label, {
        fontFamily: PIXELIFY,
        fontSize: '12px',
        color: C.DARK_BROWN,
        wordWrap: { width: w - 34 },
      }).setOrigin(0, 0.5);
      // Single words don't wrap, they spill — a measured clamp catches the
      // labels ("Underwear", "Pumpkin...") that still land on the border art.
      if (labelTxt.width > w - 34) labelTxt.setScale((w - 34) / labelTxt.width);
      content.push(labelTxt);
    }

    shell.addContent(content);
    return shell.container;
  }

  // ── Popup pickers — the Game palette's paint pot / pumpkin pot UX ─────────
  private showColorPicker() {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const COLS = width > height ? 8 : 4;
    const rows = Math.ceil(PAINT_COLORS.length / COLS);

    const t = this.tsf;
    const pad = 14, gap = 8, titleH = Math.round(34 * t);
    const slotSz = Math.min(Math.round(64 * t), Math.floor(
      (Math.min(width - 24, Math.round((COLS === 8 ? 620 : 340) * t)) - pad * 2 - gap * (COLS - 1)) / COLS));
    const popW = slotSz * COLS + gap * (COLS - 1) + pad * 2;
    const popH = titleH + rows * (slotSz + gap) - gap + pad * 2;
    const pcx = width / 2, pcy = height / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(pcx, pcy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);
    items.push(addBeigeButtonShell(this, pcx, pcy, popW, Math.max(popH, 66), false).container);
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2 + 6, 'Pick a color', {
      fontFamily: PIXELIFY, fontSize: `${Math.round(15 * t)}px`, fontStyle: 'bold', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const gridLeft = pcx - popW / 2 + pad;
    const gridTop  = pcy - popH / 2 + titleH + pad;
    PAINT_COLORS.forEach((mod, i) => {
      const sx = gridLeft + (i % COLS) * (slotSz + gap) + slotSz / 2;
      const sy = gridTop + Math.floor(i / COLS) * (slotSz + gap) + slotSz / 2;
      const numCol = parseInt((mod.color ?? '#ffffff').replace('#', ''), 16);
      const shell = addBeigeButtonShell(this, sx, sy, slotSz, slotSz, false, () => {
        this.closeActivePopup();
        this.applyGoalMod(mod);
      }, true);
      const slimeSz = Math.round(slotSz * 0.62);
      const shadow = this.add.image(2, 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      shadow.setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
      shadow.setAlpha(0.28);
      const shineKey = bakeSwatchShine(this, numCol);
      const slimeImg = this.add.image(0, 0, shineKey).setDisplaySize(slimeSz, slimeSz);
      const border   = this.add.image(0, 0, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      shell.addContent([shadow, slimeImg, border]);
      items.push(shell.container);
    });

    this.openPopup(items);
  }

  private showPumpkinPicker() {
    this.closeActivePopup();
    const { width, height } = this.scale;
    const mods = ALL_MODS
      .filter((m) => m.type === 'pumpkin')
      .sort((a, b) => (a.coverage ?? 0) - (b.coverage ?? 0));
    const worn = replayOps(EDITOR_DEFS, this.actions).worn;

    const t = this.tsf;
    const pad = 14, gap = 10, titleH = Math.round(36 * t);
    const slotSz = Math.min(Math.round(104 * t), Math.floor(
      (Math.min(width - 24, Math.round(360 * t)) - pad * 2 - gap * (mods.length - 1)) / mods.length));
    const popW = slotSz * mods.length + gap * (mods.length - 1) + pad * 2;
    const popH = titleH + pad + slotSz + pad;
    const pcx = width / 2, pcy = height / 2;
    const items: Phaser.GameObjects.GameObject[] = [];

    const overlay = this.add.rectangle(pcx, pcy, width, height, 0x000000, 0.55).setInteractive();
    overlay.on('pointerup', () => this.closeActivePopup());
    items.push(overlay);
    items.push(addBeigeButtonShell(this, pcx, pcy, popW, popH, false).container);
    // Same in-the-moment teaching as the Game picker: with a pumpkin on, the
    // title says the tap swaps rather than stacks.
    const anyPumpkinWorn = worn.some((id) => id.startsWith('pumpkin-'));
    items.push(this.add.text(pcx, pcy - popH / 2 + titleH / 2 + 4, anyPumpkinWorn ? 'Tap a size to swap' : 'Pumpkin size', {
      fontFamily: PIXELIFY, fontSize: `${Math.round(15 * t)}px`, fontStyle: 'bold', color: C.DARK_BROWN,
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0.5));

    const gridLeft = pcx - popW / 2 + pad;
    const tileY    = pcy - popH / 2 + titleH + pad + slotSz / 2;
    const slimeSz  = Math.round(slotSz * 0.56);

    mods.forEach((mod, i) => {
      const sx  = gridLeft + i * (slotSz + gap) + slotSz / 2;
      const cov = mod.coverage ?? 50;
      const isWorn = worn.includes(`pumpkin-${cov}`);

      const shell = addBeigeButtonShell(this, sx, tileY, slotSz, slotSz, false, () => {
        this.closeActivePopup();
        this.applyGoalMod(mod);
      }, true);

      const sh  = this.add.image(2, -slotSz * 0.08 + 2, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      sh.setTint(0x000000).setTintMode(Phaser.TintModes.FILL);
      sh.setAlpha(0.30);
      const sli = this.add.image(0, -slotSz * 0.08, 'slime-color').setDisplaySize(slimeSz, slimeSz);
      const brd = this.add.image(0, -slotSz * 0.08, 'slime-border').setDisplaySize(slimeSz, slimeSz);
      // Pumpkin above the border — worn stencils sit ON the slime.
      const pum = this.add.image(0, -slotSz * 0.08, `mod-pumpkin-${cov}`).setDisplaySize(slimeSz, slimeSz);
      const lbl = this.add.text(0, slotSz * 0.30, isWorn ? `${cov}% ON` : anyPumpkinWorn ? `${cov}% SWAP` : `${cov}%`, {
        // #1E3D08, not the lighter #2E5C0A — this sits on the beige button
        // shell, where the lighter green was too close to it to read.
        fontFamily: PIXEL_FONT, fontSize: `${Math.round(9 * t)}px`, color: isWorn ? '#1E3D08' : C.DARK_BROWN,
      }).setOrigin(0.5);
      shell.addContent([sh, sli, brd, pum, lbl]);
      if (isWorn) {
        shell.addContent([
          this.add.rectangle(0, 0, slotSz - 8, slotSz - 8).setStrokeStyle(3, C.WORN_RING, 1),
        ]);
      }
      items.push(shell.container);
    });

    this.openPopup(items);
  }

  private openPopup(items: Phaser.GameObjects.GameObject[]) {
    // The DOM inputs float above the canvas — hide them so the dim overlay
    // actually dims everything.
    this.setInputsVisible(false);
    this.activePopup = this.add.container(0, 0, items).setDepth(60);
    this.tweens.add({
      targets: this.activePopup,
      alpha: { from: 0, to: 1 },
      duration: 160,
      ease: 'Quad.easeOut',
    });
  }

  private closeActivePopup() {
    if (!this.activePopup) return;
    this.activePopup.destroy(true);
    this.activePopup = null;
    this.setInputsVisible(true);
  }

  private setInputsVisible(visible: boolean) {
    const display = visible ? '' : 'none';
    if (this.titleInput) this.titleInput.style.display = display;
    if (this.hintInput)  this.hintInput.style.display = display;
  }

  private buildBottomButtons(cx: number, height: number, width: number) {
    const t = this.tsf;
    const btnY = height - Math.round(32 * t);
    const btnW = Math.min((width - 48) / 2, Math.round(148 * t));
    const btnH = Math.round(46 * t);

    this.uiObjs.push(addBeigeButton(this, {
      x: cx - btnW / 2 - 6, y: btnY,
      width: btnW, height: btnH,
      label: 'Test Play',
      iconKey: 'icon-play',
      fontSize: Math.round(13 * t), fontFamily: PIXELIFY,
      onClick: () => this.testPlay(),
    }).setDepth(8));

    this.uiObjs.push(addBeigeButton(this, {
      x: cx + btnW / 2 + 6, y: btnY,
      width: btnW, height: btnH,
      label: 'Publish',
      iconKey: 'icon-share',
      fontSize: Math.round(13 * t), fontFamily: PIXELIFY,
      onClick: () => void this.publish(),
    }).setDepth(8));
  }

  private buildSmallBtn(x: number, y: number, w: number, h: number, label: string, cb: () => void) {
    this.uiObjs.push(addBeigeButton(this, {
      x, y,
      width: Math.max(w, 60), height: Math.max(h, 36),
      label,
      fontSize: Math.round(11 * this.tsf), fontFamily: PIXELIFY,
      onClick: cb,
    }).setDepth(5));
  }

  // ── Goal building — the creator plays their own level ──────
  private applyGoalMod(mod: ModifierDef) {
    // The publish cap, enforced while recording: every level ships with a
    // proof it's beatable in at most MAX_SOLUTION_STEPS moves.
    if (this.actions.length >= MAX_SOLUTION_STEPS) {
      playSfx('refuse');
      this.showFeedback(`Max ${MAX_SOLUTION_STEPS} moves. Levels must stay beatable! Undo or Reset.`, true);
      return;
    }
    const before = replayOps(EDITOR_DEFS, this.actions);
    // Same rule as in play: goggles a splash landed on are broken for the run.
    if (before.broken.includes(mod.id)) {
      playSfx('refuse');
      this.showFeedback(`${modLabel(mod)} broke. Goggles are one-time use! (Undo or Reset restores them.)`, true);
      return;
    }
    // The alpha dip is one per level.
    if (mod.type === 'alpha' && before.spent.includes(mod.id)) {
      playSfx('refuse');
      this.showFeedback('Alpha dip already used — one per level! (Undo or Reset.)', true);
      return;
    }
    const brokeGoggles = before.worn.some(isBreakableMask);
    const noseWorn = before.worn.some((id) => id.startsWith('nose-'));
    const wasWorn = before.worn.includes(mod.id);
    // Wear rules, same as in play — a recording must replay strictly at
    // publish, so a tap the sim would refuse must not be recorded either.
    // A different pumpkin size is a SWAP (one action, worn count unchanged);
    // only a wear that would push Splot past MAX_WORN is refused.
    const isPumpkinSwap = mod.type === 'pumpkin' && !wasWorn
      && before.worn.some((id) => id.startsWith('pumpkin-'));
    const wearsNewSlot = mod.type === 'nose'
      ? !noseWorn
      : mod.type !== 'paint' && mod.type !== 'alpha' && mod.type !== 'bubble'
        && !wasWorn && !isPumpkinSwap;
    if (wearsNewSlot && before.worn.length >= MAX_WORN) {
      playSfx('refuse');
      this.showFeedback(`Splot can only wear ${MAX_WORN} things at once. Take something off!`, true);
      return;
    }
    this.actions.push(mod.id);
    // Same action → sound mapping as play (see Game.playActionSfx) so the
    // editor's goal-painting feels like the same toybox.
    if (mod.type === 'paint')       playSfx('splash');
    else if (mod.type === 'alpha')  playSfx('dip');
    else if (mod.type === 'bubble') playSfx('bubble');
    else if (mod.type === 'pumpkin' && !wasWorn) playSfx('pumpkin');
    else if (wasWorn)               playSfx('remove');
    else                            playSfx('wear');
    this.goalRenderer?.setPattern(EDITOR_DEFS, this.actions);
    this.goalRenderer?.playApplyAnim(this);
    this.updateMeta();

    if (mod.type === 'paint') {
      this.showFeedback(brokeGoggles ? 'Splash! The goggles snapped off, one-time use.' : '', false);
    } else if (mod.type === 'alpha') {
      this.showFeedback(`Alpha dip! Everything exposed fades to 75%.${brokeGoggles ? ' Goggles snapped off.' : ''}`, false);
    } else if (mod.type === 'bubble') {
      this.showFeedback('Bubble! The inner circle fades to 75% — reuse it freely.', false);
    } else if (mod.type === 'nose') {
      this.showFeedback(noseWorn ? 'Nose off.' : 'Nose on (small). Each paint grows it; big + a splash pops it off!', false);
    } else if (mod.type === 'goggles' && !wasWorn) {
      this.showFeedback(`${modLabel(mod)} on. Breaks off after one splash!`, false);
    } else if (isPumpkinSwap) {
      this.showFeedback(`Swapped to ${modLabel(mod)} — one pumpkin at a time.`, false);
    } else {
      this.showFeedback(
        wasWorn ? `${modLabel(mod)} off.` : `${modLabel(mod)} on, protects what it covers.`,
        false,
      );
    }
  }

  private undo() {
    if (this.actions.length === 0) return;
    playSfx('remove');
    this.actions.pop();
    this.goalRenderer?.setPattern(EDITOR_DEFS, this.actions);
    this.updateMeta();
  }

  private reset() {
    if (this.actions.length > 0) playSfx('reset');
    this.actions = [];
    this.goalRenderer?.setPattern(EDITOR_DEFS, this.actions);
    this.updateMeta();
  }

  private updateMeta() {
    const steps = this.actions.length;
    const diff  = computeDifficulty(steps);
    this.stepsText?.setText(`Steps: ${steps}/${MAX_SOLUTION_STEPS}  |  Diff: ${diff}/5`);
  }

  private showFeedback(msg: string, isError: boolean) {
    if (!this.feedbackText) return;
    if (!msg) { this.feedbackText.setAlpha(0); return; }
    this.splot?.setExpression(isError ? 'pain' : 'excited', 1400);
    this.feedbackText.setText(msg).setColor(isError ? '#ff8888' : '#6DD400').setAlpha(1);
    this.tweens.killTweensOf(this.feedbackText);
    this.time.delayedCall(2200, () => {
      if (this.feedbackText?.active) {
        this.tweens.add({ targets: this.feedbackText, alpha: 0, duration: 300 });
      }
    });
  }

  // Goals must be bare slimes — a level can't be finished while stencils are
  // still on, so a recording that ends worn isn't a valid goal either.
  private validateRecording(): string | null {
    if (this.actions.length === 0) return 'Paint something to build a goal first!';
    if (!this.actions.some((id) => id.startsWith('paint-'))) return 'Goals need at least one splash of paint!';
    const { worn } = replayOps(EDITOR_DEFS, this.actions);
    if (worn.length > 0) return 'Take every stencil off, goals are bare slimes!';
    return null;
  }

  // ── Test / Publish ─────────────────────────────────────────
  private testPlay() {
    const err = this.validateRecording();
    if (err) {
      this.showFeedback(err, true);
      return;
    }
    const level = this.buildLevelData('__preview__');
    // The draft rides along so the preview's exits (win or back) can hand the
    // recording back to a fresh Editor instead of wiping it.
    const draft: EditorDraft = {
      title: (this.titleInput?.value ?? this.titleValue).trim() || 'My Custom Level',
      hint: this.hintInput?.value ?? this.hintValue,
      actions: [...this.actions],
      decoyCount: this.decoyCount,
    };
    this.goToScene('Game', { levelId: '__preview__', previewData: level, editorDraft: draft });
  }

  // Centralizes every scene.start(...) call — see `navigating` field comment.
  private goToScene(key: string, data?: Record<string, unknown>) {
    if (this.navigating) return;
    this.navigating = true;
    this.removeInputs();
    this.cameras.main.fadeOut(250, 26, 10, 46);
    this.time.delayedCall(260, () => this.scene.start(key, data));
  }

  private async publish() {
    // Publishing creates a Reddit post — a double-tap must not create two.
    // The flag stays set on success (the scene navigates away); only failure
    // paths clear it so the creator can retry.
    if (this.publishing) return;
    const err = this.validateRecording();
    if (err) {
      this.showFeedback(err, true);
      return;
    }
    this.publishing = true;
    this.showFeedback('Publishing your level…', false);
    const title = (this.titleInput?.value ?? '').trim() || 'My Custom Level';
    this.titleValue = title;
    const hint = (this.hintInput?.value ?? '').trim().slice(0, 160);

    try {
      const res = await fetch('/api/level/create', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          difficulty:   computeDifficulty(this.actions.length),
          palette:      this.buildPalette(),
          optimalSteps: this.actions.length,
          solution:     [...this.actions],
          ...(hint ? { hint } : {}),
        }),
        // Publishing does real work server-side (validation + a Reddit post) —
        // generous cap, but a hung request must still free the Publish button.
        signal: AbortSignal.timeout(15000),
      });

      // The player may have already navigated away (e.g. tapped back) while
      // this request was in flight — don't touch UI/scene state that's gone.
      if (this.navigating) return;

      if (res.status === 401) {
        this.publishing = false;
        this.showFeedback('Log in to publish levels!', true);
        return;
      }
      if (!res.ok) {
        const err = await res.json() as { message?: string };
        this.publishing = false;
        this.showFeedback(err.message ?? 'Failed to publish', true);
        return;
      }

      const data = await res.json() as LevelCreateResponse;
      playSfx('confirm');
      this.showFeedback('Published! Sharing your level…', false);
      this.time.delayedCall(1800, () => {
        this.goToScene('Game', { levelId: data.levelId });
      });
    } catch {
      this.publishing = false;
      if (!this.navigating) this.showFeedback('Network error, try again', true);
    }
  }

  private buildPalette(): ModifierDef[] {
    // Every distinct def the recording used + the creator-chosen decoy count
    const usedIds = new Set(this.actions);
    const palette = EDITOR_DEFS.filter(d => usedIds.has(d.id));
    const decoyPool = ALL_MODS.filter(m => !usedIds.has(m.id));

    for (let i = 0; i < Math.min(this.decoyCount, decoyPool.length); i++) {
      const idx = Math.floor(Math.random() * decoyPool.length);
      const [decoy] = decoyPool.splice(idx, 1);
      if (decoy) palette.push(decoy);
    }

    // Shuffle so palette order doesn't leak the solution order
    for (let i = palette.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = palette[i]!;
      palette[i] = palette[j]!;
      palette[j] = tmp;
    }
    return palette;
  }

  private buildLevelData(id: string): LevelData {
    const hint = this.hintValue.trim().slice(0, 160);
    return {
      id,
      title:           this.titleValue,
      difficulty:      computeDifficulty(this.actions.length),
      palette:         this.buildPalette(),
      optimalSteps:    this.actions.length,
      optimalSolution: [...this.actions],
      ...(hint ? { hint } : {}),
    };
  }

  private createOverlayInput(
    placeholder: string, value: string, maxLength: number,
    onInput: (v: string) => void,
  ): HTMLInputElement {
    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = placeholder;
    input.maxLength   = maxLength;
    input.value       = value;

    // Beige field matching the UI assets (same treatment as the splat-card
    // caption input and the community search box).
    Object.assign(input.style, {
      position:     'fixed',
      padding:      '0 10px',
      boxSizing:    'border-box',
      background:   '#FFF6DF',
      color:        '#3A1A08',
      border:       '2px solid #7A4A20',
      borderRadius: '8px',
      outline:      'none',
      zIndex:       '100',
      fontFamily:   '"Pixelify Sans", sans-serif',
    });

    const canvas = this.game.canvas;
    const parent = canvas.parentElement ?? document.body;
    parent.appendChild(input);
    input.addEventListener('input', () => onInput(input.value));
    return input;
  }

  private positionOverlayInput(input: HTMLInputElement, cx: number, y: number, w: number) {
    const canvas = this.game.canvas;
    const rect   = canvas.getBoundingClientRect();
    const sx     = rect.width  / this.scale.width;
    const sy     = rect.height / this.scale.height;
    const scale  = Math.min(sx, sy);
    const inputH = 26 * this.tsf;

    Object.assign(input.style, {
      left:     `${rect.left + (cx - w / 2) * sx}px`,
      top:      `${rect.top  + (y - inputH / 2) * sy}px`,
      width:    `${w * sx}px`,
      height:   `${inputH * sy}px`,
      fontSize: `${13 * this.tsf * scale}px`,
    });
  }

  private removeInputs() {
    this.titleInput?.remove();
    this.titleInput = null;
    this.hintInput?.remove();
    this.hintInput = null;
  }

  shutdown() {
    this.navigating = true;
    this.scale.off('resize', this.onResize, this);
    this.removeInputs();
    this.splot?.stopIdleAnims();
    this.splot = null;
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
