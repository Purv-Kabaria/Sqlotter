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

// ── In-progress attempts (persistent levels) ────────────────────────────────
// Session store for the live action log + banked time of unfinished levels —
// backing out and returning resumes instantly from here. The Game scene also
// syncs it to Redis (POST /api/progress) so logged-in players resume across
// page loads; this map is the always-hit fast path.
export type WipAttempt = { actions: string[]; timeMs: number };

const wip = new Map<string, WipAttempt>();

export function getWipAttempt(levelId: string): WipAttempt | null {
  return wip.get(levelId) ?? null;
}

export function setWipAttempt(levelId: string, attempt: WipAttempt): void {
  wip.set(levelId, attempt);
}

export function clearWipAttempt(levelId: string): void {
  wip.delete(levelId);
}
