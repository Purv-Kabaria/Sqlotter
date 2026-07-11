# Best Use of Phaser

Sqlotter runs on **Phaser 4.2** inside a Reddit Devvit webview. This doc is the
engine-level tour: how the game is structured as a Phaser application, the rendering
techniques that make the slime puzzle work, and the choices that keep a
canvas-compositing game smooth on a phone inside an iframe. Component-level deep dives
live in `docs/slime-rendering.md`, `docs/splot-mascot.md`, `docs/ui-components.md`, and
`docs/9-slicing.md`; this doc ties them together and explains *why Phaser* was the right
engine for this game.

---

## 1. Application shape

The game boots from `src/client/game.ts` with `Phaser.Scale.RESIZE` at a 1024×768
reference resolution:

```ts
scale: { mode: Phaser.Scale.RESIZE, autoCenter: CENTER_BOTH,
         width: window.innerWidth, height: window.innerHeight },
pixelArt: true,
```

`pixelArt: true` disables texture smoothing globally — every asset is crisp pixel art,
and the blocky upscales the slime renderer relies on (see §3) stay blocky. The single
`Game` instance is exposed on `window.__sqlotter` for automated layout checks.

### Scene graph

Ten scenes, one file each under `src/client/scenes/`, in a deliberate boot order:

| Scene | Role |
|-------|------|
| `Boot` | Loads the *bare minimum* for the loading screen, then generates two textures procedurally (see §5). |
| `Preloader` | Streams the art set behind a progress bar; routes to the right first scene. |
| `MainMenu` | Home; starts the deferred audio/asset stream. |
| `LevelSelect` | World map + community Finder. |
| `Game` | The puzzle itself. |
| `LevelComplete` | Win celebration, Splat Card / crown sharing. |
| `Leaderboard`, `Shop`, `Editor`, `GameOver` | Boards, cosmetics, authoring, error fallback. |

Scenes are **fully re-laid-out on resize**, not patched: each keeps its created objects
in an array (`uiObjs` / `els`) and a debounced resize handler destroys and rebuilds the
whole layout for the new size (Editor.ts:253, Shop.ts:1377). RESIZE mode streams events
during a window drag, so the rebuild is debounced ~120 ms. This is why the same scene
renders correctly from a 320-wide phone in portrait to a 1024-wide desktop in landscape
— there is no fixed layout to break, only a layout *function* of `(width, height)`.

The boot route is data-driven off the post's `postData` (`src/client/launch.ts`): a
daily/UGC post deep-links straight into `Game`, a Fit Check post opens the `Shop`
dressing room, everything else lands on `MainMenu`.

---

## 2. Why Phaser fits this game

Sqlotter is a **stencil-compositing** puzzle: the slime's appearance is the result of
replaying paint/stencil operations, each of which colours the body *except* where the
then-worn masks protected it. That is fundamentally a **2D raster-compositing** problem —
`source-over`, `multiply`, `destination-out`, `destination-in`, `overlay` blends over a
canvas. Phaser gives us:

- **`CanvasTexture`** — a writable 2D canvas that lives in the texture manager and can be
  drawn by any number of `Image` game objects. This is the backbone of the slime
  renderer (§3).
- **A retained scene graph of `Container`s** — so the layered slime (pattern → border →
  worn stencils → shine) moves, scales, and tweens as one unit.
- **A tween engine** rich enough for the game's entire "juice" budget without a physics
  system (§4).
- **`NineSlice`** — resolution-independent panels/buttons from tiny corner art (§6).
- **A deferred loader** we can re-drive from any scene to stream assets off the boot
  path (§7).

No physics, no tilemaps, no spritesheet animation are used — the game's motion is
tween-driven and its art is composited, so Phaser is used as a **compositor + scene
graph + tween engine**, which is exactly its strongest, lightest core.

---

## 3. The signature technique — per-instance `CanvasTexture` compositing

`SlimeRenderer` (`src/client/components/SlimeRenderer.ts`) is the clearest showcase of
Phaser used well. Each instance owns a private canvas texture:

```ts
this.texKey = `slime-pattern-${nextInstanceId++}`;
this.canvasTex = scene.textures.createCanvas(this.texKey, native, native);
this.patternImg = scene.add.image(0, 0, this.texKey).setDisplaySize(size, size);
```

`setPattern(palette, actions)` replays the action list (the shared sim, `replayOps`) and
composites the result **directly on the canvas 2D context** the texture exposes:

1. draw the white body,
2. for each paint op, build a tinted-body *stamp* on a shared scratch canvas —
   `multiply` the paint colour onto the body silhouette, `destination-in` to restore the
   body's alpha, then `destination-out` each stencil worn at paint time to punch it back
   out — and draw the stamp onto the pattern,
3. fade the "dipped" (75% opacity) cells via a body-clipped white veil built from the
   64×64 alpha grid,
4. `overlay`-blend the gloss shine and `destination-in`-clamp it back to the body shape,
5. `canvasTex.refresh()` to push the pixels to the GPU.

Currently-worn stencils are then added as ordinary `Image` children **above** the border,
because worn accessories sit *on* the slime. The win check never reads a pixel — the
server and client run the identical geometry on baked bitmaps — so this class is
**presentation only**, which is what keeps client and server in perfect agreement.

Three things make this Phaser-idiomatic rather than a canvas hack bolted onto Phaser:

- **Shared caches, per-instance output.** Binary-alpha stencil canvases and the scratch
  stamp canvas are static and shared across every renderer; only the output texture is
  per-instance. A goal card, the live board, every colour swatch in the picker, and every
  Splat Card can all render simultaneously without multiplying the scratch memory.
- **Deterministic lifecycle.** The per-instance texture is released on the container's
  `DESTROY` event (SlimeRenderer.ts:112) — every scene rebuild would otherwise leak a
  256×256 canvas into the texture manager.
- **`pixelArt` upscaling.** The dip veil is drawn at the native 64-cell grid then upscaled
  with `imageSmoothingEnabled = false`, so a 64×64 logical grid renders as crisp blocky
  cells at any display size.

The mascot (`SplotMascot`, `docs/splot-mascot.md`) uses the complementary technique — a
**depth-sorted `Container` of layered `Image`s** (shadow → blob → mouth → eyes → brows →
accessory → shine → outline) rather than a baked texture, because its parts animate
independently (blink, expression swaps, bob).

---

## 4. Motion is all tweens — the juice budget

Every bit of game feel is a tween, no physics stepper, no `update()` polling. Highlights:

- **Apply squash-and-stretch** (`playApplyAnim`, SlimeRenderer.ts:246) — a
  `tweens.chain` of scaleX/scaleY keyframes ending in `Elastic.easeOut`, plus an additive
  flash sprite fading out. Completes in ~280 ms, under the "instant feedback" bar.
- **Conflict shake** — a yoyo'd x-offset tween when the sim refuses a tap.
- **Win burst** — a `Back.easeOut` scale pop.
- **Reward particles** (`playRewardBurst`, LevelComplete.ts:970) — hand-rolled from
  pooled `Image`s + tweens (spark/star icons flung on ballistic arcs), scaled by star
  count. Deliberately *not* a `ParticleEmitter`: a dozen tweened sprites are cheaper and
  fully art-directed, and avoid shipping the particle pipeline for one screen.
- **Idle life** — the mascot's bob and blink are looping tweens with a guarded
  `destroyed` flag so a scene rebuild mid-tween never fires `setTexture` on a dead object.

The design rule (`CLAUDE.md`): non-animation state is **event-driven**, never polled in
`update()`. Most scenes don't implement `update()` at all.

---

## 5. Procedural textures at boot

`Boot.ts` generates two textures with `Graphics.generateTexture` so they never touch the
network:

- **`ui-dark-panel`** — a rounded near-black panel used as the palette/side-panel
  background across scenes.
- **`splot-shadow`** — a soft contact-shadow ellipse faked as eight concentric fading
  ellipses (Graphics can't gaussian-blur), used under *every* mascot instead of shipping
  `character/shadow.png`.

`Preloader` and `Shop` do the same for swatch shines and the downscaled small-button
nine-slice (`textures.createCanvas`, Preloader.ts:428/448). Generating chrome procedurally
keeps the boot payload to actual game art.

---

## 6. Resolution-independent UI with `NineSlice`

The entire beige-button / panel language is built on `Phaser.GameObjects.NineSlice`
(`src/client/components/PixelUI.ts`, and `docs/9-slicing.md`). A 9-slice stretches only
the middle strips of a texture, leaving the corners pixel-perfect, so one small source
asset renders a button at *any* size without corner distortion. Below a 65 px floor the
system swaps to a half-scale corner asset so small phones get proportionally small
buttons instead of corrupted corners. The rule enforced project-wide: **one `NineSlice`
per surface**, never a hand-assembled 3×3 of nine `Image`s — that was a real per-frame
draw-call regression the codebase fixed.

Scrolling lists (Shop grid, Leaderboard) clip to their viewport with **`applyRectClip`**
(PixelUI.ts:164): Phaser 4's WebGL renderer wants a **Filters Mask**, not the old
geometry mask, so a white-rect `Graphics` is rendered once into a `DynamicTexture` aligned
to the viewport and used as an alpha mask — no per-frame mask re-render.

---

## 7. Performance on a phone in an iframe

Devvit ships the game inside a Reddit iframe on mobile hardware, so the engine work is
tuned hard:

- **Audio is off the boot critical path.** Only ~130 KB of core UI ticks ride the
  `Preloader`; the rest of the SFX and the 2 MB music loop stream in the background via
  `streamAudio(scene)` (`src/client/audio.ts`), re-driven from `MainMenu` / `Game` /
  `LevelSelect` / `Shop` `create()`. `playSfx` silently skips a still-loading key, and the
  music self-starts the moment `bgm` lands. Audio was 5× the weight of the entire art set;
  it must never gate the first interactive frame.
- **Static backgrounds are pre-baked into a `RenderTexture`.** The Game scene's four-layer
  cloud parallax would be full-screen overdraw every frame; instead it's stamped once into
  a `RenderTexture` (Game.ts:410) and drawn as a single quad. Phaser 4 runs `stamp()`
  through a **deferred command buffer** — the entry must be a texture *key* (a scratch
  `Image` would have to outlive the call) and nothing appears until an explicit
  `rt.render()` flushes the buffer. That deferred model is called out in the code because
  it's a real Phaser-4 gotcha (`DynamicTexture`/`RenderTexture` draws are queued, not
  immediate).
- **Input on `pointerdown`, tuned for touch.** Beige buttons fire their click sound on
  `pointerdown` (the tap lands the instant the finger does) and run the action on the next
  tick, *outside* input dispatch, so a handler that destroys its own button is safe.
  Chaining the action off the release tween's `onComplete` had added ~70 ms of artificial
  input lag to every button in the game — removing it was a measured latency win.
- **Cheap caches everywhere.** Swatch shines are baked once and keyed; the Shop keeps a
  session profile cache so repeat visits render instantly while a background refetch
  corrects them.

Measured result (from the QA sweep): idle p50 ~6 ms, every tap under 25 ms at 6× CPU
throttling.

---

## 8. What "Best Use of Phaser" means here

The game doesn't reach for Phaser's flashy subsystems (physics, tilemaps, spine). It uses
the **core engine deliberately and correctly**:

- a writable `CanvasTexture` as a real-time compositor for a mechanic that genuinely needs
  raster blending,
- a retained `Container` scene graph for the layered, independently-animated mascot,
- the tween engine as the entire motion budget,
- `NineSlice` + Filters masks for resolution-independent, phone-to-desktop UI,
- procedural `Graphics` textures and a re-drivable deferred loader to keep the boot
  payload tiny,
- and a hard discipline about the Phaser-4 deferred-draw model and per-instance texture
  lifecycles so nothing leaks and nothing stalls.

It's Phaser used the way a shipping game uses it: every feature earns its place, and the
hard parts (compositing, lifecycle, latency) are handled explicitly.

---

## Related docs

- `docs/slime-rendering.md` — the CanvasTexture compositor in full detail.
- `docs/splot-mascot.md` — the layered-Container mascot and its expression system.
- `docs/ui-components.md` — icons, text, responsive layout math.
- `docs/9-slicing.md` — the NineSlice panel/button system.
- `docs/assets.md` — every texture key and where it loads.
