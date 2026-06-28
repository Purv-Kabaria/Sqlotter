import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const input = await c.req.json<OnAppInstallRequest>();
    const subredditName = context.subredditName ?? '';

    // Persist subreddit name so the daily scheduler can use it
    if (subredditName) {
      await redis.set('subreddit:name', subredditName);
    }

    // Create the initial welcome post
    const post = await reddit.submitCustomPost({
      title: '🟢 Splot! — The Slime Puzzle Game',
      entry: 'default',
      styles: {
        height: 'TALL',
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });

    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `Splot! post created in r/${subredditName} (id: ${post.id}, trigger: ${input.type})`,
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
