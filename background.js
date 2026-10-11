// Owns the multiview grid: opens one fullscreen window hosting the grid
// (inject/grid-host.js), remembers each slot's game and spoofed location, and
// forwards keyboard shortcuts and popup commands to the grid page.
// Kept as a classic (non-module) script so it runs as a Chrome service worker
// and as a Firefox background script.

const GRID_KEY = 'grid';
const HOST_URL = 'https://tv.youtube.com/live#mv-grid';
const MAX_SLOTS = 4;

// grid state: { tabId, windowId, slots: [{label, teams, geo}], layout }
const getGrid = async () => (await chrome.storage.session.get(GRID_KEY))[GRID_KEY] || null;
const setGrid = grid => grid
  ? chrome.storage.session.set({ [GRID_KEY]: grid })
  : chrome.storage.session.remove(GRID_KEY);

// Requests from the grid page can arrive while openGrid is still saving state.
let opening = Promise.resolve();

async function workArea(fallback) {
  try {
    const displays = (await chrome.system.display.getInfo()).filter(d => d.isEnabled !== false);
    const last = await chrome.windows.getLastFocused();
    const cx = last.left + last.width / 2;
    const cy = last.top + last.height / 2;
    const inside = d => cx >= d.bounds.left && cx < d.bounds.left + d.bounds.width &&
      cy >= d.bounds.top && cy < d.bounds.top + d.bounds.height;
    const display = displays.find(inside) || displays.find(d => d.isPrimary) || displays[0];
    if (display) return display.workArea;
  } catch (err) {
    // system.display unavailable (e.g. Firefox): use the area the popup measured
  }
  return fallback;
}

async function closeGrid() {
  const grid = await getGrid();
  await setGrid(null);
  if (grid) await chrome.windows.remove(grid.windowId).catch(() => {});
}

async function doOpenGrid({ games, layout, area }) {
  if (!games.length) throw new Error('Choose at least one game.');
  await closeGrid();
  const a = await workArea(area);
  const win = await chrome.windows.create({
    url: HOST_URL,
    type: 'popup',
    left: Math.round(a.left),
    top: Math.round(a.top),
    width: Math.round(a.width),
    height: Math.round(a.height),
    focused: true
  });
  try {
    // windows.create doesn't always include the tabs array.
    const tab = (win.tabs && win.tabs[0]) || (await chrome.tabs.query({ windowId: win.id }))[0];
    if (!tab) throw new Error('Chrome did not create a tab for the grid window.');
    // Save state first: the page asks for it as soon as its content script runs.
    await setGrid({
      tabId: tab.id,
      windowId: win.id,
      slots: games.slice(0, MAX_SLOTS).map(g => ({ label: g.label, teams: g.teams, geo: g.geo })),
      layout
    });
    // Keep the whole tab silent until the grid has mounted and taken over per-frame audio.
    await chrome.tabs.update(tab.id, { muted: true });
  } catch (error) {
    await setGrid(null);
    await chrome.windows.remove(win.id).catch(() => {});
    throw error;
  }
}

function openGrid(request) {
  opening = doOpenGrid(request);
  return opening;
}

const isFromExtensionPage = sender => Boolean(sender.url && sender.url.startsWith(chrome.runtime.getURL('')));
const isGridHost = (sender, grid) => Boolean(grid && sender.tab && sender.tab.id === grid.tabId && sender.frameId === 0);

async function sendToGrid(grid, message) {
  return chrome.tabs.sendMessage(grid.tabId, message, { frameId: 0 });
}

async function handle(message, sender) {
  await opening.catch(() => {});
  const grid = await getGrid();

  // Messages from the popup.
  if (isFromExtensionPage(sender)) {
    switch (message.type) {
      case 'open-grid': return openGrid(message);
      case 'close-grid': return closeGrid();
      case 'get-session': {
        if (!grid) return { grid: null, status: null };
        const status = await sendToGrid(grid, { type: 'mv-status' }).catch(() => null);
        return { grid: { slots: grid.slots.map(s => ({ label: s.label })), layout: grid.layout }, status };
      }
      case 'command':
        if (grid) await sendToGrid(grid, { type: 'mv-command', command: message.command, layout: message.layout });
        return;
    }
    throw new Error('Unknown request.');
  }

  // Messages from content scripts in the grid tab.
  if (!grid || !sender.tab || sender.tab.id !== grid.tabId) throw new Error('Not part of the active grid.');

  if (message.type === 'get-slot') {
    const slot = grid.slots[message.slot];
    if (!Number.isInteger(message.slot) || !slot) throw new Error('Unknown slot.');
    return { geo: slot.geo || null, teams: slot.teams || [] };
  }

  if (!isGridHost(sender, grid)) throw new Error('Only the grid page may do that.');
  switch (message.type) {
    case 'grid-bootstrap':
      return { slots: grid.slots.map(s => ({ label: s.label })), layout: grid.layout };
    case 'grid-ready':
      await chrome.tabs.update(grid.tabId, { muted: false });
      await chrome.windows.update(grid.windowId, { state: 'fullscreen' });
      return;
    case 'grid-layout':
      grid.layout = String(message.layout);
      await setGrid(grid);
      await chrome.storage.local.set({ layout: grid.layout });
      return;
    case 'grid-fullscreen': {
      const win = await chrome.windows.get(grid.windowId);
      await chrome.windows.update(grid.windowId, { state: win.state === 'fullscreen' ? 'normal' : 'fullscreen' });
      return;
    }
    case 'close-grid': return closeGrid();
  }
  throw new Error('Unknown request.');
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(
    result => sendResponse({ ok: true, result }),
    error => sendResponse({ ok: false, error: String((error && error.message) || error) })
  );
  return true;
});

chrome.commands.onCommand.addListener(async command => {
  const grid = await getGrid();
  if (grid) sendToGrid(grid, { type: 'mv-command', command }).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const grid = await getGrid();
  if (grid && grid.tabId === tabId) await setGrid(null);
});
