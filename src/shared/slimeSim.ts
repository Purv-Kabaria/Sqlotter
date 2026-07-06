import type { ModifierDef } from './types';
import { BODY_MASK, MASK_BITMAPS, MASK_GRID } from './maskData';

// ── The paint simulation ────────────────────────────────────────────────────
// Core gameplay (Factory-Balls style): modifiers are STENCILS. While one is
// worn, the slime cells it covers are protected from paint; painting colors
// every exposed body cell. Tapping a worn stencil takes it off again, and a
// level is solved when the painted pattern matches the goal pattern AND
// nothing is worn (goals are always bare slimes).
//
// GOGGLES are one-time use: the splash that lands on them knocks them off and
// breaks them — they leave `worn` automatically (no action logged) and can
// never be worn again that run (only a reset restores them). Every other
// stencil is a reusable toggle.
//
// Geometry comes from maskData.ts — per-modifier coverage bitsets sampled from
// the real PNGs — so this file is pure TS with no canvas: the client engine
// and the server's replay verification run the exact same simulation.

export const BASE_COLOR = '#FFFFFF';
export const CELL_COUNT = MASK_GRID * MASK_GRID;

// A "dipped" cell renders its colour at 75% opacity over the white body — the
// alpha dip (paint variant) and the bubble both set this. Kept as a per-cell
// binary state (opaque | dipped) so it's idempotent: dipping a dipped cell, or
// a second bubble over the same spot, leaves it at 75%, never 56%. A fresh
// colour splash makes the cell opaque again.
export const DIP_FACTOR = 0.75;
export const CELL_OPAQUE = 0;
export const CELL_DIPPED = 1;

const dipHexCache = new Map<string, string>();

/** The colour a dipped cell shows: `color` composited at 75% over white. */
export function dipHex(hex: string): string {
  const key = hex.toUpperCase();
  const cached = dipHexCache.get(key);
  if (cached) return cached;
  const n = key.startsWith('#') ? key.slice(1) : key;
  const ch = (o: number) => parseInt(n.slice(o, o + 2), 16) || 0;
  const mix = (c: number) => Math.round(c * DIP_FACTOR + 255 * (1 - DIP_FACTOR));
  const out = '#' + [mix(ch(0)), mix(ch(2)), mix(ch(4))]
    .map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  dipHexCache.set(key, out);
  return out;
}

// The nose is worn small, then grows one size per paint splash. Its worn mask
// id is the current size; wearing always starts at 'nose-small'.
const NOSE_SIZES = ['nose-small', 'nose-medium', 'nose-big'] as const;
function isNoseMaskId(id: string): boolean {
  return id === 'nose-small' || id === 'nose-medium' || id === 'nose-big';
}

// ── Standard action catalog ─────────────────────────────────────────────────
// The paint pot always offers these 16 colors and the pumpkin tile always
// offers all three sizes, regardless of what the level's palette stores —
// so the replay (client, server, renderer) resolves these ids as a fallback
// whenever an action id has no palette entry. Palette defs win on conflict,
// keeping stored levels' exact ids/colors authoritative.

export type PaintColor = { name: string; hex: string };

export const PAINT_COLORS_16: readonly PaintColor[] = [
  { name: 'Red',     hex: '#FF4136' },
  { name: 'Orange',  hex: '#FF851B' },
  { name: 'Yellow',  hex: '#FFDC00' },
  { name: 'Green',   hex: '#2ECC40' },
  { name: 'Lime',    hex: '#01FF70' },
  { name: 'Teal',    hex: '#39CCCC' },
  { name: 'Sky',     hex: '#7FDBFF' },
  { name: 'Blue',    hex: '#0074D9' },
  { name: 'Navy',    hex: '#003AB4' },
  { name: 'Purple',  hex: '#B10DC9' },
  { name: 'Magenta', hex: '#F012BE' },
  { name: 'Pink',    hex: '#FF69B4' },
  { name: 'Maroon',  hex: '#85144B' },
  { name: 'Olive',   hex: '#3D9970' },
  { name: 'Gray',    hex: '#AAAAAA' },
  { name: 'Black',   hex: '#111111' },
];

export function paintDefOf(color: PaintColor): ModifierDef {
  return { id: `paint-${color.name.toLowerCase()}`, type: 'paint', color: color.hex };
}

let paintsCache: ModifierDef[] | null = null;
let pumpkinsCache: ModifierDef[] | null = null;
let standardCache: Map<string, ModifierDef> | null = null;

export function standardPaints(): readonly ModifierDef[] {
  paintsCache ??= PAINT_COLORS_16.map(paintDefOf);
  return paintsCache;
}

export function standardPumpkins(): readonly ModifierDef[] {
  pumpkinsCache ??= ([25, 50, 75] as const).map(
    (coverage): ModifierDef => ({ id: `pumpkin-${coverage}`, type: 'pumpkin', coverage }),
  );
  return pumpkinsCache;
}

/** Resolves an action id: the level's own palette first, then the catalog. */
export function resolveActionDef(
  palette: readonly ModifierDef[],
  actionId: string,
): ModifierDef | undefined {
  const own = palette.find((m) => m.id === actionId);
  if (own) return own;
  if (!standardCache) {
    standardCache = new Map([...standardPaints(), ...standardPumpkins()].map((m) => [m.id, m]));
  }
  return standardCache.get(actionId);
}

/** Goggles (any variant) break after protecting one splash. */
export function isBreakableMask(maskId: string): boolean {
  return maskId.startsWith('goggles-');
}

// Environment-free base64 decoder (no atob on the server, no Buffer types on
// the client) — the bitsets are ~512 bytes each, decoded once and cached.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = new Map<string, number>([...B64].map((ch, i) => [ch, i]));

function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0, accBits = 0, o = 0;
  for (const ch of clean) {
    const v = B64_LOOKUP.get(ch);
    if (v === undefined) continue;
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[o++] = (acc >> accBits) & 0xff;
    }
  }
  return out;
}

const bitsCache = new Map<string, Uint8Array>();

function bitsOf(key: string, b64: string): Uint8Array {
  let bits = bitsCache.get(key);
  if (!bits) {
    bits = decodeBase64(b64);
    bitsCache.set(key, bits);
  }
  return bits;
}

export function bodyBits(): Uint8Array {
  return bitsOf('__body__', BODY_MASK);
}

/** Coverage bitset for a mask id, or null for unknown ids. */
export function maskBits(maskId: string): Uint8Array | null {
  const b64 = MASK_BITMAPS[maskId];
  return b64 === undefined ? null : bitsOf(maskId, b64);
}

export function getBit(bits: Uint8Array, i: number): boolean {
  return ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

/**
 * The FIXED stencil geometry a modifier uses, or null. Null means "not a plain
 * worn stencil": paints/alpha/bubble (which colour or dip instead of protect),
 * and the nose (whose worn geometry is dynamic — its size lives in `worn` as
 * nose-small/medium/big, so it's handled directly in applySimAction).
 */
export function maskIdOf(mod: ModifierDef): string | null {
  switch (mod.type) {
    case 'paint':     return null;
    case 'alpha':     return null;
    case 'bubble':    return null;
    case 'nose':      return null;
    case 'goggles':   return `goggles-${mod.variant ?? 'h-thick'}`;
    case 'glasses':   return `glasses-${mod.variant ?? 'h-thick'}`;
    case 'belt':      return `belt-${mod.variant ?? 'h-thick'}`;
    case 'pendant':   return `pendant-${mod.variant ?? 'h'}`;
    case 'pumpkin':   return `pumpkin-${mod.coverage ?? 50}`;
    case 'underwear': return 'underwear';
    case 'plate':     return 'plate';
    case 'cone':      return 'cone';
    case 'scarf':     return 'scarf';
  }
}

/** True for a nose modifier (whichever size). */
export function isNoseMod(mod: ModifierDef): boolean {
  return mod.type === 'nose';
}

// ── Sim state ───────────────────────────────────────────────────────────────

export type SimState = {
  /** Per-cell index into `colors`. Only body cells are meaningful. */
  grid: Uint8Array;
  /** Per-cell opacity: CELL_OPAQUE (full) or CELL_DIPPED (75%). */
  alpha: Uint8Array;
  /** Color table; colors[0] is always BASE_COLOR (unpainted). */
  colors: string[];
  /** Mask ids currently worn, in wear order (nose stored as its size id). */
  worn: string[];
  /** Mask ids broken this run (goggles painted over) — unwearable until reset. */
  broken: string[];
  /** One-shot action ids used this run (alpha dip) — refused until reset. */
  spent: string[];
};

// 'broken' = a refused tap (broken goggles, or an already-spent one-shot like
// the alpha dip); the state is untouched and the tap must NOT be logged as an
// action (replays reject sequences containing one).
export type ActionKind = 'paint' | 'wear' | 'remove' | 'reset' | 'broken';

// Reset is part of the action log (it must be — the server replays the log to
// verify wins, and moves made before a reset still count toward the total).
// Reserved id; palette modifier ids can never collide with it.
export const RESET_ACTION_ID = '__reset__';

export function createSimState(): SimState {
  return {
    grid: new Uint8Array(CELL_COUNT),
    alpha: new Uint8Array(CELL_COUNT),
    colors: [BASE_COLOR],
    worn: [],
    broken: [],
    spent: [],
  };
}

function resetSimState(state: SimState): void {
  state.grid.fill(0);
  state.alpha.fill(0);
  state.colors.length = 1;
  state.worn.length = 0;
  state.broken.length = 0;
  state.spent.length = 0;
}

// Scratch buffer for the per-paint combined protection bitset — paints run in
// tight generation loops (160 levels × up to 14 attempts each), so avoiding a
// fresh allocation per op matters. Safe: the sim is fully synchronous.
const protScratch = new Uint8Array((CELL_COUNT + 7) >> 3);

// Runs `fn` over every EXPOSED body cell (a body cell no worn stencil covers),
// optionally further limited to `regionMaskId` — the shared core of colour
// paint (region null), the alpha dip (region null) and the bubble (region
// 'bubble-inner').
function forEachExposed(
  state: SimState, regionMaskId: string | null, fn: (cell: number) => void,
): void {
  const body = bodyBits();
  // OR all worn masks into one protection bitset, then walk whole bytes — most
  // bytes are fully covered or empty, so this skips the vast majority of cells.
  protScratch.fill(0);
  for (const id of state.worn) {
    const bits = maskBits(id);
    if (!bits) continue;
    for (let b = 0; b < protScratch.length; b++) protScratch[b] = (protScratch[b] ?? 0) | (bits[b] ?? 0);
  }
  const region = regionMaskId ? maskBits(regionMaskId) : null;
  for (let b = 0; b < body.length; b++) {
    let exposed = (body[b] ?? 0) & ~(protScratch[b] ?? 0);
    if (region) exposed &= region[b] ?? 0;
    if (exposed === 0) continue;
    const base = b << 3;
    for (let bit = 0; bit < 8; bit++) {
      if (exposed & (1 << bit)) fn(base + bit);
    }
  }
}

// A paint SPLASH (colour paint or alpha dip) knocks worn goggles off broken
// and grows a worn nose one size — the bubble is gentler and does neither.
function applySplashSideEffects(state: SimState): void {
  for (let w = state.worn.length - 1; w >= 0; w--) {
    const wornId = state.worn[w]!;
    if (isBreakableMask(wornId)) {
      state.worn.splice(w, 1);
      state.broken.push(wornId);
    }
  }
  const n = state.worn.findIndex(isNoseMaskId);
  if (n >= 0) {
    const cur = state.worn[n]!;
    const next = NOSE_SIZES[NOSE_SIZES.indexOf(cur as typeof NOSE_SIZES[number]) + 1];
    if (next) state.worn[n] = next;           // small→medium→big
    else state.worn.splice(n, 1);             // big + splash → falls off (re-wearable small)
  }
}

/**
 * Applies one modifier to the sim state. When `ops` is passed (rendering),
 * every colour paint records its op (colour + the stencils masking it) BEFORE
 * its splash side effects, so the renderer can composite exactly what the
 * player saw. Returns 'broken' for a refused tap (see ActionKind).
 */
export function applySimAction(state: SimState, mod: ModifierDef, ops?: PaintOp[]): ActionKind {
  switch (mod.type) {
    case 'paint': {
      const color = (mod.color ?? BASE_COLOR).toUpperCase();
      let idx = state.colors.indexOf(color);
      if (idx === -1) { idx = state.colors.length; state.colors.push(color); }
      ops?.push({ color, maskedBy: [...state.worn] });
      forEachExposed(state, null, (i) => { state.grid[i] = idx; state.alpha[i] = CELL_OPAQUE; });
      applySplashSideEffects(state);
      return 'paint';
    }
    case 'alpha': {
      // One dip per level: a second tap is refused (not logged).
      if (state.spent.includes(mod.id)) return 'broken';
      forEachExposed(state, null, (i) => { state.alpha[i] = CELL_DIPPED; });
      applySplashSideEffects(state);
      state.spent.push(mod.id);
      return 'paint';
    }
    case 'bubble': {
      // Reusable, and only the inner circle — the outer ring keeps its colour.
      forEachExposed(state, 'bubble-inner', (i) => { state.alpha[i] = CELL_DIPPED; });
      return 'paint';
    }
    case 'nose': {
      const at = state.worn.findIndex(isNoseMaskId);
      if (at >= 0) { state.worn.splice(at, 1); return 'remove'; } // take it off (re-wearable small)
      state.worn.push('nose-small');
      return 'wear';
    }
    default: {
      const maskId = maskIdOf(mod);
      if (maskId === null) return 'paint'; // unreachable: only paint-likes are null
      const at = state.worn.indexOf(maskId);
      if (at >= 0) { state.worn.splice(at, 1); return 'remove'; }
      if (state.broken.includes(maskId)) return 'broken';
      state.worn.push(maskId);
      return 'wear';
    }
  }
}

// Single simulation core — both the strict validator (replaySim) and the
// renderer's op stream (replayOps) run through here, so they can never diverge.
function runSim(
  palette: readonly ModifierDef[],
  actions: readonly string[],
  strict: boolean,
): { state: SimState; ops: PaintOp[] } | null {
  const state = createSimState();
  const ops: PaintOp[] = [];
  for (const actionId of actions) {
    if (actionId === RESET_ACTION_ID) {
      resetSimState(state);
      ops.length = 0;
      continue;
    }
    const mod = resolveActionDef(palette, actionId);
    if (!mod) { if (strict) return null; else continue; }
    if (applySimAction(state, mod, ops) === 'broken' && strict) return null;
  }
  return { state, ops };
}

/**
 * Replays an action-id list against a palette (plus the standard catalog).
 * Returns null when an action id resolves nowhere (a tampered or stale
 * sequence) or tries a refused tap (broken goggles / spent one-shot) — the
 * client never logs either.
 */
export function replaySim(
  palette: readonly ModifierDef[],
  actions: readonly string[],
): SimState | null {
  const run = runSim(palette, actions, true);
  return run ? run.state : null;
}

export function cellColor(state: SimState, i: number): string {
  return state.colors[state.grid[i] ?? 0] ?? BASE_COLOR;
}

/** The colour a cell actually DISPLAYS — dipped cells show their 75% version. */
export function cellEffectiveColor(state: SimState, i: number): string {
  const raw = cellColor(state, i);
  return (state.alpha[i] ?? CELL_OPAQUE) === CELL_OPAQUE ? raw : dipHex(raw);
}

/** True when every body cell DISPLAYS the same color (opacity included). */
export function patternsEqual(a: SimState, b: SimState): boolean {
  const body = bodyBits();
  for (let byteIdx = 0; byteIdx < body.length; byteIdx++) {
    const byte = body[byteIdx] ?? 0;
    if (byte === 0) continue;
    const base = byteIdx << 3;
    for (let bit = 0; bit < 8; bit++) {
      if (!(byte & (1 << bit))) continue;
      const i = base + bit;
      if (cellEffectiveColor(a, i) !== cellEffectiveColor(b, i)) return false;
    }
  }
  return true;
}

/** Win condition: pattern matches AND the slime is bare. */
export function isCleanMatch(state: SimState, goal: SimState): boolean {
  return state.worn.length === 0 && patternsEqual(state, goal);
}

/** True when any body cell DISPLAYS something other than the bare white base
 *  (a dip on white is still white, so it doesn't count — a goal needs colour). */
export function isPainted(state: SimState): boolean {
  const body = bodyBits();
  for (let byteIdx = 0; byteIdx < body.length; byteIdx++) {
    const byte = body[byteIdx] ?? 0;
    if (byte === 0) continue;
    const base = byteIdx << 3;
    for (let bit = 0; bit < 8; bit++) {
      if ((byte & (1 << bit)) && cellEffectiveColor(state, base + bit) !== BASE_COLOR) return true;
    }
  }
  return false;
}

// Structure-key downsampling: 64/4 = 16×16 blocks. Coarse on purpose — masks
// that differ by only a few cells (goggles vs glasses of the same variant)
// collapse into the same block pattern, matching how a player sees them.
const STRUCT_BLOCK = 4;

/**
 * Perceptual, color-blind signature of a pattern. The body grid is majority-
 * downsampled to 16×16 blocks and the colors are relabeled in first-appearance
 * order, so two goals that differ only by hue — or by near-identical masks —
 * share a key. The level generator dedupes on this, forcing every generated
 * level into a genuinely different SHAPE, not just a recolor.
 */
export function structureKey(state: SimState): string {
  const body = bodyBits();
  const blocks = MASK_GRID / STRUCT_BLOCK;
  const relabel = new Map<string, number>();
  const out: string[] = [];
  for (let by = 0; by < blocks; by++) {
    for (let bx = 0; bx < blocks; bx++) {
      // Majority color among the block's body cells (insertion order breaks
      // ties, which is deterministic — the scan order is fixed).
      const counts = new Map<string, number>();
      for (let dy = 0; dy < STRUCT_BLOCK; dy++) {
        for (let dx = 0; dx < STRUCT_BLOCK; dx++) {
          const i = (by * STRUCT_BLOCK + dy) * MASK_GRID + bx * STRUCT_BLOCK + dx;
          if (!getBit(body, i)) continue;
          const c = cellEffectiveColor(state, i);
          counts.set(c, (counts.get(c) ?? 0) + 1);
        }
      }
      if (counts.size === 0) {
        out.push('.');
        continue;
      }
      let best = '';
      let bestN = -1;
      for (const [c, n] of counts) {
        if (n > bestN) { best = c; bestN = n; }
      }
      let idx = relabel.get(best);
      if (idx === undefined) {
        idx = relabel.size;
        relabel.set(best, idx);
      }
      out.push(String.fromCharCode(65 + idx));
    }
  }
  return out.join('');
}

/**
 * Compact signature of a pattern — for deduping generated levels and checking
 * whether an action actually changes the outcome.
 */
export function patternKey(state: SimState): string {
  const body = bodyBits();
  const parts: string[] = [];
  for (let byteIdx = 0; byteIdx < body.length; byteIdx++) {
    const byte = body[byteIdx] ?? 0;
    if (byte === 0) continue;
    const base = byteIdx << 3;
    for (let bit = 0; bit < 8; bit++) {
      if (byte & (1 << bit)) parts.push(cellEffectiveColor(state, base + bit));
    }
  }
  return parts.join('');
}

// ── Rendering support ───────────────────────────────────────────────────────
// The client composites the visual with the real PNGs; it needs each paint op
// with the stencils that were worn at that moment, plus what's worn now.

export type PaintOp = { color: string; maskedBy: string[] };

// The renderer composites the crisp colour pattern from `ops` (each colour
// splash with the stencils that masked it), then fades the cells the final
// `alpha` grid marks dipped, then draws the `worn` stencils on top. Fading from
// the FINAL alpha grid (not per-op) keeps a reusable bubble idempotent — a cell
// re-dipped or later re-painted resolves to a single, correct opacity.
export type ReplayOps = {
  ops: PaintOp[];
  worn: string[];
  broken: string[];
  spent: string[];
  alpha: Uint8Array;
};

export function replayOps(
  palette: readonly ModifierDef[],
  actions: readonly string[],
): ReplayOps {
  // Non-strict: unresolvable / refused taps are skipped so a stray sequence
  // still renders something rather than throwing.
  const { state, ops } = runSim(palette, actions, false)!;
  return { ops, worn: state.worn, broken: state.broken, spent: state.spent, alpha: state.alpha };
}
