import { requestExpandedMode, context } from '@devvit/web/client';

const greeting  = document.getElementById('greeting')    as HTMLParagraphElement;
const dailyInfo = document.getElementById('daily-info')  as HTMLParagraphElement;
const startBtn  = document.getElementById('start-button') as HTMLButtonElement;

// Show username greeting immediately from context
greeting.textContent = context.username
  ? `Hey u/${context.username}! 👋`
  : 'Ready to play? 🎮';

// Fetch daily puzzle info
void (async () => {
  try {
    const res = await fetch('/api/init');
    if (res.ok) {
      const data = await res.json() as { username?: string; sparks?: number };
      if (data.username) greeting.textContent = `Hey u/${data.username}! 👋`;
      if (data.sparks !== undefined) {
        dailyInfo.textContent = `You have ✨ ${data.sparks} Sparks`;
      }
    }
  } catch {
    // Fallback — no network in preview
  }
})();

// Launch game on button click
startBtn.addEventListener('click', (e) => {
  requestExpandedMode(e, 'game');
});
