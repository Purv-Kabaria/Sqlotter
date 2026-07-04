import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type { TaskResponse } from '@devvit/web/server';
import { generateDailyLevel } from '../../shared/levelData';
import { syncUserFlair } from '../core/flair';
import { dailyPostTitle } from '../core/post';
import { isCommentId, isPostId } from '../core/tid';

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
      await redis.set(`level:${levelId}`, JSON.stringify(level));
      await redis.set(`daily:${today}`, levelId);
      // Expiry so stale levels are auto-cleaned after 30 days
      await redis.expire(`level:${levelId}`, 60 * 60 * 24 * 30);
      await redis.expire(`daily:${today}`, 60 * 60 * 24 * 30);
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
        await redis.set(`daily-post:${today}`, post.id);
        await redis.expire(`daily-post:${today}`, 60 * 60 * 24 * 30);
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
// Two-task weekly ritual: Friday 15:00 UTC opens the thread, Sunday midnight
// (Monday 00:00 UTC) crowns the top-voted fit. Entries land via
// POST /api/share/fit, which maps each fit comment back to its player.

// ISO-8601 week number (UTC) — labels the weekly thread, e.g. "W27".
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

schedulerRoutes.post('/fitcheck-post', async (c) => {
  try {
    const subredditName = (await redis.get('subreddit:name')) ?? '';
    if (!subredditName) return c.json<TaskResponse>({ status: 'ok' }, 200);

    // One thread per week even if the cron re-fires.
    const week = `W${isoWeek(new Date())}`;
    const existingPost = await redis.get('fitcheck:current');
    const existingWeek = await redis.get('fitcheck:week');
    if (existingPost && existingWeek === week) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const post = await reddit.submitCustomPost({
      subredditName,
      title: `Fit Check Friday ${week} — dress your Splot, drop the fit below. Top vote takes 500 Sparks + the crown flair 👑`,
      entry: 'default',
      postData: { fitcheck: week },
      styles: {
        heightPixels: 512,
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });
    await redis.set('fitcheck:current', post.id);
    await redis.set('fitcheck:week', week);

    console.log(`Fit Check thread posted for ${week}: ${post.id}`);
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (e) {
    console.error('Fit Check post failed:', e);
    return c.json<TaskResponse>({ status: 'error', message: String(e) }, 500);
  }
});

schedulerRoutes.post('/fitcheck-award', async (c) => {
  try {
    const postId = (await redis.get('fitcheck:current')) ?? '';
    const week = (await redis.get('fitcheck:week')) ?? '';
    // Close the thread first — /api/share/fit stops accepting entries even
    // if the awarding below fails, so a retry can't double-award later fits.
    await redis.del('fitcheck:current');
    if (!postId || !isPostId(postId)) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const entries: Record<string, string> =
      (await redis.hGetAll(`fitcheck:comments:${postId}`)) ?? {};
    if (Object.keys(entries).length === 0) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    // Highest-voted comment that is a registered fit entry wins — the
    // community's upvotes run the contest, the app just reads the result.
    const comments = await reddit.getComments({ postId, sort: 'top', limit: 100 }).all();
    let winner = '';
    let winningCommentId = '';
    for (const comment of comments) {
      const player = entries[comment.id];
      if (player) {
        winner = player;
        winningCommentId = comment.id;
        break;
      }
    }
    if (!winner) return c.json<TaskResponse>({ status: 'ok' }, 200);

    // +500 Sparks (balance, negated leaderboard score, and lifetime for the
    // flair tier — same trio /api/complete maintains) plus the crown badge.
    const newTotal = await redis.incrBy(`sparks:${winner}`, 500);
    await redis.zAdd('lb:global:sparks', { score: -newTotal, member: winner });
    await redis.hIncrBy(`user:${winner}`, 'sparks:lifetime', 500);
    await redis.hSet(`user:${winner}`, { 'fitcheck:won': week });
    await syncUserFlair(winner);

    if (isCommentId(winningCommentId)) {
      try {
        await reddit.submitComment({
          id: winningCommentId,
          text: `👑 **CROWNED.** The people have spoken — u/${winner} takes Fit Check ${week}: +500 Sparks, the Fit crown flair, and a full week of drip supremacy. See you next Friday!`,
        });
      } catch {
        // The Sparks and flair already landed; the shout-out is a bonus.
      }
    }

    console.log(`Fit Check ${week} winner: ${winner}`);
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (e) {
    console.error('Fit Check award failed:', e);
    return c.json<TaskResponse>({ status: 'error', message: String(e) }, 500);
  }
});
