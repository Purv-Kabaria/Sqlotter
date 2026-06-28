import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
import { addPixelIconButton, addPixelPanel, PIXEL_FONT } from '../components/PixelUI';
import { SHOP_ITEMS } from '../../shared/shop';
import type { ShopCategory, ShopItem } from '../../shared/shop';
import type { BuyResponse, EquipResponse, ProfileResponse } from '../../shared/api';

const C = {
  BG:     0x1a0a2e,
  PANEL:  0x2d1b4e,
  GREEN:  0x6dd400,
  GOLD:   0xffd700,
  ORANGE: 0xff6b35,
  TEXT:   '#ffffff',
  DIM:    '#7a8a9a',
  LOCKED: 0x1a1030,
} as const;

const CAT_LABELS: Record<ShopCategory, string> = {
  eyes: 'Eyes',
  mouth: 'Mouth',
  brows: 'Brows',
  accessories: 'Hats',
};

export class Shop extends Phaser.Scene {
  private activeCategory: ShopCategory = 'eyes';
  private splot: SplotMascot | null = null;
  private sparks = 0;
  private unlockedItems: Set<string> = new Set();
  private equippedItems: Record<string, string> = {};
  private sparksText: Phaser.GameObjects.Text | null = null;
  private itemGrid: Phaser.GameObjects.Container | null = null;
  private catBtns: Phaser.GameObjects.Container[] = [];
  private bgLayers: Phaser.GameObjects.Image[] = [];
  private pendingItemIds: Set<string> = new Set();

  constructor() { super('Shop'); }

  init() {
    this.activeCategory = 'eyes';
    this.catBtns = [];
    this.bgLayers = [];
    this.unlockedItems = new Set();
    this.equippedItems = {};
    this.pendingItemIds = new Set();
  }

  async create() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor(C.BG);
    this.cameras.main.fadeIn(350, 26, 10, 46);

    this.buildBackground();
    await this.loadProfile();
    this.buildHeader(width, height);
    this.buildCategories(width, height);
    this.buildSplotPreview(width, height);
    this.renderItems(width, height);
  }

  private buildBackground() {
    const { width, height } = this.scale;
    ['bg4-1'].forEach((key) => {
      const img = this.add.image(width / 2, height / 2, key).setAlpha(0.4).setDepth(-10);
      img.setScale(Math.max(width / (img.width || 1), height / (img.height || 1)) * 1.05);
      this.bgLayers.push(img);
    });
  }

  private async loadProfile() {
    try {
      const res = await fetch('/api/user/profile');
      if (res.ok) {
        const data: ProfileResponse = await res.json();
        this.sparks = data.sparks ?? 0;
        this.unlockedItems = new Set(data.unlockedItems ?? []);
        this.equippedItems = data.equippedItems ?? {};
      }
    } catch { /* offline fallback */ }
  }

  private buildHeader(width: number, _height: number) {
    addPixelIconButton(this, {
      x: 30, y: 30, size: 40,
      iconKey: 'icon-arrow', iconAngle: 180,
      onClick: () => {
        this.cameras.main.fadeOut(250, 26, 10, 46);
        this.time.delayedCall(260, () => this.scene.start('MainMenu'));
      },
    }).setDepth(15);

    this.add.image(width / 2 - 56, 30, 'icon-bag').setDisplaySize(22, 22).setDepth(10);
    this.add.text(width / 2 - 36, 30, 'Shop', {
      fontFamily: PIXEL_FONT,
      fontSize: '12px',
      color: '#ffffff',
      stroke: '#1a0a2e',
      strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(10);

    // Sparks counter using panel asset
    const sparksPanel = addPixelPanel(this, width - 58, 30, 96, 32).setDepth(10);
    this.add.image(width - 96, 30, 'icon-spark').setDisplaySize(18, 18).setDepth(11);
    this.sparksText = this.add.text(width - 80, 30, `${this.sparks}`, {
      fontFamily: PIXEL_FONT,
      fontSize: '10px',
      color: '#FFD700',
    }).setOrigin(0, 0.5).setDepth(11);
    void sparksPanel;

    const div = this.add.graphics().setDepth(10);
    div.lineStyle(1, C.GOLD, 0.3);
    div.lineBetween(0, 54, width, 54);
  }

  private buildCategories(width: number, _height: number) {
    const cats: ShopCategory[] = ['eyes', 'mouth', 'brows', 'accessories'];
    const catW = (width - 24) / cats.length;

    cats.forEach((id, i) => {
      const label = CAT_LABELS[id];
      const tx = 12 + i * catW + catW / 2;
      const ty = 72;

      const bg = this.add.graphics();
      const draw = (active: boolean) => {
        bg.clear();
        bg.fillStyle(active ? C.ORANGE : 0x1a1030, active ? 1 : 0.7);
        bg.fillRoundedRect(-catW / 2 + 3, -15, catW - 6, 30, 8);
      };
      draw(id === this.activeCategory);

      const txt = this.add.text(0, 0, label, {
        fontFamily: PIXEL_FONT,
        fontSize: '8px',
        color: id === this.activeCategory ? '#1a0a2e' : C.TEXT,
      }).setOrigin(0.5);

      const c = this.add.container(tx, ty, [bg, txt]).setDepth(10).setSize(catW - 6, 44);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerup', () => {
        if (this.activeCategory === id) return;
        this.activeCategory = id;
        this.catBtns.forEach((btn, j) => {
          const bBg = btn.list[0] as Phaser.GameObjects.Graphics;
          const bTxt = btn.list[1] as Phaser.GameObjects.Text;
          const isAct = cats[j] === id;
          bBg.clear();
          bBg.fillStyle(isAct ? C.ORANGE : 0x1a1030, isAct ? 1 : 0.7);
          bBg.fillRoundedRect(-catW / 2 + 3, -15, catW - 6, 30, 8);
          bTxt.setColor(isAct ? '#1a0a2e' : C.TEXT);
        });
        this.itemGrid?.destroy();
        const { width: w, height: h } = this.scale;
        this.renderItems(w, h);
      });
      this.catBtns.push(c);
    });
  }

  private buildSplotPreview(width: number, height: number) {
    const isPortrait = height > width;
    const previewX = isPortrait ? width / 2 : width * 0.82;
    const previewY = isPortrait ? height * 0.78 : height * 0.42;
    const size = isPortrait ? 80 : 100;
    const panelSize = size + 20;

    addPixelPanel(this, previewX, previewY, panelSize * 2, panelSize * 2).setDepth(4).setAlpha(0.85);
    this.splot = new SplotMascot(this, previewX, previewY, size, this.equippedItems);
  }

  private renderItems(width: number, height: number) {
    const isPortrait = height > width;
    const gridW = isPortrait ? width - 16 : width * 0.65;
    const gridX = 8;
    const gridY = 96;

    this.itemGrid = this.add.container(0, 0).setDepth(5);

    const cols = isPortrait ? 3 : 4;
    const cardW = (gridW - 8 * (cols + 1)) / cols;
    const cardH = 86;
    const gap = 8;

    const filtered = SHOP_ITEMS.filter(it => it.category === this.activeCategory);

    filtered.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = gridX + gap + col * (cardW + gap) + cardW / 2;
      const cy = gridY + gap + row * (cardH + gap) + cardH / 2;

      const owned = this.unlockedItems.has(item.id);
      const equipped = Object.values(this.equippedItems).includes(item.id);

      const bg = this.add.nineslice(
        0, 0,
        owned ? 'ui-btn-open' : 'ui-btn-disabled',
        undefined,
        cardW, cardH,
        8, 8, 8, 8,
      );
      if (equipped) bg.setTint(0x2a4a1a);

      const items: Phaser.GameObjects.GameObject[] = [bg];

      const icon = this.add.image(0, -14, item.iconKey).setDisplaySize(36, 36);
      if (!owned) icon.setAlpha(0.3).setTint(0x888888);
      items.push(icon);

      const lbl = this.add.text(0, 14, item.label, {
        fontFamily: PIXEL_FONT,
        fontSize: '7px',
        color: owned ? C.TEXT : C.DIM,
        wordWrap: { width: cardW - 8 },
        align: 'center',
      }).setOrigin(0.5, 0);
      items.push(lbl);

      if (equipped) {
        const checkIcon = this.add.image(cardW / 2 - 8, -cardH / 2 + 10, 'icon-check').setDisplaySize(14, 14);
        items.push(checkIcon);
      } else if (!owned) {
        const sparkIcon = this.add.image(-16, cardH / 2 - 12, 'icon-spark').setDisplaySize(12, 12);
        items.push(sparkIcon);
        const priceTxt = this.add.text(0, cardH / 2 - 12, `${item.price}`, {
          fontFamily: PIXEL_FONT,
          fontSize: '8px',
          color: this.sparks >= item.price ? '#FFD700' : '#ff5555',
        }).setOrigin(0, 0.5);
        items.push(priceTxt);
      }

      const c = this.add.container(cx, cy, items).setDepth(5).setSize(cardW, cardH);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerover', () => {
        this.previewItem(item, owned);
        this.tweens.add({ targets: c, scaleX: 1.06, scaleY: 1.06, duration: 80 });
      });
      c.on('pointerout', () => {
        this.restorePreview();
        this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 80 });
      });
      c.on('pointerup', () => this.handleItemTap(item, owned, equipped));

      this.itemGrid!.add(c);
    });
  }

  private async handleItemTap(item: ShopItem, owned: boolean, equipped: boolean) {
    if (this.pendingItemIds.has(item.id)) return;
    this.pendingItemIds.add(item.id);
    if (!owned) {
      if (this.sparks < item.price) {
        this.splot?.setExpression('sad', 1200);
        this.pendingItemIds.delete(item.id);
        this.showToast('Not enough Sparks!', '#ff5555');
        return;
      }
      try {
        const res = await fetch('/api/user/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.id }),
        });
        if (res.ok) {
          const data: BuyResponse = await res.json();
          this.sparks = data.sparks;
          this.sparksText?.setText(`${this.sparks}`);
          this.unlockedItems.add(item.id);
          this.showToast(`Got ${item.label}!`, '#6DD400');
          this.itemGrid?.destroy();
          const { width: w, height: h } = this.scale;
          this.renderItems(w, h);
        } else {
          this.showToast('Purchase failed.', '#ff5555');
        }
      } catch {
        this.showToast('Purchase failed.', '#ff5555');
      }
      this.pendingItemIds.delete(item.id);
    } else if (!equipped) {
      try {
        const res = await fetch('/api/user/equip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: item.slot, itemId: item.id }),
        });
        if (!res.ok) {
          this.showToast('Could not equip that item.', '#ff5555');
          this.splot?.setExpression('sad', 1200);
          this.pendingItemIds.delete(item.id);
          return;
        }
        const data: EquipResponse = await res.json();
        this.equippedItems = data.equippedItems;
        this.showToast(`Equipped ${item.label}!`, '#6DD400');
        if (this.splot) {
          this.splot.refresh(this.equippedItems);
          this.splot.setExpression('excited', 1500);
          this.splot.playAppliedFlash();
        }
        this.itemGrid?.destroy();
        const { width: w, height: h } = this.scale;
        this.renderItems(w, h);
      } catch {
        this.showToast('Could not equip that item.', '#ff5555');
        this.splot?.setExpression('sad', 1200);
      }
      this.pendingItemIds.delete(item.id);
    } else {
      this.pendingItemIds.delete(item.id);
    }
  }

  private previewItem(item: ShopItem, owned: boolean) {
    if (!this.splot) return;
    if (!owned) {
      this.splot.setExpression(this.sparks >= item.price ? 'doubt' : 'sad', 900);
      return;
    }
    this.splot.refresh({ ...this.equippedItems, [item.slot]: item.id });
    this.splot.setExpression('happy', 900);
  }

  private restorePreview() {
    if (!this.splot) return;
    this.splot.refresh(this.equippedItems);
  }

  private showToast(msg: string, color: string) {
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height * 0.88, msg, {
      fontFamily: PIXEL_FONT,
      fontSize: '9px',
      color,
      backgroundColor: '#0d0620',
      padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 200 });
    this.time.delayedCall(2000, () => {
      this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => t.destroy() });
    });
  }
}
