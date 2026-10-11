// Inside a grid iframe ("mv:<slot>"), find the Live-guide row whose current
// program mentions both teams and navigate the frame to its /watch/ link.
// Guide structure (observed on tv.youtube.com/live): each channel is a
// <ytu-epg-row>; its live "now airing" cell is <ytu-epg-airing> and the
// thumbnail <ytu-endpoint class="tenx-thumb"> holds the /watch/ anchor.
(() => {
  const match = /^mv:(\d+)$/.exec(window.name);
  if (!match) return;
  const slot = Number(match[1]);
  const DONE_KEY = `mv-nav-done:${slot}`;
  const TIMEOUT_MS = 25000;

  function findWatchLink(teams) {
    for (const row of document.querySelectorAll('ytu-epg-row')) {
      const airing = row.querySelector('ytu-epg-airing');
      const text = (airing ? airing.innerText : '').toLowerCase();
      if (!text || !teams.every(t => text.includes(t))) continue;
      const anchor = row.querySelector('.tenx-thumb a[href*="watch/"]') ||
        row.querySelector('ytu-epg-airing a[href*="watch/"]');
      if (anchor) return anchor.href;
    }
    return null;
  }

  async function run() {
    // Only act on the guide, and only once per slot so a manual channel change
    // that returns to the guide isn't hijacked.
    if (location.pathname !== '/live' || sessionStorage.getItem(DONE_KEY)) return;
    let teams;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'get-slot', slot });
      teams = res && res.ok && res.result && res.result.teams;
    } catch (err) {
      return;
    }
    if (!teams || !teams.length) return;
    teams = teams.map(t => String(t).toLowerCase());

    const started = Date.now();
    const timer = setInterval(() => {
      const href = findWatchLink(teams);
      if (href) {
        clearInterval(timer);
        sessionStorage.setItem(DONE_KEY, '1');
        location.assign(href);
      } else if (Date.now() - started > TIMEOUT_MS) {
        clearInterval(timer);
        console.info('[Game Multiview] No guide row matched', teams);
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
