import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import type {
  InitResponse,
  IncrementResponse,
  DecrementResponse,
  CompleteRequest,
  CompleteResponse,
  LeaderboardResponse,
  ProfileResponse,
  EquipRequest,
  EquipResponse,
  BuyRequest,
  BuyResponse,
  LevelCreateRequest,
  LevelCreateResponse,
  CommunityLevelsResponse,
} from '../../shared/api';
import type { LevelData, Stars } from '../../shared/types';
import { CURATED_LEVELS } from '../../shared/levelData';

// Pure helpers — no Phaser dependency
function calcStars(steps: number, optimal: number): Stars {
  if (steps <= optimal)     return 3;
  if (steps <= optimal * 2) return 2;
  return 1;
}
function calcSparks(stars: Stars, isFirst: boolean): number {
  const base = stars === 3 ? 30 : stars === 2 ? 20 : 10;
  return base + (isFirst ? 30 : 0);
}

// Item price table (single source of truth)
const ITEM_PRICES: Record<string, number> = {
  'eye-doubt': 50, 'eye-cute': 80, 'eye-shock': 120, 'eye-pain': 100,
  'mouth-kiss': 60, 'mouth-frown': 40, 'mouth-ooo': 70, 'mouth-squiggle': 90,
  'brow-surprise': 55, 'brow-sad': 45, 'brow-angry': 75,
  'acc-crown': 200, 'acc-hat': 150, 'acc-party-hat': 80,
  'acc-horns': 130, 'acc-cap': 60,
};

type Err = { status: 'error'; message: string };

export const api = new Hono();

// ── /api/init ────────────────────────────────────────────────
api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);

  try {
    const username = (await reddit.getCurrentUsername()) ?? '';
    const sparks   = username
      ? parseInt((await redis.get(`sparks:${username}`)) ?? '0', 10)
      : 0;

    return c.json<InitResponse>({
      type: 'init',
      postId,
      count: 0,
      username,
      isLoggedIn: username !== '',
      sparks,
    });
  } catch (e) {
    return c.json<Err>({ status: 'error', message: String(e) }, 500);
  }
});

// ── /api/daily ───────────────────────────────────────────────
api.get('/daily', async (c) => {
  const today   = new Date().toISOString().slice(0, 10);           // YYYY-MM-DD
  const levelId = await redis.get(`daily:${today}`);

  if (levelId) {
    const levelJson = await redis.get(`level:${levelId}`);
    if (levelJson) {
      return c.json({ levelId, level: JSON.parse(levelJson), date: today });
    }
  }

  // Fall back to rotating curated levels by day-of-year
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const fallback = CURATED_LEVELS[dayOfYear % CURATED_LEVELS.length] ?? CURATED_LEVELS[0];
  if (!fallback) return c.json({ levelId: 'L01', date: today }, 200);
  return c.json({ levelId: fallback.id, level: fallback, date: today });
});

// ── /api/levels/list ─────────────────────────────────────────
api.get('/levels/list', async (c) => {
  return c.json({ levels: CURATED_LEVELS });
});

// ── /api/level/:id ───────────────────────────────────────────
api.get('/level/:id', async (c) => {
  const id = c.req.param('id');

  // Check curated first
  const curated = CURATED_LEVELS.find(l => l.id === id);
  if (curated) return c.json({ level: curated });

  // Check Redis (UGC / daily generated)
  const json = await redis.get(`level:${id}`);
  if (json) return c.json({ level: JSON.parse(json) });

  return c.json<Err>({ status: 'error', message: 'Level not found' }, 404);
});

// ── /api/complete ────────────────────────────────────────────
api.post('/complete', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body = await c.req.json<CompleteRequest>();
  const { levelId, steps, timeMs } = body;

  // Determine optimal steps
  let optimalSteps = body.stars === 3 ? steps : steps * 2; // fallback
  const curated = CURATED_LEVELS.find(l => l.id === levelId);
  if (curated) optimalSteps = curated.optimalSteps;
  else {
    const json = await redis.get(`level:${levelId}`);
    if (json) {
      const lvl = JSON.parse(json) as { optimalSteps: number };
      optimalSteps = lvl.optimalSteps;
    }
  }

  const stars    = calcStars(steps, optimalSteps);
  const userKey  = `user:${username}`;
  const prevDone = await redis.hGet(userKey, `done:${levelId}`);
  const isFirst  = !prevDone;
  const actualSparks = calcSparks(stars, isFirst);

  // Best steps — lower is better: only update if this is a new best
  const stepsKey = `lb:steps:${levelId}`;
  const prevSteps = await redis.zScore(stepsKey, username);
  if (prevSteps === undefined || steps < prevSteps) {
    await redis.zAdd(stepsKey, { score: steps, member: username });
  }

  // Best time — lower is better
  const timeKey = `lb:time:${levelId}`;
  const prevTime = await redis.zScore(timeKey, username);
  if (prevTime === undefined || timeMs < prevTime) {
    await redis.zAdd(timeKey, { score: timeMs, member: username });
  }

  // Global: increment levels-solved count (always, even on repeat)
  if (isFirst) {
    await redis.zIncrBy('lb:global:solved', username, 1);
  }

  // Award sparks
  const newSparks = await redis.incrBy(`sparks:${username}`, actualSparks);

  // Persist best star rating for this level
  const prevStarsStr = await redis.hGet(userKey, `stars:${levelId}`);
  const prevStars    = prevStarsStr ? parseInt(prevStarsStr, 10) : 0;
  const bestStars    = Math.max(stars, prevStars) as Stars;

  await redis.hSet(userKey, {
    [`done:${levelId}`]:  '1',
    [`stars:${levelId}`]: String(bestStars),
  });

  return c.json<CompleteResponse>({ sparksEarned: actualSparks, newTotal: newSparks, stars });
});

// ── /api/leaderboard/level/:id ────────────────────────────────
api.get('/leaderboard/level/:id', async (c) => {
  const levelId  = c.req.param('id');
  const type     = c.req.query('type') ?? 'steps';
  const lbKey    = type === 'time' ? `lb:time:${levelId}` : `lb:steps:${levelId}`;
  const username = (await reddit.getCurrentUsername()) ?? '';

  // Ascending (lower steps/time = better), top 10
  const raw = await redis.zRange(lbKey, 0, 9, { by: 'rank' });

  const entries = raw.map((r, i) => ({
    rank:          i + 1,
    username:      r.member,
    score:         r.score,
    isCurrentUser: r.member === username,
  }));

  return c.json<LeaderboardResponse>({ entries });
});

// ── /api/leaderboard/global ───────────────────────────────────
api.get('/leaderboard/global', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';

  // Descending (most levels solved first)
  const raw = await redis.zRange('lb:global:solved', 0, 9, { by: 'rank', reverse: true });

  const entries = raw.map((r, i) => ({
    rank:          i + 1,
    username:      r.member,
    score:         r.score,
    isCurrentUser: r.member === username,
  }));

  return c.json<LeaderboardResponse>({ entries });
});

// ── /api/user/profile ─────────────────────────────────────────
api.get('/user/profile', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) {
    return c.json<ProfileResponse>({
      username: '',
      sparks: 0,
      unlockedItems: [],
      equippedItems: {},
      levelsCompleted: 0,
      optimalSolves: 0,
      streakDays: 0,
      completedLevels: [],
      levelStars: {},
    });
  }

  const userKey  = `user:${username}`;
  const sparks   = parseInt((await redis.get(`sparks:${username}`)) ?? '0', 10);
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};

  const completedLevels: string[] = [];
  const levelStars: Record<string, number> = {};
  let optimalSolves = 0;

  for (const [field, value] of Object.entries(allFields)) {
    if (field.startsWith('done:')) {
      completedLevels.push(field.slice(5));
    } else if (field.startsWith('stars:')) {
      const id  = field.slice(6);
      const s   = parseInt(value, 10);
      levelStars[id] = s;
      if (s === 3) optimalSolves++;
    }
  }

  const unlockedItems: string[] = JSON.parse(allFields['unlocked'] ?? '[]');
  const equippedItems: Record<string, string> = JSON.parse(allFields['equipped'] ?? '{}');

  return c.json<ProfileResponse>({
    username,
    sparks,
    unlockedItems,
    equippedItems,
    levelsCompleted: completedLevels.length,
    optimalSolves,
    streakDays: 0,
    completedLevels,
    levelStars,
  });
});

// ── /api/user/equip ───────────────────────────────────────────
api.post('/user/equip', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body     = await c.req.json<EquipRequest>();
  const userKey  = `user:${username}`;
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const equipped: Record<string, string> = JSON.parse(allFields['equipped'] ?? '{}');
  equipped[body.slot] = body.itemId;

  await redis.hSet(userKey, { equipped: JSON.stringify(equipped) });
  return c.json<EquipResponse>({ equippedItems: equipped });
});

// ── /api/user/buy ─────────────────────────────────────────────
api.post('/user/buy', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body    = await c.req.json<BuyRequest>();
  const userKey = `user:${username}`;
  const price   = ITEM_PRICES[body.itemId];

  if (!price) return c.json<Err>({ status: 'error', message: 'Unknown item' }, 400);

  const sparks = parseInt((await redis.get(`sparks:${username}`)) ?? '0', 10);
  if (sparks < price) return c.json<Err>({ status: 'error', message: 'Insufficient Sparks' }, 402);

  const newSparks = await redis.incrBy(`sparks:${username}`, -price);
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const unlocked: string[] = JSON.parse(allFields['unlocked'] ?? '[]');

  if (!unlocked.includes(body.itemId)) {
    unlocked.push(body.itemId);
    await redis.hSet(userKey, { unlocked: JSON.stringify(unlocked) });
  }

  return c.json<BuyResponse>({ sparks: newSparks, unlockedItems: unlocked });
});

// ── /api/level/create ─────────────────────────────────────────
api.post('/level/create', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Login required to create levels' }, 401);

  const body = await c.req.json<LevelCreateRequest>();
  const { title, difficulty, goalState, palette, optimalSteps, hint } = body;

  if (!title?.trim()) return c.json<Err>({ status: 'error', message: 'Title is required' }, 400);
  if (!palette?.length) return c.json<Err>({ status: 'error', message: 'Palette must have at least one modifier' }, 400);
  if (optimalSteps < 1) return c.json<Err>({ status: 'error', message: 'Level must have at least one solution step' }, 400);

  const levelId = `ugc-${username}-${Date.now()}`;
  const level = {
    id: levelId,
    title: title.trim().slice(0, 60),
    difficulty,
    goalState,
    palette,
    optimalSteps,
    authorName: username,
    hint,
  };

  await redis.set(`level:${levelId}`, JSON.stringify(level));
  await redis.expire(`level:${levelId}`, 60 * 60 * 24 * 90); // 90-day TTL

  // Track user's created levels
  const userKey = `user:${username}`;
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const created: string[] = JSON.parse(allFields['created'] ?? '[]');
  created.push(levelId);
  await redis.hSet(userKey, { created: JSON.stringify(created) });

  // Add to global community index (sorted by creation time)
  const now = Date.now();
  await redis.zAdd('ugc:index', { score: now, member: levelId });
  // Keep index at max 500 entries — remove oldest if exceeded
  const count = await redis.zCard('ugc:index');
  if (count > 500) {
    await redis.zRemRangeByRank('ugc:index', 0, count - 501);
  }

  return c.json<LevelCreateResponse>({ levelId });
});

// ── /api/levels/community ─────────────────────────────────────
api.get('/levels/community', async (c) => {
  const limitStr = c.req.query('limit') ?? '20';
  const limit = Math.min(parseInt(limitStr, 10) || 20, 50);

  // Fetch most recent UGC level IDs (descending by creation time)
  const raw = await redis.zRange('ugc:index', 0, limit - 1, { by: 'rank', reverse: true });
  if (!raw.length) return c.json<CommunityLevelsResponse>({ levels: [] });

  const levels = (
    await Promise.all(
      raw.map(async (r) => {
        const json = await redis.get(`level:${r.member}`);
        if (!json) return null;
        const level: LevelData = JSON.parse(json);
        return {
          id: level.id,
          title: level.title,
          difficulty: level.difficulty,
          authorName: level.authorName,
          optimalSteps: level.optimalSteps,
        };
      }),
    )
  ).filter((level) => level !== null);

  return c.json<CommunityLevelsResponse>({ levels });
});

// ── Legacy counter endpoints ──────────────────────────────────
api.post('/increment', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);
  const count = await redis.incrBy('count', 1);
  return c.json<IncrementResponse>({ count, postId, type: 'increment' });
});

api.post('/decrement', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);
  const count = await redis.incrBy('count', -1);
  return c.json<DecrementResponse>({ count, postId, type: 'decrement' });
});
