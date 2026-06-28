import type { LevelData, SlimeState } from './types';

const D: SlimeState = {
  color: '#FFFFFF', goggles: null, glasses: null,
  belt: null, pendant: null, pumpkin: null, underwear: false,
};

export const CURATED_LEVELS: LevelData[] = [
  // ─────────────── WORLD 1 — BASICS ───────────────
  {
    id: 'L01', title: 'First Coat', difficulty: 1,
    goalState: { ...D, color: '#FF4136' },
    palette: [
      { id: 'paint-red',   type: 'paint', color: '#FF4136' },
      { id: 'paint-blue',  type: 'paint', color: '#0074D9' },
    ],
    optimalSteps: 1,
    hint: 'Pick the right colour!',
  },
  {
    id: 'L02', title: 'Safety First', difficulty: 1,
    goalState: { ...D, color: '#0074D9', goggles: 'h-thick' },
    palette: [
      { id: 'paint-blue',      type: 'paint',   color: '#0074D9' },
      { id: 'paint-green',     type: 'paint',   color: '#2ECC40' },
      { id: 'goggles-h-thick', type: 'goggles', variant: 'h-thick' },
      { id: 'goggles-h-thin',  type: 'goggles', variant: 'h-thin' },
    ],
    optimalSteps: 2,
    hint: 'Paint first, then protect those eyes!',
  },
  {
    id: 'L03', title: 'Slim Shady', difficulty: 1,
    goalState: { ...D, color: '#2ECC40', belt: 'h-thin' },
    palette: [
      { id: 'paint-green',  type: 'paint', color: '#2ECC40' },
      { id: 'paint-yellow', type: 'paint', color: '#FFDC00' },
      { id: 'belt-h-thin',  type: 'belt',  variant: 'h-thin' },
      { id: 'belt-h-thick', type: 'belt',  variant: 'h-thick' },
    ],
    optimalSteps: 2,
    hint: 'Green and lean!',
  },
  {
    id: 'L04', title: 'Pumpkin Spice', difficulty: 1,
    goalState: { ...D, color: '#FFDC00', pumpkin: 50 },
    palette: [
      { id: 'paint-yellow', type: 'paint',   color: '#FFDC00' },
      { id: 'paint-orange', type: 'paint',   color: '#FF851B' },
      { id: 'pumpkin-50',   type: 'pumpkin', coverage: 50 },
      { id: 'pumpkin-25',   type: 'pumpkin', coverage: 25 },
    ],
    optimalSteps: 2,
    hint: 'Half pumpkin, half slime!',
  },
  // ─────────────── WORLD 2 — MIX UP ───────────────
  {
    id: 'L05', title: 'Dressed Up', difficulty: 2,
    goalState: { ...D, color: '#B10DC9', underwear: true, pendant: 'h' },
    palette: [
      { id: 'paint-purple', type: 'paint',    color: '#B10DC9' },
      { id: 'paint-pink',   type: 'paint',    color: '#FF69B4' },
      { id: 'underwear',    type: 'underwear' },
      { id: 'pendant-h',    type: 'pendant',  variant: 'h' },
      { id: 'pendant-v',    type: 'pendant',  variant: 'v' },
    ],
    optimalSteps: 3,
    hint: 'Accessorise before you finalise!',
  },
  {
    id: 'L06', title: 'Specs Appeal', difficulty: 2,
    goalState: { ...D, color: '#FF851B', glasses: 'h-thick' },
    palette: [
      { id: 'paint-orange', type: 'paint',   color: '#FF851B' },
      { id: 'paint-red',    type: 'paint',   color: '#FF4136' },
      { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
      { id: 'glasses-h-thin',  type: 'glasses', variant: 'h-thin' },
      { id: 'glasses-v-thin',  type: 'glasses', variant: 'v-thin' },
    ],
    optimalSteps: 2,
    hint: 'Four eyes are better than two!',
  },
  {
    id: 'L07', title: 'Lil Pumpkin', difficulty: 2,
    goalState: { ...D, color: '#39CCCC', pumpkin: 25, pendant: 'v' },
    palette: [
      { id: 'paint-teal',   type: 'paint',   color: '#39CCCC' },
      { id: 'pumpkin-25',   type: 'pumpkin', coverage: 25 },
      { id: 'pumpkin-50',   type: 'pumpkin', coverage: 50 },
      { id: 'pendant-v',    type: 'pendant', variant: 'v' },
      { id: 'pendant-h',    type: 'pendant', variant: 'h' },
    ],
    optimalSteps: 3,
    hint: 'Just a little bit of pumpkin!',
  },
  {
    id: 'L08', title: 'Vertical Limit', difficulty: 2,
    goalState: { ...D, color: '#FF69B4', belt: 'v-thick', glasses: 'v-thin' },
    palette: [
      { id: 'paint-pink',    type: 'paint',   color: '#FF69B4' },
      { id: 'belt-v-thick',  type: 'belt',    variant: 'v-thick' },
      { id: 'belt-v-thin',   type: 'belt',    variant: 'v-thin' },
      { id: 'glasses-v-thin',type: 'glasses', variant: 'v-thin' },
      { id: 'goggles-v-thin',type: 'goggles', variant: 'v-thin' },
    ],
    optimalSteps: 3,
    hint: 'Go vertical!',
  },
  // ─────────────── WORLD 3 — EXPERT ───────────────
  {
    id: 'L09', title: 'Double Vision', difficulty: 3,
    goalState: { ...D, color: '#0074D9', goggles: 'v-mono' },
    palette: [
      { id: 'paint-red',    type: 'paint',   color: '#FF4136' },
      { id: 'paint-blue',   type: 'paint',   color: '#0074D9' },
      { id: 'paint-green',  type: 'paint',   color: '#2ECC40' },
      { id: 'goggles-v-mono', type: 'goggles', variant: 'v-mono' },
      { id: 'goggles-h-mono', type: 'goggles', variant: 'h-mono' },
    ],
    optimalSteps: 2,
    hint: 'Pick the colour, pick the eye!',
  },
  {
    id: 'L10', title: 'Fully Loaded', difficulty: 3,
    goalState: { ...D, color: '#2ECC40', belt: 'h-thin', glasses: 'h-thick', underwear: true },
    palette: [
      { id: 'paint-green',     type: 'paint',   color: '#2ECC40' },
      { id: 'paint-lime',      type: 'paint',   color: '#01FF70' },
      { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin' },
      { id: 'belt-h-thick',    type: 'belt',    variant: 'h-thick' },
      { id: 'glasses-h-thick', type: 'glasses', variant: 'h-thick' },
      { id: 'underwear',       type: 'underwear' },
      { id: 'pumpkin-25',      type: 'pumpkin', coverage: 25 },
    ],
    optimalSteps: 4,
    hint: 'Dress Splot up properly!',
  },
  {
    id: 'L11', title: 'Pumpkin Head', difficulty: 4,
    goalState: { ...D, color: '#FF4136', pumpkin: 75, goggles: 'h-thin' },
    palette: [
      { id: 'paint-red',      type: 'paint',   color: '#FF4136' },
      { id: 'paint-orange',   type: 'paint',   color: '#FF851B' },
      { id: 'pumpkin-75',     type: 'pumpkin', coverage: 75 },
      { id: 'pumpkin-50',     type: 'pumpkin', coverage: 50 },
      { id: 'goggles-h-thin', type: 'goggles', variant: 'h-thin' },
      { id: 'underwear',      type: 'underwear' },    // conflict trap!
    ],
    optimalSteps: 3,
    hint: 'Watch out for conflicts!',
  },
  {
    id: 'L12', title: 'The Works', difficulty: 5,
    goalState: { ...D, color: '#B10DC9', glasses: 'v-thick', belt: 'v-thin', pendant: 'h' },
    palette: [
      { id: 'paint-purple',    type: 'paint',   color: '#B10DC9' },
      { id: 'paint-blue',      type: 'paint',   color: '#0074D9' },
      { id: 'glasses-v-thick', type: 'glasses', variant: 'v-thick' },
      { id: 'glasses-v-thin',  type: 'glasses', variant: 'v-thin' },
      { id: 'belt-v-thin',     type: 'belt',    variant: 'v-thin' },
      { id: 'belt-h-thin',     type: 'belt',    variant: 'h-thin' },
      { id: 'pendant-h',       type: 'pendant', variant: 'h' },
      { id: 'goggles-v-thin',  type: 'goggles', variant: 'v-thin' }, // eye-slot trap!
    ],
    optimalSteps: 4,
    hint: 'Every choice counts!',
  },
];

export function getLevelById(id: string): LevelData | undefined {
  return CURATED_LEVELS.find(l => l.id === id);
}

export const WORLD_LABELS: Record<number, string> = {
  1: 'World 1 — Basics',
  2: 'World 2 — Mix Up',
  3: 'World 3 — Expert',
  4: 'World 4 — Master',
};
