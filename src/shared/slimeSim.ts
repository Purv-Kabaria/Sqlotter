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

/** The stencil geometry a modifier uses; null for paints. */
export function maskIdOf(mod: ModifierDef): string | null {
  switch (mod.type) {
    case 'paint':     return null;
    case 'goggles':   return `goggles-${mod.variant ?? 'h-thick'}`;
    case 'glasses':   return `glasses-${mod.variant ?? 'h-thick'}`;
    case 'belt':      return `belt-${mod.variant ?? 'h-thick'}`;
    case 'pendant':   return `pendant-${mod.variant ?? 'h'}`;
    case 'pumpkin':   return `pumpkin-${mod.coverage ?? 50}`;
    case 'underwear': return 'underwear';
  }
}

// ── Sim state ───────────────────────────────────────────────────────────────

export type SimState = {
  /** Per-cell index into `colors`. Only body cells are meaningful. */
  grid: Uint8Array;
  /** Color table; colors[0] is always BASE_COLOR (unpainted). */
  colors: string[];
  /** Mask ids currently worn, in wear order. */
  worn: string[];
  /** Mask ids broken this run (goggles painted over) — unwearable until reset. */
  broken: string[];
};

// 'broken' = a wear attempt on broken goggles; the state is untouched and the
// tap must NOT be logged as an action (replays reject sequences containing one).
export type ActionKind = 'paint' | 'wear' | 'remove' | 'reset' | 'broken';

// Reset is part of the action log (it must be — the server replays the log to
// verify wins, and moves made before a reset still count toward the total).
// Reserved id; palette modifier ids can never collide with it.
export const RESET_ACTION_ID = '__reset__';

export function createSimState(): SimState {
  return { grid: new Uint8Array(CELL_COUNT), colors: [BASE_COLOR], worn: [], broken: [] };
}

function resetSimState(state: SimState): void {
  state.grid.fill(0);
  state.colors.length = 1;
  state.worn.length = 0;
  state.broken.length = 0;
}

// Scratch buffer for the per-paint combined protection bitset — paints run in
// tight generation loops (160 levels × up to 14 attempts each), so avoiding a
// fresh allocation per op matters. Safe: the sim is fully synchronous.
const protScratch = new Uint8Array((CELL_COUNT + 7) >> 3);

export function applySimAction(state: SimState, mod: ModifierDef): ActionKind {
  const maskId = maskIdOf(mod);
  if (maskId === null) {
    const color = (mod.color ?? BASE_COLOR).toUpperCase();
    let idx = state.colors.indexOf(color);
    if (idx === -1) {
      idx = state.colors.length;
      state.colors.push(color);
    }
    const body = bodyBits();
    // OR all worn masks into one protection bitset, then walk whole bytes —
    // most bytes are fully covered or fully empty, so this skips the vast
    // majority of the 4096 cells instead of testing each bit per mask.
    protScratch.fill(0);
    for (const id of state.worn) {
      const bits = maskBits(id);
      if (!bits) continue;
      for (let b = 0; b < protScratch.length; b++) protScratch[b] = (protScratch[b] ?? 0) | (bits[b] ?? 0);
    }
    for (let b = 0; b < body.length; b++) {
      const exposed = (body[b] ?? 0) & ~(protScratch[b] ?? 0);
      if (exposed === 0) continue;
      const base = b << 3;
      for (let bit = 0; bit < 8; bit++) {
        if (exposed & (1 << bit)) state.grid[base + bit] = idx;
      }
    }
    // The splash knocks worn goggles off and breaks them — one-time use.
    for (let w = state.worn.length - 1; w >= 0; w--) {
      const wornId = state.worn[w]!;
      if (isBreakableMask(wornId)) {
        state.worn.splice(w, 1);
        state.broken.push(wornId);
      }
    }
    return 'paint';
  }

  const at = state.worn.indexOf(maskId);
  if (at >= 0) {
    state.worn.splice(at, 1);
    return 'remove';
  }
  if (state.broken.includes(maskId)) return 'broken';
  state.worn.push(maskId);
  return 'wear';
}

/**
 * Replays an action-id list against a palette (plus the standard catalog).
 * Returns null when an action id resolves nowhere (a tampered or stale
 * sequence) or tries to wear broken goggles — the client never logs either.
 */
export function replaySim(
  palette: readonly ModifierDef[],
  actions: readonly string[],
): SimState | null {
  const state = createSimState();
  for (const actionId of actions) {
    if (actionId === RESET_ACTION_ID) {
      resetSimState(state);
      continue;
    }
    const mod = resolveActionDef(palette, actionId);
    if (!mod) return null;
    if (applySimAction(state, mod) === 'broken') return null;
  }
  return state;
}

export function cellColor(state: SimState, i: number): string {
  return state.colors[state.grid[i] ?? 0] ?? BASE_COLOR;
}

/** True when every body cell resolves to the same color in both states. */
export function patternsEqual(a: SimState, b: SimState): boolean {
  const body = bodyBits();
  for (let byteIdx = 0; byteIdx < body.length; byteIdx++) {
    const byte = body[byteIdx] ?? 0;
    if (byte === 0) continue;
    const base = byteIdx << 3;
    for (let bit = 0; bit < 8; bit++) {
      if (!(byte & (1 << bit))) continue;
      const i = base + bit;
      if (cellColor(a, i) !== cellColor(b, i)) return false;
    }
  }
  return true;
}

/** Win condition: pattern matches AND the slime is bare. */
export function isCleanMatch(state: SimState, goal: SimState): boolean {
  return state.worn.length === 0 && patternsEqual(state, goal);
}

/** True when any body cell has been painted away from the base color. */
export function isPainted(state: SimState): boolean {
  const body = bodyBits();
  for (let byteIdx = 0; byteIdx < body.length; byteIdx++) {
    const byte = body[byteIdx] ?? 0;
    if (byte === 0) continue;
    const base = byteIdx << 3;
    for (let bit = 0; bit < 8; bit++) {
      if ((byte & (1 << bit)) && cellColor(state, base + bit) !== BASE_COLOR) return true;
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
          const c = cellColor(state, i);
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
      if (byte & (1 << bit)) parts.push(cellColor(state, base + bit));
    }
  }
  return parts.join('');
}

// ── Rendering support ───────────────────────────────────────────────────────
// The client composites the visual with the real PNGs; it needs each paint op
// with the stencils that were worn at that moment, plus what's worn now.

export type PaintOp = { color: string; maskedBy: string[] };

export type ReplayOps = { ops: PaintOp[]; worn: string[]; broken: string[] };

export function replayOps(
  palette: readonly ModifierDef[],
  actions: readonly string[],
): ReplayOps {
  const worn: string[] = [];
  const broken: string[] = [];
  const ops: PaintOp[] = [];
  for (const actionId of actions) {
    if (actionId === RESET_ACTION_ID) {
      worn.length = 0;
      broken.length = 0;
      ops.length = 0;
      continue;
    }
    const mod = resolveActionDef(palette, actionId);
    if (!mod) continue;
    const maskId = maskIdOf(mod);
    if (maskId === null) {
      // The splash is masked by the goggles it lands on — THEN they break off.
      ops.push({ color: (mod.color ?? BASE_COLOR).toUpperCase(), maskedBy: [...worn] });
      for (let w = worn.length - 1; w >= 0; w--) {
        if (isBreakableMask(worn[w]!)) broken.push(...worn.splice(w, 1));
      }
      continue;
    }
    const at = worn.indexOf(maskId);
    if (at >= 0) worn.splice(at, 1);
    else if (!broken.includes(maskId)) worn.push(maskId);
  }
  return { ops, worn, broken };
}
