import * as Phaser from 'phaser';
import type { SoundSettingsRequest } from '../shared/api';

// ── Audio director ───────────────────────────────────────────────────────────
// One shared module owns every sound decision: which file plays for which game
// event, whether the player has SFX/music enabled, and keeping the music loop
// alive across scene changes (Phaser's sound manager is game-global, so music
// started in MainMenu keeps playing through Game/Shop/everywhere).
//
// Latency: everything is WAV decoded up-front by the Preloader into Web Audio
// buffers — playback starts on the exact audio tick, no fetch, no MP3 decode
// head, no leading silence in the files (verified + trimmed at import time).
//
// Preferences: seeded from /api/init (Redis-backed for logged-in players),
// saved fire-and-forget through POST /api/user/settings. Guests keep their
// choice for the session only — localStorage is not durable inside the Devvit
// iframe, and per CLAUDE.md persistent state belongs in Redis.

// Every SFX the game uses → its file. Keys are the game-event vocabulary the
// scenes speak; the mapping to files lives ONLY here, so re-skinning a sound
// is a one-line change. (Files in public/sounds not listed here are unused on
// purpose — guns, sirens and monster screams don't fit a slime dress-up game.)
export const SFX_FILES = {
  // UI
  click:     'Click.wav',        // every beige button press
  menuIn:    'Menu_In.wav',      // popup / picker opens
  menuOut:   'Menu_Out.wav',     // popup / picker closes
  pause:     'Pause.wav',        // settings popup (the classic pause-menu chirp)
  cancel:    'Cancel.wav',       // back-out navigation (skip course, load-error)
  // Puzzle actions
  splash:    'Water_Splash.wav', // paint splash
  dip:       'Drink.wav',        // alpha dip (a dunk into liquid)
  bubble:    'Blip.wav',         // bubble pop
  wear:      'Trampoline.wav',   // stencil on (springy dress-up boing)
  remove:    'Sword_Slash.wav',  // stencil off (quick whoosh)
  pumpkin:   'Crunch.wav',       // pumpkin wear AND swap (crunchy gourd)
  breakOff:  'Bottle_Break.wav', // goggles snapping off broken (glass!)
  refuse:    'Notso_Confirm.wav',// refusal: broken goggles / 4th wear / spent dip
  nudge:     'Bump.wav',         // guided-mode off-script tap
  reset:     'Hurt.wav',         // reset wipes Splot — ouch
  // Milestones
  win:       'Powerup.wav',      // level complete
  lose:      'Powerdown.wav',    // GameOver / hard load errors
  star:      'Blip.wav',         // star pips on the win screen (rising rate)
  confirm:   'Confirm.wav',      // purchase / publish / crown claim
  squish:    'Jump.wav',         // tapping Splot
  daily:     'Evil_Laugh.wav',   // a daily Sqlot begins — they skew devious
} as const;

export type SfxName = keyof typeof SFX_FILES;

// The handful of UI sounds the Preloader keeps on the boot critical path
// (~130KB) so the very first tap clicks even on a slow connection. Everything
// else — the remaining SFX and the 2MB music loop — streams in the background
// AFTER the game is interactive (see streamAudio), because on a slow network
// audio was 5x the weight of the entire art set and none of it is worth
// making the player stare at a progress bar for.
export const CORE_SFX: readonly SfxName[] = ['click', 'menuIn', 'menuOut', 'cancel', 'pause'];

const MUSIC_KEY = 'bgm';
const MUSIC_VOLUME = 0.35;   // under the SFX, which run at ~1.0
const SFX_VOLUME = 0.9;

// The bgm.mp3 carries ~163ms of encoder-delay silence at its head and ~98ms at
// its tail — looping the raw buffer would hiccup at every wrap. The loop marker
// plays only the audible span, so the wrap is seamless. (Values measured with
// ffmpeg silencedetect at -50dB; the file is 84.24s.)
const MUSIC_LOOP_START = 0.16;
const MUSIC_LOOP_END   = 84.14;

let sfxOn = true;
let musicOn = true;
let game: Phaser.Game | null = null;
let music: Phaser.Sound.BaseSound | null = null;
// True once the user's stored prefs arrived — applySettings only fires once
// so a slow /api/init can never stomp a toggle the player just pressed.
let settingsApplied = false;

/** Called once by the Preloader after load; remembers the game for the sound manager. */
export function initAudio(g: Phaser.Game): void {
  game = g;
}

/**
 * Streams every sound not yet cached through the given scene's loader —
 * the non-core SFX and the music, kept off the Preloader's critical path.
 * Safe to call from any scene's create(): it no-ops once everything is
 * cached, and re-queues whatever a mid-stream scene shutdown aborted (missing
 * sounds are silently skipped by playSfx in the meantime, never a gate).
 * Music starts the moment bgm lands, if enabled.
 */
export function streamAudio(scene: Phaser.Scene): void {
  if (!game) return;
  const missing = (Object.keys(SFX_FILES) as SfxName[])
    .filter((name) => !game!.cache.audio.exists(`sfx-${name}`));
  const needBgm = !game.cache.audio.exists(MUSIC_KEY);
  if (missing.length === 0 && !needBgm) return;

  scene.load.setPath('sounds');
  for (const name of missing) scene.load.audio(`sfx-${name}`, SFX_FILES[name]);
  if (needBgm) scene.load.audio(MUSIC_KEY, 'bgm.mp3');
  scene.load.setPath('assets'); // restore the project-wide loader default
  if (needBgm) {
    scene.load.once(Phaser.Loader.Events.COMPLETE, () => startMusic());
  }
  scene.load.start();
}

/** Seed prefs from /api/init exactly once (first writer wins). */
export function applyStoredSettings(sfx: boolean | undefined, musicPref: boolean | undefined): void {
  if (settingsApplied) return;
  settingsApplied = true;
  sfxOn = sfx !== false;
  musicOn = musicPref !== false;
  if (!musicOn) stopMusic();
}

export function isSfxOn(): boolean { return sfxOn; }
export function isMusicOn(): boolean { return musicOn; }

export function setSfxOn(on: boolean): void {
  sfxOn = on;
  settingsApplied = true;
  saveSettings();
}

export function setMusicOn(on: boolean): void {
  musicOn = on;
  settingsApplied = true;
  if (on) startMusic(); else stopMusic();
  saveSettings();
}

// Fire-and-forget: a lost write costs one preference, not gameplay. Guests get
// a 401 and simply keep the in-session value.
function saveSettings(): void {
  const body: SoundSettingsRequest = { sfx: sfxOn, music: musicOn };
  void fetch('/api/user/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  }).catch(() => { /* offline / guest — session-only */ });
}

/**
 * Plays one SFX. `rate` pitches without re-decoding (the star pips climb);
 * `volume` scales under the shared SFX level. Missing audio (load failure,
 * noAudio browser) is silently skipped — sound is garnish, never a gate.
 */
export function playSfx(name: SfxName, opts?: { rate?: number; volume?: number }): void {
  if (!sfxOn || !game) return;
  const key = `sfx-${name}`;
  if (!game.cache.audio.exists(key)) return;
  try {
    game.sound.play(key, {
      volume: SFX_VOLUME * (opts?.volume ?? 1),
      rate: opts?.rate ?? 1,
    });
  } catch { /* audio context unavailable — never break gameplay over a sound */ }
}

/**
 * Starts the music loop if enabled and not already playing. Safe to call on
 * every scene entry: it no-ops while running. Browsers keep the audio context
 * suspended until the first user gesture — Phaser unlocks it automatically and
 * pending sounds start then, so calling this before the first tap still works.
 */
export function startMusic(): void {
  if (!musicOn || !game || !game.cache.audio.exists(MUSIC_KEY)) return;
  if (music && music.isPlaying) return;
  try {
    // Browsers keep the audio context suspended until the first user gesture.
    // Phaser unlocks it on that gesture and fires UNLOCKED — defer the start
    // there (re-checking musicOn: the player may have toggled it off while
    // still locked).
    if (game.sound.locked) {
      game.sound.once(Phaser.Sound.Events.UNLOCKED, () => startMusic());
      return;
    }
    if (!music) {
      music = game.sound.add(MUSIC_KEY);
      music.addMarker({
        name: 'loop',
        start: MUSIC_LOOP_START,
        duration: MUSIC_LOOP_END - MUSIC_LOOP_START,
        config: { loop: true, volume: MUSIC_VOLUME },
      });
    }
    music.play('loop', { loop: true, volume: MUSIC_VOLUME });
  } catch { /* audio context unavailable */ }
}

export function stopMusic(): void {
  music?.stop();
}
