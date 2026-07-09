import { context, reddit } from '@devvit/web/server';
import type { LevelData } from '../../shared/types';

// One voice for every post the app creates. Post titles are the only part of
// the game non-players ever see in their feed — they carry the hook, so a
// bare name or an ISO date is a wasted impression.
export const GAME_POST_TITLE = 'Sqlotter — paint the slime, mind the goggles, beat the par';

// HARD RULE: post titles never carry emojis — not from our copy, and not
// smuggled in through a user-supplied level title. Every composed post title
// goes through this scrub (pictographs, variation selectors, ZWJ), then
// whitespace is collapsed so the removal leaves no double spaces behind.
export function cleanPostTitle(raw: string): string {
  return raw
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Daily titles stay minimal — no emojis, no flavor copy. A daily level is
// a "Sqlot": just the ritual name, the date, and the level name.
export function dailyPostTitle(level: LevelData, date: string): string {
  return cleanPostTitle(`Sqlot ${date}: ${level.title}`);
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
