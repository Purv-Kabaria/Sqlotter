# Splot Mascot

Splot is the game's character mascot — distinct from the puzzle slime.
He appears on the main menu, loading screen, shop, and win/conflict reactions.
He is rendered by `SplotMascot` (`src/client/components/SplotMascot.ts`).

---

## Layer stack

Splot is 11 images inside a `Phaser.GameObjects.Container`. Depths are internal to the container.

```
depth  0/5  shadow   — splot-shadow (home screen) or char-shadow sprite (everywhere else) — see below
depth 10  blob       — char-blob         (body; splash-screen green by default, tint overridable)
depth 20  mouth      — char-mouth-*      (switches per expression; default char-mouth-smile)
depth 22  blush      — char-blush        (fades in/out — visible only on excited/kiss)
depth 22  cry        — char-cry          (fades in/out — visible only on sad)
depth 30  eye        — char-eye-*        (switches per expression; blinks in idle; default char-eye-normal)
depth 40  eyebrow    — char-brow-*       (switches per expression/equip; default char-brow-normal, always visible)
depth 50  accessory  — char-acc-*        (hidden when none equipped)
depth 58  applied    — char-applied      (flash overlay; tweened alpha only during playAppliedFlash)
depth 60  shine      — char-shine        (alpha 0.5, always visible)
depth 65  outline    — char-outline      (always visible)
```

All images are set to `setDisplaySize(size, size)` where `size` is passed to the constructor,
**except the shadow when the CSS-style variant is active** (see below), which is a flattened
ellipse sized off `size` separately.

### Asset dimensions

| Layer | Source file | Source size | Notes |
|-------|-------------|-------------|-------|
| blob | `character/blob.png` | **512×512** | Higher res than all other layers |
| shadow (sprite) | `character/shadow.png` | 128×128 | Default everywhere except the home screen |
| shadow (CSS-style) | procedural, `Boot.ts` | 256×96 (source texture) | Home screen only — see "Shadow" below |
| all others | `character/*.png` | **128×128** | Eyes, mouth, outline, shine, accessories |

The blob is 512×512 so it stays sharp at large display sizes (240–440px). All other square layers
are 128×128 and share the same coordinate space when displayed at the same `size`.

### Shadow: sprite vs. CSS-style

`SplotMascot`'s constructor takes a `useCssShadow` flag (last param, default `false`):

```typescript
new SplotMascot(scene, x, y, size, equipped, blobColor, useCssShadow)
```

- **Default (`false`)** — used by `Shop.ts` and `LevelComplete.ts`. Renders `character/shadow.png`
  (key `char-shadow`) as a normal `size × size` layer at depth 5, like every other layer.
- **`true`** — used only by `MainMenu.spawnMascot()` for the home-screen Splot. Instead of the
  sprite, `Boot.ts#genSplotShadowTexture()` generates a `splot-shadow` texture once at boot: 8
  concentric semi-transparent black ellipses (`fillEllipse`, alpha 0.05 each) drawn into a 256×96
  `Graphics` object and baked with `generateTexture`. Overlapping alpha builds up toward the center
  and falls off toward the edges, faking the soft blur a CSS `box-shadow`/`drop-shadow` would
  produce. It's displayed as a flat ellipse under the character rather than a character-shaped
  silhouette, at depth 0:

  ```typescript
  this.shadow = scene.add.image(0, s * 0.40, 'splot-shadow')
    .setDisplaySize(s * 0.85, s * 0.30).setDepth(0);
  ```

`setSize(s)` follows the same branch: the CSS-style shadow resizes/repositions as `s * 0.85` wide,
`s * 0.30` tall, offset `s * 0.40` down from center; the sprite shadow just resizes to `s × s` like
every other layer. Either way it scales correctly with the mascot at any display size.

---

## Instantiation

```typescript
import { SplotMascot } from '../components/SplotMascot';

const mascot = new SplotMascot(
  scene,
  x,           // center X in world coords
  y,           // center Y in world coords
  size,        // display size in game units (e.g. 240)
  equipped,    // Record<string, string> from user profile — see Equipped items below
  0x6DD400,    // optional blob tint (Splot's default green)
);

mascot.container.setDepth(5);
scene.add.existing(mascot.container);  // if not added via a parent container
```

The constructor immediately calls `startIdleAnims()`.

### Interactive Splot (tap to squish)

```typescript
mascot.container.setInteractive(
  new Phaser.Geom.Circle(0, 0, size * 0.50),
  Phaser.Geom.Circle.Contains,
);
mascot.container.on('pointerdown', () => {
  mascot.playSquishAnim();
  mascot.setExpression('excited', 1200);
});
```

Circle hit area with radius = half the display size. `Phaser.Geom.Circle.Contains` tests in local space (container-relative), so `(0, 0)` is the center of the container.

---

## Expressions

Eight built-in expressions map to specific eye/eyebrow/mouth/effect combinations:

| Name | Eye | Eyebrow | Mouth | Extras |
|------|-----|---------|-------|--------|
| `happy` (default/resting) | `char-eye-normal` | `char-brow-normal` | `char-mouth-smile` | — |
| `excited` (tap reaction) | `char-eye-cute` | `char-brow-surprise` | `char-mouth-kiss` | blush fades in |
| `sad` | `char-eye-pain` | `char-brow-sad` | `char-mouth-frown` | cry fades in |
| `shocked` | `char-eye-shock` | `char-brow-surprise` | `char-mouth-ooo` | — |
| `doubt` | `char-eye-doubt` | `char-brow-normal` | `char-mouth-squiggle` | — |
| `pain` | `char-eye-pain` | `char-brow-angry` | `char-mouth-frown` | — |
| `kiss` | `char-eye-cute` | `char-brow-normal` | `char-mouth-kiss` | blush fades in |
| `squiggle` | `char-eye-open` | `char-brow-normal` | `char-mouth-squiggle` | — |

The eyebrow layer is always visible — `setExpression` swaps its texture just like eye/mouth, and
an equipped eyebrow item (see "Equipped items" below) overrides the texture again once the
expression reverts to `happy`.

**Setting an expression:**

```typescript
// Permanent until changed
mascot.setExpression('shocked');

// Temporary — reverts to 'happy' after 1500ms
mascot.setExpression('shocked', 1500);
```

`setExpression` swaps the eye/eyebrow/mouth textures instantly, but fades `blush`/`cry` in or out
with a short alpha tween (`animateFacePart`, ~150ms) instead of an abrupt visibility toggle. The
revert uses `scene.time.delayedCall`.

### Idle blink

During idle, eyes blink every 3200ms. The eye is hidden for 130ms:

```typescript
this.blinkTimer = scene.time.addEvent({
  delay: 3200, loop: true,
  callback: () => {
    const key = this.eye.texture.key;
    // Don't blink if eyes are already closed or styled
    if (key === 'char-eye-pain' || key === 'char-eye-happy') return;
    this.eye.setVisible(false);
    scene.time.delayedCall(130, () => this.eye.setVisible(true));
  },
});
```

Expressions that use `char-eye-pain` suppress blinking because that texture is already
closed/squinted. `char-eye-happy` is no longer used by any built-in expression (the default
resting eye is now `char-eye-normal`), but the guard is left in place since a user can still
equip `eye-happy` as a shop item. Add new "no-blink" keys to the guard condition if needed.

### Adding a new expression

1. Add the name to the `SplotExpression` union type:
   ```typescript
   export type SplotExpression = '...' | 'myNewExpr';
   ```

2. Add its config to `EXPRESSIONS`:
   ```typescript
   myNewExpr: {
     eye:     'char-eye-open',
     eyebrow: 'char-brow-angry',
     mouth:   'char-mouth-ooo',
     blush:   false,
     cry:     false,
   },
   ```

3. Call `mascot.setExpression('myNewExpr')` wherever needed.

No asset changes required if the expression reuses existing eye/eyebrow/mouth textures.

---

## Idle animations

Started automatically in the constructor. Stopped via `stopIdleAnims()` before the scene shuts down.

### Float bob

Gentle vertical oscillation:
```typescript
this.bobTween = scene.tweens.add({
  targets: this.container,
  y: container.y - 6,       // 6px upward
  duration: 800,
  yoyo: true, repeat: -1,
  ease: 'Sine.easeInOut',
});
```

Duration per half-cycle: 800ms → full cycle 1600ms. The `yoyo: true, repeat: -1` makes it loop indefinitely.

**Important:** The `bobTween` targets the container's world Y. If the container is repositioned between builds, destroy the old tween and recreate it, or the starting Y reference will be stale.

### Blink

See Idle blink section above.

---

## Interactive animations

All animations are safe to call repeatedly — each creates a new tween and the previous one is interrupted or runs to completion independently.

### `playSquishAnim()` — on tap

Wide squish that bounces back:
```typescript
scene.tweens.add({
  targets: this.container,
  scaleX: 1.15, scaleY: 0.88,
  duration: 60, yoyo: true,
  ease: 'Quad.easeOut',
  onComplete: () => { this.container.setScale(1); },
});
```

Duration per direction: 60ms → total ~120ms. `setScale(1)` in `onComplete` snaps back cleanly in case of float drift.

### `playPressAnim()` — UI press feedback

Uniform scale-down:
```typescript
scene.tweens.add({
  targets: this.container,
  scaleX: 0.95, scaleY: 0.95,
  duration: 60, yoyo: true,
  ease: 'Quad.easeOut',
});
```

### `playWin()` — level complete

Combines expression, flash, and scale burst:
```typescript
mascot.playWin();
// Internally:
// 1. setExpression('excited')
// 2. playAppliedFlash()  — shine overlay expands and fades
// 3. Scale to 1.25× → yoyo → setExpression('kiss', 2000)
```

The full sequence lasts about 2200ms (200ms scale + 2000ms kiss expression hold).

### `playConflict()` — invalid modifier

Shake + shocked expression:
```typescript
mascot.playConflict();
// Internally:
// 1. setExpression('shocked', 1500)
// 2. Horizontal shake: x ± 8px, 50ms, 3 repeats
```

The shake uses an absolute X target `{ from: ox - 8, to: ox + 8 }` with `onComplete` restoring `container.x = ox`. This prevents drift if `playConflict` is called multiple times rapidly.

### `playAppliedFlash()` — modifier applied (separate from win)

The `char-applied` (shine overlay) expands and fades:
```typescript
this.applied.setVisible(true).setAlpha(0.7).setScale(1);
scene.tweens.add({
  targets: this.applied,
  alpha: 0, scaleX: 1.16, scaleY: 1.16,
  duration: 300, ease: 'Quad.easeOut',
  onComplete: () => this.applied.setVisible(false).setScale(1),
});
```

---

## Equipped items

The user can purchase cosmetics in the Shop. Equipped items are stored in `UserProfile.equippedItems` (a `Record<string, string>`) and passed to the constructor.

### Slot keys and texture key formula

| Slot key | `equippedItems` key | Texture key formula | Example |
|----------|---------------------|---------------------|---------|
| `eye`       | `items.eye`       | `char-${value}`         | `char-eye-cute` |
| `eyebrow`   | `items.eyebrow`   | `char-${value}`         | `char-brow-sad` |
| `mouth`     | `items.mouth`     | `char-${value}`         | `char-mouth-kiss` |
| `accessory` | `items.accessory` | `char-${value}` + visible | `char-acc-crown` |

The `value` in `equippedItems` is the shop item ID minus the type prefix:
- Shop item `id: 'eye-cute'` → `items.eye = 'eye-cute'` → texture `char-eye-cute`
- Shop item `id: 'acc-crown'` → `items.accessory = 'acc-crown'` → texture `char-acc-crown`

```typescript
private applyEquipped(items: Record<string, string>) {
  if (items.eye)       this.eye.setTexture(`char-${items.eye}`);
  this.eyebrow.setTexture(items.eyebrow ? `char-${items.eyebrow}` : 'char-brow-normal');
  if (items.mouth)     this.mouth.setTexture(`char-${items.mouth}`);
  if (items.accessory) this.accessory.setTexture(`char-${items.accessory}`).setVisible(true);
}
```

**Default appearance** (when no item equipped, and no `blobColor` passed):
- Eye: `char-eye-normal`
- Eyebrow: `char-brow-normal`, always visible
- Mouth: `char-mouth-smile`
- Body: splash-screen green (`char-blob` tinted `0x6DD400`, `DEFAULT_BLOB_COLOR`)
- Accessory: hidden

### Updating equipped items live

```typescript
// After a shop purchase completes:
mascot.refresh(newEquippedItems);
```

`refresh()` hides the accessory first (clearing whichever was previously equipped), then
re-applies the new items — so unequipping it correctly goes back to hidden. The eyebrow layer
is never hidden; unequipping an eyebrow item just falls back to `char-brow-normal`.

---

## Cleanup

Always call `stopIdleAnims()` before the mascot's scene shuts down:

```typescript
// In scene.shutdown or Phaser.Scenes.Events.SHUTDOWN handler:
mascot.stopIdleAnims();
```

This destroys the bob tween and blink timer to prevent callbacks from firing on destroyed objects.

```typescript
shutdown() {
  this.mascot?.stopIdleAnims();
  this.scale.off('resize', this.onResize, this);
}
```

---

## Resize

`setSize(newSize)` resizes all 11 image layers:

```typescript
mascot.setSize(300);
```

The shadow is the one exception, and only when the mascot was constructed with `useCssShadow: true`
(home screen). In that case it isn't a `size × size` square like the other layers — it's resized as
a flat ellipse (`s * 0.85` wide, `s * 0.30` tall) offset `s * 0.40` below center, so it keeps looking
like a contact shadow instead of stretching into a circle at every size. Everywhere else the shadow
sprite resizes to `s × s` along with the rest of the layers.

The bob tween targets the container `y`, so if you also move the container, stop and recreate the tween. A common pattern:

```typescript
mascot.stopIdleAnims();
mascot.container.setPosition(newX, newY);
// SplotMascot doesn't re-expose startIdleAnims() publicly;
// rebuild the mascot or keep track of the tween externally if needed.
```

For scenes that call `buildUI()` on resize, it's simpler to destroy the old mascot and create a new one — `buildUI()` calls `mascot.stopIdleAnims()` first.

---

## Color tinting

Pass a hex integer as the `blobColor` argument to tint the blob:

```typescript
const mascot = new SplotMascot(scene, x, y, size, equipped, 0xFF4136); // red Splot
```

Omit `blobColor` (or pass `undefined`) for the default splash-screen-green blob (`DEFAULT_BLOB_COLOR = 0x6DD400`; use this if skin color comes from a shop item later). All other layers (outline, eyes, etc.) are not tinted.

---

## Usage map

| Scene / context | Splot purpose | Expression flow |
|-----------------|---------------|-----------------|
| `MainMenu` | Idle greeter | Idle (happy + bob + blink); squish on tap → excited 1200ms |
| Loading screen | Progress mascot | Static, no `SplotMascot` — drawn directly with `slime-color` |
| `Game` (HUD) | Reaction to gameplay | Apply modifier → `playAppliedFlash`; conflict → `playConflict`; win → `playWin` |
| `LevelComplete` | Celebration | `playWin` immediately; `setExpression('kiss')` after burst |
| `Shop` | Customization preview | `refresh(equipped)` after each purchase; no idle expression changes |
