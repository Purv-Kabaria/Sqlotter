import { context } from '@devvit/web/client';

type LaunchPostData = {
  levelId?: unknown;
};

export function getLaunchLevelId(): string | null {
  const postData: LaunchPostData | undefined = context.postData;
  const levelId = postData?.levelId;
  if (typeof levelId !== 'string') return null;
  const trimmed = levelId.trim();
  if (trimmed.length < 1 || trimmed.length > 120) return null;
  return trimmed;
}
