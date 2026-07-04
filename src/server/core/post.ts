import { context, reddit } from '@devvit/web/server';
import type { LevelData } from '../../shared/types';

// One voice for every post the app creates. Post titles are the only part of
// the game non-players ever see in their feed — they carry the hook, so a
// bare name or an ISO date is a wasted impression.
export const GAME_POST_TITLE = 'Sqlotter 🎨 — paint the slime. Mind the goggles. Beat the par.';

// Daily titles tease the day's difficulty instead of announcing a date. The
// flavor ladder tracks generateDailyLevel's weekday→tier mapping, and putting
// par in the title turns the post into a dare before the game even loads.
const TIER_FLAVOR: Record<LevelData['difficulty'], string> = {
  1: 'a gentle one',
  2: 'a sneaky one',
  3: 'a tricky one',
  4: 'a devious one',
  5: 'a diabolical one',
};

export function dailyPostTitle(level: LevelData, date: string): string {
  return `🎨 Daily Splat ${date} — ${TIER_FLAVOR[level.difficulty]}, par ${level.optimalSteps}. First solver takes the crown 👑`;
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
