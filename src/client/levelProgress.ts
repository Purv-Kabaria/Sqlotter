// Session cache of per-level completion (best stars), shared across scenes.
// LevelSelect renders instantly from it on repeat visits (a background
// refetch corrects it), and Game records wins into it the moment they happen
// so returning to the map never shows a stale lock on the level just beaten.
export type ProgressMap = Record<string, { stars: number }>;

let progress: ProgressMap | null = null;

export function getCachedProgress(): ProgressMap | null {
  return progress;
}

export function setCachedProgress(next: ProgressMap): void {
  progress = next;
}

export function recordCompletion(levelId: string, stars: number): void {
  // Nothing cached yet — the next profile fetch will include this win anyway.
  if (!progress) return;
  const prev = progress[levelId];
  if (!prev || stars > prev.stars) {
    progress = { ...progress, [levelId]: { stars } };
  }
}
