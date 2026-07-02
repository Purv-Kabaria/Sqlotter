import { context } from '@devvit/web/client';

type LaunchPostData = {
  levelId?: unknown;
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
