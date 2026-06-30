# Slime Rendering

The puzzle slime is rendered by `SlimeRenderer` (`src/client/components/SlimeRenderer.ts`).
It is a self-contained Phaser `Container` holding 9 image layers that composite via depth.
`SlimeState` (from `src/shared/types.ts`) is the single source of truth.

---

## SlimeState

```typescript
type SlimeState = {
  color:       string;          // hex "#RRGGBB" — top zone color (or whole slime)
  colorBottom?: string;         // hex — bottom zone color (only when pumpkin is active)
  goggles:  GogglesVariant | null;
  glasses:  GlassesVariant | null;
  belt:     BeltVariant    | null;
  pendant:  PendantVariant | null;
  pumpkin:  PumpkinCoverage | null;   // 25 | 50 | 75
  underwear: boolean;
};
```

The variant strings encode orientation (`h` / `v`) and style:

| Field | Type | Valid values |
|-------|------|--------------|
| `goggles` | `GogglesVariant` | `h-thick`, `h-thin`, `h-mono`, `v-thick`, `v-thin`, `v-mono` |
| `glasses` | `GlassesVariant` | `h-thick`, `h-thin`, `v-thick`, `v-thin` |
| `belt` | `BeltVariant` | `h-thick`, `h-thin`, `v-thick`, `v-thin` |
| `pendant` | `PendantVariant` | `h`, `v` |
| `pumpkin` | `PumpkinCoverage` | `25`, `50`, `75` |

`DEFAULT_SLIME_STATE` (exported from `types.ts`) is the starting state for every puzzle attempt:

```typescript
const DEFAULT_SLIME_STATE: SlimeState = {
  color: '#FFFFFF',
  goggles: null, glasses: null,
  belt: null, pendant: null, pumpkin: null, underwear: false,
};
```

---

## Layer stack

All layers sit inside a single `Phaser.GameObjects.Container`. Depths are relative to the container's own coordinate space.

```
depth -1  bottomImg    — slime-color, tinted to colorBottom, bottom crop
depth  0  topImg       — slime-color, tinted to color, full or top crop
depth  1  pumpkinImg   — mod-pumpkin-{25|50|75}
depth  2  underwearImg — mod-underwear
depth  3  beltImg      — mod-belt-{variant}
depth  4  pendantImg   — mod-pendant-{h|v}
depth  5  eyeImg       — mod-goggles-{variant} OR mod-glasses-{variant}
depth  6  shineImg     — slime-shine (alpha 0.80, always on)
depth  7  borderImg    — slime-border (always on)
depth  8  appliedFlash — slime-applied (animation only, alpha 0 when idle)
```

All images are set to the same `setDisplaySize(size, size)`. The slime-color source is 256×256; all modifier overlays are also 256×256 and were painted in the same coordinate space, so they align pixel-perfectly at any output size.

---

## Instantiation

```typescript
import { SlimeRenderer } from '../components/SlimeRenderer';

const renderer = new SlimeRenderer(scene, x, y, size);
renderer.container.setDepth(10);

// Apply a state
renderer.setState({
  color: '#2ECC40',
  goggles: 'h-thick',
  glasses: null,
  belt: null,
  pendant: null,
  pumpkin: null,
  underwear: false,
});
```

`size` is the display size in game units (e.g., `200` for a 200×200 slime). The container's position is the center of the slime.

---

## Color tinting

Single-color slimes use one image layer (`topImg`) tinted with Phaser's `setTint()`:

```typescript
const topColor = Phaser.Display.Color.HexStringToColor(state.color).color;
this.topImg.setTint(topColor);
```

`Phaser.Display.Color.HexStringToColor(hex).color` converts `"#2ECC40"` to the packed integer `0x2ECC40`. This matches exactly what `setTint()` expects.

---

## Two-color rendering

When a pumpkin is active, the slime can have two separate colors — one for the top zone (exposed) and one for the bottom zone (protected by the pumpkin). This is used in levels like "Two Tone" and "Layered Up".

**How it works:**

The pumpkin coverage defines what fraction of the slime height is "protected". The bottom zone keeps the color that was active when the pumpkin was first applied (`colorBottom`). Subsequent paint only affects the top zone (`color`).

`SlimeRenderer.setState()` splits `slime-color.png` into two cropped images:

```typescript
// In SlimeRenderer.setState():
const fraction   = state.pumpkin / 100;       // e.g. 0.50 for 50%
const topFraction = 1 - fraction;             // e.g. 0.50

// Bottom zone: bottomColor, positioned at the bottom half
this.bottomImg
  .setTint(bottomColor)
  .setOrigin(0.5, 0)
  .setPosition(0, this.size * (topFraction - 0.5))      // shift down
  .setCrop(0, Math.floor(this.texH * topFraction),       // crop top rows away
           this.texW, Math.ceil(this.texH * fraction));  // keep bottom fraction

// Top zone: topColor, positioned at the top half
this.topImg
  .setOrigin(0.5, 0)
  .setPosition(0, -this.size / 2)                        // anchor at top
  .setCrop(0, 0, this.texW, Math.ceil(this.texH * topFraction)); // keep top fraction
```

The source texture dimensions (`texW = 256, texH = 256`) are read once in the constructor from `scene.textures.get('slime-color').source[0]`.

**State transitions:**
- `paint` with no pumpkin → updates `color`, clears `colorBottom`, single-color mode
- First `pumpkin` application → saves current `color` as `colorBottom`, sets `pumpkin` coverage
- `paint` with pumpkin active → updates `color` (top only), `colorBottom` unchanged
- Changing pumpkin coverage → fraction changes, both zones redraw at new split

**Example sequence for "Two Tone" (L13):**
```
Start:  color=#FFFFFF, pumpkin=null
Step 1: paint-pink  → color=#FF69B4
Step 2: pumpkin-50  → colorBottom=#FF69B4, pumpkin=50
Step 3: paint-green → color=#2ECC40        ← top becomes green, bottom stays pink
Goal: { color: '#2ECC40', colorBottom: '#FF69B4', pumpkin: 50 }
```

---

## Modifier layers

`setLayer()` is the internal helper that shows/hides modifier images:

```typescript
private setLayer(img: Phaser.GameObjects.Image, textureKey: string | null) {
  if (textureKey) {
    img.setTexture(textureKey)
       .setDisplaySize(this.size, this.size)
       .setOrigin(0.5, 0.5)
       .setPosition(0, 0)
       .setVisible(true);
  } else {
    img.setVisible(false);
  }
}
```

**Texture key formulas:**
```typescript
pumpkinImg:   state.pumpkin !== null ? `mod-pumpkin-${state.pumpkin}` : null
underwearImg: state.underwear ? 'mod-underwear' : null
beltImg:      state.belt      ? `mod-belt-${state.belt}` : null
pendantImg:   state.pendant   ? `mod-pendant-${state.pendant}` : null
eyeImg:       state.goggles   ? `mod-goggles-${state.goggles}`
              : state.glasses ? `mod-glasses-${state.glasses}`
              : null
```

Goggles and glasses share the `eyeImg` layer — they are mutually exclusive in game rules.

---

## Game rules and conflicts

Modifier application is validated in `src/shared/gameRules.ts` before any state mutation.
`SlimeRenderer` is purely visual — it receives already-validated states from `applyModifier()`.

**The flow in the Game scene:**
```typescript
import { applyModifier } from '../../shared/gameRules';

const result = applyModifier(currentState, mod, gogglesUsed, goalState);
if (result.ok) {
  currentState = result.newState;
  slimeRenderer.setState(currentState);
  slimeRenderer.playApplyAnim(scene);
  if (result.isWin) { /* show win screen */ }
} else {
  // result.conflict and result.message are available
  slimeRenderer.playShakeAnim(scene);
  showToast(result.message);
}
```

**Conflict types** (from `types.ts`):

| Conflict | Trigger | Message |
|----------|---------|---------|
| `EYE_SLOT` | Goggles + glasses both present | "Splot can't see through all that!" |
| `GOGGLE_ONE_SHOT` | Goggles already used once | "Those goggles are all used up!" |
| `PUMPKIN_UNDERWEAR` | Underwear at pumpkin 75% | "No room for undies on that pumpkin!" |
| `UNDERWEAR_PUMPKIN75` | Pumpkin 75% while underwear on | "Take the undies off first!" |
| `THICK_BELT_PUMPKIN75` | Thick belt at pumpkin 75% | "The pumpkin ate the belt!" |
| `PUMPKIN75_THICK_BELT` | Pumpkin 75% while thick belt on | "Can't belt a full pumpkin!" |
| `COUNT_LIMIT` | Modifier used beyond `count` | "No more of that modifier!" |

Goggles are tracked separately via a `gogglesUsed: boolean` flag (not in `SlimeState`) because the one-shot rule applies per attempt, not per state.

---

## Win detection

```typescript
import { statesMatch } from '../../shared/gameRules';

const isWin = statesMatch(currentState, goalState);
```

`statesMatch` compares all fields. For two-color slimes, `colorBottom` falls back to `color` when not set:

```typescript
const aBottom = a.colorBottom ?? a.color;
const bBottom = b.colorBottom ?? b.color;
return a.color === b.color && aBottom === bBottom
  && a.goggles === b.goggles && a.glasses === b.glasses
  && a.belt === b.belt && a.pendant === b.pendant
  && a.pumpkin === b.pumpkin && a.underwear === b.underwear;
```

---

## Animations

All animations use Phaser tweens and are safe to call multiple times.

### `playApplyAnim(scene)` — modifier applied

Squish-bounce on the container + radial fade on the applied-flash overlay:

```typescript
// Applied flash: slime-applied expands and fades out
scene.tweens.add({
  targets: this.appliedFlash,
  alpha: 0, scaleX: 1.18, scaleY: 1.18,
  duration: 280, ease: 'Quad.easeOut',
});

// Container: squish down → bounce up → settle
scene.tweens.chain({
  targets: this.container,
  tweens: [
    { scaleX: 1.15, scaleY: 0.88, duration: 80 },   // squish wide
    { scaleX: 0.92, scaleY: 1.12, duration: 80 },   // bounce tall
    { scaleX: 1.0,  scaleY: 1.0,  duration: 120, ease: 'Elastic.easeOut' },
  ],
});
```

Total duration: ~280ms. The Elastic easeOut gives a wobble feel on the return.

### `playShakeAnim(scene)` — conflict

Horizontal shake at the container's world X, 4 repetitions at 45ms each = ~180ms total:

```typescript
scene.tweens.add({
  targets: this.container,
  x: { from: ox - 10, to: ox + 10 },
  duration: 45, yoyo: true, repeat: 3,
  ease: 'Sine.easeInOut',
  onComplete: () => { this.container.x = ox; },
});
```

The `onComplete` restores exact X to prevent float drift after repeated shakes.

### `playWinAnim(scene, onComplete?)` — level complete

Scale burst to 1.3× then return:

```typescript
scene.tweens.add({
  targets: this.container,
  scale: 1.3, duration: 200, ease: 'Back.easeOut', yoyo: true,
});
```

`Back.easeOut` gives a slight overshoot on the way up, making it feel celebratory.

---

## Resizing

```typescript
renderer.setSize(newSize);
```

`setSize()` re-runs `setState(currentState)` with the new size, which repositions the two-color crops and resets all layer `setDisplaySize` calls. Call this in `onResize` handlers.

---

## Rendering the goal slime (static preview)

The goal slime is a second `SlimeRenderer` instance set to `goalState` and never animated. It can be placed in a `RenderTexture` for efficiency if showing many goal slimes simultaneously (e.g., level select grid):

```typescript
// Static snapshot into a RenderTexture
const rt = scene.add.renderTexture(x, y, size, size);
const renderer = new SlimeRenderer(scene, 0, 0, size);
renderer.setState(goalState);
rt.draw(renderer.container, size / 2, size / 2);
renderer.container.destroy();
```

For single-goal-slime scenes (Game scene), a live `SlimeRenderer` is simpler and cheaper.

---

## Adding a new modifier type

1. Add the new variant type to `src/shared/types.ts`:
   ```typescript
   export type HatVariant = 'cowboy' | 'witch';
   // Add 'hat' to ModifierType union
   export type ModifierType = '...' | 'hat';
   // Add field to SlimeState
   type SlimeState = { ...; hat: HatVariant | null; };
   ```

2. Add the asset (256×256 PNG) and load it in `Preloader.ts`.

3. In `SlimeRenderer.ts`:
   - Add a new `Image` field and create it in the constructor at the appropriate depth.
   - Add `setLayer(this.hatImg, state.hat ? \`mod-hat-${state.hat}\` : null)` in `setState()`.

4. In `src/shared/gameRules.ts`, add conflict checks and the `applyToState` case.

5. Add the `ModifierDef` entry to level palettes in `levelData.ts`.
