import * as Phaser from 'phaser';
import { playSfx } from '../audio';
import { addBeigeButton, addBeigeButtonShell, BODY_FONT, PIXEL_FONT } from './PixelUI';

// ── First-visit welcome tour ────────────────────────────────────────────────
// A brand-new player lands on the home page with six buttons and no idea what
// any of them do. This overlay walks them through the whole game as a short
// story told by Splot: a dim layer with a spotlight hole over one home-screen
// element at a time, a beige speech panel underneath, and a closing choice —
// walk into the Splash Course world (the tutorial page of LevelSelect) or
// stay and explore. MainMenu owns when it appears (first visit only) and
// records the spotlight bounds while laying out; this class only renders and
// paces the steps.

// One stop on the tour: highlight a home-screen element (by the key MainMenu
// recorded its bounds under) while Splot says his line about it.
export type HomeTourStep = {
  // Key into MainMenu's recorded bounds; a missing rect just skips the hole.
  target: string;
  text: string;
  // The closing step swaps Next/Skip for the Splash Course / Dive in choice.
  final?: boolean;
};

// Splot's script — the story opens on Splot himself (who you are, what the
// game is), tours every destination in the order the buttons stack, covers
// the features that live off the home page (dailies and crowns, duels and
// royalties, Sparks, Fit Check, Splat Cards, flair), and closes on the "?"
// so players know where the lessons live forever after. The tour's happy
// ending walks the player straight into the Splash Course world.
const STEPS: HomeTourStep[] = [
  {
    target: 'splot',
    text: 'Oh! A new splotter! I\'m Splot — resident slime, part-time canvas, full-time fashion icon. Welcome to Sqlotter, right here in your subreddit\'s feed!',
  },
  {
    target: 'splot',
    text: 'Here\'s my life: every puzzle shows a goal pattern, and I start blank. Paint splashes over ALL of me... except where something I\'m wearing covers. Wear, splash, remove — the ORDER is the whole puzzle.',
  },
  {
    target: 'Play',
    text: 'Play holds the campaign — worlds of handmade puzzles, gentle to devious. It opens with my Splash Course: five short lessons where I teach you every rule myself.',
  },
  {
    target: 'Daily Sqlot',
    text: 'A fresh Daily Sqlot drops every day, and it skews devious. Clear it to grow a streak that shows on your Reddit flair — and the FIRST solver of any daily claims its crown forever.',
  },
  {
    target: 'Create',
    text: 'Build your own level here — just play it, and your recording becomes the goal. Publishing makes a real Reddit post with a live scoreboard daring players to beat your moves. Popular levels even pay you Sparks.',
  },
  {
    target: 'Find',
    text: 'Find is the library — every level other players have published, plus the whole campaign, all searchable. Someone\'s level is out there waiting to be crushed.',
  },
  {
    target: 'sparks',
    text: 'See that number? Sparks — the currency here. Every clear pays some: fast solves pay extra, dailies pay extra, being first-ever pays a LOT. Stars are separate — those come from clean, low-move solves.',
  },
  {
    target: 'Shop',
    text: 'The Shop is where Sparks go: colors, faces and hats — for me! Every week the subreddit posts a Fit Check thread — open it from the feed and a Fit Check button appears right here so you can drop your look in as a real, upvotable comment.',
  },
  {
    target: 'Ranking',
    text: 'The global boards: most Sparks, fewest moves, most levels cleared. Three ladders, three kinds of famous.',
  },
  {
    target: 'splot',
    text: 'Wins are for bragging. Any solve can post a Splat Card — your stars, moves and time on a comment, never the recipe. Between cards, crowns and flair, this subreddit remembers who you are.',
  },
  {
    target: 'help',
    text: 'That\'s the whole game! This ? replays my lessons any time. Now let\'s start you proper — the Splash Course world is five quick lessons, and it\'s right this way.',
    final: true,
  },
];

export type HomeTourOptions = {
  // Resolves a step's target key to its on-screen bounds (MainMenu records
  // them while laying out). Null builds the step without a spotlight.
  getRect: (key: string) => Phaser.Geom.Rectangle | null;
  // Fired on Skip and on either closing choice; startCourse = the player
  // took the "Take me there" path into the Splash Course world. The owner
  // marks the tour seen, tears down, and navigates.
  onDone: (startCourse: boolean) => void;
  // Fired as each step builds so the owner can react outside the overlay —
  // MainMenu squishes the mascot whenever the spotlight lands on Splot.
  onStep?: (target: string, index: number) => void;
  // Resume point for mid-tour layout rebuilds (resize): the tour dies with
  // the old layout and reopens here at the same step against the new bounds.
  startStep?: number;
};

export class HomeTour {
  private scene: Phaser.Scene;
  private opts: HomeTourOptions;
  private index: number;
  private root: Phaser.GameObjects.Container | null = null;
  // Step-scoped tweens: every ring pulse, sparkle twinkle and panel pop lands
  // here so a rebuild (or teardown) can remove them before their targets die.
  private fx: Phaser.Tweens.Tween[] = [];
  // Typewriter state — the body text feeds out a few glyphs at a time; any
  // tap lands the whole line instantly before the next tap pages forward.
  private typeTimer: Phaser.Time.TimerEvent | null = null;
  private typing = false;
  private body: Phaser.GameObjects.Text | null = null;
  private fullText = '';
  // The dim layer fades in once; later steps keep it solid and animate only
  // the ring + panel, so paging never flashes the undimmed screen behind it.
  private firstBuild = true;
  private destroyed = false;

  constructor(scene: Phaser.Scene, opts: HomeTourOptions) {
    this.scene = scene;
    this.opts = opts;
    this.index = Phaser.Math.Clamp(opts.startStep ?? 0, 0, STEPS.length - 1);
    this.buildStep();
  }

  // Where the tour currently is — MainMenu reads this to resume across a
  // resize-triggered layout rebuild.
  get step(): number {
    return this.index;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cleanupStep();
  }

  // Tweens and timers outlive their targets unless removed explicitly — every
  // buildStep and the final teardown funnel through here.
  private cleanupStep() {
    for (const t of this.fx) t.remove();
    this.fx = [];
    this.typeTimer?.remove();
    this.typeTimer = null;
    this.typing = false;
    this.body = null;
    this.root?.destroy(true);
    this.root = null;
  }

  private finishTyping() {
    this.typeTimer?.remove();
    this.typeTimer = null;
    this.typing = false;
    this.body?.setText(this.fullText);
  }

  private advance() {
    if (this.destroyed || this.index >= STEPS.length - 1) return;
    this.index += 1;
    this.buildStep();
  }

  // Tapping the dim layer (or the spotlight itself): an unfinished line lands
  // in full first; a finished one pages forward — except on the closing step,
  // where the two buttons are the only way out.
  private tapThrough() {
    const current = STEPS[this.index];
    if (!current) return;
    if (this.typing) {
      playSfx('click');
      this.finishTyping();
      return;
    }
    if (current.final) return;
    playSfx('click');
    this.advance();
  }

  private buildStep() {
    if (this.destroyed) return;
    this.cleanupStep();

    const scene = this.scene;
    const { width, height } = scene.scale;
    const step = STEPS[this.index];
    if (!step) return;
    this.opts.onStep?.(step.target, this.index);
    const items: Phaser.GameObjects.GameObject[] = [];

    // ── Spotlight: four dim rects framing a bright hole over the target, an
    // invisible catcher over the hole (the spotlit button must not fire
    // mid-tour), a gold ring that snaps onto the target and pulses, and
    // twinkling sparkles at the corners. Every layer advances on tap.
    const raw = this.opts.getRect(step.target);
    let hole: Phaser.Geom.Rectangle | null = null;
    if (raw) {
      hole = Phaser.Geom.Rectangle.Clone(raw);
      Phaser.Geom.Rectangle.Inflate(hole, 8, 8);
    }

    const addDim = (x: number, y: number, w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      const r = scene.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0.62);
      r.setInteractive();
      r.on('pointerup', () => this.tapThrough());
      items.push(r);
    };

    if (hole) {
      addDim(0, 0, width, hole.y);
      addDim(0, hole.bottom, width, height - hole.bottom);
      addDim(0, hole.y, hole.x, hole.height);
      addDim(hole.right, hole.y, width - hole.right, hole.height);
      const catcher = scene.add
        .rectangle(hole.centerX, hole.centerY, hole.width, hole.height, 0x000000, 0)
        .setInteractive();
      catcher.on('pointerup', () => this.tapThrough());
      items.push(catcher);

      // Ring + soft glow live in one container centered on the hole so the
      // whole assembly can shrink-snap onto the target (Back overshoot reads
      // as "locking on"), then the inner ring settles into a slow pulse.
      const ringBox = scene.add.container(hole.centerX, hole.centerY);
      const glow = scene.add.graphics();
      glow.lineStyle(8, 0xffd24a, 0.22);
      glow.strokeRoundedRect(-hole.width / 2 - 3, -hole.height / 2 - 3, hole.width + 6, hole.height + 6, 12);
      const ring = scene.add.graphics();
      ring.lineStyle(3, 0xffd24a, 1);
      ring.strokeRoundedRect(-hole.width / 2, -hole.height / 2, hole.width, hole.height, 10);
      ringBox.add([glow, ring]);
      ringBox.setScale(1.35).setAlpha(0);
      this.fx.push(scene.tweens.add({
        targets: ringBox,
        scale: 1,
        alpha: 1,
        duration: 280,
        ease: 'Back.easeOut',
      }));
      this.fx.push(scene.tweens.add({
        targets: ring,
        alpha: { from: 1, to: 0.35 },
        delay: 300,
        duration: 550,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      }));
      items.push(ringBox);

      if (scene.textures.exists('icon-sparkle')) {
        const corners: Array<[number, number]> = [
          [hole.x, hole.y], [hole.right, hole.y],
          [hole.right, hole.bottom], [hole.x, hole.bottom],
        ];
        corners.forEach(([cx, cy], i) => {
          const spark = scene.add.image(cx, cy, 'icon-sparkle')
            .setDisplaySize(16, 16).setTint(0xffe27a).setAlpha(0);
          const base = spark.scale;
          items.push(spark);
          this.fx.push(scene.tweens.add({
            targets: spark,
            alpha: { from: 0.2, to: 1 },
            scale: { from: base * 0.7, to: base * 1.2 },
            angle: { from: -10, to: 10 },
            delay: 200 + i * 160,
            duration: 480,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }));
        });
      }
    } else {
      addDim(0, 0, width, height);
    }

    // ── Speech panel — body text measured first so the shell derives its
    // height from the content (same discipline as MainMenu's popups): the
    // panel is always exactly as tall as its copy, no clipped or stranded
    // space. On short viewports the body FONT steps down (re-wrapping as it
    // goes) until the whole panel fits the screen budget.
    const popW = Math.min(width - 24, 430);
    const btnH = step.final ? 46 : 40;
    // Title row + gaps + action row; the final step stacks a text link under
    // its button, so its action row is taller.
    const actionH = step.final ? btnH + 8 + 22 : btnH;
    const chromeH = 16 + 22 + 6 + 14 + actionH + 14;
    const budget = height - 24;
    // 16, not 15: Pixelify Sans is drawn on a pixel grid and only bakes crisp
    // at grid-aligned sizes (16/24) — at 15px every glyph block straddles
    // pixels and antialiases into gray fringes, which the pixelArt canvas
    // upscale on phones smears into visible blur. The emergency step-down
    // below trades that crispness for fitting, which off-grid sizes do buy.
    let bodyFs = 16;
    const body = scene.add.text(0, 0, step.text, {
      fontFamily: BODY_FONT,
      fontSize: `${bodyFs}px`,
      color: '#40301F',
      wordWrap: { width: popW - 36 },
      lineSpacing: 3,
    }).setOrigin(0, 0);
    while (bodyFs > 10 && chromeH + body.height > budget) {
      bodyFs -= 1;
      body.setFontSize(bodyFs);
    }
    const popH = Math.min(budget, chromeH + body.height);

    // The panel takes whichever side of the spotlight has more room; with no
    // spotlight it hugs the bottom.
    const margin = 12;
    let panelY = height - margin - popH / 2;
    if (hole) {
      const spaceBelow = height - hole.bottom;
      panelY = spaceBelow >= hole.y
        ? Math.min(hole.bottom + 10 + popH / 2, height - margin - popH / 2)
        : Math.max(hole.y - 10 - popH / 2, margin + popH / 2);
    }

    const shell = addBeigeButtonShell(scene, width / 2, panelY, popW, popH, false);
    const content: Phaser.GameObjects.GameObject[] = [];

    // Name and page counter share one header baseline, symmetric padding on
    // both edges — no more mismatched sizes stranded in opposite corners.
    const headerY = -popH / 2 + 27;
    content.push(scene.add.text(-popW / 2 + 18, headerY, 'Splot', {
      fontFamily: BODY_FONT,
      fontSize: '16px',
      fontStyle: 'bold',
      color: '#3A1A08',
      shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true },
    }).setOrigin(0, 0.5));
    // Counter digits stay in the crisp numeric face — Pixelify's rounded
    // digits blur into each other, which is why numbers live in Press Start 2P.
    content.push(scene.add.text(popW / 2 - 18, headerY, `${this.index + 1}/${STEPS.length}`, {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#8A6B4A',
    }).setOrigin(1, 0.5));
    body.setPosition(-popW / 2 + 18, -popH / 2 + 16 + 22 + 6);
    content.push(body);

    const btnRowY = popH / 2 - 14 - btnH / 2;
    if (step.final) {
      // One clear way forward (the Splash Course world), one quiet way out.
      // Stacked, not side by side — two 14px labels can't share a 256px-wide
      // panel row on small phones without colliding.
      const bw = Math.min(popW - 32, 280);
      const primaryY = popH / 2 - 14 - 22 - 8 - btnH / 2;
      content.push(addBeigeButton(scene, {
        x: 0, y: primaryY, width: bw, height: btnH,
        label: 'Take me there', iconKey: 'icon-play',
        fontSize: 16, fontFamily: BODY_FONT, forceSmall: true,
        onClick: () => {
          playSfx('confirm');
          this.opts.onDone(true);
        },
      }));
      const explore = scene.add.text(0, popH / 2 - 14 - 11, 'I\'ll explore on my own', {
        fontFamily: BODY_FONT,
        fontSize: '16px',
        color: '#5A4326',
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      explore.on('pointerup', () => {
        playSfx('cancel');
        this.opts.onDone(false);
      });
      content.push(explore);
    } else {
      // #5A4326, not the muted #75604C — on the beige shell the lighter tone
      // reads too close to the background (same call as the settings blurb).
      const skip = scene.add.text(-popW / 2 + 18, btnRowY, 'Skip tour', {
        fontFamily: BODY_FONT,
        fontSize: '16px',
        color: '#5A4326',
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      skip.on('pointerup', () => {
        playSfx('cancel');
        this.opts.onDone(false);
      });
      content.push(skip);
      content.push(addBeigeButton(scene, {
        x: popW / 2 - 16 - 55, y: btnRowY, width: 110, height: btnH,
        label: 'Next', fontSize: 16, fontFamily: BODY_FONT, forceSmall: true,
        onClick: () => this.advance(),
      }));
    }
    shell.addContent(content);
    items.push(shell.container);

    // The panel pops in — a small rise + Back-overshoot scale, content riding
    // along inside. (Alpha is clamped to [0,1] by Phaser, so the overshoot
    // only ever shows on the scale.)
    shell.container.setScale(0.92).setAlpha(0);
    shell.container.y = panelY + 14;
    this.fx.push(scene.tweens.add({
      targets: shell.container,
      y: panelY,
      scale: 1,
      duration: 260,
      ease: 'Back.easeOut',
    }));
    this.fx.push(scene.tweens.add({
      targets: shell.container,
      alpha: 1,
      duration: 150,
      ease: 'Quad.easeOut',
    }));

    // Above every home-screen element including popups (depth 60).
    this.root = scene.add.container(0, 0, items).setDepth(80);
    if (this.firstBuild) {
      this.firstBuild = false;
      this.root.setAlpha(0);
      this.fx.push(scene.tweens.add({ targets: this.root, alpha: 1, duration: 200, ease: 'Quad.easeOut' }));
    }

    // Typewriter reveal: pre-wrap the fitted text (so words never jump lines
    // as they appear) and feed it out two glyphs per tick — the longest lines
    // land in about two seconds, and any tap lands them instantly.
    const wrapped = body.getWrappedText().join('\n');
    this.fullText = wrapped;
    this.body = body;
    body.setText('');
    this.typing = true;
    let shown = 0;
    this.typeTimer = scene.time.addEvent({
      delay: 18,
      loop: true,
      callback: () => {
        shown = Math.min(shown + 2, wrapped.length);
        body.setText(wrapped.slice(0, shown));
        if (shown >= wrapped.length) this.finishTyping();
      },
    });
  }
}
