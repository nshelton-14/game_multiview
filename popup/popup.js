import { fetchGames } from '../lib/espn.js';
import { gameToSlot } from '../lib/slot.js';

const L = globalThis.MVLayout;
const MAX_GAMES = 8;
const REFRESH_MS = 60000;

const statusEl = document.getElementById('status');
const listEl = document.getElementById('games');
const openBtn = document.getElementById('open');
const layoutEl = document.getElementById('layout');
const sessionEl = document.getElementById('session');
const sessionListEl = document.getElementById('session-list');
const countEl = document.getElementById('count');
const picksEl = document.getElementById('picks');

let games = [];
const selected = []; // game ids in the order they were checked; index 0 is the main window

const send = async message => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res || !res.ok) throw new Error(res && res.error);
  return res.result;
};

const el = (tag, className, ...children) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children);
  return node;
};

const gameById = id => games.find(g => g.id === id);

// ---- selection ----
function renderDock() {
  countEl.textContent = String(selected.length);
  openBtn.disabled = selected.length === 0;
  openBtn.textContent = selected.length > 1 ? `▶ OPEN GRID (${selected.length})` : '▶ OPEN GRID';

  if (!selected.length) {
    picksEl.replaceChildren(el('span', 'hint', `Pick up to ${MAX_GAMES} games. The first one is the main window.`));
    return;
  }
  picksEl.replaceChildren(...selected.map((id, i) => {
    const remove = el('button', '', '✕');
    remove.title = 'Remove';
    remove.addEventListener('click', () => toggle(id, false));
    return el('span', 'pick', el('span', 'n', String(i + 1)), gameToSlot(gameById(id)).label, remove);
  }));
}

function syncCards() {
  for (const card of listEl.querySelectorAll('.card')) {
    const i = selected.indexOf(card.dataset.id);
    card.querySelector('input').checked = i !== -1;
    card.querySelector('.slot-badge').textContent = i === -1 ? '' : String(i + 1);
  }
  renderDock();
}

function toggle(id, on) {
  const i = selected.indexOf(id);
  if (on && i === -1) {
    if (selected.length >= MAX_GAMES) {
      statusEl.textContent = `You can watch up to ${MAX_GAMES} games at once.`;
      syncCards();
      return;
    }
    selected.push(id);
  } else if (!on && i !== -1) {
    selected.splice(i, 1);
  }
  statusEl.textContent = '';
  syncCards();
}

// ---- game cards ----
function teamRow(team, game, leading) {
  const swatch = el('span', 'swatch');
  swatch.style.background = team.color || '#4b5a8c';
  const row = el('div', `team${leading ? ' lead' : ''}`,
    swatch, el('span', 'abbr', team.abbr), el('span', 'name', team.name));
  if (game.state !== 'pre') row.append(el('span', 'score', String(team.score)));
  return row;
}

function renderCard(game) {
  const box = el('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => toggle(game.id, box.checked));

  const status = el('div', 'status');
  if (game.state === 'in') status.append(el('span', 'live-badge', 'LIVE'));
  status.append(game.detail);
  const head = el('div', 'card-head', status, el('span', 'network', game.networks.join(' · ')));

  const away = Number(game.away.score);
  const home = Number(game.home.score);
  const decided = game.state !== 'pre' && away !== home;

  const card = el('label', `card ${game.state}`, box, head,
    teamRow(game.away, game, decided && away > home),
    teamRow(game.home, game, decided && home > away),
    el('span', 'slot-badge'));
  card.dataset.id = game.id;
  card.style.setProperty('--away', game.away.color || '#4b5a8c');
  card.style.setProperty('--home', game.home.color || '#4b5a8c');
  return card;
}

const SECTIONS = [
  { state: 'in', title: 'Live now' },
  { state: 'pre', title: 'Upcoming' },
  { state: 'post', title: 'Final' }
];

function renderGames() {
  const parts = [];
  for (const { state, title } of SECTIONS) {
    const list = games.filter(g => g.state === state);
    if (!list.length) continue;
    parts.push(el('div', `section-title ${state === 'in' ? 'live' : ''}`, title),
      el('div', 'cards', ...list.map(renderCard)));
  }
  listEl.replaceChildren(...parts);
  syncCards();
}

async function loadGames() {
  try {
    games = await fetchGames();
    // Forget picks for games that dropped off the scoreboard.
    for (let i = selected.length - 1; i >= 0; i--) if (!gameById(selected[i])) selected.splice(i, 1);
    statusEl.textContent = games.length ? '' : 'No games found this week.';
    renderGames();
  } catch (e) {
    statusEl.textContent = String(e.message || e);
  }
}

// ---- open grid ----
function buildOpenRequest(chosen) {
  return {
    type: 'open-grid',
    layout: layoutEl.value,
    // Used only when chrome.system.display isn't available (Firefox).
    area: {
      left: screen.availLeft ?? 0,
      top: screen.availTop ?? 0,
      width: screen.availWidth,
      height: screen.availHeight
    },
    games: chosen.map(gameToSlot)
  };
}

async function renderSession() {
  const { grid, status } = await send({ type: 'get-session' });
  sessionEl.hidden = !grid;
  if (!grid) return;
  document.getElementById('mute-all').textContent = status && status.muted ? 'Restore audio' : 'Mute all';
  sessionListEl.replaceChildren(...grid.slots.map((slot, i) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    const active = status && !status.muted && status.audio === i;
    btn.className = active ? 'audio' : '';
    btn.textContent = `${active ? '🔊' : '🔇'} ${i + 1}  ${slot.label}`;
    btn.addEventListener('click', async () => {
      await send({ type: 'command', command: `audio-${i + 1}` });
      renderSession();
    });
    li.append(btn);
    return li;
  }));
}

openBtn.addEventListener('click', async () => {
  const chosen = selected.map(gameById);
  openBtn.disabled = true;
  try {
    await send(buildOpenRequest(chosen));
    // window.close() isn't reliable for a window an extension opened, so remove it explicitly.
    const self = await chrome.windows.getCurrent();
    await chrome.windows.remove(self.id);
  } catch (e) {
    statusEl.textContent = `Could not open the grid: ${e.message}`;
    openBtn.disabled = false;
  }
});

document.getElementById('mute-all').addEventListener('click', async () => {
  await send({ type: 'command', command: 'mute-all' });
  renderSession();
});

document.getElementById('close-grid').addEventListener('click', async () => {
  await send({ type: 'close-grid' });
  renderSession();
});

document.getElementById('refresh').addEventListener('click', loadGames);

layoutEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ layout: layoutEl.value });
  // If a grid is open, re-layout it live.
  await send({ type: 'command', command: 'set-layout', layout: layoutEl.value }).catch(() => {});
});

// ---- init ----
document.getElementById('max').textContent = String(MAX_GAMES);
await L.load().catch(() => {});
for (const [key, label] of Object.entries(L.LABELS)) {
  layoutEl.append(new Option(label, key));
}
const { layout } = await chrome.storage.local.get({ layout: L.DEFAULT });
layoutEl.value = layout in L.LABELS ? layout : L.DEFAULT;

renderDock();
renderSession().catch(() => {});
setInterval(() => renderSession().catch(() => {}), 3000);

await loadGames();
setInterval(loadGames, REFRESH_MS);
