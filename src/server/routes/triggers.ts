import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { LEVELS_VERSION } from '../../shared/levelData';
import { GAME_POST_TITLE } from '../core/post';
import { openFitCheckThread } from '../core/fitcheck';

export const triggers = new Hono();

// Wipes every player's LEVEL progress: completions, stars, daily streaks,
// created-level lists, the progress leaderboards, first-completer records,
// and the UGC index. Sparks balances, the Sparks leaderboard, and shop
// unlocks/equips are untouched — currency and cosmetics aren't progress.
// Runs when the deployed LEVELS_VERSION doesn't match the stored one (i.e.
// the level set changed incompatibly, like the stencil-gameplay rework).
async function wipeProgressIfStale(): Promise<boolean> {
  const stored = await redis.get('levels:version');
  if (stored === LEVELS_VERSION) return false;

  const usernames = new Set<string>();
  for (const registry of ['users:all', 'lb:global:solved']) {
    const count = await redis.zCard(registry);
    if (count > 0) {
      const entries = await redis.zRange(registry, 0, count - 1, { by: 'rank' });
      for (const entry of entries) usernames.add(entry.member);
    }
  }

  for (const username of usernames) {
    const userKey = `user:${username}`;
    const fields = await redis.hKeys(userKey);
    const toClear = fields.filter((f) =>
      f.startsWith('done:') || f.startsWith('stars:') || f.startsWith('daily:') || f === 'created');
    if (toClear.length > 0) await redis.hDel(userKey, toClear);
  }

  await redis.del(
    'lb:global:solved', 'lb:global:moves', 'lb:global:played',
    'level:first-completer', 'ugc:index',
  );
  await redis.set('levels:version', LEVELS_VERSION);
  console.log(`Level progress wiped for ${usernames.size} user(s) — level set is now ${LEVELS_VERSION}`);
  return true;
}

triggers.post('/on-app-upgrade', async (c) => {
  try {
    // Older installs may predate the install trigger's write of this key —
    // the daily/fitcheck schedulers can't post without it.
    if (context.subredditName) {
      await redis.set('subreddit:name', context.subredditName);
      // Bring existing installs up to the always-live Fit Check thread without
      // waiting for the first Thursday cycle (idempotent when one already exists).
      await openFitCheckThread(context.subredditName);
    }
    const wiped = await wipeProgressIfStale();
    return c.json<TriggerResponse>(
      { status: 'success', message: wiped ? 'Progress reset for new level set' : 'Level set unchanged' },
      200,
    );
  } catch (error) {
    console.error('Upgrade trigger error:', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: `Upgrade handling failed: ${String(error)}` },
      400,
    );
  }
});

triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();
    const subredditName = context.subredditName ?? '';

    // Persist subreddit name so the daily scheduler can use it
    if (subredditName) {
      await redis.set('subreddit:name', subredditName);
    }
    await redis.set('levels:version', LEVELS_VERSION);

    // Create the initial welcome post
    const post = await reddit.submitCustomPost({
      subredditName,
      title: GAME_POST_TITLE,
      entry: 'default',
      styles: {
        heightPixels: 512,
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });

    // Open the first Fit Check thread right away so the weekly ritual is live
    // from install (idempotent, best-effort — never blocks the welcome post).
    await openFitCheckThread(subredditName);

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Sqlotter post created in r/${subredditName} (id: ${post.id}, trigger: ${input.type})`,
      },
      200,
    );
  } catch (error) {
    console.error('Install trigger error:', error);
    return c.json<TriggerResponse>(
      { status: 'error', message: `Failed to initialise: ${String(error)}` },
      400,
    );
  }
});
