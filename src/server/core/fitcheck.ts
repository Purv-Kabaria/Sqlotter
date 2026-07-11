import { redis, reddit } from '@devvit/web/server';
import { syncUserFlair } from './flair';
import { KAOMOJI } from './post';
import { isPostId, type PostId } from './tid';

// Fit Check Friday — one weekly Splot-fashion thread at a time. A single
// scheduler task (hourly on Thursdays, see runFitCheckCycle) crowns the current
// thread's top-voted fit, deletes that post, and opens a fresh one, so the feed
// always carries exactly one live thread and it turns over every Thursday.
// Entries arrive via POST /api/share/fit, but only while the player is viewing
// the live thread (that endpoint matches context.postId against fitcheck:current).

export const FIT_AWARD_SPARKS = 500;

const THREAD_STYLES = {
  heightPixels: 512,
  backgroundColor: '#1a0a2eff',
  backgroundColorDark: '#1a0a2eff',
} as const;

// Redis keys — the live post id, its display week label, and the date of the
// last completed Thursday cycle (idempotency guard against a cron re-fire).
const KEY_CURRENT = 'fitcheck:current';
const KEY_WEEK    = 'fitcheck:week';
const KEY_CYCLED  = 'fitcheck:cycledOn';

// ISO-8601 week number (UTC) — labels the weekly thread, e.g. "W27".
function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}

function fitCheckWeekLabel(date: Date = new Date()): string {
  return `W${isoWeek(date)}`;
}

function fitCheckTitle(week: string): string {
  return `Fit Check Friday ${week}: dress your Splot, drop the fit below. Top vote takes ${FIT_AWARD_SPARKS} Sparks + the crown flair`;
}

// Submits a fresh thread and records it as the live one. Callers own the
// surrounding idempotency: openFitCheckThread guards on an existing thread,
// runFitCheckCycle guards on the Thursday date.
async function postFitCheckThread(subredditName: string): Promise<string> {
  const week = fitCheckWeekLabel();
  const post = await reddit.submitCustomPost({
    subredditName,
    title: fitCheckTitle(week),
    entry: 'default',
    postData: { fitcheck: week },
    styles: THREAD_STYLES,
  });
  await redis.set(KEY_CURRENT, post.id);
  await redis.set(KEY_WEEK, week);
  return post.id;
}

// Bootstrap path (app install/upgrade): open a thread only when none is live,
// so a fresh install carries a Fit Check thread immediately instead of waiting
// for the first Thursday cycle. Idempotent per live thread, and never throws —
// a failed bootstrap must not brick install.
export async function openFitCheckThread(subredditName: string): Promise<void> {
  try {
    if (!subredditName) return;
    const existing = await redis.get(KEY_CURRENT);
    if (existing && isPostId(existing)) return;
    await postFitCheckThread(subredditName);
  } catch (e) {
    console.error('Fit Check bootstrap failed:', e);
  }
}

// Crowns the top-voted fit on a thread: +500 Sparks (balance, negated board
// score, and lifetime for the flair tier — the same trio /api/complete keeps),
// stamps the fit-crown week, and syncs flair. Returns the winner so the caller
// can announce them on the FRESH thread — the old post gets deleted moments
// later, so a shout-out there would vanish with it. Best-effort throughout: a
// transient Reddit hiccup never unwinds the Sparks that already landed.
type FitWinner = { username: string; week: string };

async function resolveAndAwardWinner(postId: PostId, week: string): Promise<FitWinner | null> {
  const entries: Record<string, string> =
    (await redis.hGetAll(`fitcheck:comments:${postId}`)) ?? {};
  if (Object.keys(entries).length === 0) return null;

  // Highest-voted comment that is a registered fit entry wins — the community's
  // upvotes run the contest, the app just reads the result.
  const comments = await reddit.getComments({ postId, sort: 'top', limit: 100 }).all();
  let winner = '';
  for (const comment of comments) {
    const player = entries[comment.id];
    if (player) { winner = player; break; }
  }
  if (!winner) return null;

  const newTotal = await redis.incrBy(`sparks:${winner}`, FIT_AWARD_SPARKS);
  await redis.zAdd('lb:global:sparks', { score: -newTotal, member: winner });
  await redis.hIncrBy(`user:${winner}`, 'sparks:lifetime', FIT_AWARD_SPARKS);
  await redis.hSet(`user:${winner}`, { 'fitcheck:won': week });
  await syncUserFlair(winner);
  console.log(`Fit Check ${week} winner: ${winner}`);
  return { username: winner, week };
}

// Deletes the app's own thread once its week is over. Best-effort: a delete
// failure just leaves a stale (now unlinked) post in the feed.
async function deleteFitCheckThread(postId: PostId): Promise<void> {
  try {
    const post = await reddit.getPostById(postId);
    await post.delete();
  } catch {
    // Post already gone, or Reddit refused — the new thread still opens below.
  }
}

// The Thursday ritual (cron 0 * * * 4 — hourly, like the daily task): crown →
// delete → repost → announce. Idempotent per calendar day via KEY_CYCLED, so
// the ritual runs exactly once per Thursday but a transient Reddit failure
// retries on the next hourly fire instead of skipping the whole week.
export async function runFitCheckCycle(subredditName: string): Promise<void> {
  if (!subredditName) return;
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (a Thursday)
  if ((await redis.get(KEY_CYCLED)) === today) return;

  const currentPostId = (await redis.get(KEY_CURRENT)) ?? '';
  const currentWeek   = (await redis.get(KEY_WEEK)) ?? '';
  let winner: FitWinner | null = null;
  if (currentPostId && isPostId(currentPostId)) {
    // Close entries first so /api/share/fit stops accepting during the award —
    // a retry after a mid-cycle failure then can't double-award later fits.
    await redis.del(KEY_CURRENT);
    winner = await resolveAndAwardWinner(currentPostId, currentWeek);
    await deleteFitCheckThread(currentPostId);
  }

  // Open the fresh thread, then crown last week's champ ON it (so the shout-out
  // outlives the deleted post), then stamp the cycle date last. If that stamp
  // somehow failed after the post landed, a re-fire re-awards a brand-new
  // (entry-less) thread — a no-op — rather than skipping the crown entirely.
  const newPostId = await postFitCheckThread(subredditName);
  if (winner && isPostId(newPostId)) {
    try {
      await reddit.submitComment({
        // ♛ is a text glyph, not an emoji — comment voice is kaomoji/text-art.
        id: newPostId,
        text: `♛ **Last week's Fit Check crown** goes to u/${winner.username} (${winner.week}): +${FIT_AWARD_SPARKS} Sparks and the Fit crown flair. New week, new fits — drop yours below! ${KAOMOJI.cheer}`,
      });
    } catch {
      // The Sparks and flair already landed; the shout-out is a bonus.
    }
  }
  await redis.set(KEY_CYCLED, today);
}
