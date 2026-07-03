export type ShopCategory = 'colors' | 'eyes' | 'mouth' | 'brows' | 'accessories';
export type ShopSlot = 'color' | 'eye' | 'mouth' | 'eyebrow' | 'accessory';

// Colors-only. Solid variants set just `hex`. The rare finale variants set
// `stops` (2+ hex colors) instead, baked into a gradient tint by Shop.ts's
// swatch renderer and by SplotMascot's blob bake; `sparkle` additionally
// spawns a shimmering particle flourish on the mascot while equipped.
export type ShopColor = {
  hex: string;
  stops?: string[];
  sparkle?: boolean;
};

export type ShopItem = {
  id: string;
  label: string;
  iconKey: string;
  price: number;
  category: ShopCategory;
  slot: ShopSlot;
  color?: ShopColor;
};

// Base slime tint players start with — unlocked for everyone, never bought.
const DEFAULT_COLOR_HEX = '#6DD400';

// 30 variants total: Default (free) + 24 solid colors + 5 rare finale colors.
// Prices are a single smooth exponential ladder (~9% growth per step) from
// 1,000 to the fixed 25,000 finale, rounded to friendly numbers — "every
// variant pricier than the last," not a separate curve bolted onto a rare
// tier at the end. The rare tier is set apart by name/rendering (gradient,
// multi-stop rainbow, sparkle) rather than a price discontinuity.
const COLOR_ITEMS: readonly ShopItem[] = [
  { id: 'color-default', label: 'Default', iconKey: 'icon-paint', price: 0, category: 'colors', slot: 'color', color: { hex: DEFAULT_COLOR_HEX } },
  { id: 'color-crimson', label: 'Crimson Red', iconKey: 'icon-paint', price: 1000, category: 'colors', slot: 'color', color: { hex: '#E63946' } },
  { id: 'color-ocean', label: 'Ocean Blue', iconKey: 'icon-paint', price: 1100, category: 'colors', slot: 'color', color: { hex: '#1D7DEA' } },
  { id: 'color-sunny', label: 'Sunny Yellow', iconKey: 'icon-paint', price: 1300, category: 'colors', slot: 'color', color: { hex: '#FFD23F' } },
  { id: 'color-grape', label: 'Grape Purple', iconKey: 'icon-paint', price: 1400, category: 'colors', slot: 'color', color: { hex: '#7B2FE0' } },
  { id: 'color-coral', label: 'Coral Pink', iconKey: 'icon-paint', price: 1600, category: 'colors', slot: 'color', color: { hex: '#FF6B9D' } },
  { id: 'color-mint', label: 'Mint Green', iconKey: 'icon-paint', price: 1800, category: 'colors', slot: 'color', color: { hex: '#3ED9A0' } },
  { id: 'color-tangerine', label: 'Tangerine', iconKey: 'icon-paint', price: 2000, category: 'colors', slot: 'color', color: { hex: '#FF8C1A' } },
  { id: 'color-sky', label: 'Sky Cyan', iconKey: 'icon-paint', price: 2200, category: 'colors', slot: 'color', color: { hex: '#3FD1FF' } },
  { id: 'color-magenta', label: 'Hot Magenta', iconKey: 'icon-paint', price: 2500, category: 'colors', slot: 'color', color: { hex: '#E01E8C' } },
  { id: 'color-forest', label: 'Forest Green', iconKey: 'icon-paint', price: 2800, category: 'colors', slot: 'color', color: { hex: '#1B7A3D' } },
  { id: 'color-royal', label: 'Royal Blue', iconKey: 'icon-paint', price: 3200, category: 'colors', slot: 'color', color: { hex: '#2A3FE0' } },
  { id: 'color-lavender', label: 'Lavender', iconKey: 'icon-paint', price: 3500, category: 'colors', slot: 'color', color: { hex: '#B08CFF' } },
  { id: 'color-bubblegum', label: 'Bubblegum', iconKey: 'icon-paint', price: 4000, category: 'colors', slot: 'color', color: { hex: '#FF7FD1' } },
  { id: 'color-lime', label: 'Lime Punch', iconKey: 'icon-paint', price: 4500, category: 'colors', slot: 'color', color: { hex: '#9CE022' } },
  { id: 'color-teal', label: 'Deep Teal', iconKey: 'icon-paint', price: 5000, category: 'colors', slot: 'color', color: { hex: '#0E8C8C' } },
  { id: 'color-blood-orange', label: 'Blood Orange', iconKey: 'icon-paint', price: 5600, category: 'colors', slot: 'color', color: { hex: '#E0431E' } },
  { id: 'color-amethyst', label: 'Amethyst', iconKey: 'icon-paint', price: 6300, category: 'colors', slot: 'color', color: { hex: '#8E2FD6' } },
  { id: 'color-arctic', label: 'Arctic Blue', iconKey: 'icon-paint', price: 7100, category: 'colors', slot: 'color', color: { hex: '#8FE0FF' } },
  { id: 'color-blush', label: 'Peach Blush', iconKey: 'icon-paint', price: 7900, category: 'colors', slot: 'color', color: { hex: '#F2A98E' } },
  { id: 'color-midnight', label: 'Midnight Navy', iconKey: 'icon-paint', price: 8900, category: 'colors', slot: 'color', color: { hex: '#12174A' } },
  { id: 'color-emerald', label: 'Emerald', iconKey: 'icon-paint', price: 10000, category: 'colors', slot: 'color', color: { hex: '#0FA968' } },
  { id: 'color-ruby', label: 'Ruby', iconKey: 'icon-paint', price: 11000, category: 'colors', slot: 'color', color: { hex: '#C40C3A' } },
  { id: 'color-sapphire', label: 'Sapphire', iconKey: 'icon-paint', price: 12500, category: 'colors', slot: 'color', color: { hex: '#1450C4' } },
  { id: 'color-obsidian', label: 'Obsidian', iconKey: 'icon-paint', price: 14000, category: 'colors', slot: 'color', color: { hex: '#1A1A1F' } },
  // ── Rare finale: five variants, each a genuinely distinct effect ──────────
  { id: 'color-aurora', label: 'Aurora Gradient', iconKey: 'icon-paint', price: 16000, category: 'colors', slot: 'color', color: { hex: '#845EC2', stops: ['#00C9A7', '#845EC2', '#FF6F91'] } },
  { id: 'color-sparkle', label: 'Silver Sparkle', iconKey: 'icon-paint', price: 17500, category: 'colors', slot: 'color', color: { hex: '#E8ECEF', sparkle: true } },
  { id: 'color-rainbow', label: 'Rainbow', iconKey: 'icon-paint', price: 20000, category: 'colors', slot: 'color', color: { hex: '#FFA13B', stops: ['#FF3B3B', '#FFA13B', '#FFEB3B', '#3BFF6B', '#3BB8FF', '#8C3BFF'] } },
  { id: 'color-opal', label: 'Opal Shimmer', iconKey: 'icon-paint', price: 22500, category: 'colors', slot: 'color', color: { hex: '#D6FFE9', stops: ['#CFF7FF', '#FFD6F5', '#D6FFE9'], sparkle: true } },
  { id: 'color-golden', label: 'Golden', iconKey: 'icon-paint', price: 25000, category: 'colors', slot: 'color', color: { hex: '#FFD700', stops: ['#FFD700', '#FFA500', '#FFF6C8'], sparkle: true } },
];

// Everything below is roughly the old price list × 2.5 (rounded), so the
// former cheapest (Frown, 40) lands exactly on the new 100-sparks floor.
// Golden Crown is untouched — it's deliberately priced to match the Colors
// tab's Golden finale, not scaled with the rest of this list.
export const SHOP_ITEMS: readonly ShopItem[] = [
  ...COLOR_ITEMS,
  { id: 'eye-doubt', label: 'Doubt Eyes', iconKey: 'char-eye-doubt', price: 125, category: 'eyes', slot: 'eye' },
  { id: 'eye-cute', label: 'Cute Eyes', iconKey: 'char-eye-cute', price: 200, category: 'eyes', slot: 'eye' },
  { id: 'eye-shock', label: 'Shocked', iconKey: 'char-eye-shock', price: 300, category: 'eyes', slot: 'eye' },
  { id: 'eye-pain', label: 'Pain Eyes', iconKey: 'char-eye-pain', price: 250, category: 'eyes', slot: 'eye' },
  { id: 'mouth-kiss', label: 'Kiss Mouth', iconKey: 'char-mouth-kiss', price: 150, category: 'mouth', slot: 'mouth' },
  { id: 'mouth-frown', label: 'Frown', iconKey: 'char-mouth-frown', price: 100, category: 'mouth', slot: 'mouth' },
  { id: 'mouth-ooo', label: 'Ooo Mouth', iconKey: 'char-mouth-ooo', price: 175, category: 'mouth', slot: 'mouth' },
  { id: 'mouth-squiggle', label: 'Squiggle', iconKey: 'char-mouth-squiggle', price: 225, category: 'mouth', slot: 'mouth' },
  { id: 'brow-surprise', label: 'Surprised', iconKey: 'char-brow-surprise', price: 140, category: 'brows', slot: 'eyebrow' },
  { id: 'brow-sad', label: 'Sad Brows', iconKey: 'char-brow-sad', price: 110, category: 'brows', slot: 'eyebrow' },
  { id: 'brow-angry', label: 'Angry Brows', iconKey: 'char-brow-angry', price: 190, category: 'brows', slot: 'eyebrow' },
  { id: 'acc-crown', label: 'Golden Crown', iconKey: 'char-acc-crown', price: 25000, category: 'accessories', slot: 'accessory' },
  { id: 'acc-hat', label: 'Top Hat', iconKey: 'char-acc-hat', price: 375, category: 'accessories', slot: 'accessory' },
  { id: 'acc-party-hat', label: 'Party Hat', iconKey: 'char-acc-party-hat', price: 200, category: 'accessories', slot: 'accessory' },
  { id: 'acc-horns', label: 'Horns', iconKey: 'char-acc-horns', price: 325, category: 'accessories', slot: 'accessory' },
  { id: 'acc-cap', label: 'Cap', iconKey: 'char-acc-cap', price: 150, category: 'accessories', slot: 'accessory' },
];

export function getShopItem(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}
