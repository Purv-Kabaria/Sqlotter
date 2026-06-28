import * as Phaser from 'phaser';
import { SplotMascot } from '../components/SplotMascot';
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

  constructor() { super('Shop'); }

  init() {
    this.activeCategory = 'eyes';
    this.catBtns = [];
    this.bgLayers = [];
    this.unlockedItems = new Set();
    this.equippedItems = {};
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
    ['bg2-1'].forEach((key) => {
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
    this.buildIconBtn(30, 30, '‹', 36, () => {
      this.cameras.main.fadeOut(250, 26, 10, 46);
      this.time.delayedCall(260, () => this.scene.start('MainMenu'));
    });

    this.add.image(width / 2 - 70, 30, 'icon-bag').setDisplaySize(24, 24).setDepth(10);
    this.add.text(width / 2 - 48, 30, 'Shop', {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '22px',
      color: '#ffffff',
      stroke: '#1a0a2e',
      strokeThickness: 4,
    }).setOrigin(0, 0.5).setDepth(10);

    // Sparks counter
    const sparkBg = this.add.graphics().setDepth(10);
    sparkBg.fillStyle(0x000000, 0.5);
    sparkBg.fillRoundedRect(width - 120, 12, 108, 36, 18);
    this.add.image(width - 104, 30, 'icon-spark').setDisplaySize(20, 20).setDepth(11);
    this.sparksText = this.add.text(width - 86, 30, `${this.sparks}`, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '16px',
      color: '#FFD700',
    }).setOrigin(0, 0.5).setDepth(11);

    const div = this.add.graphics().setDepth(10);
    div.lineStyle(1, C.GOLD, 0.3);
    div.lineBetween(0, 54, width, 54);
  }

  private buildCategories(width: number, _height: number) {
    const cats: [ShopCategory, string][] = [
      ['eyes', '👁 Eyes'],
      ['mouth', '👄 Mouth'],
      ['brows', '🤨 Brows'],
      ['accessories', '🎩 Hats'],
    ];
    const catW = (width - 24) / cats.length;

    cats.forEach(([id, label], i) => {
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
        fontFamily: '"Arial Black", sans-serif',
        fontSize: '12px',
        color: id === this.activeCategory ? '#1a0a2e' : C.TEXT,
      }).setOrigin(0.5);

      const c = this.add.container(tx, ty, [bg, txt]).setDepth(10).setSize(catW - 6, 30);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerup', () => {
        if (this.activeCategory === id) return;
        this.activeCategory = id;
        this.catBtns.forEach((btn, j) => {
          const bBg = btn.list[0] as Phaser.GameObjects.Graphics;
          const bTxt = btn.list[1] as Phaser.GameObjects.Text;
          const isAct = cats[j]?.[0] === id;
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

    const bg = this.add.graphics().setDepth(4);
    bg.fillStyle(C.PANEL, 0.8);
    bg.fillRoundedRect(previewX - size - 10, previewY - size - 10, (size + 10) * 2, (size + 10) * 2, 16);

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

      const bg = this.add.graphics();
      bg.fillStyle(owned ? C.PANEL : C.LOCKED, owned ? 1 : 0.9);
      bg.lineStyle(2, equipped ? C.GREEN : (owned ? 0x6dd400 : 0x3a2060), equipped ? 1 : 0.4);
      bg.fillRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
      bg.strokeRoundedRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);

      const items: Phaser.GameObjects.GameObject[] = [bg];

      // Icon
      const icon = this.add.image(0, -14, item.iconKey).setDisplaySize(36, 36);
      if (!owned) icon.setAlpha(0.3).setTint(0x888888);
      items.push(icon);

      // Label
      const lbl = this.add.text(0, 14, item.label, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '11px',
        color: owned ? C.TEXT : C.DIM,
        wordWrap: { width: cardW - 8 },
        align: 'center',
      }).setOrigin(0.5, 0);
      items.push(lbl);

      // Price or equipped
      if (equipped) {
        const eqBadge = this.add.text(cardW / 2 - 4, -cardH / 2 + 4, '✓', {
          fontSize: '14px', color: '#6DD400',
        }).setOrigin(1, 0);
        items.push(eqBadge);
      } else if (!owned) {
        const priceTxt = this.add.text(0, cardH / 2 - 14, `✨ ${item.price}`, {
          fontFamily: '"Arial Black", sans-serif',
          fontSize: '12px',
          color: this.sparks >= item.price ? '#FFD700' : '#ff5555',
        }).setOrigin(0.5, 1);
        items.push(priceTxt);
      }

      const c = this.add.container(cx, cy, items).setDepth(5).setSize(cardW, cardH);
      c.setInteractive({ useHandCursor: true });
      c.on('pointerover', () => this.tweens.add({ targets: c, scaleX: 1.06, scaleY: 1.06, duration: 80 }));
      c.on('pointerout', () => this.tweens.add({ targets: c, scaleX: 1, scaleY: 1, duration: 80 }));
      c.on('pointerup', () => this.handleItemTap(item, owned, equipped));

      this.itemGrid!.add(c);
    });
  }

  private async handleItemTap(item: ShopItem, owned: boolean, equipped: boolean) {
    if (!owned) {
      if (this.sparks < item.price) {
        this.showToast('Not enough Sparks! ✨', '#ff5555');
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
          this.showToast(`Got ${item.label}! ✨`, '#6DD400');
          this.itemGrid?.destroy();
          const { width: w, height: h } = this.scale;
          this.renderItems(w, h);
        }
      } catch {
        this.showToast('Purchase failed.', '#ff5555');
      }
    } else if (!equipped) {
      // Equip
      try {
        const res = await fetch('/api/user/equip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slot: item.slot, itemId: item.id }),
        });
        if (!res.ok) {
          this.showToast('Could not equip that item.', '#ff5555');
          return;
        }
        const data: EquipResponse = await res.json();
        this.equippedItems = data.equippedItems;
        this.showToast(`Equipped ${item.label}!`, '#6DD400');
        if (this.splot) {
          this.splot.refresh(this.equippedItems);
          this.splot.setExpression('excited', 1500);
        }
        this.itemGrid?.destroy();
        const { width: w, height: h } = this.scale;
        this.renderItems(w, h);
      } catch {
        this.showToast('Could not equip that item.', '#ff5555');
      }
    }
  }

  private showToast(msg: string, color: string) {
    const { width, height } = this.scale;
    const t = this.add.text(width / 2, height * 0.88, msg, {
      fontFamily: '"Arial Black", sans-serif',
      fontSize: '15px',
      color,
      backgroundColor: '#0d0620',
      padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, duration: 200 });
    this.time.delayedCall(2000, () => {
      this.tweens.add({ targets: t, alpha: 0, duration: 300, onComplete: () => t.destroy() });
    });
  }

  private buildIconBtn(x: number, y: number, icon: string, size: number, cb: () => void) {
    const g = this.add.graphics().setDepth(15);
    g.fillStyle(0x000000, 0.4);
    g.fillRoundedRect(x - size / 2, y - size / 2, size, size, 8);
    const txt = this.add.text(x, y, icon, {
      fontSize: `${Math.round(size * 0.65)}px`,
      color: '#ffffff',
    }).setOrigin(0.5, 0.45).setDepth(16);
    this.add.zone(x, y, size, size).setDepth(16).setInteractive({ useHandCursor: true })
      .on('pointerup', cb)
      .on('pointerover', () => this.tweens.add({ targets: [g, txt], scaleX: 1.12, scaleY: 1.12, duration: 80 }))
      .on('pointerout', () => this.tweens.add({ targets: [g, txt], scaleX: 1, scaleY: 1, duration: 80 }));
  }
}
