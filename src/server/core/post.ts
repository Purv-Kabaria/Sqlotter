import { context, reddit } from '@devvit/web/server';
import type { LevelData } from '../../shared/types';

// One voice for every post the app creates. Post titles are the only part of
// the game non-players ever see in their feed — they carry the hook, so a
// bare name or an ISO date is a wasted impression.
export const GAME_POST_TITLE = 'Sqlotter 🎨 Paint the slime. Mind the goggles. Beat the par.';

// Daily titles stay minimal — no emojis, no flavor copy. Just the game,
// the date, and the level name.
export function dailyPostTitle(level: LevelData, date: string): string {
  return `Daily Splat ${date}: ${level.title}`;
}

export const createPost = async () => {
  return await reddit.submitCustomPost({
    subredditName: context.subredditName ?? '',
    title: GAME_POST_TITLE,
    entry: 'default',
    styles: {
      heightPixels: 512,
      backgroundColor: '#1a0a2eff',
      backgroundColorDark: '#1a0a2eff',
    },
  });
};
