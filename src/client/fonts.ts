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
