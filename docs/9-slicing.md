# 9-Slice Panels & Buttons in Sqlotter

Nine-slicing (also called 9-patch) divides a texture into a 3×3 grid:

```
┌───┬──────────┬───┐
│ TL│    TC    │ TR│  ← corners: drawn at natural pixel size, never scaled
├───┼──────────┼───┤
│ ML│    MC    │ MR│  ← edges: TileSprite, tiles along one axis only
│   │          │   │
├───┼──────────┼───┤
│ BL│    BC    │ BR│
└───┴──────────┴───┘
```

Only the center and edges stretch; corners stay pixel-perfect at 1:1 regardless of output size.

---

## Asset shapes (reference images)

### Button asset — horizontal pill

The button source (`button-open.png`, 128×96) is a **horizontal pill / stadium shape**.
The 9-slice grid cuts at 32px from each edge:

```
 0          32              96         128
 ┌──────────┬───────────────┬──────────┐ 0
 │ ░░░░ TL │      TC       │ TR ░░░░ │
 │ ░░░ ╭───┤               ├───╮ ░░░ │ 32
 ├─────┤   │               │   ├─────┤
 │  ML │   │      MC       │   │  MR │
 ├─────┤   │               │   ├─────┤ 64
 │ ░░░ ╰───┤               ├───╯ ░░░ │
 │ ░░░░ BL │      BC       │ BR ░░░░ │ 96
 └──────────┴───────────────┴──────────┘
```

`░░` = **4 pixels of transparent margin** at each outer corner edge.
Measured on the actual PNG: `btn-open-tl.png` has `top: 4, left: 4` transparent rows/columns.
The straight side edges (ML, MR, TC, BC) are **fully opaque** at their outer boundary.

### Panel asset — rounded square

The panel source (`panel.png`, 96×96) is a **rounded square / circle shape**.
The 9-slice grid cuts at 32px from each edge:

```
 0      32          64      96
 ┌───────┬───────────┬───────┐ 0
 │  ╭────┤           ├────╮  │
 │  │ TL │    TC     │ TR │  │ 32
 ├──┤    │           │    ├──┤
 │ML│    │    MC     │    │MR│
 ├──┤    │           │    ├──┤ 64
 │  │ BL │    BC     │ BR │  │
 │  ╰────┤           ├────╯  │ 96
 └───────┴───────────┴───────┘
```

Panel corners have **zero transparent margin** — measured `top: 0, left: 0` on all four corner PNGs.
The dark-brown rounded shape fills to the very edge of each 32×32 tile; the rounding is formed by
the opaque pixels themselves, not by transparency. This means the visual bounds match the container
bounds exactly.

---

## Asset inventory

| Component | Source texture | Source size | Corner inset | Corner transparency |
|-----------|---------------|-------------|--------------|---------------------|
| Button (open/hover/press/dis) | `ui/button-{state}.png` → `ui-btn-*` | 128×96 | 32 | **4px** outer edge |
| Small button / badge | `ui/slices/btn-open-sm-*.png`, composed to `ui-btn-open-sm` at load | 64×48 | 16 | ~2px |
| Panel | `ui/panel.png` → `ui-panel` | 96×96 | 32 | **0px** (fully opaque) |
| Beige card / slot | `more ui/UI_Flat_FrameSlot01c.png` | 32×32 total | 10 | 0px |
| Dark panel | Procedurally generated 64×64 in `Boot.ts` | — | 12 | 0px |

---

## Implementation: one NineSlice per surface

Every 9-sliced surface is a single `scene.add.nineslice()` of a whole-image
texture — `ui-panel`, `ui-btn-open/hover/press/dis`, `ui-btn-open-sm`,
`ui-flat-slot`, `ui-dark-panel`. One batched GameObject per surface.

**History**: the shells used to be assembled from 9 pre-sliced PNGs
(`build9Pieces()` — 3 `Image` corners + 6 `TileSprite` edges), on the belief
that Phaser's NineSlice couldn't swap textures per-state. Two problems killed
that approach:

1. **TileSprites dominated the mobile frame budget.** A Game scene carried ~80
   of them (12 palette tiles + HUD buttons + stat pills × 6 each); hiding them
   dropped the throttled frame time from ~79ms to ~12ms. Rebuilding them on
   every palette refresh was also most of the tap lag on phones.
2. The premise is false in Phaser 4: `NineSlice` extends `Components.Texture`,
   so `setTexture('ui-btn-hover')` re-renders in place — all four button
   states share the same 128×96 layout, so the slice geometry stays valid.

The pre-sliced files still shipping in `ui/slices/` are only loaded for the
small-corner variant: the nine `btn-open-sm-*` cells are stitched back into
the single `ui-btn-open-sm` (64×48) texture by `Preloader.composeSmallButtonTexture()`
at load (they are the hand-tuned half-scale art; no full-size downsample file
exists). The full-size `pnl-*` / `btn-*-{pos}` piece sets are no longer loaded.

---

## API reference

### `addPanel9(scene, x, y, width, height)`

Creates a panel of any size (one NineSlice of `ui-panel`, wrapped in a Container).

```typescript
import { addPanel9 } from '../components/PixelUI';

const panel = addPanel9(scene, splitX / 2, height / 2, panelW, panelH);
panel.setDepth(3);
```

- `x, y` — world position of the **center**
- `width, height` — output size; rounded to even numbers internally to prevent sub-pixel gaps
- Returns `Phaser.GameObjects.Container`
- **Minimum size**: 64×64 (corner tiles are 32×32 and must not overlap)
- Panel is not interactive — no hitbox needed

---

### `addBeigeButton(scene, options)`

Beige pill-shaped button with dark-brown text, optional icon, and three interactive states.

```typescript
import { addBeigeButton } from '../components/PixelUI';

const btn = addBeigeButton(scene, {
  x: cx,
  y: startY,
  width: 320,
  height: 70,
  label: 'Play',
  iconKey: 'icon-play',           // optional
  fontSize: 18,                   // optional — defaults to height × 0.28
  fontFamily: '"Pixelify Sans", sans-serif',  // optional
  disabled: false,                // optional — grays out + removes interaction
  onClick: () => scene.scene.start('LevelSelect'),
});
btn.setDepth(8);
```

**Container contents:**

| Index | Object | Role |
|-------|--------|------|
| 0 | background `NineSlice` | Texture-swapped on state change |
| 1 | `Container` (icon + drop shadow) | Optional; created by `addDepthIcon` |
| last | `Text` | Label |

**Interaction states:**

| Event | Texture prefix | Position tween |
|-------|---------------|----------------|
| `pointerover` | `btn-hover-*` | y → ry − 3 (80 ms, Quad.easeOut) |
| `pointerout` | `btn-open-*` | y → ry (90 ms, Quad.easeOut) |
| `pointerdown` | `btn-press-*` | y → ry + 2, scale 0.97 (60 ms) |
| `pointerup` | `btn-hover-*` → fires `onClick` | y → ry − 3, scale 1 (70 ms) |

---

### `addBeigeButtonShell(scene, x, y, width, height, disabled, onClick)`

The background + hover/press interaction logic behind `addBeigeButton`, extracted so scenes that
need a beige-button-styled surface with *custom* content (not just a label + optional icon) can
reuse the same texture-swap/tween behavior. `LevelSelect`'s level and community cards use this —
each card needs a number badge, difficulty dots, title, and stars laid out inside the button shell.

```typescript
import { addBeigeButtonShell } from '../components/PixelUI';

const shell = addBeigeButtonShell(scene, cx, cy, cardW, cardH, isLocked, () => {
  scene.scene.start('Game', { levelId: level.id });
});

shell.addContent([titleText, starIcon1, starIcon2, starIcon3]); // added into shell.visual
```

- Returns `{ container, visual, addContent }` — `container` is what you position/depth/return;
  `visual` is the inner sub-container the hover/press tweens move (see "No flicker-prevention
  extension needed" above — same reasoning applies here).
- `addBeigeButton` is now a thin wrapper: it calls this, then adds its label/icon via `addContent`.
- Same 65px minimum as `addBeigeButton` (32px corners) — see "Minimum size constraints" below.
- To tint just the background (e.g. per-world accent color) without recoloring text/icons added
  via `addContent`, use `shell.setTint(accentColor)` — it tints only the background NineSlice
  and survives hover/press feedback (the small variant restores it after its state tints).

---

### `addBeigeCard(scene, x, y, width, height)`

Non-interactive beige slot via Phaser's built-in NineSlice. Use for HUD badges, sparks pills,
stat boxes — anything too small for the 32px-corner button.

```typescript
const card = addBeigeCard(scene, x, y, 120, 32);
```

- Corner inset: 10px (`FLAT_SLICE`)
- Minimum size: 20×20
- Returns `Phaser.GameObjects.NineSlice`

---

### `addDarkPanel(scene, x, y, width, height)`

Near-black rounded panel for modifier palettes and overlay backgrounds.

```typescript
const bg = addDarkPanel(scene, cx, cy, paletteW, paletteH);
```

- Corner inset: 12px (`DARK_SLICE`)
- Source texture generated at boot as a 64×64 rounded-rect graphics object
- Minimum size: 24×24
- Returns `Phaser.GameObjects.NineSlice`

---

## Choosing the right component

| Use case | Component | Reason |
|----------|-----------|--------|
| Main menu / game buttons | `addBeigeButton` | Multi-state texture swap + animation |
| Buttons with custom content (level cards, icon-only nav, etc.) | `addBeigeButtonShell` | Same shell/interaction, caller supplies content |
| Left sidebar / card frames | `addPanel9` | Large panel, beige border |
| Stat boxes, HUD slots, pills | `addBeigeCard` | Small, single-state, cheap |
| Modifier palette background | `addDarkPanel` | Dark, procedural, cheap |
| Disabled button | `addBeigeButton({ disabled: true })` | Grayed-out, no interaction |

---

## Hitbox for `addBeigeButton`

The interactive area is a custom `Phaser.Geom.Rectangle` set on the outer container:

```typescript
container.setInteractive(
  new Phaser.Geom.Rectangle(4, 4, W - 8, H - 8),
  Phaser.Geom.Rectangle.Contains,
);
```

### Phaser Container hitbox coordinate system (critical)

Phaser's `InputManager.pointWithinHitArea` does **not** pass raw local coordinates to the
Rectangle test. Before calling `Rectangle.Contains`, it adds the container's `displayOriginX`
and `displayOriginY`:

```javascript
// From InputManager.js (Phaser 4)
x += gameObject.displayOriginX;   // Container always returns width  * 0.5
y += gameObject.displayOriginY;   // Container always returns height * 0.5
```

This shifts the coordinate space so that `(0, 0)` in hitbox space corresponds to the
**top-left corner** of the container, not its center. The Rectangle must therefore use
top-left-origin coordinates, not center-origin coordinates.

The common mistake is to write `(-W/2+4, -H/2+4, W-8, H-8)` assuming center-origin, which
places the hitbox shifted W/2 to the LEFT of the button visual — exactly spanning the wrong
half of the screen in fullscreen/landscape mode.

The correct Rectangle: `(4, 4, W-8, H-8)` where (4, 4) is 4px from the top-left corner.

### Why 4px inset on all four sides

The button corner tiles (`btn-open-tl.png` etc.) have exactly **4 transparent pixels** along their
outer edge. Measured from actual PNG alpha channel:

```
btn-open-tl (32×32):  top=4px transparent, left=4px transparent
btn-open-tr (32×32):  top=4px transparent, right=4px transparent
btn-open-bl (32×32):  bottom=4px transparent, left=4px transparent
btn-open-br (32×32):  bottom=4px transparent, right=4px transparent
```

The side edge tiles (ML, MR, TC, BC) are fully opaque at their boundaries. Inset of 4px
aligns the hitbox exactly with the first opaque pixels at every edge:

```
  ← 4px →                              ← 4px →
  ┌────┬───────────────────────────┬────┐  ─┐
  │░░░░│                           │░░░░│   │ 4px transparent
  ├────┼───────────────────────────┼────┤  ─┤
  │    │      hitbox lives here    │    │
  │    │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │    │
  ├────┼───────────────────────────┼────┤  ─┤
  │░░░░│                           │░░░░│   │ 4px transparent
  └────┴───────────────────────────┴────┘  ─┘
```

### No flicker-prevention extension needed

Hover tweens target the inner `visual` sub-container only — the outer container (which holds the
hitbox) never moves. The hitbox stays fixed in world space regardless of the hover animation,
so no bottom-height extension is required.

### `setSize` vs hitbox

`container.setSize(Math.max(W, 44), Math.max(H, 44))` sets the layout bounding box for a
minimum 44px touch target. It does **not** affect the interactive area — the custom `Rectangle`
+ `Phaser.Geom.Rectangle.Contains` callback overrides it entirely.

---

## Minimum size constraints

### 32px-corner assets (Panel, Button)

Corners are always at natural 32×32. The edge and center pieces fill the gap:

```
mw = output_width  − 64  (must be > 0 → minimum width  = 65px)
mh = output_height − 64  (must be > 0 → minimum height = 65px)
```

Below 65px in either dimension: the edge TileSprite gets zero or negative size — Phaser clips it
to 0px, the two corner pieces in that axis overlap, and the visual corrupts. Always pass
`width ≥ 65, height ≥ 65` for `addBeigeButton` and `addPanel9`.

For touch targets smaller than 65px, use `addBeigeCard` (10px corners) instead.

### 10px-corner (Beige card): minimum 21×21
### 12px-corner (Dark panel): minimum 25×25

---

## Adding a new 9-sliceable asset

1. **Design the source.** Give it a clear 3×3 structure with opaque or transparent margins as
   needed. Decide on corner size (power-of-two is not required, but consistent corner W and H
   avoids layout complexity).

2. **Export ONE whole-image file** (`public/assets/ui/mything.png`) and load it in `Preloader`:
   ```typescript
   { key: 'ui-mything', path: 'ui/mything.png' },
   ```

3. **Slice at runtime in `PixelUI.ts`** with a single NineSlice:
   ```typescript
   const CW = 16, CH = 16;  // your corner dimensions
   const slice = scene.add.nineslice(0, 0, 'ui-mything', undefined, outputW, outputH, CW, CW, CH, CH);
   ```
   Do NOT assemble it from per-piece Images/TileSprites — a screen full of
   TileSprites is what made the Game scene lag on phones (see History above).

4. **Set the hitbox** if interactive. Measure the transparent margin with:
   ```python
   from PIL import Image
   img = Image.open('mything-tl.png').convert('RGBA')
   px = img.load()
   w, h = img.size
   left_margin = next(x for x in range(w) for y in range(h) if px[x,y][3] > 32)
   top_margin  = next(y for y in range(h) for x in range(w) if px[x,y][3] > 32)
   ```
   Then inset the hitbox by those pixel values + hover offset if the button animates upward.

5. **Multi-state swapping** (optional): export one whole-image file per state with the SAME
   dimensions and slice layout, and call `slice.setTexture('ui-mything-hover')` in pointer
   event handlers — Phaser 4's NineSlice re-renders in place.

---

## Common pitfalls

| Problem | Cause | Fix |
|---------|-------|-----|
| Sub-pixel gaps between slices | Odd output dimensions | Pass even integers; `PixelUI.ts` rounds internally |
| Corners overlap / center missing | Output dimension < 65px with 32px corners | Use `addBeigeCard` for small elements |
| Hitbox spans wrong area of screen | Using center-origin coords (`-W/2+4`) but Phaser adds `displayOriginX=W/2` first | Use top-left-origin coords: `(4, 4, W-8, H-8)` |
| Hover flickers at button edge | Hover tween moves the Container (hitbox shifts too) | Tween only the inner `visual` sub-container; outer container stays fixed |
| Hover triggers just outside the visual | Hitbox not inset to match transparent corner margin | Inset by measured transparent px count (4px for these buttons) |
| Texture doesn't swap on hover | State textures differ in size/layout | Export every state at the same dimensions; `setTexture()` then swaps cleanly |
| Panel interaction triggers unexpectedly | Panel has 0px transparent margin; hitbox = full container | Add explicit inset or don't make panels interactive |
