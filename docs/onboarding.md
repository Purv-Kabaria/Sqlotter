# Onboarding — the welcome tour and the guided Splash Course

Sqlotter teaches new players twice, in two different places, by two different
mechanisms: a **home-screen welcome tour** (`src/client/components/HomeTour.ts`) that
narrates what each button does before the player has touched anything, and a
**guided, step-by-step Splash Course** (the `guideStep` state machine inside
`src/client/scenes/Game.ts`) that walks them through actually playing five tutorial
levels. README §4 and `docs/core-gameplay.md` describe *what* the Splash Course
teaches; this doc is the *how* for both systems — the state machines, not the
lesson content.

---

## 1. The welcome tour (`HomeTour`)

A brand-new player lands on the home page with six buttons and no context. `HomeTour`
is an eleven-step scripted walkthrough, owned and triggered by `MainMenu` on a
player's first visit (gated by `guide:seen` on the user hash / a session flag for
guests — see `GET /api/init`'s `guideSeen` field and `POST /api/user/guide-seen`).

### Shape

Each step (`HomeTourStep`) is `{ target, text, final? }` — `target` is a key into a
map of on-screen bounds that `MainMenu` records while laying out its own buttons
(`getRect(key)`), so the tour never hardcodes coordinates; it just asks the owning
scene "where is the thing called `'Shop'` right now." A missing rect (element not
present in this layout) just skips the spotlight hole and dims the whole screen
instead.

The script (`STEPS` in `HomeTour.ts`) opens on Splot introducing himself and the core
loop, tours every home-screen button in the order they stack (Play, Daily Sqlot,
Create, Find, the Sparks pill, Shop, Ranking), touches features that live off the home
page entirely (crowns, duels, royalties, Fit Check, Splat Cards, flair), and closes on
the `?` help button with a choice: **"Take me there"** (walks straight into the
Splash Course world) or **"I'll explore on my own."** Either choice calls
`onDone(startCourse: boolean)`, and `MainMenu` marks the tour seen and navigates.

### The spotlight

For a step with a target rect, `buildStep()` draws four dim rectangles framing a
bright rectangular hole (the target's bounds inflated by 8px), an invisible "catcher"
over the hole so tapping the spotlit element itself also advances the tour instead of
accidentally firing the real button, a pulsing gold ring that snap-scales onto the
target with a `Back.easeOut` overshoot (reads as "locking on"), and four twinkling
corner sparkles. Every dim rectangle and the catcher share one `tapThrough()` handler.

### Typewriter text + paging

Body text is measured once at a starting font size (16px — Pixelify Sans's crisp
grid size, see `docs/ui-components.md`), then the panel height derives from the
wrapped text's actual height; on very short viewports the font steps down (re-wrapping
each time) until the whole panel fits the screen budget, the same discipline
`docs/9-slicing.md` describes for other popups. Once sized, the text feeds out two
glyphs per 18ms tick (a typewriter reveal) — `tapThrough()` either finishes the current
line instantly (if still typing) or advances to the next step (if the line already
finished), so an impatient player can always speed through by tapping repeatedly.

### Resize survival

A resize event tears down and rebuilds the *whole* home screen layout (per the
project's standard "rebuild, don't patch" resize pattern — see
`docs/ui-components.md`), which would normally reset any overlay to its start. Instead
`MainMenu` reads `homeTour.step` before destroying the old tour and passes it back in
as `startStep` when constructing the new one, so a mid-tour window resize (or
orientation flip) resumes at the same line of dialogue against the newly laid-out
bounds instead of restarting from step 1.

---

## 2. The guided Splash Course (`Game.ts`'s `guideStep`)

Once the player is actually inside one of the five Splash Course levels, a second,
independent system takes over: a level is **guided** when its `LevelData.guide` array
exists and has exactly one coach line per step of `optimalSolution`
(`this.guideStep = guide.length === optimalSolution.length ? 0 : -1`). `guideStep` is
the index of the next expected action; `-1` means "not a guided level, play normally."

### What the player sees each step

- **The expected tile glows.** Whatever `optimalSolution[guideStep]` is, the matching
  palette tile gets a pulsing gold ring — and if the expected action lives inside a
  picker (a specific color inside the paint rack, a specific size inside the pumpkin
  picker), the ring follows it down into that picker too, so the glow is never "close
  but not exact."
- **A coach panel narrates the step** (`buildGuidePanel`), showing `guide[guideStep]`
  as the lesson's teaching line and a `STEP n/m` counter in the numeric font (Press
  Start 2P — Pixelify's rounded digits blur together at small sizes, the same reason
  numeric HUD elements elsewhere in the game use the same font).
- **Splot moves out of the way.** Guided lessons in portrait drop the in-area mascot
  entirely — Splot speaks through the coach panel instead of reacting beside the
  slime, freeing the vertical space the panel needs.

### Off-script taps: nudge vs. real refusal

A tap that doesn't match `optimalSolution[guideStep]` is checked against the sim's own
refusal rules first (broken goggles, a spent one-shot dip, a wear past the 3-stencil
limit — the exact mirror of `applySimAction`'s refusal logic, kept in sync by
inspecting the same conditions rather than duplicating the sim). Two different
outcomes follow:

- **A tap the sim would refuse anyway plays the real refusal** — nothing is nudged
  away, the actual cross-icon/refusal message fires, because some lessons *want* the
  player to try the forbidden thing (Full Outfit's whole point is inviting a 4th wear
  so the refusal teaches the 3-stencil limit in the moment it's broken).
- **Any other off-script (but otherwise legal) tap is nudged back for free**: the
  glowing ring wiggles (a short repeating x-offset tween), the coach panel's text is
  temporarily replaced with "Not that one yet — follow the glowing tile!", and — this
  is the load-bearing detail — **nothing is logged and no step is spent**. A guided
  lesson cannot be derailed into an unintended solution or accidentally cost a star;
  every path through it either matches the script or bounces harmlessly.

### Advancing and resetting

`guideStep` only increments when the played action's id **exactly** matches
`optimalSolution[guideStep]` — matching by side effect (e.g. accidentally landing on
the same visual result a different way) doesn't count, only the literal scripted
action does. `Reset` (`__reset__`) restarts the script back to step 0 along with the
rest of the sim state, so a player who wants to redo a lesson from scratch always gets
the full guided experience again, not a partially-completed one.

The coach panel and glow ring are rebuilt from scratch on every step and every resize
(`buildGuidePanel`/the highlight-ring logic re-anchor against the current layout), the
same "tear down, rebuild against new bounds" discipline `HomeTour` and every other
scene use.

---

## Related docs

- `docs/core-gameplay.md` — what each Splash Course lesson teaches, and the sim rules
  the guided gate is built to mirror.
- `docs/ui-components.md` — the shrink-to-fit panel sizing and typewriter/tooltip
  patterns reused by the tour.
- README §4 ("Level Sources") — the five lessons by name and the rules each covers.
