# Asset Catalog

Every file under `public/assets/`, its Phaser texture key, dimensions, and purpose.
Load path is set in `Preloader.ts` via `this.load.setPath('assets')`.

---

## Directory tree

```
public/assets/
├── title.png                    ← game logo
├── slime/                       ← puzzle slime layers
├── character/                   ← Splot mascot layers
│   ├── eyes/
│   ├── eyebrows/
│   ├── mouth/
│   └── accessories/
├── modifiers/                   ← puzzle modifier overlays
├── icons/
│   ├── navigation/
│   ├── gameplay/
│   ├── puzzle/
│   ├── hud/
│   ├── community/
│   ├── shop/
│   ├── status/
│   └── misc/
├── ui/
│   ├── panel.png
│   ├── button-open.png
│   ├── button-hover.png
│   ├── button-press.png
│   ├── button-disabled.png
│   ├── loading-border.png
│   ├── loading-filler.png
│   └── slices/                  ← pre-cut nine-slice pieces
├── more ui/
│   └── UI_Flat_FrameSlot01c.png
└── background/
    ├── background 1/ (1.png–4.png)
    ├── background 2/
    ├── background 3/
    └── background 4/
```

---

## Logo

| File | Key | Size | Notes |
|------|-----|------|-------|
| `title.png` | `title` | 512×112 | Pixel-art wordmark "SQLOTTER". Aspect ratio 512:112. Always scale with `setDisplaySize(w, w*112/512)`. |

---

## Backgrounds

Four parallax layer sets, each with four depth layers (1 = deepest, 4 = closest).

| File | Key | Size | Typical alpha |
|------|-----|------|--------------|
| `background/background 4/1.png` | `bg4-1` | 576×324 | 1.0 (base) |
| `background/background 4/2.png` | `bg4-2` | 576×324 | 0.80 |
| `background/background 4/3.png` | `bg4-3` | 576×324 | 0.55 |
| `background/background 4/4.png` | `bg4-4` | 576×324 | 0.30 |
| Same pattern for sets 1, 2, 3 | `bg{1-3}-{1-4}` | 576×324 | — |

Background 4 (sky/clouds) is used on MainMenu. The others are available for different scenes.

**Usage pattern — cover-scale with parallax drift:**
```typescript
const img = this.add.image(width / 2, height / 2, 'bg4-1');
img.setScale(Math.max(width / img.width, height / img.height) * 1.05);
// 1.05 headroom gives the parallax drift room without showing edges
this.tweens.add({
  targets: img, x: width / 2 + 18,
  duration: 13000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
});
```

**Adding a background set:** drop 4 PNGs into `background/background N/`, load them in `Preloader.ts`, and switch the `keys` array in `buildBackground()`.

---

## Slime base layers

All 256×256. Rendered using `SlimeRenderer` (see `docs/slime-rendering.md`).

| File | Key | Purpose |
|------|-----|---------|
| `slime/color.png` | `slime-color` | White body shape — the base of every pattern composite and the alpha clamp |
| `slime/border.png` | `slime-border` | Black outline, always on top of the pattern |
| `slime/overlay-normal.png` | `slime-shine` | Gloss highlight, overlay-composited into the pattern at 0.5 |
| `slime/overlay-applied.png` | `slime-applied` | Post-action flash (ADD blend) |

`SlimeRenderer` composites the paint pattern (body + per-coat tinted stamps with
worn stencils punched out + dip veil + shine) onto a per-instance canvas texture —
see `docs/slime-rendering.md`. Single-color shine bakes elsewhere (Preloader's
decorative slime, color-picker swatches, Splot) use `paintOverlayShine()`
(`src/client/components/overlayShine.ts`).

**Child order inside `SlimeRenderer`'s container:**

```
patternImg    (the per-instance canvas texture: body + coats + dip veil + shine)
borderImg     (slime-border, always visible)
worn stencils (mod-{maskId} images in wear order — ON the slime, above the outline)
appliedFlash  (slime-applied, ADD blend, only during animation)
```

---

## Modifier overlays

All 256×256 PNG with transparency. Drawn at the same display size as the slime body so they composite automatically.

### Goggles

| File | Key | Variant string |
|------|-----|----------------|
| `modifiers/horizontal-goggles-thick.png` | `mod-goggles-h-thick` | `h-thick` |
| `modifiers/horizontal-goggles-thin.png`  | `mod-goggles-h-thin`  | `h-thin`  |
| `modifiers/horizontal-goggle.png`        | `mod-goggles-h-mono`  | `h-mono`  |
| `modifiers/vertical-goggles-thick.png`   | `mod-goggles-v-thick` | `v-thick` |
| `modifiers/vertical-goggles-thin.png`    | `mod-goggles-v-thin`  | `v-thin`  |
| `modifiers/vertical-goggle.png`          | `mod-goggles-v-mono`  | `v-mono`  |

Key formula: `mod-goggles-${variant}` where variant is `h-thick`, `h-thin`, `h-mono`, `v-thick`, `v-thin`, `v-mono`.

### Glasses

| File | Key | Variant string |
|------|-----|----------------|
| `modifiers/horizontal-glasses-thick.png` | `mod-glasses-h-thick` | `h-thick` |
| `modifiers/horizontal-glasses-thin.png`  | `mod-glasses-h-thin`  | `h-thin`  |
| `modifiers/vertical-glasses-thick.png`   | `mod-glasses-v-thick` | `v-thick` |
| `modifiers/vertical-glasses-thin.png`    | `mod-glasses-v-thin`  | `v-thin`  |

Key formula: `mod-glasses-${variant}`.

### Belt

| File | Key | Variant string |
|------|-----|----------------|
| `modifiers/horizontal-belt-thick.png` | `mod-belt-h-thick` | `h-thick` |
| `modifiers/horizontal-belt-thin.png`  | `mod-belt-h-thin`  | `h-thin`  |
| `modifiers/vertical-belt-thick.png`   | `mod-belt-v-thick` | `v-thick` |
| `modifiers/vertical-belt-thin.png`    | `mod-belt-v-thin`  | `v-thin`  |

Key formula: `mod-belt-${variant}`.

### Pendant

| File | Key | Variant string |
|------|-----|----------------|
| `modifiers/horizontal-pendent.png` | `mod-pendant-h` | `h` |
| `modifiers/vertical-pendent.png`   | `mod-pendant-v` | `v` |

Key formula: `mod-pendant-${variant}`.

### Pumpkin

| File | Key | Coverage |
|------|-----|---------|
| `modifiers/pumpkin-25.png` | `mod-pumpkin-25` | 25% |
| `modifiers/pumpkin-50.png` | `mod-pumpkin-50` | 50% |
| `modifiers/pumpkin-75.png` | `mod-pumpkin-75` | 75% |

Key formula: `mod-pumpkin-${coverage}`.

### Underwear, plate, cone

| File | Key |
|------|-----|
| `modifiers/underwear.png` | `mod-underwear` |
| `modifiers/plate.png` | `mod-plate` |
| `modifiers/cone.png` | `mod-cone` |

### Scarf

| File | Key |
|------|-----|
| `modifiers/scarf-right.png` | `mod-scarf` |

The left/right variants share one coverage mask, so the game loads a single
texture (`scarf-left.png` exists as art but isn't loaded). The palette tile
carries a diagonal orientation arrow (135° for left, −45° for right) instead of
separate icons.

### Nose (grows one size per splash)

| File | Key |
|------|-----|
| `modifiers/nose-small.png` | `mod-nose-small` |
| `modifiers/nose-medium.png` | `mod-nose-medium` |
| `modifiers/nose-big.png` | `mod-nose-big` |

### Bubble (reusable inner-circle opacity dip)

| File | Key |
|------|-----|
| `modifiers/bubble.png` | `mod-bubble` |

**Texture key rule:** worn masks render as `mod-{maskId}` — the maskId comes from
`slimeSim.ts#maskIdOf` (`goggles-h-thick`, `pumpkin-50`, `nose-medium`, `plate`, …).

**Adding a new modifier overlay:**
1. Place `modifiers/my-mod.png` at 256×256 with transparency, painted in the same
   coordinate space as `slime/color.png`.
2. Re-run `scripts/generate_masks.py` to bake its coverage into `src/shared/maskData.ts`.
3. Add the type/variant in `src/shared/types.ts` and its maskId in `slimeSim.ts#maskIdOf`.
4. Load in `Preloader.ts`: `{ key: 'mod-mymod', path: 'modifiers/my-mod.png' }`.
   `SlimeRenderer` discovers masks by id — no renderer changes needed.

---

## Character / Splot mascot

Splot is a separate 11-layer system from the puzzle slime. See `docs/splot-mascot.md` for the full API.

### Body

| File | Key | Size | Notes |
|------|-----|------|-------|
| `character/blob.png` | `char-blob` | **512×512** | The blob body — tinted `0x6DD400` (splash-screen green) by default, tint overridable |
| `character/outline.png` | `char-outline` | 128×128 | Black outline, always on top |
| — (procedural, `Boot.ts`) | `splot-shadow` | 256×96 | Soft blurred contact-shadow ellipse, depth 0 — generated at boot from concentric `fillEllipse` calls; the ONLY Splot shadow. `character/shadow.png` exists as art but is never loaded (it reads as a hard black blob against flat panels). See `docs/splot-mascot.md` |
| `character/overlay-normal.png` | `char-shine` | 128×128 | Gloss highlight — genuine OVERLAY blend baked via `color-blend`, amount 0.5 |
| `character/overlay-applied.png` | `char-applied` | 128×128 | Flash on interaction, ADD blend, tweened to alpha 0 |

**Note:** `char-blob` is 512×512 while all other character layers are 128×128. All are rendered at the same `setDisplaySize(size, size)` regardless — Phaser scales them to match. The higher-resolution blob gives Splot a crisper appearance at large sizes (240–440px display).

### Eyes

| File | Key | Expression use |
|------|-----|----------------|
| `character/eyes/eye-normal.png` | `char-eye-normal` | Default idle |
| `character/eyes/eye-doubt.png`  | `char-eye-doubt`  | `doubt` |
| `character/eyes/eye-cute.png`   | `char-eye-cute`   | `excited`, `kiss` |
| `character/eyes/eye-pain.png`   | `char-eye-pain`   | `sad`, `pain` |
| `character/eyes/eye-happy.png`  | `char-eye-happy`  | `happy` |
| `character/eyes/eye-shock.png`  | `char-eye-shock`  | `shocked` |
| `character/eyes/eye-open.png`   | `char-eye-open`   | `squiggle` |

All 128×128.

### Eyebrows

| File | Key | Expression use |
|------|-----|----------------|
| `character/eyebrows/eyebrow-normal.png`   | `char-brow-normal`   | Default, `happy`, `doubt`, `kiss`, `squiggle` |
| `character/eyebrows/eyebrow-surprise.png` | `char-brow-surprise` | `excited`, `shocked` |
| `character/eyebrows/eyebrow-sad.png`      | `char-brow-sad`      | `sad` |
| `character/eyebrows/eyebrow-angry.png`    | `char-brow-angry`    | `pain` |

All 128×128.

### Mouth

| File | Key | Expression use |
|------|-----|----------------|
| `character/mouth/mouth-happy.png`   | `char-mouth-happy`   | `happy` |
| `character/mouth/mouth-smile.png`   | `char-mouth-smile`   | (available, unused in base expressions) |
| `character/mouth/mouth-frown.png`   | `char-mouth-frown`   | `sad`, `pain` |
| `character/mouth/mouth-squiggle.png`| `char-mouth-squiggle`| `doubt`, `squiggle` |
| `character/mouth/mouth-kiss.png`    | `char-mouth-kiss`    | `excited`, `kiss` |
| `character/mouth/mouth-ooo.png`     | `char-mouth-ooo`     | `shocked` |
| `character/mouth/blush.png`         | `char-blush`         | Shown on `excited`, `kiss` |
| `character/mouth/cry.png`           | `char-cry`           | Shown on `sad` |

All 128×128. `char-blush` and `char-cry` are effect overlays toggled by `setVisible()`, not full expressions.

### Accessories

| File | Key | Shop ID | Price |
|------|-----|---------|-------|
| `character/accessories/horns.png`     | `char-acc-horns`     | `acc-horns`     | 325 ✦   |
| `character/accessories/party-hat.png` | `char-acc-party-hat` | `acc-party-hat` | 200 ✦   |
| `character/accessories/crown.png`     | `char-acc-crown`     | `acc-crown`     | 25,000 ✦ (Golden Crown — also unlocks the Royal Slime flair tier) |
| `character/accessories/cap.png`       | `char-acc-cap`       | `acc-cap`       | 150 ✦   |
| `character/accessories/hat.png`       | `char-acc-hat`       | `acc-hat`       | 375 ✦   |

Prices are defined once in `src/shared/shop.ts` (`SHOP_ITEMS`) — treat that file as
authoritative and this table as a pointer to it, not a second source of truth.

All 128×128. Accessories are hidden by default (`setVisible(false)`) and shown only when equipped.

Key formula in `SplotMascot`: `char-${items.accessory}` where `items.accessory` is the shop ID (e.g., `acc-crown` → `char-acc-crown`).

**Adding a new accessory:**
1. Place `character/accessories/my-item.png` at 128×128.
2. Load: `{ key: 'char-acc-my-item', path: 'character/accessories/my-item.png' }`.
3. Add to `SHOP_ITEMS` in `src/shared/shop.ts` with `slot: 'accessory'`.
4. No code change needed in `SplotMascot` — the generic `applyEquipped` handles any accessory key.

---

## Icons

Icons are used in buttons (via `addDepthIcon`), HUD, and the modifier palette.

### Navigation (128×128)

| Key | File | Usage |
|-----|------|-------|
| `icon-arrow`    | `icons/navigation/arrow.png`    | Back/forward |
| `icon-home`     | `icons/navigation/home.png`     | Home button |
| `icon-settings` | `icons/navigation/settings.png` | Settings |
| `icon-cancel`   | `icons/navigation/cancel.png`   | Close/dismiss |
| `icon-help`     | `icons/navigation/help.png`     | Help/hint |
| `icon-share`    | `icons/navigation/share.png`    | Share sheet |

### Gameplay (96×96)

| Key | File | Usage |
|-----|------|-------|
| `icon-play`  | `icons/gameplay/play.png`  | Play/start |
| `icon-pause` | `icons/gameplay/pause.png` | Pause |
| `icon-timer` | `icons/gameplay/timer.png` | Daily puzzle, timer |
| `icon-reset` | `icons/gameplay/reset.png` | Reset level |

### Puzzle / modifier palette (96×96)

| Key | File | Modifier type |
|-----|------|---------------|
| `icon-paint`         | `icons/puzzle/paint.png`         | `paint` |
| `icon-pendant`       | `icons/puzzle/pendent.png`       | `pendant` |
| `icon-glasses-thick` | `icons/puzzle/glasses-thick.png` | `glasses` thick |
| `icon-glasses-thin`  | `icons/puzzle/glasses-thin.png`  | `glasses` thin |
| `icon-goggles-thin`  | `icons/puzzle/goggles-thin.png`  | `goggles` thin |
| `icon-goggles-thick` | `icons/puzzle/goggles-thick.png` | `goggles` thick |
| `icon-goggle`        | `icons/puzzle/goggle.png`        | `goggles` monocle |
| `icon-pumpkin`       | `icons/puzzle/pumpkin.png`       | `pumpkin` |
| `icon-underwear`     | `icons/puzzle/underwear.png`     | `underwear` |
| `icon-belt-thick`    | `icons/puzzle/belt-thick.png`    | `belt` thick |
| `icon-belt-thin`     | `icons/puzzle/belt-thin.png`     | `belt` thin |
| `icon-nose`          | `icons/puzzle/nose.png`          | `nose` |
| `icon-plate`         | `icons/puzzle/plate.png`         | `plate` |
| `icon-cone`          | `icons/puzzle/cone.png`          | `cone` |
| `icon-scarf`         | `icons/puzzle/scarf.png`         | `scarf` (one icon; tiles add an orientation arrow) |
| `icon-bubble`        | `icons/puzzle/bubble.png`        | `bubble` |

The last five load tolerantly via `OPTIONAL_PUZZLE_ICONS` in `Preloader.ts`:
a missing file just 404s and the palette tile falls back to drawing the modifier
art itself (`icon-nose` additionally falls back to a baked zoom of `mod-nose-big`).
Drop the PNG in and the icon appears with no code change.

### HUD (96×96)

| Key | File | Usage |
|-----|------|-------|
| `icon-heart`   | `icons/hud/heart.png`   | Lives |
| `icon-spark`   | `icons/hud/spark.png`   | Sparks currency |
| `icon-star`    | `icons/hud/star.png`    | Stars / rating |
| `icon-fire`    | `icons/hud/fire.png`    | Streak badge |

### Community (96×96)

| Key | File | Usage |
|-----|------|-------|
| `icon-people` | `icons/community/people.png` | Player count |
| `icon-trophy` | `icons/community/trophy.png` | Leaderboard / ranking |
| `icon-pencil` | `icons/community/pencil.png` | Create level |
| `icon-gold`   | `icons/community/gold.png`   | 1st place |
| `icon-silver` | `icons/community/silver.png` | 2nd place |
| `icon-bronze` | `icons/community/bronze.png` | 3rd place |

### Shop (96×96)

| Key | File | Usage |
|-----|------|-------|
| `icon-bag`    | `icons/shop/bag.png`    | Shop/store |
| `icon-lock`   | `icons/shop/lock.png`   | Locked item |
| `icon-unlock` | `icons/shop/unlock.png` | Unlocked item |
| `icon-price`  | `icons/shop/price.png`  | Price tag |

### Status (96×96)

| Key | File | Usage |
|-----|------|-------|
| `icon-check`   | `icons/status/check.png`   | Success / completed |
| `icon-cross`   | `icons/status/cross.png`   | Failure / disabled |
| `icon-warning` | `icons/status/warning.png` | Conflict / caution |

### Misc (64×64)

| Key | File | Usage |
|-----|------|-------|
| `icon-plus`    | `icons/misc/plus.png`    | Add / increment |
| `icon-minus`   | `icons/misc/minus.png`   | Remove / decrement |
| `icon-dot`     | `icons/misc/dot.png`     | Bullet / indicator |
| `icon-sparkle` | `icons/misc/sparkle.png` | Win particles, decoration |

**Note on icon sizes:** Navigation icons are 128×128 and render crisper at large sizes. All others are 96×96. The `addDepthIcon` helper renders them at any target `w × h` via `setDisplaySize`, so source dimensions don't constrain usage.

---

## UI panels and buttons

See `docs/9-slicing.md` for the complete nine-slice system and `docs/ui-components.md` for usage patterns.

### Source files (unsliced — for reference only)

| File | Key | Size | Notes |
|------|-----|------|-------|
| `ui/button-open.png`     | `ui-btn-open`     | 128×96 | Original unsliced button (idle) |
| `ui/button-hover.png`    | `ui-btn-hover`    | 128×96 | Hover state |
| `ui/button-press.png`    | `ui-btn-press`    | 128×96 | Pressed state |
| `ui/button-disabled.png` | `ui-btn-disabled` | 128×96 | Disabled state |
| `ui/panel.png`           | `ui-panel`        | 96×96  | Left sidebar panel |

These keys are loaded but NOT used in the new component system — they're kept for legacy scenes. The runtime uses the pre-sliced `ui/slices/` files.

### Pre-sliced button cells

**Files:** `ui/slices/btn-{state}-{pos}.png`  
**States:** `open`, `hover`, `press`, `dis`  
**Positions:** `tl tc tr ml mc mr bl bc br`  
**Loaded as:** `btn-{state}-{pos}` (e.g., `btn-open-tl`)  
**Each cell size:** 32×32

### Pre-sliced panel cells

**Files:** `ui/slices/pnl-{pos}.png`  
**Loaded as:** `pnl-{pos}` (e.g., `pnl-tl`)  
**Each cell size:** 32×32

### Beige card / slot

| File | Key | Size | Nine-slice corners |
|------|-----|------|--------------------|
| `more ui/UI_Flat_FrameSlot01c.png` | `ui-flat-slot` | 32×32 | 10px each side |

Used by `addBeigeCard()` and `buildSparksPill()`. Minimum rendered size: 21×21.

### Loading bar

| File | Key | Size | Notes |
|------|-----|------|-------|
| `ui/loading-border.png` | `loading-border` | 128×16 | Border/frame of progress bar |
| `ui/loading-filler.png` | `loading-filler` | 128×16 | Fill — cropped to show progress |

Progress is shown by cropping the filler: `filler.setCrop(0, 0, Math.round(128 * progress), 16)`.

---

## Loading order

Assets are split across two scenes to enable a rich loading screen:

**`Boot.ts` loads (synchronously, before Preloader shows):**
- `title.png`, `bg4-1`
- All `slime-color`, `slime-border`, `slime-shine`
- `ui-flat-slot`
- `loading-border`, `loading-filler`
- All 9-slice panel cells (`pnl-*`)
- All 9-slice button cells (`btn-open-*`, `btn-hover-*`, `btn-press-*`, `btn-dis-*`)

**`Preloader.ts` loads (everything else, with progress bar):**
- All modifier overlays
- All character assets
- All icons
- Backgrounds 1–4 (all layers)
- Legacy UI source files

The split means `addBeigeButton` and `addPanel9` work immediately in the Preloader scene itself (the loading screen uses beige cards for the sparks pill).
