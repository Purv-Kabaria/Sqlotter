# UI Components & Layout

Reference for the Phaser UI system in Sqlotter: icons, text, responsive layout math, and scene patterns.
For the nine-slice panel/button system, see `docs/9-slicing.md`.

---

## Icon system

Icons are rendered via `addDepthIcon` from `src/client/components/PixelUI.ts`.

### `addDepthIcon(scene, x, y, key, w, h, shadowOffset?, shadowAlpha?)`

Creates a two-image stack: a black-tinted shadow copy offset by `shadowOffset` pixels, and the icon on top. Returns a `Phaser.GameObjects.Container` centered at `(x, y)`.

```typescript
import { addDepthIcon } from '../components/PixelUI';

const icon = addDepthIcon(scene, 120, 60, 'icon-play', 32, 32);
icon.setDepth(9);
```

Parameters:

| Param | Default | Notes |
|-------|---------|-------|
| `shadowOffset` | `2` | Pixels right and down for the shadow |
| `shadowAlpha` | `0.50` | Shadow opacity |

The shadow uses `setTintFill(0x000000)` — a flat black fill, not a texture blend — so it works correctly regardless of icon color.

**Sizing convention:** render icons at the display size you need, not the source size. Source sizes (96×96 for most icons) have no significance at runtime.

```typescript
// 24px icon inside a 78px button
const icon = addDepthIcon(scene, iconX, 0, 'icon-timer', 24, 24);

// 48px icon standalone on the HUD
const spark = addDepthIcon(scene, hudX, hudY, 'icon-spark', 48, 48);
```

### Icon key reference

See `docs/assets.md` for the full table. Quick summary:

| Category | Key format | Source size |
|----------|-----------|-------------|
| Navigation | `icon-{arrow\|home\|settings\|cancel\|help\|share}` | 128×128 |
| Gameplay | `icon-{play\|pause\|timer\|reset}` | 96×96 |
| Puzzle palette | `icon-{paint\|pendant\|glasses-thick\|...}` | 96×96 |
| HUD | `icon-{heart\|spark\|star\|fire}` | 96×96 |
| Community | `icon-{people\|trophy\|pencil\|gold\|silver\|bronze}` | 96×96 |
| Shop | `icon-{bag\|lock\|unlock\|price}` | 96×96 |
| Status | `icon-{check\|cross\|warning}` | 96×96 |
| Misc | `icon-{plus\|minus\|dot\|sparkle}` | 64×64 |

---

## Fonts

Two fonts are used. Both are pixel / retro style.

| Constant | Font | Used for |
|----------|------|---------|
| `PIXEL_FONT` (PixelUI.ts) | `"Press Start 2P", monospace` | Legacy scenes (Editor, LevelComplete) |
| `PIXELIFY` (scene files) | `"Pixelify Sans", sans-serif` | All new UI (buttons, HUD, labels) |

**Text style template:**

```typescript
const style: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: '"Pixelify Sans", sans-serif',
  fontSize: '18px',
  color: '#3A1A08',   // dark brown (C.TEXT_DARK)
  shadow: { offsetX: 1, offsetY: 1, color: '#C8A870', blur: 0, fill: true },
};
```

**Color constants** (defined in each scene's local `C` object):

| Name | Hex | Usage |
|------|-----|-------|
| `C.HEADER_BG` | `0x232323` | Dark background bars |
| `C.AMBER` | `'#C8940A'` | Sparks text, gold accents |
| `C.TEXT_DARK` | `'#3A1A08'` | Button labels, usernames |

**Drop shadow for lifted text:**

```typescript
shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true }
// blur: 0 keeps it pixel-sharp
// fill: true fills the shadow with color (not outline-only)
```

For light text on dark backgrounds (e.g., sparks counter):
```typescript
shadow: { offsetX: 1, offsetY: 1, color: '#7A4A20', blur: 0, fill: true }
color: '#C8940A'  // amber
```

---

## Sparks pill

The sparks HUD element (star icon + number) is built in `buildSparksPill()` in `MainMenu.ts`. Use the same pattern in other scenes:

```typescript
// Portrait: top-right of title strip
const pillH = Math.round(titleH * 0.60);   // proportional to strip height
const pillW = 88;
buildSparksPill(w - pillW / 2 - 8, titleH / 2, pillW, pillH, depth);

// Landscape: fixed position top-right
const pillH = 32, pillW = 108;
buildSparksPill(w - pillW / 2 - 10, pillH / 2 + 8, pillW, pillH, depth);
```

The pill uses `addBeigeCard` (not a button) because it is non-interactive and too small for 32px button corners. Rule of thumb: **pill height under 65px → use `addBeigeCard`**.

### Updating the sparks count

`buildSparksPill` stores the `Text` object in `this.sparksText`. Update it directly when sparks change:

```typescript
if (this.sparksText) {
  this.sparksText.setText(`${newSparks}`);
}
```

---

## Responsive layout

All scenes support `Phaser.Scale.RESIZE` mode. Layout code runs in `buildUI()` which is called on `create()`, after API data loads, and on every resize event.

### Scale factor

For elements that should not grow beyond a reference size, compute a scale factor:

```typescript
const sf = Math.min(width / 1024, height / 768, 1); // never above 1×
const iconSize = Math.round(48 * sf);
```

Scenes that drive layout from `%` of width/height don't need `sf` explicitly — the percentage already adapts.

### Portrait vs landscape branching

```typescript
if (height > width) {
  this.buildPortraitLayout(width, height, elements);
} else {
  this.buildLandscapeLayout(width, height, elements);
}
```

This single branch point keeps both layouts in sync on resize. The threshold is purely aspect ratio — no device-type detection.

### Common layout variables

```typescript
const cx = width / 2;   // horizontal center
const cy = height / 2;  // vertical center
const pad = 14;          // standard inner padding (portrait)
const pad = 24;          // standard inner padding (landscape)
```

### Button sizing

**Portrait (5 stacked buttons):**

```typescript
const minBtnArea = 5 * 66 + 4 * 4 + pad * 2;  // minimum to fit 5×66px with 4px gaps
const skyH = Math.min(h * 0.36, h - titleH - minBtnArea);
const remaining = h - titleH - skyH;
const rawBtnH = Math.round((remaining - pad * 2) / 5) - 8;
const btnH = Math.min(Math.max(rawBtnH, 66), 84);  // floor 66, cap 84
const gap  = Math.max(4, Math.round((remaining - pad * 2 - 5 * btnH) / 4));
```

The floor of 66 is determined by the nine-slice corner size: `BTN_CH = 32`, so `2 × 32 = 64` is the absolute minimum button height before corners overlap. 66 gives 2px center.

**Landscape (1 full-width + 2×2 grid):**

```typescript
const btnW   = Math.min(rightW - 48, Math.round(rightW * 0.88));
const btnH   = Math.min(Math.round(h * 0.12), 110);
const smallH = Math.round(btnH * 0.88);
const gap    = Math.max(8, Math.round(h * 0.015));
const halfW  = (btnW - gap) / 2;   // each grid cell width
```

### Vertical centering a group

```typescript
const groupH = btnH + gap + smallH + gap + smallH;
const available = h - topMargin - pad;
const btnTop = topMargin + Math.max(8, Math.round((available - groupH) / 2));
```

This centers the entire button group within the available vertical space while respecting a minimum 8px offset from `topMargin`.

### Overlap-safe positioning (username → buttons)

When an element (e.g., username text) is positioned relative to another element's size, its bottom edge may vary. Rather than hardcoding a gap, derive the button start:

```typescript
const usernameY = splotY + Math.round(splotSz * 0.58);
const btnAreaStart = Math.max(titleH + skyH, usernameY + 26);
const startY = btnAreaStart + pad;
```

`Math.max(...)` ensures buttons always start below the dynamically-positioned username, even on edge-case screen sizes where the splot and username land unusually close to the zone boundary.

---

## Depth conventions

Depths are assigned per-scene but follow a rough shared convention:

| Depth range | Usage |
|-------------|-------|
| −10 to −1 | Background parallax layers |
| 0 to 2 | Background solid fills |
| 3 to 4 | Panel backgrounds, dark overlays |
| 5 to 7 | Mascot / character container |
| 8 to 9 | Buttons, cards, interactive elements |
| 10 to 11 | Title strip / header bar, logo |
| 12+ | Overlays, tooltips, sparks pill |

When adding objects to a `Container`, depths are local to that container and do not interact with the world depth. Set `container.setDepth(N)` for the container's world position, and use child image depths for internal ordering.

---

## UI elements walkthrough

### Adding a labeled HUD counter

```typescript
// Step counter in the Game HUD
const stepBg  = addBeigeCard(scene, cx, y, 120, 36);
const stepIcon = addDepthIcon(scene, cx - 40, y, 'icon-reset', 20, 20);
const stepText = scene.add.text(cx - 20, y, 'Steps: 0', {
  fontFamily: '"Pixelify Sans", sans-serif',
  fontSize: '16px',
  color: '#3A1A08',
}).setOrigin(0, 0.5);
stepBg.setDepth(8);
stepIcon.setDepth(9);
stepText.setDepth(9);
```

### Adding a full-width section header

```typescript
const headerBar = scene.add.rectangle(0, y, width, 40, 0x232323).setOrigin(0, 0.5).setDepth(10);
const headerText = scene.add.text(width / 2, y, 'LEADERBOARD', {
  fontFamily: '"Pixelify Sans", sans-serif',
  fontSize: '20px',
  color: '#DEC998',
  shadow: { offsetX: 1, offsetY: 1, color: '#3A1A08', blur: 0, fill: true },
}).setOrigin(0.5).setDepth(11);
```

### Streak badge

The streak badge (shown on MainMenu when `streakDays > 0`) uses `addBeigeCard` + icon + text in a container:

```typescript
const pillW = 160, pillH = 24;
const bg   = addBeigeCard(scene, 0, 0, pillW, pillH);
const icon = addDepthIcon(scene, -pillW / 2 + 14, 0, 'icon-fire', 14, 14);
const txt  = scene.add.text(-pillW / 2 + 28, 0, `${days} day streak!`, {
  fontFamily: PIXELIFY, fontSize: '12px', color: C.TEXT_DARK,
}).setOrigin(0, 0.5);
const badge = scene.add.container(x, y, [bg, icon, txt]);
```

All positions inside the container use center-relative coordinates (0, 0 = center of badge).

---

## Scene structure pattern

Every scene follows this structure:

```typescript
export class MyScene extends Phaser.Scene {
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private uiLayer: Phaser.GameObjects.Container | null = null;

  constructor() { super('MyScene'); }

  init() {
    this.bgLayers = [];
    this.uiLayer = null;
    // reset all state here so the scene is clean after `scene.start()`
  }

  create() {
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.shutdown, this);
    this.cameras.main.setBackgroundColor(0x232323);
    this.cameras.main.fadeIn(400, 10, 5, 14);

    this.buildBackground();
    this.buildUI();
    this.scale.on('resize', this.onResize, this);

    void this.loadData();  // async API fetch
  }

  private async loadData() {
    const res = await fetch('/api/...');
    if (res.ok) {
      this.data = await res.json();
      this.buildUI();  // rebuild after data arrives
    }
  }

  private buildBackground() { /* ... */ }

  private buildUI() {
    this.uiLayer?.destroy(true);  // destroy old UI before rebuild
    const elements: Phaser.GameObjects.GameObject[] = [];
    // ... build layout here ...
    this.uiLayer = this.add.container(0, 0, elements);
  }

  private onResize(gameSize: Phaser.Structs.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.repositionBgLayers(gameSize.width, gameSize.height);
    this.buildUI();
  }

  private repositionBgLayers(width: number, height: number) {
    this.bgLayers.forEach(img => {
      img.setPosition(width / 2, height / 2);
      img.setScale(Math.max(width / img.width, height / img.height) * 1.05);
    });
  }

  shutdown() {
    this.scale.off('resize', this.onResize, this);
    // destroy any timers or tweens that target destroyed objects
  }
}
```

Key rules:
- `init()` resets all fields — scenes are reused across `scene.start()` calls.
- `buildUI()` always calls `uiLayer?.destroy(true)` first — this destroys all child GameObjects recursively.
- `onResize` rebuilds the entire UI — Phaser's resize mode means `width`/`height` can change any time.
- `SHUTDOWN` event (not `destroy`) is used because `scene.start()` shuts down the current scene before starting the next.

### Scene transition

```typescript
private goToScene(key: string, param?: string) {
  this.cameras.main.fadeOut(250, 10, 5, 14);
  this.time.delayedCall(260, () => {
    this.scene.start(key, param ? { levelId: param } : undefined);
  });
}
```

The 10ms delay after the fade-out gives the camera effect time to complete before the scene swap.

---

## Background parallax system

All four background sets are in use, one mood per destination — arriving anywhere
reads as a place change:

| Set | Art | Scenes |
|-----|-----|--------|
| `bg1-*` | night sky, crescent moon | LevelSelect (incl. the finder), Leaderboard |
| `bg2-*` | pink clouds | Shop, Editor |
| `bg3-*` | purple dusk clouds | Game (and its portrait header) |
| `bg4-*` | bright day, big cumulus | MainMenu |

bg3/bg4 load in the Preloader; bg1/bg2 are DEFERRED (`DEFERRED_IMG`) — MainMenu
streams them once interactive, and the scenes that use them re-declare them in
their own `preload()` so a fast click can't outrun the download. Layers are
stacked with decreasing alpha and drift in alternating directions:

```typescript
const keys   = ['bg4-1', 'bg4-2', 'bg4-3', 'bg4-4'];
const alphas = [1, 0.80, 0.55, 0.30];

keys.forEach((key, i) => {
  const img = this.add.image(width / 2, height / 2, key)
    .setAlpha(alphas[i] ?? 0.3)
    .setDepth(-10 + i);

  img.setScale(Math.max(width / img.width, height / img.height) * 1.05);
  this.bgLayers.push(img);

  const dir = i % 2 === 0 ? 1 : -1;
  this.tweens.add({
    targets: img,
    x: width / 2 + dir * 18,   // ± 18px horizontal drift
    duration: 13000 + i * 3500,
    yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
  });
});
```

`1.05` scale headroom ensures the 18px drift never reveals the edge. Each layer drifts at a slightly different speed (3500ms offset per layer), creating a parallax depth illusion.

**Changing background set:** replace the `keys` array with a different `bg{N}-*` set. Alphas are tuned per set — the day/pink sets fade upper layers (`[1, 0.80, 0.55, 0.30]`); the bg1 night set keeps its layers near-solid (`[1, 1, 0.90, 0.85]`) because a dimmed moon just looks broken and the night must stay dark.

---

## Animation timing reference

| Animation | Duration | Ease |
|-----------|---------|------|
| Scene fade in/out | 400 / 250ms | — |
| Button hover lift | 80ms | Quad.easeOut |
| Button hover return | 90ms | Quad.easeOut |
| Button press down | 60ms | — |
| Button press release | 70ms | — |
| Splot squish | 60ms × 2 (yoyo) | Quad.easeOut |
| Splot bob cycle | 800ms × 2 (yoyo, repeat) | Sine.easeInOut |
| Splot blink | every 3200ms, hidden 130ms | — |
| Splot win burst | 200ms | Back.easeOut |
| Splot conflict shake | 50ms × 4 | Sine.easeInOut |
| Slime apply squish chain | 80 + 80 + 120ms | Quad / Elastic.easeOut |
| Slime shake | 45ms × 4 | Sine.easeInOut |
| Slime win scale | 200ms | Back.easeOut |
| Applied flash fade | 280–300ms | Quad.easeOut |
| Background drift | 13000–24500ms | Sine.easeInOut |
| Logo float bob | 2400ms | Sine.easeInOut |
