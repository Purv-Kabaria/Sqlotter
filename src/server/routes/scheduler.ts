import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type { TaskResponse } from '@devvit/web/server';
import { generateDailyLevel } from '../../shared/levelData';
import { dailyPostTitle } from '../core/post';
import { runFitCheckCycle } from '../core/fitcheck';

export const schedulerRoutes = new Hono();

// ── Daily puzzle generation ───────────────────────────────────
// Runs HOURLY (see devvit.json) and is idempotent per piece: the level store
// and the Reddit post are checked separately, so whichever half failed on the
// last tick is retried on the next one instead of silently skipping the whole
// day. The post therefore lands right after UTC midnight, and a transient
// Reddit failure costs at most an hour — this is what actually guarantees a
// daily post every day.
schedulerRoutes.post('/daily-puzzle', async (c) => {
  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    // The generator is date-seeded and deterministic, so regenerating is the
    // same as loading the stored copy — no JSON parsing needed here.
    const level  = generateDailyLevel(today);
    const levelId = level.id;

    if (!(await redis.get(`daily:${today}`))) {
      // set()'s inline expiration folds the 30-day auto-clean TTL into the
      // same write; the two independent keys go together in one batch.
      const expiration = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000);
      await Promise.all([
        redis.set(`level:${levelId}`, JSON.stringify(level), { expiration }),
        redis.set(`daily:${today}`, levelId, { expiration }),
      ]);
      console.log(`Daily puzzle generated: ${levelId} for ${today}`);
    }

    if (!(await redis.get(`daily-post:${today}`))) {
      // Scheduler runs carry the subreddit in context on current Devvit; the
      // redis copy covers older runtimes and is refreshed for the other tasks.
      const subredditName = context.subredditName ?? (await redis.get('subreddit:name')) ?? '';
      if (subredditName) {
        await redis.set('subreddit:name', subredditName);
        const post = await reddit.submitCustomPost({
          subredditName,
          title: dailyPostTitle(level, today),
          entry: 'default',
          postData: { levelId },
          styles: {
            heightPixels: 512,
            backgroundColor: '#1a0a2eff',
            backgroundColorDark: '#1a0a2eff',
          },
        });
        await redis.set(`daily-post:${today}`, post.id, { expiration: new Date(Date.now() + 60 * 60 * 24 * 30 * 1000) });
        console.log(`Daily puzzle posted: ${post.id} for ${today}`);
      }
    }

    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (e) {
    console.error('Daily puzzle task failed:', e);
    return c.json<TaskResponse>({ status: 'error', message: String(e) }, 500);
  }
});

// ── Fit Check Friday ──────────────────────────────────────────
// One weekly ritual on a single task (hourly on Thursdays, see devvit.json):
// crown the current thread's top-voted fit, delete that post, then open a fresh
// thread — so the feed carries exactly one live Fit Check post and it turns over
// every Thursday. Runs at most once per Thursday (idempotent via a per-day
// stamp) but retries within the day on a transient failure, exactly like the
// daily-puzzle task. All the moving parts live in core/fitcheck.ts.
schedulerRoutes.post('/fitcheck-cycle', async (c) => {
  try {
    // Scheduler runs carry the subreddit in context on current Devvit; the
    // redis copy covers older runtimes and is refreshed here for the task.
    const subredditName = context.subredditName ?? (await redis.get('subreddit:name')) ?? '';
    if (subredditName) {
      await redis.set('subreddit:name', subredditName);
      await runFitCheckCycle(subredditName);
    }
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (e) {
    console.error('Fit Check cycle failed:', e);
    return c.json<TaskResponse>({ status: 'error', message: String(e) }, 500);
  }
});
