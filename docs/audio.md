# Audio — sound director, latency, and settings

One module, `src/client/audio.ts`, owns every sound decision in the game: which file
plays for which event, whether the player has SFX/music on, and keeping the 84-second
music loop alive across scene changes (Phaser's sound manager is game-global, so music
started in `MainMenu` keeps playing through `Game`, `Shop`, everywhere). This doc is
the "how" companion to the CLAUDE.md/README summaries — the event→file map, the boot-
path split, and the settings-persistence contract.

---

## 1. One map from game event to file

```ts
export const SFX_FILES = {
  click: 'Click.wav', menuIn: 'Menu_In.wav', menuOut: 'Menu_Out.wav',
  pause: 'Pause.wav', cancel: 'Cancel.wav',
  splash: 'Water_Splash.wav', dip: 'Drink.wav', bubble: 'Blip.wav',
  wear: 'Trampoline.wav', remove: 'Sword_Slash.wav', pumpkin: 'Crunch.wav',
  breakOff: 'Bottle_Break.wav', refuse: 'Notso_Confirm.wav', nudge: 'Bump.wav',
  reset: 'Hurt.wav',
  win: 'Powerup.wav', lose: 'Powerdown.wav', star: 'Blip.wav',
  confirm: 'Confirm.wav', squish: 'Jump.wav', daily: 'Evil_Laugh.wav',
} as const;
```

Scenes call `playSfx('splash')`, never a filename — re-skinning a sound (or picking a
punchier file for `breakOff`) is a one-line change in this map, and nothing outside
`audio.ts` needs to know the actual asset name. Files that exist in `public/sounds/`
but aren't listed here (guns, sirens, monster screams from the raw sound pack) are
simply never loaded — they don't fit a slime dress-up game, and the Preloader never
pays their bandwidth.

---

## 2. Off the boot critical path

Audio was measured at **5× the weight of the entire art set** — decoding it all before
the first interactive frame would have doubled or tripled load time on a slow
connection for a benefit (sound) the player doesn't need until they've already started
tapping. The split:

- **`CORE_SFX`** — `click`, `menuIn`, `menuOut`, `cancel`, `pause` (~130KB) — rides the
  `Preloader`'s critical path, so the very first button tap on the loading screen
  already clicks.
- **Everything else** (the remaining ~26 SFX plus the 2MB `bgm.mp3`) streams in the
  background via `streamAudio(scene)`, called from `MainMenu` / `Game` / `LevelSelect`
  / `Shop`'s `create()`. It's idempotent and safe to call from every one of those
  scenes: it diffs against `game.cache.audio.exists(...)` and only queues what's
  actually still missing, so a scene switch mid-download doesn't restart anything.
- **`playSfx` never blocks or throws on a missing key** — if a sound hasn't streamed
  in yet (or the browser has no audio context), the call is a silent no-op. Sound is
  garnish, never a gate on gameplay.
- **Music self-starts the moment `bgm` lands** (`streamAudio`'s load-complete callback
  calls `startMusic()`), so a player who moves fast doesn't need to do anything to
  hear it — it just fades into existence in the background.

---

## 3. Web Audio buffers, not streamed files

Every SFX (and the music loop) is a WAV/MP3 decoded up front into a Web Audio buffer
by Phaser's loader — playback then starts on the exact requested tick with no fetch,
no MP3 decode head, and no leading silence (the raw sound pack was silence-trimmed at
import time; see the note in CLAUDE.md's Asset Inventory). This is what makes
`playSfx('splash')` feel simultaneous with the tap that triggered it instead of
lagging behind by a network round trip.

### The music loop marker

`bgm.mp3` carries encoder-delay silence at both ends (~163ms head, ~98ms tail,
measured with `ffmpeg silencedetect` at −50dB; the file itself is 84.24s). Looping the
raw buffer would produce an audible hiccup at every wrap. Instead, `startMusic()`
defines a Web Audio **marker** spanning only the audible span:

```ts
music.addMarker({
  name: 'loop',
  start: 0.16, duration: 84.14 - 0.16,
  config: { loop: true, volume: MUSIC_VOLUME },
});
music.play('loop', { loop: true, volume: MUSIC_VOLUME });
```

Looping the marker (not the raw file) means the wrap always lands on audible content
on both sides, so the seam is inaudible.

### Autoplay unlock

Browsers keep the Web Audio context suspended until a user gesture. `startMusic()`
checks `game.sound.locked` and, if still locked, defers itself to Phaser's `UNLOCKED`
event (re-checking `musicOn` at that point, since the player may have toggled music
off while still waiting on the gesture) — so calling `startMusic()` before the
player's first tap is always safe and never lost.

---

## 4. Settings: seeded once, saved fire-and-forget

- **Seeding**: `GET /api/init` returns `sfxEnabled` / `musicEnabled` (Redis-backed for
  logged-in players, defaulting on). `applyStoredSettings(sfx, music)` applies them
  exactly once — a `settingsApplied` guard means a slow `/api/init` response can never
  stomp a toggle the player already pressed on the settings popup before the response
  landed.
- **Toggling**: `setSfxOn` / `setMusicOn` update the in-memory flag immediately (so the
  UI and any in-flight `playSfx` calls see the change instantly) and then fire
  `POST /api/user/settings` without awaiting it — a lost write costs one remembered
  preference, never gameplay. Guests get a 401 back and simply keep the in-session
  choice; `localStorage` is not used (per CLAUDE.md, it isn't durable inside the
  Devvit iframe, and persistent state belongs in Redis).
- **Storage shape**: the user hash stores `sound:sfxOff` / `sound:musicOff` inverted —
  `'1'` means off — so a field that has never been written (every account that
  predates the setting) defaults to on without a migration.

---

## Related docs

- `docs/phaser.md` §7 — audio in the broader "performance on a phone in an iframe"
  story (the boot-critical-path decision alongside the other latency work).
- `CLAUDE.md` — the asset inventory note on where the raw sound pack lives in git
  history and how it was trimmed.
