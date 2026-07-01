import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { CURATED_LEVELS, generateDailyLevel } from '../../shared/levelData';

export const menu = new Hono();

// Mod action: post standard Sqlotter game post
menu.post('/post-create', async (c) => {
  try {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName ?? '',
      title: 'Sqlotter — The Slime Puzzle Game',
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
      title: `Sqlotter Daily Puzzle — ${today}`,
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

// Mod action: wipe every user's level completion stars/completion state, first-completer
// records, and all per-level leaderboards. Sparks, unlocked/equipped shop items are untouched —
// those are currency/cosmetics, not level statistics.
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

    const ugcCount = await redis.zCard('ugc:index');
    const communityIds = ugcCount > 0
      ? (await redis.zRange('ugc:index', 0, ugcCount - 1, { by: 'rank' })).map((r) => r.member)
      : [];

    for (const levelId of [...CURATED_LEVELS.map((l) => l.id), ...communityIds]) {
      await redis.del(`lb:steps:${levelId}`, `lb:time:${levelId}`);
    }

    return c.json<UiResponse>(
      { showToast: `Reset level stats for ${usernames.length} user(s)` },
      200,
    );
  } catch (error) {
    console.error('Error resetting level stats:', error);
    return c.json<UiResponse>({ showToast: `Failed: ${String(error)}` }, 400);
  }
});
