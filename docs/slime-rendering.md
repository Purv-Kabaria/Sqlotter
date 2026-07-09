# Slime Rendering

The puzzle slime is rendered by `SlimeRenderer`
(`src/client/components/SlimeRenderer.ts`). The slime's look is a **paint
pattern**: each paint op colors the body except where the then-worn stencils
protected it. The renderer replays an action list and composites the result with
the real PNGs on a per-instance canvas texture — it is presentation only. Win
logic never reads pixels: `src/shared/slimeSim.ts` runs the same geometry on
baked 64×64 bitmaps (see `docs/core-gameplay.md`).

---

## The API

```typescript
import { SlimeRenderer } from '../components/SlimeRenderer';

const renderer = new SlimeRenderer(scene, x, y, size);
renderer.container.setDepth(10);

// Render the pattern produced by replaying `actions` over `palette`,
// plus whatever stencils are worn at the end of the replay.
renderer.setPattern(level.palette, actionLog);

// The goal preview is the same call with the level's own solution —
// valid solutions end bare, so goals always render as bare slimes.
goalRenderer.setPattern(level.palette, level.optimalSolution);

renderer.setSize(newSize);   // call from onResize; re-renders the last state
renderer.displaySize;        // current on-screen size (effect layers match it)
```

`size` is the display size in game units; the container's position is the
slime's center. Each instance owns one canvas texture
(`slime-pattern-{id}`), created in the constructor and released when the
container is destroyed — forgetting that release would leak a 256×256 canvas
into the texture manager on every scene rebuild.

---

## How `setPattern` composites

`replayOps(palette, actions)` (from the shared sim) returns the paint-op
stream, the final worn list, and the final per-cell alpha grid. Then, on the
instance's canvas texture at the art's native 256×256:

1. **Base body** — draw `slime-color.png` (white).
2. **Per paint op** — build a stamp on a shared scratch canvas: the body drawn,
   `multiply`-filled with the op's color (matching Phaser's tint math),
   `destination-in` to restore body alpha, then `destination-out` every stencil
   the op was masked by. Draw the stamp onto the pattern.
3. **Opacity veil** — if any cell is dipped, draw a white silhouette of the
   dipped cells at `1 − DIP_FACTOR` (25%) alpha. It's built from the sim's
   **final** alpha grid — a later color splash already reset its cells to
   opaque there — so a reusable bubble never compounds. A 25% white wash over a
   cell equals that cell's color composited at 75% over white, matching the
   sim's `cellEffectiveColor` exactly.
4. **Gloss shine** — `slime-shine` overlay-blended at 0.5, then
   `destination-in` clamped back to the body alpha.

Canvas 2D supports the `overlay` composite directly, which is why the pattern
is baked on a canvas texture rather than layered Phaser images (Phaser's
OVERLAY blend is Canvas-renderer-only; on WebGL it silently falls back to
NORMAL).

**Stencil masks are binarized.** `getStencil()` caches, per maskId, a copy of
the modifier PNG with alpha flattened to 0/255 at threshold 100 — the same
`STENCIL_ALPHA_THRESHOLD` used by `scripts/generate_masks.py` when baking the
sim bitmaps. Translucent goggle lenses PROTECT in the sim, so paint erasure
must flatten them too; otherwise paint would peek through lenses the sim says
are covered. The sim and the renderer share geometry by construction.

---

## Worn stencils

Stencils currently worn at the end of the replay draw as normal images in wear
order **above `slime-border.png`** (but under the apply flash) — accessories
sit ON the slime, so the outline must not cut across their art. The container's
child order is: pattern image → border → worn stencils → applied flash.

Texture keys are `mod-{maskId}` (e.g. `mod-goggles-h-thick`, `mod-pumpkin-50`,
`mod-nose-medium`, `mod-scarf` variants) — see `docs/assets.md` for the full
key catalog.

---

## Animations

All are Phaser tweens on the container, safe to call repeatedly.

| Method | Effect |
|--------|--------|
| `playApplyAnim(scene)` | ~280ms squish-wide → bounce-tall → elastic settle, plus the `slime-applied` flash (ADD blend) expanding and fading |
| `playShakeAnim(scene)` | ~180ms horizontal shake (4 × 45ms), restores exact X on complete to prevent float drift |
| `playWinAnim(scene, onComplete?)` | scale burst to 1.3× with `Back.easeOut` overshoot, yoyo back |

The apply flash keeps `Phaser.BlendModes.ADD` — a brightening burst is the
right feel for a momentary flash, and ADD (unlike OVERLAY) works natively on
WebGL.

---

## Shine elsewhere

Other slime-shine highlights (the Preloader's decorative slime, the Game
scene's color-picker swatches, Splot's `char-shine`) use
`src/client/components/overlayShine.ts#paintOverlayShine()`, which computes an
alpha-aware overlay blend on the CPU via the `color-blend` package and bakes it
into a `CanvasTexture` at the source art's native resolution. Those are
single-color tints baked once (or once per unique hex); the pattern renderer
above does its own overlay compositing because it redraws per action.

---

## Adding a new modifier

1. Add the 256×256 PNG under `public/assets/modifiers/` (painted in the same
   coordinate space as `slime/color.png` so it aligns pixel-perfectly).
2. Re-run `scripts/generate_masks.py` to bake its coverage into
   `src/shared/maskData.ts` (never hand-edit that file).
3. Add the type/variant to `ModifierDef` in `src/shared/types.ts` and its
   maskId mapping in `slimeSim.ts#maskIdOf`.
4. Load the texture in `Preloader.ts` as `mod-{maskId}` (and optionally a
   palette icon under `OPTIONAL_PUZZLE_ICONS`).
5. The renderer needs no changes — it discovers masks by id.
