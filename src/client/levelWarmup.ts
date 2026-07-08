import type * as Phaser from 'phaser';
import { warmCuratedLevels } from '../shared/levelData';

// Spreads the curated-level build (24 worlds, hundreds of ms of pure CPU)
// across idle frames — one world (~15-40ms) per step — so no single frame
// ever eats the whole build. Started by Preloader (during its "waking up"
// wait) and continued by MainMenu; a scene shutdown just stops the chain,
// and any getCuratedLevels() call finishes the remainder synchronously, so
// this is purely a head start, never a dependency.
export function warmLevelsDuringIdle(scene: Phaser.Scene): void {
  if (warmCuratedLevels()) return;
  scene.time.delayedCall(30, () => warmLevelsDuringIdle(scene));
}
