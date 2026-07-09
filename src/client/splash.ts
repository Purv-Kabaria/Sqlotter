import { requestExpandedMode, context } from '@devvit/web/client';
import { getLaunchLevelId } from './launch';

const greeting  = document.getElementById('greeting')     as HTMLParagraphElement;
const dailyInfo = document.getElementById('daily-info')   as HTMLParagraphElement;
const startBtn  = document.getElementById('start-button') as HTMLButtonElement;
const launchLevelId = getLaunchLevelId();

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
}

void (async () => {
  try {
    const [initRes, dailyRes] = await Promise.all([
      fetch('/api/init'),
      fetch('/api/daily'),
    ]);

    if (initRes.ok) {
      const init = await initRes.json() as { username?: string; sparks?: number };
      if (init.username) greeting.textContent = `Hey u/${init.username}!`;
      if (init.sparks !== undefined) {
        dailyInfo.replaceChildren();
        const count = document.createElement('span');
        count.className = 'spark-num';
        count.textContent = `${init.sparks}`;
        dailyInfo.append(count, document.createTextNode(' Sparks'));
      }
    }

    if (!launchLevelId && dailyRes.ok) {
      const daily = await dailyRes.json() as { level?: { difficulty?: number } };
      const diff  = daily.level?.difficulty ?? 1;
      const label = DIFF_LABELS[diff] ?? 'Medium';
      dailyInfo.textContent = `Today's Sqlot: ${label}`;
    }
  } catch {
    dailyInfo.textContent = "Today's Sqlot is waiting!";
  }
})();

startBtn.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
