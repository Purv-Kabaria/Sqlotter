import { context } from '@devvit/web/client';

type LaunchPostData = {
  levelId?: unknown;
  fitcheck?: unknown;
};

export function getLaunchLevelId(): string | null {
  try {
    // context is undefined outside the Devvit webview (e.g. local testing) —
    // without the guard this throws inside Preloader.create() and bricks boot.
    const postData: LaunchPostData | undefined = context.postData;
    const levelId = postData?.levelId;
    if (typeof levelId !== 'string') return null;
    const trimmed = levelId.trim();
    if (trimmed.length < 1 || trimmed.length > 120) return null;
    return trimmed;
  } catch {
    return null;
  }
}

// True when the current post is a live Fit Check thread (its postData carries a
// `fitcheck` week label). Drives the boot route straight into the dressing room
// (Shop) and un-hides the Shop's "Fit Check" button — a fit can only be posted
// from here, matching the server's context.postId check on /api/share/fit.
export function isFitCheckPost(): boolean {
  try {
    const postData: LaunchPostData | undefined = context.postData;
    return typeof postData?.fitcheck === 'string';
  } catch {
    return false;
  }
}
