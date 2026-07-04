import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { generateDailyLevel } from '../../shared/levelData';
import { dailyPostTitle, GAME_POST_TITLE } from '../core/post';

export const menu = new Hono();

// Mod action: post standard Sqlotter game post
menu.post('/post-create', async (c) => {
  try {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName ?? '',
      title: GAME_POST_TITLE,
      entry: 'default',
      styles: {
        heightPixels: 512,
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });

    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}` },
      200,
    );
  } catch (error) {
    console.error('Error creating post:', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

// Mod action: manually trigger daily puzzle generation
menu.post('/post-daily', async (c) => {
  try {
    const today   = new Date().toISOString().slice(0, 10);
    const level   = generateDailyLevel(today);
    const levelId = level.id;

    await redis.set(`level:${levelId}`, JSON.stringify(level));
    await redis.set(`daily:${today}`, levelId);
    await redis.expire(`level:${levelId}`, 60 * 60 * 24 * 30);
    await redis.expire(`daily:${today}`, 60 * 60 * 24 * 30);

    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName ?? '',
      title: dailyPostTitle(level, today),
      entry: 'default',
      postData: { levelId },
      styles: {
        heightPixels: 512,
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });

    await redis.set(`daily-post:${today}`, post.id);

    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}` },
      200,
    );
  } catch (error) {
    console.error('Error posting daily puzzle:', error);
    return c.json<UiResponse>({ showToast: `Failed: ${String(error)}` }, 400);
  }
});

// Mod action: FULL wipe — every user's sparks, shop unlocks/equips, completions,
// stars, and streaks, plus all leaderboards and first-completer records. Used when
// relaunching with a new level set so everyone starts fresh.
menu.post('/reset-all-users', async (c) => {
  try {
    // Enumerate every known player. users:all is the permanent registry written
    // by /api/init; lb:global:solved additionally covers players from before the
    // registry existed.
    const usernames = new Set<string>();
    for (const registry of ['users:all', 'lb:global:solved']) {
      const count = await redis.zCard(registry);
      if (count > 0) {
        const entries = await redis.zRange(registry, 0, count - 1, { by: 'rank' });
        for (const entry of entries) usernames.add(entry.member);
      }
    }

    const keysToDelete: string[] = [];
    for (const username of usernames) {
      keysToDelete.push(`user:${username}`, `sparks:${username}`);
    }
    keysToDelete.push(
      'users:all', 'lb:global:solved', 'level:first-completer',
      'lb:global:sparks', 'lb:global:moves', 'lb:global:played',
    );

    for (let i = 0; i < keysToDelete.length; i += 100) {
      await redis.del(...keysToDelete.slice(i, i + 100));
    }

    return c.json<UiResponse>(
      { showToast: `Wiped ALL data for ${usernames.size} user(s)` },
      200,
    );
  } catch (error) {
    console.error('Error resetting all user data:', error);
    return c.json<UiResponse>({ showToast: `Failed: ${String(error)}` }, 400);
  }
});

// Mod action: wipe every user's level completion stars/completion state and
// first-completer records. Sparks, unlocked/equipped shop items, and the
// global Sparks/Moves/Levels Played leaderboards are untouched — those are
// currency/cosmetics/cumulative activity, not level statistics.
menu.post('/reset-level-stats', async (c) => {
  try {
    const solvedCount = await redis.zCard('lb:global:solved');
    const usernames = solvedCount > 0
      ? (await redis.zRange('lb:global:solved', 0, solvedCount - 1, { by: 'rank' })).map((r) => r.member)
      : [];

    for (const username of usernames) {
      const userKey = `user:${username}`;
      const fields = await redis.hKeys(userKey);
      const toClear = fields.filter((f) =>
        f.startsWith('done:') || f.startsWith('stars:') || f.startsWith('daily:'));
      if (toClear.length > 0) await redis.hDel(userKey, toClear);
    }

    await redis.del('lb:global:solved');
    await redis.del('level:first-completer');

    return c.json<UiResponse>(
      { showToast: `Reset level stats for ${usernames.length} user(s)` },
      200,
    );
  } catch (error) {
    console.error('Error resetting level stats:', error);
    return c.json<UiResponse>({ showToast: `Failed: ${String(error)}` }, 400);
  }
});
