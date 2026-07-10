import * as Phaser from 'phaser';
import { streamAudio } from '../audio';
import { addBeigeButton, addBeigeButtonShell, addDepthIcon, BODY_FONT } from '../components/PixelUI';
import { getCuratedLevels, LEVELS_PER_WORLD, WORLDS_META } from '../../shared/levelData';
import type { WorldMeta } from '../../shared/levelData';
import type { LevelData } from '../../shared/types';
import type { CommunityLevelSummary, CommunityLevelsResponse } from '../../shared/api';
import { getCachedProgress, setCachedProgress } from '../levelProgress';
import { DEFERRED_IMG } from './Preloader';
import { SplotMascot } from '../components/SplotMascot';

const PIXELIFY = BODY_FONT;

// Session cache of the default community listing (no query) — with the
// progress cache it lets repeat visits render the whole screen instantly
// while a background refetch corrects both.
let communityCache: CommunityLevelSummary[] | null = null;

// The grid reserves layout space for a full world (see buildPage's grid geometry):
// 8 rows × 2 cols portrait, 4 rows × 4 cols desktop. Worlds may hold fewer
// levels than the cap (the tutorial world has 5) — the grid just leaves the
// remaining cells empty.
const WORLD_CAPACITY = LEVELS_PER_WORLD;

type GridItem = { label: string; disabled: boolean; icon?: string; onClick?: (() => void) | undefined };
type WorldPage = { kind: 'world'; meta: WorldMeta; levels: LevelData[] };
type CommunityPage = { kind: 'community' };
type Page = WorldPage | CommunityPage;

// A finder result row — richer than the world grid's bare label: a result
// needs to say who made it (community) or where it lives (campaign) before
// it's worth a tap.
type FinderItem = {
  title: string;
  sub: string;            // byline: "by creator" or "World 12 · Level 3"
  par: number;
  difficulty: number;     // 1-5 → DIFF_TIERS word
  locked?: boolean;       // campaign hits behind progression show a lock
  onClick?: (() => void) | undefined;
};

// Difficulty 1-5 rendered as a colored tier word on the row's right edge.
const DIFF_TIERS = [
  { label: 'Easy',   color: '#3E8914' },
  { label: 'Mild',   color: '#5C8A12' },
  { label: 'Medium', color: '#B87700' },
  { label: 'Hard',   color: '#C24A14' },
  { label: 'Expert', color: '#8C2BC1' },
] as const;

export class LevelSelect extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private contentLayer: Phaser.GameObjects.Container | null = null;
  private pages: Page[] = [];
  private pageIndex = 0;
  private completedLevels: Record<string, { stars: number }> = {};
  private communityLevels: CommunityLevelSummary[] = [];
  // Community search — a DOM input (same overlay pattern as the Editor's
  // title field) that persists across buildPage rebuilds so typing never
  // loses focus. window.setTimeout for the debounce: it must survive the
  // buildPage tween/timer churn a result redraw causes.
  private searchInput: HTMLInputElement | null = null;
  private searchQuery = '';
  private searchDebounce: number | null = null;
  private searchToken = 0;
  // True while a search fetch is in flight — the grid shows "Searching..."
  // instead of silently holding the previous results.
  private searchPending = false;
  // Set when MainMenu's Find button opened this scene — jump straight to the
  // finder page (and put the caret in the search box) once pages exist.
  private openFinder = false;
  // Set when another scene asked for a specific world page (the guided
  // lessons' Skip button lands on World 1) — applied once pages exist.
  private startWorld: number | null = null;

  // Scratch shapes reused by buildFrame() every call — RenderTexture.draw()/erase()
  // only *queue* the draw for the next render pass rather than rendering synchronously,
  // so the source Graphics objects must stay alive past the call, not be destroyed
  // immediately after (that was the earlier bug: the frame silently never rendered).
  private frameSolid: Phaser.GameObjects.Graphics | null = null;
  private frameHole: Phaser.GameObjects.Graphics | null = null;
  // Guards every scene.start(...) call — prevents double-tapping a level
  // button, or tapping a level button and the back arrow in quick succession,
  // from queuing more than one scene transition.
  private navigating = false;
  // Debounces the heavy relayout during continuous RESIZE events (window drag).
  private resizeRebuild: Phaser.Time.TimerEvent | null = null;

  constructor() { super('LevelSelect'); }

  // Safety net for the deferred night-sky set (bg1) — normally MainMenu has
  // already streamed it in the background and this queues nothing.
  preload() {
    this.load.setPath('assets');
    for (const { key, path } of DEFERRED_IMG) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
  }

  init(data?: { page?: string; world?: number }) {
    // Phaser re-delivers a scene's LAST init data when it's started with none,
    // so after Find passes { page: 'finder' } a plain Play would land on the
    // finder again. Consume the data so every start says what it means.
    this.sys.settings.data = {};
    this.bgLayers = [];
    this.contentLayer = null;
    this.pages = [];
    this.pageIndex = 0;
    this.completedLevels = {};
    this.communityLevels = [];
    this.searchInput = null;
    this.searchQuery = '';
    this.searchDebounce = null;
    this.searchToken = 0;
    this.searchPending = false;
    this.openFinder = data?.page === 'finder';
    this.startWorld = typeof data?.world === 'number' ? data.world : null;
    this.frameSolid = null;
    this.frameHole = null;
    this.navigating = false;
  }

  async create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(0x0c1238);
    this.cameras.main.fadeIn(350, 10, 14, 46);
    // Re-queue any deferred sounds a mid-stream scene change aborted (no-op
    // once everything is cached).
    streamAudio(this);

    this.buildBackground();

    // Repeat visits render instantly from the session caches (a background
    // refetch corrects them). Only the very first visit blocks its render on
    // the fetches — level buttons must not flash an incorrect locked state —
    // and shows a pulsing label for that capped (2.5s) wait.
    const cachedProgress = getCachedProgress();
    if (cachedProgress) {
      this.completedLevels = { ...cachedProgress };
      this.communityLevels = communityCache ? [...communityCache] : [];
      void this.refreshInBackground();
    } else {
      const loading = this.add.text(this.scale.width / 2, this.scale.height / 2, 'Loading levels...', {
        fontFamily: PIXELIFY, fontSize: '16px', color: '#FFF6DF',
        stroke: '#3A1A08', strokeThickness: 4,
      }).setOrigin(0.5).setDepth(30);
      this.tweens.add({ targets: loading, alpha: 0.35, duration: 650, yoyo: true, repeat: -1 });
      await Promise.all([this.loadProgress(), this.loadCommunityLevels()]);
      this.tweens.killTweensOf(loading);
      loading.destroy();
    }

    this.buildPages();
    if (this.openFinder) {
      this.pageIndex = this.pages.length - 1;
    } else if (this.startWorld !== null) {
      this.pageIndex = Phaser.Math.Clamp(this.startWorld, 0, this.pages.length - 1);
    }
    this.buildPage();
    // Arriving via the home page's Find button: the player came here to type,
    // so hand the search box the caret right away.
    if (this.openFinder) this.searchInput?.focus();
    this.scale.on('resize', this.onResize, this);
  }

  // Cached render path: refetch both datasets behind the visible screen and
  // rebuild only if something actually changed (new stars, new splats).
  private async refreshInBackground() {
    const before = JSON.stringify([this.completedLevels, this.communityLevels]);
    await Promise.all([this.loadProgress(), this.loadCommunityLevels(this.searchQuery.trim())]);
    if (this.navigating || !this.sys.isActive()) return;
    const after = JSON.stringify([this.completedLevels, this.communityLevels]);
    if (after !== before) {
      this.buildPages();
      this.buildPage();
    }
  }

  private async loadProgress() {
    try {
      // create() blocks its first render on this — cap it so a hung connection
      // costs at most 2.5s of bare background, then the grid renders with the
      // no-progress fallback instead of never.
      const res = await fetch('/api/user/profile', { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const profile = await res.json();
        for (const id of (profile.completedLevels ?? [])) {
          this.completedLevels[id] = { stars: profile.levelStars?.[id] ?? 1 };
        }
        setCachedProgress({ ...this.completedLevels });
      }
    } catch { /* fallback: no progress */ }
  }

  private async loadCommunityLevels(q = '') {
    // Stale-response guard: fast typing can land older search results after
    // newer ones — only the latest request may write.
    const token = ++this.searchToken;
    try {
      const url = q
        ? `/api/levels/community?limit=20&q=${encodeURIComponent(q)}`
        : '/api/levels/community?limit=20';
      // Also awaited by create()'s first render — same 2.5s cap as loadProgress.
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const data: CommunityLevelsResponse = await res.json();
        if (token === this.searchToken) this.communityLevels = data.levels ?? [];
        // Only the default (query-less) listing is worth keeping for the
        // next visit — search results are transient.
        if (!q) communityCache = data.levels ?? [];
      }
    } catch { /* fallback: empty */ }
  }

  private buildPages() {
    // WORLDS_META carries each world's start offset + size into the generated
    // curated array — worlds are contiguous but not equally sized.
    const curated = getCuratedLevels();
    this.pages = WORLDS_META.map((meta) => ({
      kind: 'world' as const,
      meta,
      levels: curated.slice(meta.start, meta.start + meta.size),
    }));
    this.pages.push({ kind: 'community' });
    this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1);
  }

  // ── Background — bg1 night sky (starfield → moon → cloud layers), distinct
  // from the menu's bright day (bg4) and the Game's purple dusk (bg3) so every
  // navigation step reads as arriving somewhere new. ───────────────────────
  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg1-1', 'bg1-2', 'bg1-3', 'bg1-4'];
    // Sky and moon stay full-strength (a dimmed moon just looks broken);
    // the cloud layers keep most of their body so the night stays dark.
    const alphas = [1, 1, 0.90, 0.85];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      if (!this.textures.exists(key)) return;
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.8).setDepth(-10 + i);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
      this.startBgDrift(img, i, width);
    });
  }

  private startBgDrift(img: Phaser.GameObjects.Image, index: number, width: number) {
    const dir = index % 2 === 0 ? 1 : -1;
    this.tweens.add({
      targets: img,
      x: width / 2 + dir * 14,
      duration: 13000 + index * 3000,
      yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }

  private repositionBgLayers(width: number, height: number) {
    this.bgLayers.forEach((img, i) => {
      this.tweens.killTweensOf(img);
      img.setPosition(width / 2, height / 2);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.startBgDrift(img, i, width);
    });
  }

  // ── Page content (frame + title + grid + nav arrows + back button) ──────
  private buildPage() {
    this.contentLayer?.destroy(true);
    const { width, height } = this.scale;
    const isPortrait = height >= width;
    const els: Phaser.GameObjects.GameObject[] = [];

    // TV-bezel style border — desktop/landscape only, per reference.
    if (!isPortrait) els.push(this.buildFrame(width, height));

    // Arrow/back buttons all share one square icon-button size, floored at 66px —
    // the beige button asset's 32px corners corrupt below 65px (see docs/9-slicing.md),
    // and every element on this screen reuses that asset.
    const arrowSize = isPortrait
      ? Math.max(66, Math.min(78, width * 0.19))
      : Math.max(66, Math.min(76, height * 0.10));
    const leftPad = isPortrait ? 14 : Math.max(20, width * 0.02);

    const page = this.pages[this.pageIndex];
    if (!page) return;

    // Title panel — width leaves clearance for the back button on the left, kept
    // symmetric on both sides so the panel still reads as centered on screen.
    // Below ~140px of symmetric budget (280px-class screens) that symmetry
    // starves the title while the right half of the strip sits empty — there
    // the panel centers in the real gap right of the back button instead.
    const titleClearance = leftPad + arrowSize + 12;
    const symmetricW = width - titleClearance * 2;
    const useGap = symmetricW < 140;
    const titleW  = Math.min(useGap ? width - titleClearance - 14 : symmetricW, isPortrait ? 300 : 360);
    const titleX  = useGap ? titleClearance + titleW / 2 : width / 2;
    const titleH  = Math.max(66, Math.min(96, Math.round(height * (isPortrait ? 0.11 : 0.135))));
    const titleY  = Math.max(titleH / 2 + 16, height * (isPortrait ? 0.09 : 0.11));
    const titleFs = Math.max(20, Math.min(34, Math.round(titleH * 0.36)));
    // World pages show "World N — Name" (the tutorial world shows just its
    // name); the font shrinks to fit the longest names inside the button's
    // FACE (titleW minus the 2×14px corner bevels) rather than overflowing.
    const titleLabel = page.kind === 'world'
      ? (page.meta.num === 0 ? page.meta.name : `World ${page.meta.num} — ${page.meta.name}`)
      : 'Level Finder';
    const fittedFs = Math.max(12, Math.min(titleFs, Math.floor((titleW - 28) / (titleLabel.length * 0.62))));
    const titleBtn = addBeigeButton(this, {
      x: titleX, y: titleY, width: titleW, height: titleH,
      label: titleLabel,
      fontSize: fittedFs,
      fontFamily: PIXELIFY,
    });
    titleBtn.setAlpha(0);
    this.tweens.add({ targets: titleBtn, alpha: 1, duration: 220, ease: 'Quad.easeOut' });
    els.push(titleBtn);

    // The Splash Course must never be mistaken for a regular world — a badge
    // right under the title says what it is and that it's optional.
    const isTutorialPage = page.kind === 'world' && page.meta.num === 0;
    if (isTutorialPage) {
      els.push(this.add.text(titleX, titleY + titleH / 2 + 13,
        'TUTORIAL — optional, skippable, worth it', {
          fontFamily: PIXELIFY, fontSize: '13px', color: '#FFE9A8', fontStyle: 'bold',
          stroke: '#3A1A08', strokeThickness: 4,
        }).setOrigin(0.5));
    }

    // Back-to-menu — top-left, vertically aligned with the title row. Not part of the
    // reference mock, but needed since the world pager has no other way out of this
    // screen. Uses the same full-corner button as the pagination arrows below (not the
    // compact "sm" variant) so it matches their size and gets proper hover/press states.
    els.push(this.buildArrow(leftPad + arrowSize / 2, titleY, arrowSize, 180, false, () => this.goToScene('MainMenu')));

    // Grid geometry — every page reserves space for up to WORLD_CAPACITY levels
    // (8 rows × 2 cols portrait, 4 rows × 4 cols desktop) so any world can be
    // authored up to that size later without the grid needing to change shape.
    const cols       = isPortrait ? 2 : 4;
    const designRows = Math.ceil(WORLD_CAPACITY / cols);
    const outerPad   = isPortrait ? Math.max(14, width * 0.05) : Math.max(96, width * 0.10);
    const gridW      = width - outerPad * 2;
    const colGap     = isPortrait ? 12 : 24;
    let   gridTop    = titleY + titleH / 2 + (isPortrait ? 26 : 34);
    if (isTutorialPage) gridTop += 14; // clearance for the TUTORIAL badge line

    // The community page carries a search bar between the title and the grid;
    // world pages must not leave a stale input floating over their grid.
    if (page.kind === 'community') {
      const searchH = 36;
      this.ensureSearchInput(width / 2, gridTop + searchH / 2, Math.min(gridW, 420), searchH);
      gridTop += searchH + 12;
    } else {
      this.removeSearchInput();
    }

    // Portrait reserves a bottom row for the pagination arrows; landscape has them
    // in the margins beside the grid, so the grid can use the full remaining height.
    const gridBottom = isPortrait ? height - 20 - arrowSize - 16 : height - 24;
    const availH     = Math.max(0, gridBottom - gridTop);

    if (page.kind === 'community') {
      // The finder renders as a row LIST (title + byline + par/difficulty),
      // not the world grid — see buildFinderList.
      this.buildFinderList(els, width, gridTop, availH, gridW, isPortrait);
    } else {
      const items = this.buildGridItems(page, cols * designRows);

      // Size rows to the page's actual content (the tutorial world runs short
      // of capacity) so sparse pages grow their buttons into the space instead
      // of huddling above a dead band.
      const layoutRows = Math.max(1, Math.ceil(items.length / cols));

      // Fit layoutRows rows (+ gaps) into availH. Prefer a comfortable gap and a
      // full-size button, but progressively tighten the gap — and then shrink the
      // button toward the small-corner variant's floor — so short screens never
      // clip the last row into the pagination arrows. addBeigeButton auto-swaps to
      // the 16px-corner art below 65px, so heights under the 66px full-size floor
      // still render cleanly (the previous Math.max(66, …) forced overflow instead).
      let rowGap = isPortrait ? 12 : 20;
      let btnH   = (availH - rowGap * (layoutRows - 1)) / layoutRows;
      if (btnH < 66) {
        rowGap = isPortrait ? 8 : 12;
        btnH   = (availH - rowGap * (layoutRows - 1)) / layoutRows;
      }
      if (btnH < 54) {
        rowGap = 5;
        btnH   = (availH - rowGap * (layoutRows - 1)) / layoutRows;
      }
      btnH = Math.max(40, Math.min(isPortrait ? 74 : 80, btnH));

      // Whatever the height clamp left over splits evenly above and below the
      // grid, so a short page reads as centered rather than top-heavy.
      const usedH = layoutRows * btnH + (layoutRows - 1) * rowGap;
      gridTop += Math.max(0, (availH - usedH) / 2);

      const btnW = (gridW - colGap * (cols - 1)) / cols;
      const fs   = Math.max(11, Math.min(16, Math.round(btnH * 0.30)));

      items.forEach((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx  = outerPad + btnW / 2 + col * (btnW + colGap);
        const cy  = gridTop + btnH / 2 + row * (btnH + rowGap);
        // Long labels (tutorial lesson names) shrink to fit the button instead
        // of spilling past its corners.
        const itemFs = Math.max(9, Math.min(fs, Math.floor((btnW - 16) / (item.label.length * 0.62))));
        const btn = addBeigeButton(this, {
          x: cx, y: cy, width: btnW, height: btnH,
          label: item.label, fontSize: itemFs, fontFamily: PIXELIFY,
          disabled: item.disabled,
          ...(item.icon ? { iconKey: item.icon } : {}),
          ...(item.onClick ? { onClick: item.onClick } : {}),
        });
        const targetY = cy;
        btn.setAlpha(0).setY(targetY + 8);
        this.tweens.add({
          targets: btn, alpha: 1, y: targetY,
          duration: 220, delay: Math.min(i * 35, 300), ease: 'Quad.easeOut',
        });
        els.push(btn);
      });
    }

    // Pagination arrows
    const canPrev = this.pageIndex > 0;
    const canNext = this.pageIndex < this.pages.length - 1;

    let prevX: number, prevY: number, nextX: number, nextY: number;
    if (isPortrait) {
      prevX = outerPad + arrowSize / 2;
      nextX = width - outerPad - arrowSize / 2;
      prevY = nextY = height - 20 - arrowSize / 2;
    } else {
      // Fixed edge margin (not outerPad-relative) so the arrows always clear the
      // border frame regardless of how wide the grid's own side padding is.
      const edgeMargin = 20;
      prevX = edgeMargin + arrowSize / 2;
      nextX = width - edgeMargin - arrowSize / 2;
      prevY = nextY = height / 2;
    }

    els.push(this.buildArrow(prevX, prevY, arrowSize, 180, !canPrev, () => this.changePage(-1)));
    els.push(this.buildArrow(nextX, nextY, arrowSize, 0, !canNext, () => this.changePage(1)));

    this.contentLayer = this.add.container(0, 0, els).setDepth(5);
  }

  private buildGridItems(page: WorldPage, maxItems: number): GridItem[] {
    const tutorial = page.meta.num === 0;
    const items: GridItem[] = page.levels.slice(0, maxItems).map((level, i) => {
      const locked = this.isLevelLocked(level);
      // Tutorial buttons read as numbered LESSONS ("2. Full Outfit") and wear
      // the help icon, so the course can't be mistaken for regular levels;
      // regular worlds number within the world, matching the page title.
      return {
        label: tutorial ? `${i + 1}. ${level.title}` : `Level ${i + 1}`,
        disabled: locked,
        ...(tutorial ? { icon: 'icon-help' } : {}),
        onClick: locked ? undefined : () => this.openLevel(level.id),
      };
    });
    // The Splash Course is optional — a standing tile says so and pages
    // straight to World 1 (nothing there is locked behind the lessons).
    if (tutorial && items.length < maxItems) {
      items.push({ label: 'Skip to World 1', disabled: false, icon: 'icon-play', onClick: () => this.changePage(1) });
    }
    return items;
  }

  // ── Finder page result list ──────────────────────────────────────────────
  // A query searches the whole game, not just community splats: curated levels
  // match on their title or their world ("bubble bog", "world 12"); community
  // levels are matched server-side on title or creator.
  private buildFinderList(
    els: Phaser.GameObjects.GameObject[],
    width: number, top: number, availH: number, gridW: number, isPortrait: boolean,
  ) {
    const cx = width / 2;

    if (this.searchPending) {
      const t = this.add.text(cx, top + availH / 2, 'Searching...', {
        fontFamily: PIXELIFY, fontSize: '16px', color: '#FFF6DF',
        stroke: '#3A1A08', strokeThickness: 4,
      }).setOrigin(0.5);
      this.tweens.add({ targets: t, alpha: 0.35, duration: 550, yoyo: true, repeat: -1 });
      els.push(t);
      return;
    }

    // Row geometry first — how many rows genuinely fit decides how many
    // results get built (this screen has no scrolling). Two-line rows by
    // preference; short screens tighten to single-line rows before dropping
    // below four visible results.
    const cols   = isPortrait ? 1 : 2;
    const colGap = 24;
    let rowGap = 8;
    let rowH   = 58;
    let rowsFit = Math.floor((availH + rowGap) / (rowH + rowGap));
    if (rowsFit < 4) {
      rowH = 44; rowGap = 6;
      rowsFit = Math.floor((availH + rowGap) / (rowH + rowGap));
    }
    rowsFit = Math.max(1, rowsFit);
    const maxItems = cols * rowsFit;

    const community: FinderItem[] = this.communityLevels.map((lv) => ({
      title: lv.title,
      sub: `by ${lv.authorName || 'anonymous'}`,
      par: lv.optimalSteps,
      difficulty: lv.difficulty,
      onClick: () => this.openLevel(lv.id),
    }));

    const q = this.searchQuery.trim().toLowerCase();
    let items: FinderItem[];
    let total: number;
    if (q) {
      // Community results keep at least half the rows so a broad curated match
      // (a whole world is 16 levels) can't crowd them off the page entirely.
      const curated = this.findCuratedLevels(q, maxItems - Math.min(community.length, Math.floor(maxItems / 2)));
      total = curated.length + community.length;
      items = [...curated, ...community].slice(0, maxItems);
      if (items.length === 0) {
        this.buildFinderEmptyState(els, cx, top + availH / 2, availH,
          'No splats found', 'Try a level, world, or creator name.');
        return;
      }
    } else {
      total = community.length;
      items = community.slice(0, maxItems);
      if (items.length === 0) {
        this.buildFinderEmptyState(els, cx, top + availH / 2, availH,
          'No community splats yet', 'Be the first — build one in the editor!', true);
        return;
      }
    }

    const rowW   = Math.min((gridW - colGap * (cols - 1)) / cols, 560);
    const rows   = Math.ceil(items.length / cols);
    const usedH  = rows * rowH + (rows - 1) * rowGap;
    const blockW = rowW * cols + colGap * (cols - 1);
    const left   = cx - blockW / 2;

    items.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = left + rowW / 2 + col * (rowW + colGap);
      const y = top + rowH / 2 + row * (rowH + rowGap);
      const rowC = this.buildFinderRow(item, x, y, rowW, rowH);
      rowC.setAlpha(0).setY(y + 8);
      this.tweens.add({ targets: rowC, alpha: 1, y, duration: 220, delay: Math.min(i * 30, 260), ease: 'Quad.easeOut' });
      els.push(rowC);
    });

    // Results that didn't fit are stated, not silently dropped.
    const hidden = total - items.length;
    if (hidden > 0 && availH - usedH >= 20) {
      els.push(this.add.text(cx, top + usedH + 14, `+${hidden} more — ${q ? 'narrow the search' : 'search to find them'}`, {
        fontFamily: PIXELIFY, fontSize: '12px', color: '#FFF6DF',
        stroke: '#3A1A08', strokeThickness: 3,
      }).setOrigin(0.5).setAlpha(0.85));
    }
  }

  // One finder result row: title over a byline on the left, par + difficulty
  // tier (or a lock for gated campaign levels) on the right.
  private buildFinderRow(item: FinderItem, x: number, y: number, w: number, h: number): Phaser.GameObjects.Container {
    const shell = addBeigeButtonShell(this, x, y, w, h, item.locked === true, item.onClick);
    const content: Phaser.GameObjects.GameObject[] = [];
    const padX = 14;
    const rightW = 76;                    // reserved for par/difficulty or the lock
    const textMaxW = w - padX * 2 - rightW;
    const twoLine = h >= 50;
    const titleFs = Math.max(12, Math.min(16, Math.round(h * 0.28)));

    const title = this.add.text(-w / 2 + padX, twoLine ? -h * 0.16 : 0, item.title, {
      fontFamily: PIXELIFY, fontSize: `${titleFs}px`,
      color: item.locked ? '#9A7A5A' : '#3A1A08',
    }).setOrigin(0, 0.5);
    if (title.width > textMaxW) title.setScale(textMaxW / title.width);
    content.push(title);

    if (twoLine) {
      const sub = this.add.text(-w / 2 + padX, h * 0.20, item.sub, {
        fontFamily: PIXELIFY, fontSize: `${Math.max(9, titleFs - 5)}px`,
        color: '#7A4A20',
      }).setOrigin(0, 0.5).setAlpha(item.locked ? 0.6 : 0.9);
      if (sub.width > textMaxW) sub.setScale(textMaxW / sub.width);
      content.push(sub);
    }

    if (item.locked) {
      content.push(addDepthIcon(this, w / 2 - padX - 10, 0, 'icon-lock', 20, 20).setAlpha(0.75));
    } else {
      content.push(this.add.text(w / 2 - padX, twoLine ? -h * 0.16 : 0, `par ${item.par}`, {
        fontFamily: PIXELIFY, fontSize: '13px', color: '#3A1A08',
      }).setOrigin(1, 0.5));
      if (twoLine) {
        const tier = DIFF_TIERS[Math.max(0, Math.min(DIFF_TIERS.length - 1, item.difficulty - 1))]!;
        content.push(this.add.text(w / 2 - padX, h * 0.20, tier.label, {
          fontFamily: PIXELIFY, fontSize: '10px', color: tier.color,
        }).setOrigin(1, 0.5));
      }
    }
    shell.addContent(content);
    return shell.container;
  }

  // Empty finder — the player's own Splot shrugs (see SplotMascot's default
  // equipment), plus a Create call-to-action when the community list is empty.
  private buildFinderEmptyState(
    els: Phaser.GameObjects.GameObject[],
    cx: number, cy: number, availH: number,
    headline: string, detail: string, withCreate = false,
  ) {
    const splotSz = Math.max(64, Math.min(110, availH * 0.30));
    const splot = new SplotMascot(this, cx, cy - splotSz * 0.62, splotSz);
    splot.setExpression('doubt');
    els.push(splot.container);

    const textY = cy + splotSz * 0.22;
    els.push(this.add.text(cx, textY, headline, {
      fontFamily: PIXELIFY, fontSize: '17px', color: '#FFF6DF',
      stroke: '#3A1A08', strokeThickness: 4,
    }).setOrigin(0.5));
    els.push(this.add.text(cx, textY + 24, detail, {
      fontFamily: PIXELIFY, fontSize: '12px', color: '#FFF6DF',
      stroke: '#3A1A08', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0.9));

    if (withCreate) {
      els.push(addBeigeButton(this, {
        x: cx, y: textY + 68, width: 220, height: 56,
        label: 'Create a Splat', iconKey: 'icon-pencil', fontSize: 15, fontFamily: PIXELIFY,
        onClick: () => this.goToScene('Editor'),
      }));
    }
  }

  // Curated matches for the finder — the level title leads and the byline says
  // where it lives in the campaign; locked levels are still listed (a search
  // should prove the level exists) but wear a lock instead of a par.
  private findCuratedLevels(q: string, cap: number): FinderItem[] {
    const out: FinderItem[] = [];
    const curated = getCuratedLevels();
    for (const meta of WORLDS_META) {
      const worldKey = `world ${meta.num} ${meta.name}`.toLowerCase();
      const worldHit = worldKey.includes(q);
      for (let i = 0; i < meta.size && out.length < cap; i++) {
        const level = curated[meta.start + i];
        if (!level) continue;
        if (!worldHit && !level.title.toLowerCase().includes(q)) continue;
        const locked = this.isLevelLocked(level);
        out.push({
          title: level.title,
          // Worlds go by their proper names everywhere the player reads them.
          sub: meta.num === 0 ? `${meta.name} · Lesson ${i + 1}` : `${meta.name} · Level ${i + 1}`,
          par: level.optimalSteps,
          difficulty: level.difficulty,
          locked,
          onClick: locked ? undefined : () => this.openLevel(level.id),
        });
      }
      if (out.length >= cap) break;
    }
    return out;
  }

  private buildArrow(x: number, y: number, size: number, angle: number, disabled: boolean, onClick: () => void) {
    const shell = addBeigeButtonShell(this, x, y, size, size, disabled, disabled ? undefined : onClick);
    const iconSize = Math.round(size * 0.42);
    const icon = addDepthIcon(this, 0, -1, 'icon-arrow', iconSize, iconSize).setAngle(angle);
    if (disabled) icon.setAlpha(0.4);
    shell.addContent([icon]);
    return shell.container;
  }

  // TV-bezel border for desktop/landscape. Rendered via a RenderTexture: fill it
  // solid in the border color, then punch a rounded-rect window out of it using
  // ERASE blend mode. This relies only on Phaser's own built-in fillRoundedRect
  // for the rounded corners (rather than hand-rolled arc/ring geometry, which
  // didn't render its corners as solid fill), so the corners are guaranteed to
  // match Phaser's own well-tested rounded-rect shape.
  private buildFrame(width: number, height: number) {
    const B = 10; // border thickness
    const R = 28; // inner window corner radius

    const rt = this.add.renderTexture(0, 0, width, height).setOrigin(0, 0);

    // RenderTexture.draw()/erase() only *queue* the draw — they don't execute it.
    // Two things are required for anything to actually show up:
    // 1. The default renderMode is 'render', which just displays whatever the
    //    texture already contains and never calls render() itself — you must call
    //    `rt.render()` explicitly to flush the queued commands (Phaser 3's
    //    RenderTexture drew immediately; Phaser 4's doesn't). Without this the
    //    texture just stays blank forever, which is why the whole frame — not just
    //    the corners — was invisible.
    // 2. Because the queue is processed later, not synchronously, the source
    //    Graphics objects must still exist when it runs — reused as persistent
    //    fields instead of destroy()'d right after queuing (an earlier bug here).
    this.frameSolid ??= this.make.graphics({});
    this.frameSolid.clear();
    this.frameSolid.fillStyle(0x66483D, 1);
    this.frameSolid.fillRect(0, 0, width, height);
    rt.draw(this.frameSolid);

    this.frameHole ??= this.make.graphics({});
    this.frameHole.clear();
    this.frameHole.fillStyle(0xffffff, 1);
    this.frameHole.fillRoundedRect(B, B, width - 2 * B, height - 2 * B, R);
    rt.erase(this.frameHole);

    rt.render();

    return rt;
  }

  private changePage(delta: number) {
    const next = Phaser.Math.Clamp(this.pageIndex + delta, 0, this.pages.length - 1);
    if (next === this.pageIndex) return;
    this.pageIndex = next;
    this.buildPage();
    // Directional micro-slide: the new page eases in from the side the player
    // paged toward, so the turn reads as movement rather than a teleport.
    // Skipped for the finder — its DOM search input sits outside the canvas
    // and can't ride along, and a half-sliding page looks broken.
    if (this.contentLayer && this.pages[next]?.kind !== 'community') {
      this.contentLayer.setX(delta * 46);
      this.tweens.add({ targets: this.contentLayer, x: 0, duration: 200, ease: 'Quad.easeOut' });
    }
  }

  // ── Community search bar ─────────────────────────────────────────────────
  private ensureSearchInput(cx: number, cy: number, w: number, h: number) {
    if (!this.searchInput) {
      const input = document.createElement('input');
      input.type        = 'text';
      input.placeholder = 'Search levels or creators...';
      input.maxLength   = 60;
      input.value       = this.searchQuery;
      Object.assign(input.style, {
        position:     'fixed',
        padding:      '0 14px',
        boxSizing:    'border-box',
        background:   '#FFF6DF',
        color:        '#3A1A08',
        border:       '3px solid #7A4A20',
        borderRadius: '10px',
        boxShadow:    '0 3px 0 rgba(58,26,8,0.35)',
        outline:      'none',
        zIndex:       '100',
        fontFamily:   '"Pixelify Sans", sans-serif',
      });
      input.addEventListener('input', () => {
        this.searchQuery = input.value;
        if (this.searchDebounce !== null) window.clearTimeout(this.searchDebounce);
        this.searchDebounce = window.setTimeout(() => {
          this.searchDebounce = null;
          void this.runSearch();
        }, 300);
      });
      (this.game.canvas.parentElement ?? document.body).appendChild(input);
      this.searchInput = input;
    }
    this.positionSearchInput(cx, cy, w, h);
  }

  private positionSearchInput(cx: number, cy: number, w: number, h: number) {
    if (!this.searchInput) return;
    const rect = this.game.canvas.getBoundingClientRect();
    const sx = rect.width  / this.scale.width;
    const sy = rect.height / this.scale.height;
    Object.assign(this.searchInput.style, {
      left:     `${rect.left + (cx - w / 2) * sx}px`,
      top:      `${rect.top  + (cy - h / 2) * sy}px`,
      width:    `${w * sx}px`,
      height:   `${h * sy}px`,
      fontSize: `${Math.round(15 * Math.min(sx, sy))}px`,
    });
  }

  private removeSearchInput() {
    if (this.searchDebounce !== null) {
      window.clearTimeout(this.searchDebounce);
      this.searchDebounce = null;
    }
    this.searchInput?.remove();
    this.searchInput = null;
  }

  private async runSearch() {
    // Redraw immediately so the grid shows "Searching..." (via buildGridItems)
    // instead of holding the previous results while the fetch runs.
    this.searchPending = true;
    const page = this.pages[this.pageIndex];
    if (page?.kind === 'community') this.buildPage();
    await this.loadCommunityLevels(this.searchQuery.trim());
    this.searchPending = false;
    // Only redraw if the player is still looking at the community page.
    const after = this.pages[this.pageIndex];
    if (!this.navigating && after?.kind === 'community') this.buildPage();
  }

  private openLevel(levelId: string) {
    this.goToScene('Game', { levelId });
  }

  // Centralizes every scene.start(...) call — see `navigating` field comment.
  private goToScene(key: string, data?: Record<string, unknown>) {
    if (this.navigating) return;
    this.navigating = true;
    this.removeSearchInput();
    this.cameras.main.fadeOut(250, 10, 14, 46);
    this.time.delayedCall(260, () => this.scene.start(key, data));
  }

  private isLevelLocked(level: LevelData): boolean {
    // The Splash Course is optional: lessons are free to play in any order,
    // and finishing them is never required — World 1 starts unlocked.
    if (level.id.startsWith('w00-')) return false;
    const curated = getCuratedLevels();
    const idx = curated.findIndex(l => l.id === level.id);
    if (idx === 0) return false;
    const prev = curated[idx - 1];
    if (!prev || prev.id.startsWith('w00-')) return false;
    return !this.completedLevels[prev.id];
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    // Full page rebuild debounced — RESIZE mode streams events during a drag.
    this.resizeRebuild?.remove();
    this.resizeRebuild = this.time.delayedCall(120, () => {
      this.resizeRebuild = null;
      this.buildPage();
    });
  }

  shutdown() {
    this.navigating = true;
    this.scale.off('resize', this.onResize, this);
    this.removeSearchInput();
    this.frameSolid?.destroy();
    this.frameHole?.destroy();
    this.tweens.killAll();
    this.time.removeAllEvents();
  }
}
