import { fetchGames } from '../lib/espn.js';
import { gameToSlot } from '../lib/slot.js';

const L = globalThis.MVLayout;
const MAX_GAMES = 4;

const statusEl = document.getElementById('status');
const listEl = document.getElementById('games');
const openBtn = document.getElementById('open');
const layoutEl = document.getElementById('layout');
const sessionEl = document.getElementById('session');
const sessionListEl = document.getElementById('session-list');

let games = [];
const selected = []; // game ids in the order they were checked; index 0 is the main window
const slotEls = new Map();
const boxEls = new Map();

const send = async message => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res || !res.ok) throw new Error(res && res.error);
  return res.result;
};

function updateSlots() {
  for (const [id, el] of slotEls) {
    const i = selected.indexOf(id);
    el.textContent = i === -1 ? '' : String(i + 1);
  }
  openBtn.disabled = selected.length === 0;
}

function renderGame(game) {
  const li = document.createElement('li');
  li.className = game.state;

  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.addEventListener('change', () => {
    const i = selected.indexOf(game.id);
    if (box.checked && i === -1) {
      if (selected.length >= MAX_GAMES) {
        box.checked = false;
        statusEl.textContent = `You can watch up to ${MAX_GAMES} games at once.`;
        return;
      }
      selected.push(game.id);
    }
    if (!box.checked && i !== -1) selected.splice(i, 1);
    statusEl.textContent = '';
    updateSlots();
  });
  boxEls.set(game.id, box);

  const slot = document.createElement('span');
  slot.className = 'slot';
  slotEls.set(game.id, slot);

  const teams = document.createElement('div');
  teams.className = 'teams';
  teams.textContent = `${game.away.name} @ ${game.home.name}`;

  const meta = document.createElement('div');
  meta.className = 'meta';
  if (game.state === 'in') {
    const live = document.createElement('span');
    live.className = 'live';
    live.textContent = 'LIVE ';
    meta.append(live);
  }
  const score = game.state === 'pre' ? '' : `${game.away.score}-${game.home.score} · `;
  meta.append(`${score}${game.detail}${game.networks.length ? ' · ' + game.networks.join(', ') : ''}`);
  teams.append(meta);

  label.append(box, slot, teams);
  li.append(label);
  return li;
}

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
  if (status && L.LABELS[status.layout]) layoutEl.value = status.layout;
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
  const chosen = selected.map(id => games.find(g => g.id === id));
  openBtn.disabled = true;
  try {
    await send(buildOpenRequest(chosen));
    window.close();
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

layoutEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ layout: layoutEl.value });
  // If a grid is open, re-layout it live.
  await send({ type: 'command', command: 'set-layout', layout: layoutEl.value }).catch(() => {});
});

// init
for (const [key, label] of Object.entries(L.LABELS)) {
  layoutEl.append(new Option(label, key));
}
const { layout } = await chrome.storage.local.get({ layout: L.DEFAULT });
layoutEl.value = layout in L.LABELS ? layout : L.DEFAULT;

renderSession().catch(() => {});

try {
  games = await fetchGames();
  statusEl.textContent = games.length ? '' : 'No games found this week.';
  listEl.append(...games.map(renderGame));
} catch (e) {
  statusEl.textContent = String(e.message || e);
}
