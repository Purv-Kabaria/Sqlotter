import { context, redis, reddit } from '@devvit/web/server';
import { buildFlairText, ROYAL_TIER_ITEM_ID } from '../../shared/flair';
import { getShopItem } from '../../shared/shop';

// Splot's default vibrant green — used when the player has no equipped color
// (fresh accounts) or an unrecognized/removed item id.
const DEFAULT_FLAIR_BG = '#6DD400';

// `equipped` is stored as a JSON-stringified Record<slot, itemId> (see
// /api/user/equip) — only the string values this module cares about survive
// a malformed or hand-edited blob.
function safeParseEquipped(json: string | undefined): Record<string, string> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null) return {};
    const result: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'string') result[key] = item;
    }
    return result;
  } catch {
    return {};
  }
}

// Reddit's flair textColor is binary (dark|light) — pick whichever reads
// better against the chosen background instead of hardcoding 'dark', since
// backgrounds now span the whole Splot color rack (down to near-black
// Obsidian and up to near-white Sparkle/Opal).
function pickTextColor(hex: string): 'dark' | 'light' {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? 'dark' : 'light';
}

// Recomputes the player's Splotter Flair line and pushes it to Reddit —
// best-effort and self-throttling: the flair API is only called when the
// text or background actually changed since the last sync (tracked on the
// user hash), so callers can invoke this on every completion without
// spamming Reddit. Never throws: flair is decoration, no game request
// should fail over it.
export async function syncUserFlair(username: string): Promise<void> {
  try {
    const subredditName = context.subredditName ?? (await redis.get('subreddit:name')) ?? '';
    if (!subredditName || !username) return;

    const userKey = `user:${username}`;
    const [optOut, streakRaw, lifetimeRaw, ownsCrown, fitWeek, lastFlair, equippedRaw] = await redis.hMGet(userKey, [
      'flair:optOut', 'daily:streak', 'sparks:lifetime', `owned:${ROYAL_TIER_ITEM_ID}`, 'fitcheck:won', 'flair:last', 'equipped',
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

    // The flair pill matches the player's own Splot — same color rack the
    // Shop sells, read off their equipped color instead of a fixed green.
    // Gradient/sparkle finales collapse to their base `hex` since Reddit's
    // flair background only takes one solid color.
    const equippedColor = safeParseEquipped(equippedRaw ?? undefined).color;
    const flairBg = (equippedColor ? getShopItem(equippedColor)?.color?.hex : undefined) ?? DEFAULT_FLAIR_BG;

    // Throttle on text + background together — a color-only re-equip (streak/
    // tier text unchanged) must still push, or the flair goes stale.
    const syncKey = `${text}|${flairBg}`;
    if (syncKey === lastFlair) return;

    await reddit.setUserFlair({
      subredditName,
      username,
      text,
      backgroundColor: flairBg,
      textColor: pickTextColor(flairBg),
    });
    await redis.hSet(userKey, { 'flair:last': syncKey });
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
