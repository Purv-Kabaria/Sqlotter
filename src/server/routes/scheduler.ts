import { Hono } from 'hono';
import { redis, reddit } from '@devvit/web/server';
import type { TaskResponse } from '@devvit/web/server';
import { generateDailyLevel } from '../../shared/levelData';

export const schedulerRoutes = new Hono();

// ── Daily puzzle generation ───────────────────────────────────
// Called every day at 08:00 UTC by the devvit.json cron.
schedulerRoutes.post('/daily-puzzle', async (c) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const existing = await redis.get(`daily:${today}`);

    if (existing) {
      // Already generated for today
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const level  = generateDailyLevel(today);
    const levelId = level.id;

    // Store the level JSON in Redis
    await redis.set(`level:${levelId}`, JSON.stringify(level));
    // Map today → levelId
    await redis.set(`daily:${today}`, levelId);
    // Set expiry so stale levels are auto-cleaned after 30 days
    await redis.expire(`level:${levelId}`, 60 * 60 * 24 * 30);
    await redis.expire(`daily:${today}`, 60 * 60 * 24 * 30);

    // Create the Reddit post
    const subredditName = (await redis.get('subreddit:name')) ?? '';
    if (subredditName) {
      const post = await reddit.submitCustomPost({
        title: `🟢 Daily Splot! Puzzle — ${today}`,
        entry: 'default',
        postData: { levelId },
        styles: {
          heightPixels: 512,
          backgroundColor: '#1a0a2eff',
          backgroundColorDark: '#1a0a2eff',
        },
      });
      // Track the post id for this day
      await redis.set(`daily-post:${today}`, post.id);
    }

    console.log(`Daily puzzle generated: ${levelId} for ${today}`);
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (e) {
    console.error('Daily puzzle generation failed:', e);
    return c.json<TaskResponse>({ status: 'error', message: String(e) }, 500);
  }
});
