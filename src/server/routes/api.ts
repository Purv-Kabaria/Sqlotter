import { Hono } from 'hono';
import type { Context } from 'hono';
import { context, media, redis, reddit } from '@devvit/web/server';
import type {
  InitResponse,
  IncrementResponse,
  DecrementResponse,
  CompleteRequest,
  CompleteResponse,
  ShareCardRequest,
  ShareCardResponse,
  FirstSplatRequest,
  FirstSplatResponse,
  ShareFitResponse,
  FlairPrefRequest,
  FlairPrefResponse,
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
import type { LevelData, ModifierDef, ModifierType, Stars } from '../../shared/types';
import { generateDailyLevel, getCuratedLevels } from '../../shared/levelData';
import {
  isBreakableMask, maskIdOf, PAINT_COLORS_16, resolveActionDef, RESET_ACTION_ID,
} from '../../shared/slimeSim';
import { calcStars, isValidSolution, MAX_SOLUTION_STEPS, verifyLevelIntegrity } from '../../shared/gameRules';
import { getShopItem } from '../../shared/shop';
import { flairTierName, ROYAL_TIER_ITEM_ID } from '../../shared/flair';
import { clearUserFlair, syncUserFlair } from '../core/flair';
import { createDuelComment, recordDuelResult } from '../core/duel';
import { isPostId } from '../core/tid';

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
  const curated = getCuratedLevels().find((level) => level.id === levelId);
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
    // Fixed-geometry singles + the special mechanics (nose/alpha/bubble) carry
    // no variant/coverage to validate — a valid id + known type is enough.
    case 'underwear':
    case 'plate':
    case 'cone':
    case 'scarf':
    case 'nose':
    case 'alpha':
    case 'bubble': return true;
    default: return false;
  }
}

function isDifficulty(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseStoredLevel(json: string): LevelData | null {
  const value = parseJsonValue(json);
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || !isDifficulty(value.difficulty)
    || !Array.isArray(value.palette)
    || !value.palette.every(isValidModifier)
    || !isStringArray(value.optimalSolution)
    || value.optimalSolution.length < 1
    || !Number.isInteger(value.optimalSteps)
    || typeof value.optimalSteps !== 'number') {
    return null;
  }

  const level: LevelData = {
    id: value.id,
    title: value.title,
    difficulty: value.difficulty,
    palette: value.palette,
    optimalSteps: value.optimalSteps,
    optimalSolution: value.optimalSolution,
    hint: typeof value.hint === 'string' ? value.hint : undefined,
    authorName: typeof value.authorName === 'string' ? value.authorName : undefined,
    isDaily: value.isDaily === true,
  };
  // Levels stored before the stencil rework (goalState-based) fail this and
  // are treated as gone — their ids no longer describe playable puzzles.
  return verifyLevelIntegrity(level) ? level : null;
}

// Three global boards, all storing NEGATED scores (see the sync calls in
// /api/complete and /api/user/buy) so a plain ascending zRange yields
// "highest total first" with A-Z tiebreaks — full rationale at the
// /api/leaderboard/global handler below.
const GLOBAL_BOARD_KEYS = {
  sparks: 'lb:global:sparks',
  moves:  'lb:global:moves',
  played: 'lb:global:played',
} as const;

// Credits Sparks to a player other than the requester (creator royalties,
// contest prizes): balance, negated leaderboard score, and the lifetime tier
// counter move together — the same trio /api/complete maintains for the
// player's own awards.
async function creditSparks(username: string, amount: number): Promise<void> {
  const total = await redis.incrBy(`sparks:${username}`, amount);
  await redis.zAdd('lb:global:sparks', { score: -total, member: username });
  await redis.hIncrBy(`user:${username}`, 'sparks:lifetime', amount);
}

// Puts a player on all three global boards at 0 ("no activity yet") so every
// logged-in player has a leaderboard presence before their first completion.
// Devvit's zAdd has no NX flag, so a one-shot flag on the user hash skips the
// zScore round-trips on every visit after the first, and the zScore guards on
// that first pass keep pre-existing real scores from being clobbered.
async function seedGlobalBoards(username: string): Promise<void> {
  const firstSeed = (await redis.hSetNX(`user:${username}`, 'lb:seeded', '1')) === 1;
  if (!firstSeed) return;
  for (const lbKey of Object.values(GLOBAL_BOARD_KEYS)) {
    const existing = await redis.zScore(lbKey, username);
    if (existing === undefined) await redis.zAdd(lbKey, { score: 0, member: username });
  }
}

// ── /api/init ────────────────────────────────────────────────
api.get('/init', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);

  try {
    const username = (await reddit.getCurrentUsername()) ?? '';
    let sparks = 0;
    let streakDays = 0;
    let equippedItems: Record<string, string> = {};
    let flairEnabled = true;

    if (username) {
      // Registry write, board seeding, and the two profile reads are all
      // independent — run them in one parallel batch. init gates the game's
      // first interactive frame, so every sequential Redis round-trip here
      // was paid on every single open.
      const [, , sparksRaw, profileFields] = await Promise.all([
        // Permanent player registry — lets mod tools (e.g. the full-reset menu
        // action) enumerate every player, not just those on a leaderboard.
        redis.zAdd('users:all', { score: Date.now(), member: username }),
        seedGlobalBoards(username),
        redis.get(`sparks:${username}`),
        redis.hMGet(`user:${username}`, ['daily:streak', 'equipped', 'flair:optOut']),
      ]);
      const [streakRaw, equippedRaw, flairOptOut] = profileFields;
      sparks = parseInt(sparksRaw ?? '0', 10);
      streakDays = parseInt(streakRaw ?? '0', 10);
      equippedItems = parseStringRecord(equippedRaw ?? undefined);
      flairEnabled = flairOptOut !== '1';
    }

    return c.json<InitResponse>({
      type: 'init',
      postId,
      count: 0,
      username,
      isLoggedIn: username !== '',
      sparks,
      streakDays,
      equippedItems,
      flairEnabled,
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

  // The hourly cron hasn't stored today's level yet (fresh install, or the
  // window right after UTC midnight). The generator is date-seeded and
  // deterministic, so generating here yields the IDENTICAL level the cron
  // would — store it exactly like the scheduler does and serve it. Without
  // this, early players got a curated stand-in that wasn't `isDaily`: no
  // streak credit, no daily bonus, and "the daily" silently swapped to the
  // real one an hour later.
  try {
    const level = generateDailyLevel(today);
    await redis.set(`level:${level.id}`, JSON.stringify(level));
    await redis.set(`daily:${today}`, level.id);
    await redis.expire(`level:${level.id}`, 60 * 60 * 24 * 30);
    await redis.expire(`daily:${today}`, 60 * 60 * 24 * 30);
    return c.json<DailyResponse>({ levelId: level.id, level, date: today });
  } catch {
    // Last resort: rotate curated levels by day-of-year (no streak credit,
    // but the button always leads to a puzzle).
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000,
    );
    const curated = getCuratedLevels();
    const fallback = curated[dayOfYear % curated.length] ?? curated[0];
    if (!fallback) return c.json<Err>({ status: 'error', message: 'No daily fallback available' }, 404);
    return c.json<DailyResponse>({ levelId: fallback.id, level: fallback, date: today });
  }
});

// ── /api/levels/list ─────────────────────────────────────────
api.get('/levels/list', async (c) => {
  return c.json<LevelsListResponse>({ levels: getCuratedLevels() });
});

// ── /api/level/:id ───────────────────────────────────────────
api.get('/level/:id', async (c) => {
  const id = c.req.param('id');

  // Check curated first
  const curated = getCuratedLevels().find(l => l.id === id);
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
    const lastDailyDate = await redis.hGet(userKey, 'daily:lastDate');
    const previousStreak = parseInt((await redis.hGet(userKey, 'daily:streak')) ?? '0', 10);

    // Only a daily at least as recent as the last one counts toward the streak.
    // Back-filling an OLD daily (an earlier post solved late) must NOT reset the
    // streak or rewind daily:lastDate — otherwise catching up on a past puzzle
    // would silently break an active streak. Dates are 'YYYY-MM-DD', so a lexical
    // compare is chronological.
    if (!lastDailyDate || dailyDate > lastDailyDate) {
      streakDays = lastDailyDate === previousUtcDate(dailyDate)
        ? previousStreak + 1
        : 1;
      await redis.hSet(userKey, {
        'daily:lastDate': dailyDate,
        'daily:streak': String(streakDays),
      });
    } else {
      // Old back-fill (or a same-date replay slipping past the first-completion
      // guard): report the streak unchanged, don't mutate it.
      streakDays = previousStreak;
    }
  }

  let sparksEarned = 0;
  let isFirstOverall = false;
  if (isFirstCompletion) {
    isFirstOverall = await redis.hSetNX('level:first-completer', levelId, username) === 1;
    sparksEarned = 10 + (stars === 3 ? 20 : 0) + (level.isDaily ? 15 : 0) + (isFirstOverall ? 30 : 0);
    // The crown comment cites the first solve's stats (steps are replay-
    // verified above; time is client-claimed but bounded by validation).
    // Crown-eligible levels only — see the firstSplat gate below.
    if (isFirstOverall && level.isDaily) {
      await redis.hSet('level:first-stats', { [levelId]: `${steps}|${timeMs}` });
    }
  }

  // First Splat Crown: offer the claimable trophy to the level's first-ever
  // solver. DAILY levels only — curated levels all resolve to the same main
  // post (160 crown comments would flood it), and on UGC levels the crown
  // stepped on the duel: the "first splat" there is just the first challenger,
  // already celebrated on the duel scoreboard. Replays keep re-offering until
  // the crown comment is actually posted (see /api/share/first-splat).
  let firstSplat = false;
  if (level.isDaily) {
    const holder = isFirstOverall ? username : await redis.hGet('level:first-completer', levelId);
    if (holder === username) {
      firstSplat = (await redis.hGet('level:crowned', levelId)) === undefined;
    }
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
    // Lifetime Sparks never go down (purchases don't touch them) — this is
    // what the Splotter Flair tier ladder ranks on.
    await redis.hIncrBy(userKey, 'sparks:lifetime', sparksEarned);
  }

  // Persist best star rating for this level
  const prevStarsStr = await redis.hGet(userKey, `stars:${levelId}`);
  const prevStars    = prevStarsStr ? parseInt(prevStarsStr, 10) : 0;
  const bestStars    = Math.max(stars, prevStars) as Stars;

  await redis.hSet(userKey, {
    [`stars:${levelId}`]: String(bestStars),
  });

  // Beat the Creator: bump this UGC level's duel counters and, on milestones,
  // refresh the scoreboard comment on its post. Best-effort inside.
  if (levelId.startsWith('ugc-')) {
    await recordDuelResult(level, username, steps, timeMs);

    // Creator royalty (see the Sparks economy): every 10th DISTINCT player to
    // clear a community level earns its creator +5 passive Sparks. Counting
    // first completions only means replaying can't farm it, and the creator's
    // own clear can at most contribute one play.
    if (isFirstCompletion && level.authorName && level.authorName !== username) {
      const plays = await redis.hIncrBy('ugc:plays', levelId, 1);
      if (plays % 10 === 0) {
        await creditSparks(level.authorName, 5);
        // Lifetime Sparks feed the flair tier ladder — refresh the creator's
        // flair too (self-throttling + best-effort inside).
        await syncUserFlair(level.authorName);
      }
    }
  }

  // Splotter Flair: self-throttling (only writes to Reddit when the flair
  // line actually changed) and best-effort inside — safe on every completion.
  await syncUserFlair(username);

  return c.json<CompleteResponse>({ sparksEarned, newTotal: newSparks, stars, isFirstCompletion, streakDays, firstSplat });
});

// Shared by both share endpoints below — the client posts a PNG data URI
// snapshot of an in-game card (Splat Card or First Splat Crown); this is the
// one validation both routes need before handing it to media.upload().
const CARD_IMAGE_PREFIX = 'data:image/png;base64,';
// 'iVBORw0KGgo' is the base64 form of the 8-byte PNG signature — any real
// PNG data URI starts exactly this way.
const CARD_PNG_SIGNATURE = `${CARD_IMAGE_PREFIX}iVBORw0KGgo`;
// ~1.5M base64 chars ≈ 1.1 MB PNG — far above any plausible card snapshot.
const CARD_IMAGE_MAX_CHARS = 1_500_000;

// ── /api/share/card ───────────────────────────────────────────
// One-tap "Splat Card": posts a spoiler-tagged result comment (with an
// in-game rendered card image, when the client supplies one) on the post the
// player is playing in. Strictly user-triggered (never automatic), once per
// level per user plus a short cooldown, and always posted by the app account
// crediting the player — never impersonating them.
const MOD_EMOJI: Record<ModifierType, string> = {
  paint: '🎨',
  goggles: '🥽',
  glasses: '👓',
  belt: '🧷',
  pendant: '📿',
  pumpkin: '🎃',
  underwear: '🩲',
  plate: '🍽️',
  cone: '🍦',
  scarf: '🧣',
  nose: '👃',
  alpha: '🌫️',
  bubble: '🫧',
};

const MOD_NAME: Record<Exclude<ModifierType, 'paint'>, string> = {
  goggles: 'Goggles',
  glasses: 'Glasses',
  belt: 'Belt',
  pendant: 'Pendant',
  pumpkin: 'Pumpkin',
  underwear: 'Undies',
  plate: 'Plate',
  cone: 'Cone',
  scarf: 'Scarf',
  nose: 'Nose',
  alpha: 'Alpha dip',
  bubble: 'Bubble',
};

function formatCardTime(timeMs: number): string {
  const secs = Math.floor(timeMs / 1000);
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

// The level's paint rack as emoji squares — the card's feed-visible identity,
// like Wordle's grid. Spoiler-safe: the rack is on the color picker for anyone
// who opens the level (and may include decoys), so it reveals nothing about
// the solution.
const COLOR_SQUARE: Record<string, string> = {
  '#FF4136': '🟥', '#FF851B': '🟧', '#FFDC00': '🟨',
  '#2ECC40': '🟩', '#01FF70': '🟩', '#3D9970': '🟩',
  '#39CCCC': '🟦', '#7FDBFF': '🟦', '#0074D9': '🟦', '#003AB4': '🟦',
  '#B10DC9': '🟪', '#F012BE': '🟪', '#FF69B4': '🟪', '#85144B': '🟫',
  '#AAAAAA': '⬜', '#111111': '⬛',
};

function paletteStrip(palette: readonly ModifierDef[]): string {
  const squares = new Set<string>();
  for (const mod of palette) {
    if (mod.type !== 'paint') continue;
    const square = COLOR_SQUARE[(mod.color ?? '').toUpperCase()];
    if (square) squares.add(square);
  }
  return [...squares].join('');
}

function colorNameOf(hex: string | undefined): string {
  const upper = (hex ?? '').toUpperCase();
  return PAINT_COLORS_16.find((c) => c.hex === upper)?.name ?? (hex ?? 'White');
}

// The spelled-out recipe: every move by name, in order. Wear/remove state is
// tracked so stencil taps read "on"/"off", and a splash that lands on goggles
// gets the 💥 (they break and pop off without their own action).
function describeMoves(palette: readonly ModifierDef[], actions: readonly string[]): string {
  const worn = new Set<string>();
  const parts: string[] = [];
  for (const id of actions) {
    if (id === RESET_ACTION_ID) {
      worn.clear();
      parts.push('🔄 Reset');
      continue;
    }
    const mod = resolveActionDef(palette, id);
    if (!mod) continue;
    if (mod.type === 'paint') {
      const burst = [...worn].some(isBreakableMask) ? ' 💥' : '';
      for (const wornId of [...worn]) if (isBreakableMask(wornId)) worn.delete(wornId);
      parts.push(`${MOD_EMOJI.paint} ${colorNameOf(mod.color)} splash${burst}`);
      continue;
    }
    // The alpha dip and the bubble are one-shot splashes, not worn toggles.
    // The alpha dip is a paint splash, so it also pops any worn goggles.
    if (mod.type === 'alpha' || mod.type === 'bubble') {
      const burst = mod.type === 'alpha' && [...worn].some(isBreakableMask) ? ' 💥' : '';
      if (mod.type === 'alpha') for (const wornId of [...worn]) if (isBreakableMask(wornId)) worn.delete(wornId);
      parts.push(`${MOD_EMOJI[mod.type]} ${MOD_NAME[mod.type]}${burst}`);
      continue;
    }
    const maskId = maskIdOf(mod) ?? mod.id;
    const name = mod.type === 'pumpkin' ? `Pumpkin ${mod.coverage ?? 50}%` : MOD_NAME[mod.type];
    if (worn.has(maskId)) {
      worn.delete(maskId);
      parts.push(`${MOD_EMOJI[mod.type]} ${name} off`);
    } else {
      worn.add(maskId);
      parts.push(`${MOD_EMOJI[mod.type]} ${name} on`);
    }
  }
  return parts.join(' → ');
}

// User text onto Reddit markdown: keep it one line, strip the spoiler-tag
// delimiters it would otherwise escape from, and cap the length.
function sanitizeCardTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(/>!|!</g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

api.post('/share/card', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body = await readJsonBody<ShareCardRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const { levelId, timeMs, actions, imageDataUrl } = body;
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
  if (imageDataUrl !== undefined
    && (typeof imageDataUrl !== 'string'
      || !imageDataUrl.startsWith(CARD_PNG_SIGNATURE)
      || imageDataUrl.length > CARD_IMAGE_MAX_CHARS)) {
    return c.json<Err>({ status: 'error', message: 'Invalid card image' }, 400);
  }

  const level = await getLevel(levelId);
  if (!level) return c.json<Err>({ status: 'error', message: 'Level not found' }, 404);
  // Same replay check as /api/complete — a card can only describe a real solve.
  if (!isValidSolution(level, actions)) {
    return c.json<Err>({ status: 'error', message: 'Solution does not match the level' }, 400);
  }

  // Anti-spam: a short global per-user cooldown, and one card per level per user.
  const cooldownKey = `carded:cooldown:${username}`;
  if (await redis.get(cooldownKey)) {
    return c.json<Err>({ status: 'error', message: 'Sharing too fast, wait a moment' }, 429);
  }
  const claimed = await redis.hSetNX(`carded:${levelId}`, username, '1');
  if (claimed !== 1) {
    return c.json<Err>({ status: 'error', message: 'Card already posted for this level' }, 409);
  }
  await redis.set(cooldownKey, '1');
  await redis.expire(cooldownKey, 20);

  const steps = actions.length;
  const stars = calcStars(steps, level.optimalSteps);
  const recipe = describeMoves(level.palette, actions);
  const caption = sanitizeCardTitle(body.cardTitle);

  let streakLine = '';
  if (level.isDaily) {
    const streak = parseInt((await redis.hGet(`user:${username}`, 'daily:streak')) ?? '0', 10);
    if (streak > 1) streakLine = ` · 🔥 ${streak}-day streak`;
  }

  // UGC titles are user text — keep them to a single markdown line.
  const safeTitle = level.title.replace(/[\r\n]+/g, ' ').trim();
  // Star-tiered voice: a flawless card reads like a flex, a scrappy one like
  // a war story. Identical cards are wallpaper, and wallpaper gets scrolled
  // past instead of replied to.
  const par = level.optimalSteps;
  const headline = stars === 3
    ? `🏆 **FLAWLESS SPLAT: u/${username} painted “${safeTitle}” move-perfect!**`
    : stars === 2
      ? `🎯 **u/${username} splatted “${safeTitle}”!**`
      : `🫠 **u/${username} wrestled “${safeTitle}” into submission!**`;
  const strip = paletteStrip(level.palette);
  const statsLine = [
    ...(strip ? [strip] : []),
    '⭐'.repeat(stars),
    `${steps}/${par} moves`,
    formatCardTime(timeMs),
  ].join(' · ') + streakLine;
  const footer = stars === 3
    ? '^(Splat Card: that recipe can\'t be beaten, only matched. Play this post and prove you can.)'
    : `^(Splat Card: par is ${par}. Play this post and out-splat this card.)`;
  const text = [
    headline,
    ...(caption ? [`💬 *“${caption}”*`] : []),
    statsLine,
    `Recipe: >!${recipe}!<`,
    footer,
  ].join('\n\n');

  try {
    let postedWithImage = false;
    if (imageDataUrl) {
      try {
        const asset = await media.upload({ url: imageDataUrl, type: 'image' });
        // Same richtext document shape as /api/share/first-splat below, plus
        // the caption/stats/footer lines the plain-text card also carries —
        // the recipe stays wrapped in a real spoilertext node so the image
        // path doesn't leak the solution any more than the text path does.
        await reddit.submitComment({
          id: postId,
          richtext: {
            document: [
              { e: 'img', mediaUrl: asset.mediaUrl, c: headline },
              ...(caption ? [{ e: 'par', c: [{ e: 'text', t: `💬 “${caption}”` }] }] : []),
              { e: 'par', c: [{ e: 'text', t: statsLine }] },
              { e: 'par', c: [
                { e: 'text', t: 'Recipe: ' },
                { e: 'spoilertext', c: [{ e: 'text', t: recipe }] },
              ] },
              { e: 'par', c: [{ e: 'text', t: footer }] },
            ],
          },
        });
        postedWithImage = true;
      } catch {
        // Upload or richtext rejected — degrade to the text-only card below.
      }
    }
    if (!postedWithImage) {
      await reddit.submitComment({ id: postId, text });
    }
  } catch {
    // Hand the card back so the player can retry after a transient failure.
    await redis.hDel(`carded:${levelId}`, [username]);
    return c.json<Err>({ status: 'error', message: 'Reddit did not accept the comment' }, 502);
  }

  return c.json<ShareCardResponse>({ posted: true });
});

// ── /api/share/first-splat ────────────────────────────────────
// First Splat Crown: the first-ever solver of a DAILY level claims a
// one-time trophy comment — the in-game rendered card (Splot wearing the
// crown) uploaded through the media plugin and embedded as a richtext image.
// The claimant is verified against the level:first-completer record written
// by /api/complete, so the endpoint never trusts the client's claim, and the
// comment is posted by the app account crediting the player. Falls back to a
// text-only crown when the image is missing or Reddit rejects the upload.
api.post('/share/first-splat', async (c) => {
  const { postId } = context;
  if (!postId) return c.json<Err>({ status: 'error', message: 'postId missing' }, 400);
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body = await readJsonBody<FirstSplatRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const { levelId, imageDataUrl } = body;
  if (typeof levelId !== 'string' || levelId.length < 1 || levelId.length > 120) {
    return c.json<Err>({ status: 'error', message: 'Invalid level id' }, 400);
  }
  if (imageDataUrl !== undefined
    && (typeof imageDataUrl !== 'string'
      || !imageDataUrl.startsWith(CARD_PNG_SIGNATURE)
      || imageDataUrl.length > CARD_IMAGE_MAX_CHARS)) {
    return c.json<Err>({ status: 'error', message: 'Invalid card image' }, 400);
  }

  const level = await getLevel(levelId);
  if (!level) return c.json<Err>({ status: 'error', message: 'Level not found' }, 404);
  // Crowns are a daily-puzzle ritual only (UGC firsts belong to the duel).
  if (!level.isDaily) {
    return c.json<Err>({ status: 'error', message: 'This level has no crown' }, 400);
  }

  // Only the recorded first solver may claim — written by /api/complete.
  const holder = await redis.hGet('level:first-completer', levelId);
  if (holder !== username) {
    return c.json<Err>({ status: 'error', message: 'The crown belongs to the first solver' }, 403);
  }

  // Anti-spam: a short per-user cooldown (separate from the Splat Card's, so
  // posting a card then claiming a crown seconds later still works), and one
  // crown comment per level, ever.
  const cooldownKey = `crown:cooldown:${username}`;
  if (await redis.get(cooldownKey)) {
    return c.json<Err>({ status: 'error', message: 'Sharing too fast, wait a moment' }, 429);
  }
  const claimed = await redis.hSetNX('level:crowned', levelId, username);
  if (claimed !== 1) {
    return c.json<Err>({ status: 'error', message: 'Crown already claimed' }, 409);
  }
  await redis.set(cooldownKey, '1');
  await redis.expire(cooldownKey, 20);

  // UGC titles are user text — keep them to a single line.
  const safeTitle = level.title.replace(/[\r\n]+/g, ' ').trim();
  // Cite the first solve's verified stats when /api/complete recorded them
  // (accounts that solved before the field existed just get the plain line).
  const [fsSteps, fsTimeMs] = ((await redis.hGet('level:first-stats', levelId)) ?? '')
    .split('|').map((n) => parseInt(n, 10));
  const statsBit = fsSteps && fsTimeMs
    ? ` (${fsSteps} ${fsSteps === 1 ? 'move' : 'moves'}, ${formatCardTime(fsTimeMs)}, before anyone else on Reddit)`
    : '';
  const headline = `👑 FIRST SPLAT! u/${username} drew first paint on "${safeTitle}"${statsBit}.`;
  const footer = 'This crown is claimed forever, but the leaderboard isn\'t. Play this post and take the top spot.';

  try {
    let postedWithImage = false;
    if (imageDataUrl) {
      try {
        const asset = await media.upload({ url: imageDataUrl, type: 'image' });
        // Plain richtext document object (submitComment accepts it directly) —
        // element shapes match what @devvit/shared-types' RichTextBuilder emits.
        await reddit.submitComment({
          id: postId,
          richtext: {
            document: [
              { e: 'img', mediaUrl: asset.mediaUrl, c: headline },
              { e: 'par', c: [{ e: 'text', t: footer }] },
            ],
          },
        });
        postedWithImage = true;
      } catch {
        // Upload or richtext rejected — degrade to the text-only crown below.
      }
    }
    if (!postedWithImage) {
      await reddit.submitComment({ id: postId, text: `**${headline}**\n\n${footer}` });
    }
  } catch {
    // Hand the crown back so the player can retry after a transient failure.
    await redis.hDel('level:crowned', [levelId]);
    return c.json<Err>({ status: 'error', message: 'Reddit did not accept the comment' }, 502);
  }

  return c.json<FirstSplatResponse>({ posted: true });
});

// ── /api/share/fit ────────────────────────────────────────────
// Fit Check Friday: posts the player's current Splot loadout as a comment on
// the live weekly Fit Check thread (created by the fitcheck-post scheduler
// task, closed by fitcheck-award). One fit per player per thread; the
// comment→player mapping is stored so the award task can find the winner.
function describeFit(equipped: Record<string, string>): string {
  const labelOf = (slot: string): string | undefined => {
    const itemId = equipped[slot];
    return itemId ? getShopItem(itemId)?.label : undefined;
  };
  const colorLabel = labelOf('color');
  const parts = [
    // Shop labels carry their own noun ("Cute Eyes", "Party Hat") — only the
    // color needs one. 'Default' is the free starter tint's shop label.
    `${!colorLabel || colorLabel === 'Default' ? 'Splot-green' : colorLabel} body`,
    labelOf('eye') ?? 'Normal Eyes',
    labelOf('mouth') ?? 'Happy Mouth',
    labelOf('eyebrow') ?? 'Normal Brows',
  ];
  const accessory = labelOf('accessory');
  if (accessory) parts.push(accessory);
  return parts.join(' · ');
}

api.post('/share/fit', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const fitPostId = (await redis.get('fitcheck:current')) ?? '';
  if (!fitPostId || !isPostId(fitPostId)) {
    return c.json<Err>({ status: 'error', message: 'No Fit Check thread is live right now' }, 404);
  }

  // Anti-spam: a short per-user cooldown plus one fit per player per thread.
  const cooldownKey = `fit:cooldown:${username}`;
  if (await redis.get(cooldownKey)) {
    return c.json<Err>({ status: 'error', message: 'Sharing too fast, wait a moment' }, 429);
  }
  const claimed = await redis.hSetNX(`fitcheck:carded:${fitPostId}`, username, '1');
  if (claimed !== 1) {
    return c.json<Err>({ status: 'error', message: 'Fit already posted this week' }, 409);
  }
  await redis.set(cooldownKey, '1');
  await redis.expire(cooldownKey, 20);

  const userKey = `user:${username}`;
  const allFields: Record<string, string> = (await redis.hGetAll(userKey)) ?? {};
  const equipped = parseStringRecord(allFields['equipped']);
  const streak = parseInt(allFields['daily:streak'] ?? '0', 10);
  let solved = 0;
  for (const field of Object.keys(allFields)) {
    if (field.startsWith('done:')) solved++;
  }

  // Lead the stats with the player's flair tier — the fit thread is where
  // the Sparks economy gets to be socially visible, so say the rank out loud.
  const lifetime = Math.max(parseInt(allFields['sparks:lifetime'] ?? '0', 10) || 0, 0);
  const tier = flairTierName(lifetime, allFields[`owned:${ROYAL_TIER_ITEM_ID}`] === '1');
  const statsBits = [tier, `${solved} ${solved === 1 ? 'level' : 'levels'} solved`];
  if (streak > 1) statsBits.push(`🔥 ${streak}-day streak`);
  const text = [
    `📸 **u/${username}'s Splot walked in wearing:** ${describeFit(equipped)}`,
    `^(${statsBits.join(' · ')}. Upvote the drip! Top fit takes 500 Sparks and the crown on Sunday.)`,
  ].join('\n\n');

  let commentId: string;
  try {
    const comment = await reddit.submitComment({ id: fitPostId, text });
    commentId = comment.id;
  } catch {
    // Hand the entry back so the player can retry after a transient failure.
    await redis.hDel(`fitcheck:carded:${fitPostId}`, [username]);
    return c.json<Err>({ status: 'error', message: 'Reddit did not accept the comment' }, 502);
  }

  // comment → player mapping for the award task's top-comment lookup. Both
  // fit hashes outlive the thread by well over the award delay, then expire.
  const entriesKey = `fitcheck:comments:${fitPostId}`;
  await redis.hSet(entriesKey, { [commentId]: username });
  await redis.expire(entriesKey, 60 * 60 * 24 * 30);
  await redis.expire(`fitcheck:carded:${fitPostId}`, 60 * 60 * 24 * 30);

  return c.json<ShareFitResponse>({ posted: true });
});

// ── /api/leaderboard/global ───────────────────────────────────
// Three boards, selected by ?type=sparks|moves|played (sparks is the
// default). All three sorted sets store NEGATED scores (see the sync calls
// in /api/complete and /api/user/buy), so a plain ascending zRange already
// yields "highest total first" — and, critically, breaks ties by member
// ascending (A-Z). zRevRange (reverse: true) would instead reverse the WHOLE
// canonical order, including tied members, giving Z-A on a tie instead of
// the requested alphabetical order.
const MAX_BOARD_ROWS = 100;

async function zRangeAll(key: string): Promise<{ member: string; score: number }[]> {
  const count = await redis.zCard(key);
  if (count < 1) return [];
  return redis.zRange(key, 0, count - 1, { by: 'rank' });
}

api.get('/leaderboard/global', async (c) => {
  const type     = c.req.query('type') ?? 'sparks';
  const lbKey    = GLOBAL_BOARD_KEYS[type as keyof typeof GLOBAL_BOARD_KEYS] ?? GLOBAL_BOARD_KEYS.sparks;
  const username = (await reddit.getCurrentUsername()) ?? '';

  // Every player who has ever logged in belongs on the board. Init seeds new
  // players (see seedGlobalBoards), so the board can only be missing players
  // registered before seeding existed — and since every board member is a
  // registered player, board ⊆ registry: a bare COUNT comparison detects the
  // gap. The full-set reads (previously paid on EVERY request) now run only
  // on that one-time backfill pass.
  const [boardCount, registryCount] = await Promise.all([
    redis.zCard(lbKey),
    redis.zCard('users:all'),
  ]);
  if (registryCount > boardCount) {
    const [board, registry] = await Promise.all([zRangeAll(lbKey), zRangeAll('users:all')]);
    const onBoard = new Set(board.map((r) => r.member));
    const missing = registry.filter((r) => !onBoard.has(r.member)).map((r) => r.member);
    if (missing.length > 0) {
      await redis.zAdd(lbKey, ...missing.map((member) => ({ score: 0, member })));
    }
  }

  // Top rows + the requester's own placement — three cheap reads instead of
  // the whole sorted set. Scores are negated (see GLOBAL_BOARD_KEYS), so the
  // ascending canonical order IS the display order and zRank IS the rank.
  const [top, selfRank, selfScore] = await Promise.all([
    redis.zRange(lbKey, 0, MAX_BOARD_ROWS - 1, { by: 'rank' }),
    username ? redis.zRank(lbKey, username) : Promise.resolve(undefined),
    username ? redis.zScore(lbKey, username) : Promise.resolve(undefined),
  ]);

  const entries = top.map((r, i) => ({
    rank:          i + 1,
    username:      r.member,
    score:         -r.score,
    isCurrentUser: r.member === username,
  }));

  // The player should always find themselves — if they rank below the row
  // cap, append their own row (with true rank) as the final entry.
  if (username && !entries.some((entry) => entry.isCurrentUser)
    && selfRank !== undefined && selfScore !== undefined) {
    entries.push({ rank: selfRank + 1, username, score: -selfScore, isCurrentUser: true });
  }

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
      flairEnabled: true,
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
    flairEnabled: allFields['flair:optOut'] !== '1',
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
  // The flair pill's background mirrors the equipped Splot color — re-sync
  // immediately so switching colors doesn't wait for the next level clear.
  if (item.slot === 'color') await syncUserFlair(username);
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

  // The Golden Crown is the only purchase that changes the flair line —
  // it promotes the owner straight to the Royal Slime tier.
  if (item.id === ROYAL_TIER_ITEM_ID) {
    await syncUserFlair(username);
  }

  return c.json<BuyResponse>({ sparks: newSparks, unlockedItems: unlocked });
});

// ── /api/user/flair ───────────────────────────────────────────
// Splotter Flair opt-in/out. Enabling re-syncs immediately; disabling clears
// the app-managed flair so opted-out players aren't left wearing stale stats.
api.post('/user/flair', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Not logged in' }, 401);

  const body = await readJsonBody<FlairPrefRequest>(c);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  }

  const userKey = `user:${username}`;
  if (body.enabled) {
    await redis.hSet(userKey, { 'flair:optOut': '0' });
    await syncUserFlair(username);
  } else {
    await redis.hSet(userKey, { 'flair:optOut': '1' });
    await clearUserFlair(username);
  }

  return c.json<FlairPrefResponse>({ enabled: body.enabled });
});

// ── /api/level/create ─────────────────────────────────────────
api.post('/level/create', async (c) => {
  const username = (await reddit.getCurrentUsername()) ?? '';
  if (!username) return c.json<Err>({ status: 'error', message: 'Login required to create levels' }, 401);

  const body = await readJsonBody<LevelCreateRequest>(c);
  if (!body) return c.json<Err>({ status: 'error', message: 'Invalid JSON body' }, 400);
  const { title, difficulty, palette, optimalSteps, solution, hint } = body;

  if (typeof title !== 'string' || !title.trim() || title.length > 60) {
    return c.json<Err>({ status: 'error', message: 'Title must be 1 to 60 characters' }, 400);
  }
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
    return c.json<Err>({ status: 'error', message: 'Difficulty must be between 1 and 5' }, 400);
  }
  if (!Array.isArray(palette) || palette.length < 1 || palette.length > 20 || !palette.every(isValidModifier)) {
    return c.json<Err>({ status: 'error', message: 'Palette must contain 1 to 20 valid modifiers' }, 400);
  }
  const uniqueIds = new Set(palette.map((modifier) => modifier.id));
  if (uniqueIds.size !== palette.length) {
    return c.json<Err>({ status: 'error', message: 'Modifier ids must be unique' }, 400);
  }
  // The cap is the solvability guarantee: whatever a player faces, the
  // creator has proven it beatable in at most MAX_SOLUTION_STEPS moves.
  if (!Array.isArray(solution) || solution.length < 1 || solution.length > MAX_SOLUTION_STEPS
    || solution.some((action) => typeof action !== 'string' || action.length > 80)
    || optimalSteps !== solution.length) {
    return c.json<Err>({ status: 'error', message: `Levels must be solvable in 1-${MAX_SOLUTION_STEPS} moves` }, 400);
  }
  if (hint !== undefined && (typeof hint !== 'string' || hint.length > 160)) {
    return c.json<Err>({ status: 'error', message: 'Hint is too long' }, 400);
  }

  const candidate: LevelData = {
    id: 'pending',
    title: title.trim(),
    difficulty,
    palette,
    optimalSteps,
    optimalSolution: solution,
    authorName: username,
    hint,
  };
  // The solution IS the goal: it must replay cleanly (all ids resolve, ends
  // with every stencil off) and actually paint something.
  if (!verifyLevelIntegrity(candidate) || !isValidSolution(candidate, solution)) {
    return c.json<Err>({ status: 'error', message: 'The recorded solution is not a valid goal (finish bare, with paint on Splot)' }, 400);
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

  // Add to global community index (sorted by creation time) and the search
  // registry (levelId → "title␁author" — one hGetAll serves any title/author
  // search without fetching hundreds of level JSONs).
  const now = Date.now();
  await redis.zAdd('ugc:index', { score: now, member: levelId });
  await redis.hSet('ugc:titles', { [levelId]: `${level.title}\u0001${username}` });
  // Keep index at max 500 entries — remove oldest (and their search entries)
  // if exceeded.
  const count = await redis.zCard('ugc:index');
  if (count > 500) {
    const oldest = await redis.zRange('ugc:index', 0, count - 501, { by: 'rank' });
    if (oldest.length > 0) {
      await redis.hDel('ugc:titles', oldest.map((r) => r.member));
    }
    await redis.zRemRangeByRank('ugc:index', 0, count - 501);
  }

  let postId: string | undefined;
  try {
    // Beat the Creator: the post title is a challenge, not an announcement,
    // and the post carries an app-maintained duel scoreboard comment.
    const moves = `${level.optimalSteps} ${level.optimalSteps === 1 ? 'move' : 'moves'}`;
    const post = await reddit.submitCustomPost({
      subredditName: context.subredditName ?? '',
      title: `⚔️ u/${username} built “${level.title}” in ${moves}. Beat that.`,
      entry: 'default',
      postData: { levelId },
      styles: {
        heightPixels: 512,
        backgroundColor: '#1a0a2eff',
        backgroundColorDark: '#1a0a2eff',
      },
    });
    postId = post.id;
    await createDuelComment(level, post.id);
  } catch {
    // The level remains playable in community discovery if Reddit post creation is unavailable.
  }

  return c.json<LevelCreateResponse>({ levelId, postId });
});

// ── /api/levels/community ─────────────────────────────────────
// Newest-first community levels, optionally filtered by ?q= — a
// case-insensitive substring match on title OR creator name, answered from
// the ugc:titles registry (one hGetAll) instead of fetching level JSONs.
api.get('/levels/community', async (c) => {
  const limitStr = c.req.query('limit') ?? '20';
  const limit = Math.min(parseInt(limitStr, 10) || 20, 50);
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);

  const total = await redis.zCard('ugc:index');
  if (total === 0) return c.json<CommunityLevelsResponse>({ levels: [] });
  const raw = await redis.zRange('ugc:index', 0, total - 1, { by: 'rank', reverse: true });
  let ids = raw.map((r) => r.member);

  // Which of the page's ids already have a search-registry entry — so the
  // backfill below only writes the missing ones, instead of re-writing every
  // entry on every list request (an awaited Redis write per level per view).
  let inRegistry: Set<string>;
  if (q) {
    const registry: Record<string, string> = (await redis.hGetAll('ugc:titles')) ?? {};
    ids = ids.filter((id) => (registry[id] ?? '').toLowerCase().includes(q)).slice(0, limit);
    inRegistry = new Set(ids.filter((id) => registry[id] !== undefined));
  } else {
    ids = ids.slice(0, limit);
    const values = ids.length > 0 ? await redis.hMGet('ugc:titles', ids) : [];
    inRegistry = new Set(ids.filter((_, i) => typeof values[i] === 'string'));
  }

  const levels = (
    await Promise.all(
      ids.map(async (id) => {
        const json = await redis.get(`level:${id}`);
        if (!json) {
          // Level hit its 90-day TTL — drop it from both indexes so it stops
          // appearing in (and slowing down) future lists and searches.
          await redis.zRem('ugc:index', [id]);
          await redis.hDel('ugc:titles', [id]);
          return null;
        }
        const level = parseStoredLevel(json);
        if (!level) return null;
        if (!inRegistry.has(id)) {
          // Backfill the search registry for levels created before it existed.
          await redis.hSet('ugc:titles', { [id]: `${level.title}\u0001${level.authorName ?? ''}` });
        }
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
