// Isolated-world half of the geolocation spoof. The page-world script
// (geo-main.js) can't reach extension APIs, so it asks us over DOM events.
// Each grid iframe is named "mv:<slot>" by the host; we use that to fetch
// that slot's location from the background. Frames that aren't grid slots
// (including normal YouTube TV tabs) get null and use real geolocation.
(() => {
  const root = document.documentElement;
  const match = /^mv:(\d+)$/.exec(window.name);
  const slot = match ? Number(match[1]) : null;

  root.addEventListener('mv-geo-request', async e => {
    const id = e.detail;
    let geo = null;
    if (slot !== null) {
      try {
        const res = await chrome.runtime.sendMessage({ type: 'get-slot', slot });
        geo = res && res.ok && res.result ? res.result.geo : null;
      } catch (err) {
        // background unavailable: fall through with null so the page uses real geolocation
      }
    }
    root.dispatchEvent(new CustomEvent('mv-geo-response', {
      detail: JSON.stringify({ id, geo })
    }));
  });
})();
