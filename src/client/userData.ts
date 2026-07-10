import type { InitResponse } from '../shared/api';

// Session-level cache of /api/init, shared across scenes. Preloader kicks the
// fetch off while assets are still streaming in, so the first MainMenu build
// already has the player's name/sparks/equipment instead of rendering
// placeholder data and visibly rebuilding when a post-create fetch lands.
let cached: InitResponse | null = null;
let inflight: Promise<InitResponse | null> | null = null;

// One-shot per page load — repeat calls return the same in-flight promise.
// Scenes that need fresh data after gameplay (MainMenu) refetch themselves
// and push the result back through setCachedUserData.
export function prefetchUserData(): Promise<InitResponse | null> {
  inflight ??= (async () => {
    try {
      const res = await fetch('/api/init', { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const data: InitResponse = await res.json();
      cached = data;
      return data;
    } catch {
      return null; // offline / playtest — scenes fall back to placeholders
    }
  })();
  return inflight;
}

export function getCachedUserData(): InitResponse | null {
  return cached;
}

export function setCachedUserData(data: InitResponse): void {
  cached = data;
}
