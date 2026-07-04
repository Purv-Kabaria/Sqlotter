// Splotter Flair — the player's Splot status rendered as subreddit user
// flair, e.g. "🔥 6 · ⚡ 1,240 · Mega-Blob". Lives in shared/ (next to
// shop.ts) so the Shop can advertise what an item unlocks (the Golden Crown
// grants the Royal Slime tier) with the exact same ladder the server applies.

export type FlairTier = {
  name: string;
  /** Lifetime Sparks earned (never reduced by Shop purchases). */
  minSparks: number;
};

// Ordered lowest → highest. Royal Slime is NOT on the ladder: it's reserved
// for Golden Crown owners regardless of Sparks (see flairTierName).
export const FLAIR_TIERS: readonly FlairTier[] = [
  { name: 'Droplet',   minSparks: 0 },
  { name: 'Puddle',    minSparks: 250 },
  { name: 'Blob',      minSparks: 1_000 },
  { name: 'Mega-Blob', minSparks: 5_000 },
];

export const ROYAL_TIER_NAME = 'Royal Slime';

// The Shop item whose purchase unlocks the Royal Slime tier.
export const ROYAL_TIER_ITEM_ID = 'acc-crown';

export function flairTierName(lifetimeSparks: number, ownsGoldenCrown: boolean): string {
  if (ownsGoldenCrown) return ROYAL_TIER_NAME;
  let name = FLAIR_TIERS[0]?.name ?? 'Droplet';
  for (const tier of FLAIR_TIERS) {
    if (lifetimeSparks >= tier.minSparks) name = tier.name;
  }
  return name;
}

export type FlairParts = {
  streakDays: number;
  lifetimeSparks: number;
  ownsGoldenCrown: boolean;
  /** Fit Check Friday win badge, e.g. "W27" — shown as "👑 Fit W27". */
  fitCrownWeek?: string;
};

// Reddit caps user flair at 64 characters; the longest realistic line here
// ("🔥 365 · ⚡ 9,999,999 · Royal Slime · 👑 Fit W52") is comfortably under.
export function buildFlairText(parts: FlairParts): string {
  const segments: string[] = [];
  if (parts.streakDays > 1) segments.push(`🔥 ${parts.streakDays}`);
  segments.push(`⚡ ${parts.lifetimeSparks.toLocaleString('en-US')}`);
  segments.push(flairTierName(parts.lifetimeSparks, parts.ownsGoldenCrown));
  if (parts.fitCrownWeek) segments.push(`👑 Fit ${parts.fitCrownWeek}`);
  return segments.join(' · ');
}
