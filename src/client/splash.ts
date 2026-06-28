import { requestExpandedMode, context } from '@devvit/web/client';
import { getLaunchLevelId } from './launch';

const greeting  = document.getElementById('greeting')     as HTMLParagraphElement;
const dailyInfo = document.getElementById('daily-info')   as HTMLParagraphElement;
const startBtn  = document.getElementById('start-button') as HTMLButtonElement;
const launchLevelId = getLaunchLevelId();

// Show username greeting from context immediately (no fetch required)
greeting.textContent = context.username
  ? `Hey u/${context.username}! 👋`
  : 'Ready to play? 🎮';
if (launchLevelId) {
  startBtn.textContent = 'Play this level';
  dailyInfo.textContent = 'Community Splot level ready!';
}

// Fetch sparks and daily info from server
void (async () => {
  try {
    const [initRes, dailyRes] = await Promise.all([
      fetch('/api/init'),
      fetch('/api/daily'),
    ]);

    if (initRes.ok) {
      const init = await initRes.json() as { username?: string; sparks?: number };
      if (init.username) greeting.textContent = `Hey u/${init.username}! 👋`;
      if (init.sparks !== undefined) {
        dailyInfo.textContent = `✨ ${init.sparks} Sparks`;
      }
    }

    if (!launchLevelId && dailyRes.ok) {
      const daily = await dailyRes.json() as { level?: { difficulty?: number } };
      const diff  = daily.level?.difficulty ?? 1;
      const stars = '⭐'.repeat(diff);
      dailyInfo.textContent = `📅 Daily puzzle available! ${stars}`;
    }
  } catch {
    dailyInfo.textContent = 'Today\'s puzzle is waiting!';
  }
})();

startBtn.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
