export type ShopCategory = 'eyes' | 'mouth' | 'brows' | 'accessories';
export type ShopSlot = 'eye' | 'mouth' | 'eyebrow' | 'accessory';

export type ShopItem = {
  id: string;
  label: string;
  iconKey: string;
  price: number;
  category: ShopCategory;
  slot: ShopSlot;
};

export const SHOP_ITEMS: readonly ShopItem[] = [
  { id: 'eye-doubt', label: 'Doubt Eyes', iconKey: 'char-eye-doubt', price: 50, category: 'eyes', slot: 'eye' },
  { id: 'eye-cute', label: 'Cute Eyes', iconKey: 'char-eye-cute', price: 80, category: 'eyes', slot: 'eye' },
  { id: 'eye-shock', label: 'Shocked', iconKey: 'char-eye-shock', price: 120, category: 'eyes', slot: 'eye' },
  { id: 'eye-pain', label: 'Pain Eyes', iconKey: 'char-eye-pain', price: 100, category: 'eyes', slot: 'eye' },
  { id: 'mouth-kiss', label: 'Kiss Mouth', iconKey: 'char-mouth-kiss', price: 60, category: 'mouth', slot: 'mouth' },
  { id: 'mouth-frown', label: 'Frown', iconKey: 'char-mouth-frown', price: 40, category: 'mouth', slot: 'mouth' },
  { id: 'mouth-ooo', label: 'Ooo Mouth', iconKey: 'char-mouth-ooo', price: 70, category: 'mouth', slot: 'mouth' },
  { id: 'mouth-squiggle', label: 'Squiggle', iconKey: 'char-mouth-squiggle', price: 90, category: 'mouth', slot: 'mouth' },
  { id: 'brow-surprise', label: 'Surprised', iconKey: 'char-brow-surprise', price: 55, category: 'brows', slot: 'eyebrow' },
  { id: 'brow-sad', label: 'Sad Brows', iconKey: 'char-brow-sad', price: 45, category: 'brows', slot: 'eyebrow' },
  { id: 'brow-angry', label: 'Angry Brows', iconKey: 'char-brow-angry', price: 75, category: 'brows', slot: 'eyebrow' },
  { id: 'acc-crown', label: 'Crown', iconKey: 'char-acc-crown', price: 200, category: 'accessories', slot: 'accessory' },
  { id: 'acc-hat', label: 'Top Hat', iconKey: 'char-acc-hat', price: 150, category: 'accessories', slot: 'accessory' },
  { id: 'acc-party-hat', label: 'Party Hat', iconKey: 'char-acc-party-hat', price: 80, category: 'accessories', slot: 'accessory' },
  { id: 'acc-horns', label: 'Horns', iconKey: 'char-acc-horns', price: 130, category: 'accessories', slot: 'accessory' },
  { id: 'acc-cap', label: 'Cap', iconKey: 'char-acc-cap', price: 60, category: 'accessories', slot: 'accessory' },
];

export function getShopItem(itemId: string): ShopItem | undefined {
  return SHOP_ITEMS.find((item) => item.id === itemId);
}
