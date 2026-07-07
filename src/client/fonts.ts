import * as Phaser from 'phaser';

// Pixelify Sans ships fi / fl / ff / ffi ligatures. Phaser 4 paints a whole text
// line with a single canvas fillText when letterSpacing is 0, which lets the
// browser apply those ligatures — and Pixelify's collapse into an unreadable
// blob (a lowercase "fi" paints as a glyph that reads like "A", so "first" →
// "Arst", "difficulty" → "di?culty"). Any non-zero letterSpacing switches Phaser
// to per-glyph rendering, which can't form a ligature. So every Pixelify Text
// that didn't request its own tracking gets a hair of it: still visually flush,
// but ligature-free. Press Start 2P (PIXEL_FONT) has no such ligatures and is
// left at 0 so its carefully measured HUD / numeric widths never shift.
const LIGATURE_SAFE_TRACKING = 0.5;

let ligaturePatched = false;

export function patchPixelifyLigatures(): void {
  if (ligaturePatched) return;
  ligaturePatched = true;
  const factory = Phaser.GameObjects.GameObjectFactory.prototype;
  const original = factory.text;
  factory.text = function (
    this: Phaser.GameObjects.GameObjectFactory,
    x: number,
    y: number,
    text: string | string[],
    style?: Phaser.Types.GameObjects.Text.TextStyle,
  ): Phaser.GameObjects.Text {
    const created = original.call(this, x, y, text, style);
    if (created.letterSpacing === 0 && /Pixelify/i.test(created.style.fontFamily)) {
      created.setLetterSpacing(LIGATURE_SAFE_TRACKING);
    }
    return created;
  };
}

// The two web fonts arrive via the Google Fonts <link> in game.html. A Phaser
// Text object created before its font has finished downloading bakes the
// *fallback* face into its canvas texture and never re-renders when the real
// font lands — so titles and labels would silently ship in monospace/sans on a
// cold load. The whole UI therefore waits for both faces before the first scene
// builds its text.
//
// document.fonts.load() forces the fetch and resolves once the face is usable; a
// bare document.fonts.ready can resolve early (before anything has requested the
// faces). The DOM splash screen doesn't need this — CSS font-swap reflows live
// text — only the canvas-baked Phaser text does.
// Pixelify ships in both regular (body copy) and bold (headings); Press Start 2P
// has a single weight. Force all three faces so neither weight flashes fallback.
const FACES = ['16px "Pixelify Sans"', '700 16px "Pixelify Sans"', '16px "Press Start 2P"'];

export async function loadGameFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.all(FACES.map((face) => document.fonts.load(face)));
  } catch {
    // Blocked or offline font CDN — fall back to system fonts rather than hang
    // the loader forever waiting on a fetch that will never resolve.
  }
}
