import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { generateDailyLevel } from '../../shared/levelData';

export const menu = new Hono();

// Mod action: post standard Splot! game post
menu.post('/post-create', async (c) => {
  try {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName ?? '',
      title: '🟢 Splot! — The Slime Puzzle Game',
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
      title: `🟢 Daily Splot! Puzzle — ${today}`,
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
