import * as Phaser from 'phaser';
import { addBeigeButton, addBeigeButtonShell, addDepthIcon, BODY_FONT } from '../components/PixelUI';
import { getCuratedLevels, LEVELS_PER_WORLD, WORLDS_META } from '../../shared/levelData';
import type { WorldMeta } from '../../shared/levelData';
import type { LevelData } from '../../shared/types';
import type { CommunityLevelSummary, CommunityLevelsResponse } from '../../shared/api';
import { getCachedProgress, setCachedProgress } from '../levelProgress';

const PIXELIFY = BODY_FONT;

// Session cache of the default community listing (no query) — with the
// progress cache it lets repeat visits render the whole screen instantly
// while a background refetch corrects both.
let communityCache: CommunityLevelSummary[] | null = null;

// The grid reserves layout space for a full world (see buildPage's grid geometry):
// 8 rows × 2 cols portrait, 4 rows × 4 cols desktop. Worlds may hold fewer
// levels than the cap (the tutorial world has 8) — the grid just leaves the
// remaining cells empty.
const WORLD_CAPACITY = LEVELS_PER_WORLD;

type GridItem = { label: string; disabled: boolean; onClick?: (() => void) | undefined };
type WorldPage = { kind: 'world'; meta: WorldMeta; levels: LevelData[] };
type CommunityPage = { kind: 'community' };
type Page = WorldPage | CommunityPage;

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

  constructor() { super('LevelSelect'); }

  init(data?: { page?: string }) {
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
    this.frameSolid = null;
    this.frameHole = null;
    this.navigating = false;
  }

  async create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(0x2a1a4a);
    this.cameras.main.fadeIn(350, 26, 10, 46);

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
    if (this.openFinder) this.pageIndex = this.pages.length - 1;
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

  // ── Background ─────────────────────────────────────────────────────────
  private buildBackground() {
    const { width, height } = this.scale;
    const keys   = ['bg3-1', 'bg3-2', 'bg3-3', 'bg3-4'];
    const alphas = [1, 0.5, 0.7, 0.9];

    this.bgLayers.forEach(img => img.destroy());
    this.bgLayers = [];

    keys.forEach((key, i) => {
      const img = this.add.image(width / 2, height / 2, key)
        .setAlpha(alphas[i] ?? 0.6).setDepth(-10 + i);
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

    // Community levels aren't capped by the API to a page-sized batch (up to 20), and
    // this screen has no scrolling — cap to the same WORLD_CAPACITY every world page
    // reserves space for, so buttons never overflow past the arrows/screen edge.
    // The finder page is capped further, to the rows that genuinely fit above the
    // 40px button floor: its search bar eats exactly the slack that lets a full
    // 16-button world grid squeeze onto short phones, so an uncapped result list
    // ran under the pagination arrows (portrait) or off the bottom (landscape).
    let maxItems = cols * designRows;
    if (page.kind === 'community') {
      const rowsFit = Math.max(1, Math.floor((availH + 5) / (40 + 5)));
      maxItems = Math.min(maxItems, cols * rowsFit);
    }
    const items = this.buildGridItems(page, maxItems);

    // Size rows to the page's actual content (the tutorial world and community
    // pages run short of capacity) so sparse pages grow their buttons into the
    // space instead of huddling above a dead band.
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

    if (page.kind === 'community' && items.length === 1 && items[0]!.disabled) {
      // "Coming soon" placeholder — spans the full grid width instead of one cell.
      const bw  = gridW;
      const bh  = btnH;
      const btn = addBeigeButton(this, {
        x: width / 2, y: gridTop + bh / 2, width: bw, height: bh,
        label: items[0]!.label, fontSize: fs, fontFamily: PIXELIFY, disabled: true,
      });
      btn.setAlpha(0);
      this.tweens.add({ targets: btn, alpha: 1, duration: 220, delay: 80, ease: 'Quad.easeOut' });
      els.push(btn);
    } else {
      items.forEach((item, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const cx  = outerPad + btnW / 2 + col * (btnW + colGap);
        const cy  = gridTop + btnH / 2 + row * (btnH + rowGap);
        // Long labels (community titles, tutorial lesson names) shrink to fit
        // the button instead of spilling past its corners.
        const itemFs = Math.max(9, Math.min(fs, Math.floor((btnW - 16) / (item.label.length * 0.62))));
        const btn = addBeigeButton(this, {
          x: cx, y: cy, width: btnW, height: btnH,
          label: item.label, fontSize: itemFs, fontFamily: PIXELIFY,
          disabled: item.disabled,
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

  private buildGridItems(page: Page, maxItems: number): GridItem[] {
    if (page.kind === 'world') {
      return page.levels.map((level, i) => {
        const locked = this.isLevelLocked(level);
        // Tutorial buttons carry their lesson name ("One-Shot Goggles");
        // regular worlds number within the world, matching the page title.
        return {
          label: page.meta.num === 0 ? level.title : `Level ${i + 1}`,
          disabled: locked,
          onClick: locked ? undefined : () => this.openLevel(level.id),
        };
      });
    }
    // Par on the button: every community level advertises the move count it's
    // guaranteed to be solvable in (the creator's own verified recording).
    const communityItems: GridItem[] = this.communityLevels
      .slice(0, Math.max(1, maxItems))
      .map((level) => ({
        label: `${level.title.length > 12 ? `${level.title.slice(0, 12)}...` : level.title} · par ${level.optimalSteps}`,
        disabled: false,
        onClick: () => this.openLevel(level.id),
      }));

    if (this.searchPending) {
      return [{ label: 'Searching...', disabled: true }];
    }

    // A query searches the whole game, not just community splats: curated
    // levels match on their title or their world ("bubble bog", "world 12").
    // Community results keep up to half the grid so a broad curated match
    // (a whole world is 16 levels) can't crowd them off the page entirely.
    const q = this.searchQuery.trim().toLowerCase();
    if (q) {
      const curatedItems = this.findCuratedLevels(q, Math.max(0, maxItems - Math.min(communityItems.length, Math.floor(maxItems / 2))));
      const combined = [...curatedItems, ...communityItems].slice(0, Math.max(1, maxItems));
      if (combined.length > 0) return combined;
      return [{ label: 'No splats found — try another name', disabled: true }];
    }

    if (communityItems.length === 0) {
      return [{ label: 'No community splats yet — search or create one!', disabled: true }];
    }
    return communityItems;
  }

  // Curated matches for the finder — world-position label so a result reads
  // as a place ("W12-L3"), with locked levels shown but not tappable.
  private findCuratedLevels(q: string, cap: number): GridItem[] {
    const out: GridItem[] = [];
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
          label: `W${meta.num}-L${i + 1} · ${level.title}`,
          disabled: locked,
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
        padding:      '0 12px',
        boxSizing:    'border-box',
        background:   '#FFF6DF',
        color:        '#3A1A08',
        border:       '2px solid #7A4A20',
        borderRadius: '8px',
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
    this.cameras.main.fadeOut(250, 26, 10, 46);
    this.time.delayedCall(260, () => this.scene.start(key, data));
  }

  private isLevelLocked(level: LevelData): boolean {
    const curated = getCuratedLevels();
    const idx = curated.findIndex(l => l.id === level.id);
    if (idx === 0) return false;
    const prev = curated[idx - 1];
    if (!prev) return false;
    return !this.completedLevels[prev.id];
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    this.buildPage();
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
