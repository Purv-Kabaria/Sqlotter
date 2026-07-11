import { requestExpandedMode, context } from '@devvit/web/client';
import { getLaunchLevelId, isFitCheckPost } from './launch';
import { getShopItem } from '../shared/shop';
import type { InitResponse } from '../shared/api';

const greeting  = document.getElementById('greeting')     as HTMLParagraphElement;
const dailyInfo = document.getElementById('daily-info')   as HTMLParagraphElement;
const startBtn  = document.getElementById('start-button') as HTMLButtonElement;
const splashHint = document.querySelector('.splash-hint') as HTMLParagraphElement | null;
const splotColor      = document.getElementById('splot-color')      as HTMLDivElement;
const splotEye        = document.getElementById('splot-eye')        as HTMLImageElement;
const splotEyebrow    = document.getElementById('splot-eyebrow')    as HTMLImageElement;
const splotMouth      = document.getElementById('splot-mouth')      as HTMLImageElement;
const splotAccessory  = document.getElementById('splot-accessory')  as HTMLImageElement;
const launchLevelId = getLaunchLevelId();
const fitCheckPost  = isFitCheckPost();

// ── Splot appearance — the player's own equipped look, same fallbacks
// SplotMascot's resting face uses (see applyEquipped in SplotMascot.ts), so
// the splash Splot is never a fixed placeholder and never drifts from what
// the expanded game actually shows.
const DEFAULT_SPLOT_COLOR = '#6DD400';

function eyebrowFile(id: string): string {
  // Item ids are 'brow-*' but the art files are 'eyebrow-*.png'.
  return `eyebrow-${id.replace(/^brow-/, '')}`;
}

function applyEquipped(equipped: Record<string, string>) {
  const color = equipped.color ? getShopItem(equipped.color)?.color : undefined;
  const fill = color?.stops && color.stops.length >= 2
    ? `linear-gradient(to bottom, ${color.stops.join(', ')})`
    : (color?.hex ?? DEFAULT_SPLOT_COLOR);
  splotColor.style.setProperty('--splot-fill', fill);
  splotColor.classList.toggle('splot-sparkle', color?.sparkle === true);

  splotEye.src     = `assets/character/eyes/${equipped.eye ?? 'eye-normal'}.png`;
  splotEyebrow.src = `assets/character/eyebrows/${eyebrowFile(equipped.eyebrow ?? 'brow-normal')}.png`;
  splotMouth.src   = `assets/character/mouth/${equipped.mouth ?? 'mouth-smile'}.png`;

  if (equipped.accessory) {
    splotAccessory.src = `assets/character/accessories/${equipped.accessory.replace(/^acc-/, '')}.png`;
    splotAccessory.classList.remove('splot-hidden');
  } else {
    splotAccessory.classList.add('splot-hidden');
  }
}

const DIFF_LABELS = ['Easy', 'Easy', 'Medium', 'Hard', 'Expert', 'Expert'];

function setStartLabel(label: string) {
  startBtn.replaceChildren();
  const icon = document.createElement('span');
  icon.className = 'play-icon';
  startBtn.append(icon, document.createTextNode(` ${label}`));
}

greeting.textContent = context.username
  ? `Hey u/${context.username}!`
  : 'Ready to play?';

if (launchLevelId) {
  setStartLabel('Play this level');
  dailyInfo.textContent = 'Community Sqlotter level!';
} else if (fitCheckPost) {
  // Fit Check thread — the expanded view opens straight into the dressing room.
  setStartLabel('Dress your Splot');
  dailyInfo.textContent = 'Fit Check Friday is live!';
  if (splashHint) splashHint.textContent = 'Style your Splot and drop your fit — top vote wins Sparks!';
}

void (async () => {
  try {
    // Timeouts so a stalled connection falls through to the catch's friendly
    // default instead of leaving the placeholder copy up forever.
    const [initRes, dailyRes] = await Promise.all([
      fetch('/api/init', { signal: AbortSignal.timeout(6000) }),
      fetch('/api/daily', { signal: AbortSignal.timeout(6000) }),
    ]);

    if (initRes.ok) {
      const init = await initRes.json() as InitResponse;
      if (init.username) greeting.textContent = `Hey u/${init.username}!`;
      // The Fit Check thread keeps its own subtitle — don't overwrite it with
      // the sparks count or (below) the daily label.
      if (init.sparks !== undefined && !fitCheckPost) {
        dailyInfo.replaceChildren();
        const count = document.createElement('span');
        count.className = 'spark-num';
        count.textContent = `${init.sparks}`;
        dailyInfo.append(count, document.createTextNode(' Sparks'));
      }
      applyEquipped(init.equippedItems ?? {});
    }

    if (!launchLevelId && !fitCheckPost && dailyRes.ok) {
      const daily = await dailyRes.json() as { level?: { difficulty?: number } };
      const diff  = daily.level?.difficulty ?? 1;
      const label = DIFF_LABELS[diff] ?? 'Medium';
      dailyInfo.textContent = `Today's Sqlot: ${label}`;
    }
  } catch {
    if (!fitCheckPost) dailyInfo.textContent = "Today's Sqlot is waiting!";
  }
})();

startBtn.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
