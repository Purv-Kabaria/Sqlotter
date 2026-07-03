import { Hono } from 'hono';
import type { Context } from 'hono';
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
  DailyResponse,
  LevelsListResponse,
  LevelResponse,
} from '../../shared/api';
import type { LevelData, ModifierDef, SlimeState, Stars } from '../../shared/types';
import { CURATED_LEVELS } from '../../shared/levelData';
import { calcStars, isValidSolution, verifyLevelIntegrity } from '../../shared/gameRules';
import { getShopItem } from '../../shared/shop';

type Err = { status: 'error'; message: string };

export const api = new Hono();

async function readJsonBody<T>(c: Context): Promise<T | null> {
  try {
    return await c.req.json<T>();
  } catch {
    return null;
  }
}

function previousUtcDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

function dailyDateFromLevel(level: LevelData): string | null {
  if (!level.isDaily) return null;
  const match = /^daily-(\d{4}-\d{2}-\d{2})$/.exec(level.id);
  return match?.[1] ?? null;
}

async function getLevel(levelId: string): Promise<LevelData | undefined> {
  const curated = CURATED_LEVELS.find((level) => level.id === levelId);
  if (curated) return curated;
  const json = await redis.get(`level:${levelId}`);
  if (!json) return undefined;
  return parseStoredLevel(json) ?? undefined;
}

const GOGGLE_VARIANTS = new Set(['h-thick', 'h-thin', 'h-mono', 'v-thick', 'v-thin', 'v-mono']);
const FOUR_WAY_VARIANTS = new Set(['h-thick', 'h-thin', 'v-thick', 'v-thin']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseJsonValue(json: string): unknown | null {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseStringArray(json: string | undefined): string[] {
  if (!json) return [];
  const value = parseJsonValue(json);
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
}

function parseStringRecord(json: string | undefined): Record<string, string> {
  if (!json) return {};
  const value = parseJsonValue(json);
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

function isValidSlimeState(state: unknown): state is SlimeState {
  return isRecord(state)
    && typeof state.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(state.color)
    && (state.goggles === null || (typeof state.goggles === 'string' && GOGGLE_VARIANTS.has(state.goggles)))
    && (state.glasses === null || (typeof state.glasses === 'string' && FOUR_WAY_VARIANTS.has(state.glasses)))
    && (state.belt === null || (typeof state.belt === 'string' && FOUR_WAY_VARIANTS.has(state.belt)))
    && (state.pendant === null || state.pendant === 'h' || state.pendant === 'v')
    && (state.pumpkin === null || state.pumpkin === 25 || state.pumpkin === 50 || state.pumpkin === 75)
    && typeof state.underwear === 'boolean';
}

function isValidModifier(modifier: unknown): modifier is ModifierDef {
  if (!isRecord(modifier)
    || typeof modifier.id !== 'string' || modifier.id.length < 1 || modifier.id.length > 80) return false;
  switch (modifier.type) {
    case 'paint': return typeof modifier.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(modifier.color);
    case 'goggles': return typeof modifier.variant === 'string' && GOGGLE_VARIANTS.has(modifier.variant);
    case 'glasses':
    case 'belt': return typeof modifier.variant === 'string' && FOUR_WAY_VARIANTS.has(modifier.variant);
    case 'pendant': return modifier.variant === 'h' || modifier.variant === 'v';
    case 'pumpkin': return modifier.coverage === 25 || modifier.coverage === 50 || modifier.coverage === 75;
    case 'underwear': return true;
    default: return false;
  }
}

function isDifficulty(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function parseStoredLevel(json: string): LevelData | null {
  const value = parseJsonValue(json);
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || !isDifficulty(value.difficulty)
    || !isValidSlimeState(value.goalState)
    || !Array.isArray(value.palette)
    || !value.palette.every(isValidModifier)
    || !Number.isInteger(value.optimalSteps)
    || typeof value.optimalSteps !== 'number') {
    return null;
  }

  return {
    id: value.id,
    title: value.title,
    difficulty: value.difficulty,
    goalState: value.goalState,
    palette: value.palette,
    optimalSteps: value.optimalSteps,
    hint: typeof value.hint === 'string' ? value.hint : undefined,
    authorName: typeof value.authorName === 'string' ? value.authorName : undefined,
    isDaily: value.isDaily === true,
  };
}

// ── /api/init ────────────────────────────────────────────────
api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);

  try {
    const username = (await reddit.getCurrentUsername()) ?? '';
    if (username) {
      // Permanent player registry — lets mod tools (e.g. the full-reset menu
      // action) enumerate every player, not just those on a leaderboard.
      await redis.zAdd('users:all', { score: Date.now(), member: username });
    }
    const sparks   = username
      ? parseInt((await redis.get(`sparks:${username}`)) ?? '0', 10)
      : 0;
    const streakDays = username
      ? parseInt((await redis.hGet(`user:${username}`, 'daily:streak')) ?? '0', 10)
      : 0;

    return c.json<InitResponse>({
      type: 'init',
      postId,
      count: 0,
      username,
      isLoggedIn: username !== '',
      sparks,
      streakDays,
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
      const level = parseStoredLevel(levelJson);
      if (level) return c.json<DailyResponse>({ levelId, level, date: today });
    }
  }

  // Fall back to rotating curated levels by day-of-year
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
  );
  const fallback = CURATED_LEVELS[dayOfYear % CURATED_LEVELS.length] ?? CURATED_LEVELS[0];
  if (!fallback) return c.json<Err>({ status: 'error', message: 'No daily fallback available' }, 404);
  return c.json<DailyResponse>({ levelId: fallback.id, level: fallback, date: today });
});

// ── /api/levels/list ─────────────────────────────────────────
api.get('/levels/list', async (c) => {
  return c.json<LevelsListResponse>({ levels: CURATED_LEVELS });
});

// ── /api/level/:id ───────────────────────────────────────────
api.get('/level/:id', async (c) => {
  const id = c.req.param('id');

  // Check curated first
  const curated = CURATED_LEVELS.find(l => l.id === id);
  if (curated) return c.json<LevelResponse>({ level: curated });

  // Check Redis (UGC / daily generated)
  const json = await redis.get(`level:${id}`);
  if (json) {
    const level = parseStoredLevel(json);
    if (level) return c.json<LevelResponse>({ level });
  }

  return c.json<Err>({ status: 'error', message: 'Level not found' }, 404);
});

// ── /api/complete ────────────────────────────────────────────
api.post('/complete', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body = await readJsonBody<CompleteRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const { levelId, timeMs, actions } = body;
  if (typeof levelId !== 'string' || levelId.length < 1 || levelId.length > 120) {
    return c.json<Err>({ status: 'error', message: 'Invalid level id' }, 400);
  }
  if (!Array.isArray(actions) || actions.length < 1 || actions.length > 100
    || actions.some((action) => typeof action !== 'string' || action.length > 80)) {
    return c.json<Err>({ status: 'error', message: 'Invalid action sequence' }, 400);
  }
  if (!Number.isInteger(timeMs) || timeMs < 100 || timeMs > 86_400_000) {
    return c.json<Err>({ status: 'error', message: 'Invalid completion time' }, 400);
  }

  const level = await getLevel(levelId);
  if (!level) return c.json<Err>({ status: 'error', message: 'Level not found' }, 404);
  if (!isValidSolution(level, actions)) {
    return c.json<Err>({ status: 'error', message: 'Solution does not match the level' }, 400);
  }

  const steps = actions.length;
  const stars = calcStars(steps, level.optimalSteps);
  const userKey  = `user:${username}`;
  const isFirstCompletion = await redis.hSetNX(userKey, `done:${levelId}`, '1') === 1;

  if (isFirstCompletion) {
    await redis.zIncrBy('lb:global:solved', username, 1);
  }

  // Global leaderboards (Moves, Levels Played) — every completion counts, not
  // just first-time solves, since these track cumulative activity rather than
  // distinct levels solved. Scores are stored negated so an ascending zRange
  // (ties broken by member A-Z) yields "highest total first, alphabetical on
  // a tie" without a reversed-tiebreak zRevRange would give (see the read side
  // in GET /leaderboard/global for the corresponding un-negation).
  await redis.zIncrBy('lb:global:moves', username, -steps);
  await redis.zIncrBy('lb:global:played', username, -1);

  let streakDays: number | undefined;
  const dailyDate = dailyDateFromLevel(level);
  if (isFirstCompletion && dailyDate) {
    const previousDate = previousUtcDate(dailyDate);
    const lastDailyDate = await redis.hGet(userKey, 'daily:lastDate');
    const previousStreak = parseInt((await redis.hGet(userKey, 'daily:streak')) ?? '0', 10);

    streakDays = lastDailyDate === previousDate
      ? previousStreak + 1
      : 1;

    await redis.hSet(userKey, {
      'daily:lastDate': dailyDate,
      'daily:streak': String(streakDays),
    });
  }

  let sparksEarned = 0;
  if (isFirstCompletion) {
    const isFirstOverall = await redis.hSetNX('level:first-completer', levelId, username) === 1;
    sparksEarned = 10 + (stars === 3 ? 20 : 0) + (level.isDaily ? 15 : 0) + (isFirstOverall ? 30 : 0);
  }
  const sparksKey = `sparks:${username}`;
  const newSparks = sparksEarned > 0
    ? await redis.incrBy(sparksKey, sparksEarned)
    : parseInt((await redis.get(sparksKey)) ?? '0', 10);
  // Only need to touch the leaderboard when the balance actually changed —
  // if it didn't, this user's last sync (from an earlier completion or a
  // purchase) is still accurate.
  if (sparksEarned > 0) {
    await redis.zAdd('lb:global:sparks', { score: -newSparks, member: username });
  }

  // Persist best star rating for this level
  const prevStarsStr = await redis.hGet(userKey, `stars:${levelId}`);
  const prevStars    = prevStarsStr ? parseInt(prevStarsStr, 10) : 0;
  const bestStars    = Math.max(stars, prevStars) as Stars;

  await redis.hSet(userKey, {
    [`stars:${levelId}`]: String(bestStars),
  });

  return c.json<CompleteResponse>({ sparksEarned, newTotal: newSparks, stars, isFirstCompletion, streakDays });
});

// ── /api/leaderboard/global ───────────────────────────────────
// Three boards, selected by ?type=sparks|moves|played (sparks is the
// default). All three sorted sets store NEGATED scores (see the sync calls
// in /api/complete and /api/user/buy), so a plain ascending zRange already
// yields "highest total first" — and, critically, breaks ties by member
// ascending (A-Z). zRevRange (reverse: true) would instead reverse the WHOLE
// canonical order, including tied members, giving Z-A on a tie instead of
// the requested alphabetical order.
const GLOBAL_BOARD_KEYS = {
  sparks: 'lb:global:sparks',
  moves:  'lb:global:moves',
  played: 'lb:global:played',
} as const;

api.get('/leaderboard/global', async (c) => {
  const type     = c.req.query('type') ?? 'sparks';
  const lbKey    = GLOBAL_BOARD_KEYS[type as keyof typeof GLOBAL_BOARD_KEYS] ?? GLOBAL_BOARD_KEYS.sparks;
  const username = (await reddit.getCurrentUsername()) ?? '';

  const raw = await redis.zRange(lbKey, 0, 9, { by: 'rank' });

  const entries = raw.map((r, i) => ({
    rank:          i + 1,
    username:      r.member,
    score:         -r.score,
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

  const unlockedItems = parseStringArray(allFields['unlocked']);
  const equippedItems = parseStringRecord(allFields['equipped']);
  const streakDays = parseInt(allFields['daily:streak'] ?? '0', 10);

  return c.json<ProfileResponse>({
    username,
    sparks,
    unlockedItems,
    equippedItems,
    levelsCompleted: completedLevels.length,
    optimalSolves,
    streakDays,
    completedLevels,
    levelStars,
  });
});

// ── /api/user/equip ───────────────────────────────────────────
api.post('/user/equip', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body     = await readJsonBody<EquipRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const userKey  = `user:${username}`;
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const item = typeof body.itemId === 'string' ? getShopItem(body.itemId) : undefined;
  if (!item || body.slot !== item.slot) {
    return c.json<Err>({ status: 'error', message: 'Invalid item or slot' }, 400);
  }
  const unlocked = parseStringArray(allFields['unlocked']);
  // Free items (the default color) are owned by everyone without ever being
  // purchased — never persisted to `unlocked`.
  const ownsItem = item.price === 0 || unlocked.includes(item.id) || allFields[`owned:${item.id}`] === '1';
  if (!ownsItem) return c.json<Err>({ status: 'error', message: 'Item is not owned' }, 403);
  const equipped = parseStringRecord(allFields['equipped']);
  equipped[item.slot] = item.id;

  await redis.hSet(userKey, { equipped: JSON.stringify(equipped) });
  return c.json<EquipResponse>({ equippedItems: equipped });
});

// ── /api/user/buy ─────────────────────────────────────────────
api.post('/user/buy', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body    = await readJsonBody<BuyRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const userKey = `user:${username}`;
  const item = typeof body.itemId === 'string' ? getShopItem(body.itemId) : undefined;

  if (!item) return c.json<Err>({ status: 'error', message: 'Unknown item' }, 400);

  const sparksKey = `sparks:${username}`;
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const unlocked = parseStringArray(allFields['unlocked']);
  const sparks = parseInt((await redis.get(sparksKey)) ?? '0', 10);
  if (item.price === 0 || unlocked.includes(item.id) || allFields[`owned:${item.id}`] === '1') {
    return c.json<BuyResponse>({ sparks, unlockedItems: unlocked });
  }
  if (sparks < item.price) return c.json<Err>({ status: 'error', message: 'Insufficient Sparks' }, 402);

  const claimed = await redis.hSetNX(userKey, `owned:${item.id}`, '1');
  if (claimed !== 1) {
    return c.json<BuyResponse>({ sparks, unlockedItems: unlocked });
  }

  const newSparks = await redis.incrBy(sparksKey, -item.price);
  if (newSparks < 0) {
    await redis.incrBy(sparksKey, item.price);
    await redis.hDel(userKey, [`owned:${item.id}`]);
    return c.json<Err>({ status: 'error', message: 'Insufficient Sparks' }, 402);
  }

  unlocked.push(item.id);
  await redis.hSet(userKey, { unlocked: JSON.stringify(unlocked) });
  // Keep the Sparks leaderboard in sync with the post-purchase balance —
  // see the matching sync in /api/complete for why the score is negated.
  await redis.zAdd('lb:global:sparks', { score: -newSparks, member: username });

  return c.json<BuyResponse>({ sparks: newSparks, unlockedItems: unlocked });
});

// ── /api/level/create ─────────────────────────────────────────
api.post('/level/create', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Login required to create levels' }, 401);

  const body = await readJsonBody<LevelCreateRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const { title, difficulty, goalState, palette, optimalSteps, solution, hint } = body;

  if (typeof title !== 'string' || !title.trim() || title.length > 60) {
    return c.json<Err>({ status: 'error', message: 'Title must be 1 to 60 characters' }, 400);
  }
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    return c.json<Err>({ status: 'error', message: 'Difficulty must be between 1 and 5' }, 400);
  }
  if (!isValidSlimeState(goalState)) {
    return c.json<Err>({ status: 'error', message: 'Invalid goal slime' }, 400);
  }
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 20 || !palette.every(isValidModifier)) {
    return c.json<Err>({ status: 'error', message: 'Palette must contain 1 to 20 valid modifiers' }, 400);
  }
  const uniqueIds = new Set(palette.map((modifier) => modifier.id));
  if (uniqueIds.size !== palette.length) {
    return c.json<Err>({ status: 'error', message: 'Modifier ids must be unique' }, 400);
  }
  if (!Array.isArray(solution) || solution.length < 1 || solution.length > 50
    || solution.some((action) => typeof action !== 'string' || action.length > 80)
    || optimalSteps !== solution.length) {
    return c.json<Err>({ status: 'error', message: 'Invalid solution' }, 400);
  }
  if (hint !== undefined && (typeof hint !== 'string' || hint.length > 160)) {
    return c.json<Err>({ status: 'error', message: 'Hint is too long' }, 400);
  }

  const candidate: LevelData = {
    id: 'pending',
    title: title.trim(),
    difficulty,
    goalState,
    palette,
    optimalSteps,
    optimalSolution: solution,
    authorName: username,
    hint,
  };
  if (!isValidSolution(candidate, solution)) {
    return c.json<Err>({ status: 'error', message: 'The submitted solution does not reach the goal' }, 400);
  }
  if (!verifyLevelIntegrity(candidate)) {
    return c.json<Err>({ status: 'error', message: 'Level solution is not internally consistent' }, 400);
  }

  const levelId = `ugc-${username}-${Date.now()}`;
  const level: LevelData = {
    ...candidate,
    id: levelId,
  };

  await redis.set(`level:${levelId}`, JSON.stringify(level));
  await redis.expire(`level:${levelId}`, 60 * 60 * 24 * 90); // 90-day TTL

  // Track user's created levels
  const userKey = `user:${username}`;
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const created = parseStringArray(allFields['created'])
    .filter((id) => id !== levelId)
    .slice(-49);
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

  let postId: string | undefined;
  try {
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName ?? '',
      title: `Splot Level by u/${username}: ${level.title}`,
      entry: 'default',
      postData: { levelId },
      styles: {
        heightPixels: 512,
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });
    postId = post.id;
  } catch {
    // The level remains playable in community discovery if Reddit post creation is unavailable.
  }

  return c.json<LevelCreateResponse>({ levelId, postId });
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
        const level = parseStoredLevel(json);
        if (!level) return null;
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
