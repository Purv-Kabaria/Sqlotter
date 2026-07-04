import { redis, reddit } from '@devvit/web/server';
import type { LevelData } from '../../shared/types';
import { isCommentId, isPostId } from './tid';

// Beat the Creator: every UGC level post carries one app-maintained duel
// scoreboard comment. The comment id lives at duel:{levelId}, the running
// counters at duel:{levelId}:stats — both on the same 90-day TTL as the
// level itself, so the whole duel expires as a unit.
const DUEL_TTL_SECONDS = 60 * 60 * 24 * 90;

function formatDuelTime(timeMs: number): string {
  const secs = Math.floor(timeMs / 1000);
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

type DuelStats = {
  attempts: number;
  matched: number;
  bestTimeMs: number | null;
  bestTimeUser: string;
};

function duelCommentText(level: LevelData, stats: DuelStats): string {
  const moves = `${level.optimalSteps} ${level.optimalSteps === 1 ? 'move' : 'moves'}`;
  const author = level.authorName ? `u/${level.authorName}` : 'the creator';
  if (stats.attempts === 0) {
    return `⚔️ **The Duel so far:** no challengers yet. ${author}'s ${moves} stand unbeaten — Splot believes in you.`;
  }
  const parts = [
    `${stats.attempts} ${stats.attempts === 1 ? 'attempt' : 'attempts'}`,
    `${stats.matched} matched ${author}'s ${moves}`,
  ];
  if (stats.bestTimeMs !== null && stats.bestTimeUser) {
    parts.push(`fastest: u/${stats.bestTimeUser} (${formatDuelTime(stats.bestTimeMs)})`);
  }
  return `⚔️ **The Duel so far:** ${parts.join(' · ')}. Splot believes in you.`;
}

// Posts the initial duel scoreboard on a freshly created UGC level post.
// Best-effort: the level post works without its scoreboard, so any Reddit
// failure is swallowed (there's just no duel comment to update later).
export async function createDuelComment(level: LevelData, postId: string): Promise<void> {
  try {
    if (!isPostId(postId)) return;
    const comment = await reddit.submitComment({
      id: postId,
      text: duelCommentText(level, { attempts: 0, matched: 0, bestTimeMs: null, bestTimeUser: '' }),
    });
    // Pin it when the app account has the rights; a regular comment works too.
    try { await comment.distinguish(true); } catch { /* app is not a mod here */ }
    await redis.set(`duel:${level.id}`, comment.id);
    await redis.expire(`duel:${level.id}`, DUEL_TTL_SECONDS);
  } catch {
    // No scoreboard — the duel silently degrades to a plain level post.
  }
}

// Records one completion of a UGC level and, on milestones only (first
// challenger, round attempt counts, matcher milestones, a new fastest time),
// re-edits the duel comment — milestone gating keeps the Reddit write rate
// far below any limit while still giving creators notification-worthy
// moments. Never throws: duel bookkeeping must not fail /api/complete.
export async function recordDuelResult(
  level: LevelData,
  username: string,
  steps: number,
  timeMs: number,
): Promise<void> {
  try {
    const statsKey = `duel:${level.id}:stats`;
    const attempts = await redis.hIncrBy(statsKey, 'attempts', 1);
    if (attempts === 1) await redis.expire(statsKey, DUEL_TTL_SECONDS);

    const matchedThisRun = steps <= level.optimalSteps;
    const matched = matchedThisRun
      ? await redis.hIncrBy(statsKey, 'matched', 1)
      : parseInt((await redis.hGet(statsKey, 'matched')) ?? '0', 10);

    const [bestRaw, bestUser] = await redis.hMGet(statsKey, ['bestTimeMs', 'bestTimeUser']);
    const prevBest = bestRaw ? parseInt(bestRaw, 10) : null;
    const newFastest = prevBest === null || timeMs < prevBest;
    if (newFastest) {
      await redis.hSet(statsKey, { bestTimeMs: String(timeMs), bestTimeUser: username });
    }

    const milestone = attempts === 1 || attempts === 10 || attempts === 25
      || (matchedThisRun && (matched === 1 || matched === 10 || matched === 25))
      || newFastest;
    if (!milestone) return;

    const commentId = await redis.get(`duel:${level.id}`);
    if (!commentId || !isCommentId(commentId)) return;
    const comment = await reddit.getCommentById(commentId);
    await comment.edit({
      text: duelCommentText(level, {
        attempts,
        matched,
        bestTimeMs: newFastest ? timeMs : prevBest,
        bestTimeUser: newFastest ? username : (bestUser ?? ''),
      }),
    });
  } catch {
    // Counters may drift or an edit may drop — acceptable for a scoreboard.
  }
}
