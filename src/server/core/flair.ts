import { context, redis, reddit } from '@devvit/web/server';
import { buildFlairText, ROYAL_TIER_ITEM_ID } from '../../shared/flair';

// Splot's default vibrant green — the flair pill matches the mascot.
const FLAIR_BG = '#6DD400';

// Recomputes the player's Splotter Flair line and pushes it to Reddit —
// best-effort and self-throttling: the flair API is only called when the
// text actually changed since the last sync (tracked on the user hash), so
// callers can invoke this on every completion without spamming Reddit.
// Never throws: flair is decoration, no game request should fail over it.
export async function syncUserFlair(username: string): Promise<void> {
  try {
    const subredditName = context.subredditName ?? (await redis.get('subreddit:name')) ?? '';
    if (!subredditName || !username) return;

    const userKey = `user:${username}`;
    const [optOut, streakRaw, lifetimeRaw, ownsCrown, fitWeek, lastFlair] = await redis.hMGet(userKey, [
      'flair:optOut', 'daily:streak', 'sparks:lifetime', `owned:${ROYAL_TIER_ITEM_ID}`, 'fitcheck:won', 'flair:last',
    ]);
    if (optOut === '1') return;

    // Lifetime-Sparks tracking postdates some accounts — fall back to the
    // current balance so long-time players don't read as fresh Droplets.
    const balance = parseInt((await redis.get(`sparks:${username}`)) ?? '0', 10);
    const lifetime = Math.max(parseInt(lifetimeRaw ?? '0', 10) || 0, balance || 0);

    const text = buildFlairText({
      streakDays: parseInt(streakRaw ?? '0', 10) || 0,
      lifetimeSparks: lifetime,
      ownsGoldenCrown: ownsCrown === '1',
      fitCrownWeek: fitWeek ?? undefined,
    });
    if (text === lastFlair) return;

    await reddit.setUserFlair({
      subredditName,
      username,
      text,
      backgroundColor: FLAIR_BG,
      textColor: 'dark',
    });
    await redis.hSet(userKey, { 'flair:last': text });
  } catch {
    // Flair must never break the caller — subreddit flair may be disabled,
    // or the Reddit call can transiently fail; the next sync retries anyway.
  }
}

// Opt-out path: remove the app-managed flair and forget the last-synced text
// so re-enabling later pushes a fresh line immediately.
export async function clearUserFlair(username: string): Promise<void> {
  try {
    const subredditName = context.subredditName ?? (await redis.get('subreddit:name')) ?? '';
    if (!subredditName || !username) return;
    await reddit.setUserFlair({ subredditName, username, text: '' });
  } catch {
    // Best-effort — stale flair simply stays until the user re-enables.
  }
  await redis.hDel(`user:${username}`, ['flair:last']);
}
