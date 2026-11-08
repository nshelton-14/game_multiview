// Grid host. When the background opens tv.youtube.com/live#mv-grid, this
// replaces the page with a borderless grid of same-origin YouTube TV iframes
// (same origin is what lets us mute each frame's <video> and restyle its
// player directly). Each iframe is named "mv:<slot>" so the geo/nav content
// scripts running inside it can look up their game.
(() => {
  if (window !== window.top || location.hash !== '#mv-grid') return;
  const L = globalThis.MVLayout;

  const FRAME_URL = 'https://tv.youtube.com/live';
  const HUD_IDLE_MS = 250;

  const send = async message => {
    const res = await chrome.runtime.sendMessage(message);
    if (!res || !res.ok) throw new Error((res && res.error) || 'No response from extension');
    return res.result;
  };
  const el = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const CSS = `
    html, body { margin: 0; height: 100%; background: #000; overflow: hidden; font: 13px system-ui, sans-serif; }
    #mv-grid { position: fixed; inset: 0; }
    .mv-tile { position: absolute; box-sizing: border-box; padding: 1px; }
    .mv-tile iframe { display: block; width: 100%; height: 100%; border: 0; background: #000; }
    .mv-tile::after { content: ''; position: absolute; inset: 1px; pointer-events: none; box-shadow: inset 0 0 0 2px transparent; }
    .mv-tile.audio::after { box-shadow: inset 0 0 0 2px #2f8cff, inset 0 0 18px rgba(47, 140, 255, .35); }
    #mv-edge { position: fixed; top: 0; left: 0; right: 0; height: 6px; z-index: 2147483646; }
    #mv-hud, #mv-edit-bar {
      --panel: #101730; --panel-2: #172042; --line: #243059; --text: #eef2ff; --muted: #8d9ac4; --accent: #2f8cff; --live: #ff3b4e;
      color: var(--text); zoom: var(--mv-ui, 1); font: 13px/1.2 system-ui, 'Segoe UI', sans-serif;
      background: linear-gradient(180deg, rgba(23, 32, 66, .96), rgba(10, 15, 33, .96));
      border: 1px solid var(--line); box-shadow: 0 12px 36px rgba(0, 0, 0, .6); backdrop-filter: blur(10px);
    }
    #mv-hud { position: fixed; top: 0; left: 50%; transform: translate(-50%, -125%); transition: transform .12s ease;
      z-index: 2147483647; display: flex; gap: 10px; align-items: center; padding: 10px 14px; border-top: 0;
      border-radius: 0 0 16px 16px; max-width: calc(96vw / var(--mv-ui, 1)); flex-wrap: wrap; justify-content: center; }
    #mv-hud.show { transform: translate(-50%, 0); }
    #mv-hud .sep { align-self: stretch; width: 1px; margin: 2px 2px; background: var(--line); }
    body.editing #mv-hud, body.editing #mv-edge { display: none; }
    /* name tag: top-centre, clear of YouTube TV's channel logo (left) and fullscreen button (right) */
    .mv-tag { zoom: var(--mv-ui, 1); position: absolute; top: 10px; left: 50%; z-index: 4; display: flex; align-items: center; gap: 8px; max-width: 90%;
      padding: 5px 12px 5px 5px; border-radius: 999px; pointer-events: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #eef2ff; font: 600 14px system-ui, 'Segoe UI', sans-serif; background: rgba(10, 15, 33, .9); border: 1px solid #243059;
      box-shadow: 0 6px 20px rgba(0, 0, 0, .5); opacity: 0; transform: translate(-50%, -4px); transition: opacity .12s, transform .12s; }
    .mv-tile:hover .mv-tag { opacity: 1; transform: translate(-50%, 0); }
    .mv-tag .n { display: grid; place-items: center; flex: none; width: 22px; height: 22px; border-radius: 50%; background: #2f8cff; font-size: 12px; font-weight: 800; }
    body.editing .mv-tag, body.swapping .mv-tag { display: none; }
    .mv-pick { position: absolute; inset: 1px; z-index: 5; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 4px; padding: 8px; text-align: center; cursor: pointer; color: #fff; text-shadow: 0 1px 4px #000; user-select: none;
      background: rgba(47, 140, 255, .28); outline: 3px solid #2f8cff; outline-offset: -3px; transition: background .12s; }
    .mv-pick:hover { background: rgba(47, 140, 255, .5); }
    .mv-pick b { font: 700 calc(clamp(13px, 1.6vw, 22px) * var(--mv-ui, 1)) system-ui, sans-serif; }
    .mv-pick span { font: 500 calc(clamp(11px, 1vw, 14px) * var(--mv-ui, 1)) system-ui, sans-serif; opacity: .9; }
    .mv-pick.source { background: rgba(10, 15, 33, .75); outline-style: dashed; }
    .mv-edit { position: absolute; inset: 1px; z-index: 5; display: flex; align-items: center; justify-content: center;
      background: rgba(47, 140, 255, .18); outline: 2px dashed #2f8cff; outline-offset: -2px; cursor: move;
      touch-action: none; user-select: none; color: #fff; font: 700 calc(15px * var(--mv-ui, 1)) system-ui, sans-serif; letter-spacing: .04em; text-shadow: 0 1px 4px #000; }
    .mv-handle { position: absolute; width: calc(14px * var(--mv-ui, 1)); height: calc(14px * var(--mv-ui, 1)); box-sizing: border-box; background: #2f8cff; border: 2px solid #fff; border-radius: 4px; }
    .mv-handle.nw { left: 0; top: 0; cursor: nwse-resize; }
    .mv-handle.n { left: calc(50% - 7px * var(--mv-ui, 1)); top: 0; cursor: ns-resize; }
    .mv-handle.ne { right: 0; top: 0; cursor: nesw-resize; }
    .mv-handle.e { right: 0; top: calc(50% - 7px * var(--mv-ui, 1)); cursor: ew-resize; }
    .mv-handle.se { right: 0; bottom: 0; cursor: nwse-resize; }
    .mv-handle.s { left: calc(50% - 7px * var(--mv-ui, 1)); bottom: 0; cursor: ns-resize; }
    .mv-handle.sw { left: 0; bottom: 0; cursor: nesw-resize; }
    .mv-handle.w { left: 0; top: calc(50% - 7px * var(--mv-ui, 1)); cursor: ew-resize; }
    #mv-edit-bar { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex;
      gap: 8px; align-items: center; padding: 10px 14px; border-radius: 14px; }
    #mv-edit-bar[hidden] { display: none; }
    #mv-edit-bar span { color: var(--muted); margin-right: 4px; }
    #mv-hud button, #mv-hud select, #mv-edit-bar button {
      font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
      padding: 7px 11px; cursor: pointer; transition: background .15s, border-color .15s;
    }
    #mv-hud button:hover, #mv-hud select:hover, #mv-edit-bar button:hover { background: var(--panel-2); border-color: #3a4a85; }
    #mv-hud button:focus-visible, #mv-hud select:focus-visible, #mv-edit-bar button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
    #mv-hud option { background: var(--panel); color: var(--text); }
    #mv-hud button.on { background: #12306a; border-color: var(--accent); }
    #mv-hud button[hidden] { display: none; }
    /* one pill per game: audio button, then small icon buttons */
    #mv-hud .group { display: flex; align-items: center; gap: 3px; padding: 4px; border: 1px solid var(--line); border-radius: 12px; background: rgba(8, 12, 24, .55); }
    #mv-hud .group.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 4px 16px rgba(47, 140, 255, .3); }
    #mv-hud .group button, #mv-hud .group select { border-color: transparent; background: transparent; padding: 6px 8px; }
    #mv-hud .group button:hover, #mv-hud .group select:hover { background: var(--panel-2); }
    #mv-hud .group button.audio { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; padding: 4px 10px 4px 4px; }
    #mv-hud .group button.audio.on { background: #12306a; }
    #mv-hud .n { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #2b3768; font-size: 12px; font-weight: 800; }
    #mv-hud .group.active .n { background: var(--accent); }
    /* No native arrow: it was clipping the swap icon. The icon alone says "pick a game". */
    #mv-hud .group select { appearance: none; -webkit-appearance: none; width: 34px; padding: 6px 0; text-align: center; text-align-last: center; }
    #mv-hud .danger { color: #ffb4be; background: #3a1620; border-color: #6b2230; }
    #mv-hud .danger:hover { background: #55202e; border-color: #8a2d40; }
    #mv-edit-bar button.primary { border: 0; color: #fff; font-weight: 700; background: linear-gradient(135deg, #2f8cff, #6a5cff); }
    #mv-edit-bar button.primary:hover { filter: brightness(1.1); }
    #mv-banner { zoom: var(--mv-ui, 1); position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      padding: 10px 18px; border-radius: 999px; color: #eef2ff; font: 600 13px system-ui, sans-serif; cursor: pointer;
      background: rgba(16, 23, 48, .94); border: 1px solid #2f8cff; box-shadow: 0 8px 28px rgba(47, 140, 255, .35); }
    #mv-banner[hidden] { display: none; }
    .mv-error { color: #fff; padding: 32px; }
  `;

  let slots = [];
  let order = []; // order[tile] = layout position the tile occupies
  const state = { audio: 0, muted: false, layout: L.DEFAULT, focus: -1, editing: false };
  const tiles = [];
  const watchedDocs = new WeakSet();
  let hud, edge, banner, hudTimer, hudPinned = false;

  const frameDoc = frame => {
    try { return frame.contentDocument; } catch (err) { return null; }
  };

  // ---- audio ----
  function canUnmute(i) {
    // Chrome pauses media that is unmuted before the user has interacted with the page.
    try {
      return navigator.userActivation.hasBeenActive ||
        tiles[i].frame.contentWindow.navigator.userActivation.hasBeenActive;
    } catch (err) {
      return true;
    }
  }

  function enforceMedia() {
    // Tell each frame's audio-guard (inject/audio-guard.js) which frame may have sound.
    const open = !state.muted && canUnmute(state.audio);
    document.documentElement.setAttribute('data-mv-audio', open ? String(state.audio) : '-1');
    tiles.forEach((t, i) => {
      const doc = frameDoc(t.frame);
      if (!doc) return;
      const mute = state.muted || i !== state.audio || !canUnmute(i);
      doc.querySelectorAll('video, audio').forEach(media => {
        if (media.muted !== mute) media.muted = mute;
      });
      if (!watchedDocs.has(doc)) {
        watchedDocs.add(doc);
        for (const name of ['play', 'playing', 'volumechange', 'loadedmetadata']) {
          doc.addEventListener(name, enforceMedia, true);
        }
      }
    });
  }

  // The name tag shown while hovering a window: its number, the teams, and whether it has audio.
  function renderTags() {
    tiles.forEach((t, i) => {
      const hasAudio = !state.muted && i === state.audio;
      t.tag.replaceChildren(
        el('span', { className: 'n', textContent: String(i + 1) }),
        `${t.label}${hasAudio ? ' 🔊' : ''}`);
    });
  }

  function applyAudio() {
    tiles.forEach((t, i) => t.tile.classList.toggle('audio', !state.muted && i === state.audio));
    renderTags();
    enforceMedia();
    banner.hidden = state.muted || canUnmute(state.audio);
  }

  function selectAudio(i, { keepMuted = false } = {}) {
    state.audio = i;
    if (!keepMuted) state.muted = false;
    if (state.focus >= 0) { state.focus = i; applyLayout(); } // focus follows audio
    applyAudio();
    renderHud();
  }

  // ---- per-game refresh ----
  // A plain reload makes the page ask for its location again (the geo bridge
  // re-fetches it from the background). `fromGuide` goes back to the guide
  // instead, so a game can be picked again after leaving it.
  function refreshFrame(i, { fromGuide = false } = {}) {
    const { frame } = tiles[i];
    const win = frame.contentWindow;
    try {
      if (fromGuide) {
        win.location.assign(FRAME_URL);
      } else {
        win.location.reload();
      }
    } catch (err) {
      // Frame is on another origin or detached: fall back to re-setting src.
      frame.src = FRAME_URL;
    }
  }

  // ---- overlay size (the control bar, name tags and editor; the video itself is untouched) ----
  // 'auto' grows the overlays on large screens: a 4K display at 100% browser scaling is 3840
  // CSS px wide, so it scales by width / 1920 (rounded to quarters, 1x to 3x).
  let uiScale = 'auto';

  function applyScale() {
    const auto = Math.round(Math.min(3, Math.max(1, innerWidth / 1920)) * 4) / 4;
    const scale = uiScale === 'auto' ? auto : Number(uiScale) || 1;
    document.documentElement.style.setProperty('--mv-ui', String(scale));
  }

  function setUiScale(value) {
    uiScale = value;
    applyScale();
    renderHud();
  }

  // ---- swap a window's game ----
  let gameList = []; // [{id, label, text}] from the background (ESPN scoreboard)

  async function loadGames() {
    try {
      gameList = await send({ type: 'list-games' });
      // Don't rebuild the bar under an open drop-down.
      if (!hud.contains(document.activeElement)) renderHud();
    } catch (err) {
      console.info('[Game Multiview] Could not load the game list', err);
    }
  }

  async function swapGame(i, id) {
    if (!id) return;
    try {
      const { label } = await send({ type: 'swap-game', index: i, id });
      tiles[i].label = label;
      renderTags();
      renderHud();
      // Back to the guide; the reload fetches the new game's location.
      refreshFrame(i, { fromGuide: true });
    } catch (err) {
      console.error('[Game Multiview] Could not swap the game', err);
      renderHud();
    }
  }

  // ---- layout ----
  function applyLayout() {
    const rects = L.rects(state.layout, tiles.length);
    tiles.forEach((t, i) => {
      // A focused tile covers the whole grid; the others keep their place
      // underneath, so they stay mounted and keep playing.
      const focused = i === state.focus;
      const r = state.editing ? editRects[i]
        : focused ? { x: 0, y: 0, width: 100, height: 100 } : rects[order[i]];
      Object.assign(t.tile.style, {
        left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%`,
        // While editing, the tile being dragged sits on top of the others.
        zIndex: state.editing ? (i === editTop ? '3' : '2') : focused ? '1' : ''
      });
    });
  }

  // ---- custom layouts: drag and resize the windows, then save the result ----
  const SNAP = 2.5; // % grid the edges snap to (they also snap to other windows' edges)
  const MIN_SIZE = 10;
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  let editRects = [];
  let editTop = -1;
  let editBar;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const snapTo = (v, edges) => edges.reduce(
    (best, e) => (Math.abs(e - v) < Math.abs(best - v) ? e : best), Math.round(v / SNAP) * SNAP);

  // The rectangle `start` would become after dragging by (dx, dy) percent.
  function draggedRect(i, start, dir, dx, dy) {
    const others = editRects.filter((_, j) => j !== i);
    const xs = others.flatMap(r => [r.x, r.x + r.width]);
    const ys = others.flatMap(r => [r.y, r.y + r.height]);
    let left = start.x, right = start.x + start.width, top = start.y, bottom = start.y + start.height;
    if (dir === 'move') {
      // Snap whichever of the two edges is closer to a guide.
      const fit = (lo, size, guides, delta) => {
        const a = snapTo(lo + delta, guides);
        const b = snapTo(lo + size + delta, guides) - size;
        return clamp(Math.abs(a - lo - delta) <= Math.abs(b - lo - delta) ? a : b, 0, 100 - size);
      };
      return {
        x: fit(start.x, start.width, xs, dx), y: fit(start.y, start.height, ys, dy),
        width: start.width, height: start.height
      };
    }
    if (dir.includes('w')) left = clamp(snapTo(left + dx, xs), 0, right - MIN_SIZE);
    if (dir.includes('e')) right = clamp(snapTo(right + dx, xs), left + MIN_SIZE, 100);
    if (dir.includes('n')) top = clamp(snapTo(top + dy, ys), 0, bottom - MIN_SIZE);
    if (dir.includes('s')) bottom = clamp(snapTo(bottom + dy, ys), top + MIN_SIZE, 100);
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function buildEditOverlay(i) {
    const box = el('div', { className: 'mv-edit' }, `${i + 1}  ${tiles[i].label}`);
    for (const dir of HANDLES) {
      const handle = el('div', { className: `mv-handle ${dir}` });
      handle.dataset.dir = dir;
      box.append(handle);
    }
    box.addEventListener('pointerdown', e => {
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      editTop = i;
      const dir = e.target.dataset.dir || 'move';
      const start = { ...editRects[i] };
      const onMove = ev => {
        editRects[i] = draggedRect(i, start, dir,
          (ev.clientX - e.clientX) / innerWidth * 100, (ev.clientY - e.clientY) / innerHeight * 100);
        applyLayout();
      };
      const onUp = () => {
        for (const [name, fn] of [['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp]]) {
          box.removeEventListener(name, fn);
        }
      };
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp);
      box.addEventListener('pointercancel', onUp);
      applyLayout();
    });
    return box;
  }

  function resetEdit() {
    const rects = L.rects(state.layout, tiles.length);
    editRects = tiles.map((_, i) => ({ ...rects[order[i]] }));
    applyLayout();
  }

  function startEdit() {
    if (state.editing) return;
    endSwap();
    state.focus = -1;
    state.editing = true;
    editTop = -1;
    document.body.classList.add('editing');
    editBar.hidden = false;
    tiles.forEach((t, i) => t.tile.append(buildEditOverlay(i)));
    resetEdit();
  }

  function endEdit() {
    state.editing = false;
    document.body.classList.remove('editing');
    editBar.hidden = true;
    tiles.forEach(t => t.tile.querySelector('.mv-edit')?.remove());
    applyLayout();
    renderHud();
  }

  async function saveEdit() {
    const current = state.layout.startsWith(L.PREFIX) ? state.layout.slice(L.PREFIX.length) : '';
    const name = (prompt('Name this layout (an existing name is overwritten):', current) || '').trim().slice(0, 40);
    if (!name) return;
    // Saved by position (position 0 is the main window), not by tile.
    const list = [];
    tiles.forEach((_, i) => { list[order[i]] = editRects[i]; });
    try {
      await L.save(name, list);
    } catch (err) {
      console.error('[Game Multiview] Could not save the layout', err);
      return;
    }
    endEdit();
    setLayout(L.PREFIX + name);
  }

  async function deleteLayout() {
    if (!state.layout.startsWith(L.PREFIX)) return;
    const name = state.layout.slice(L.PREFIX.length);
    if (!confirm(`Delete the layout "${name}"?`)) return;
    await L.remove(name).catch(() => {});
    setLayout(L.DEFAULT);
  }

  // Temporarily show one game full-window; call again (or pass its index again) to go back.
  function toggleFocus(i = state.audio) {
    if (state.editing) return;
    endSwap();
    state.focus = state.focus === i ? -1 : i;
    if (state.focus >= 0) {
      selectAudio(i); // renders the bar
    } else {
      renderHud();
    }
    applyLayout();
  }

  function setLayout(name) {
    if (!L.LABELS[name]) return;
    state.layout = name;
    applyLayout();
    renderHud();
    send({ type: 'grid-layout', layout: name }).catch(() => {});
  }

  function swapOrder(i, j) {
    [order[i], order[j]] = [order[j], order[i]];
    applyLayout();
  }

  function makeMain(i) {
    swapOrder(i, order.indexOf(0));
  }

  // Swap places with any other window: pick one, then click the window to trade with.
  // Only the windows' positions change; the frames keep playing without reloading.
  let swapFrom = -1;

  function endSwap() {
    swapFrom = -1;
    document.body.classList.remove('swapping');
    tiles.forEach(t => t.tile.querySelector('.mv-pick')?.remove());
  }

  function startSwap(i) {
    if (state.editing) return;
    const same = swapFrom === i;
    endSwap();
    if (same) return; // pressing the button again cancels
    swapFrom = i;
    document.body.classList.add('swapping'); // the overlays already label every window
    // Clear the control bar away so every window can be seen and clicked.
    clearTimeout(hudTimer);
    hud.classList.remove('show');
    tiles.forEach((t, j) => {
      const source = j === i;
      const pick = el('div', { className: `mv-pick${source ? ' source' : ''}` },
        el('b', { textContent: `${j + 1}  ${t.label}` }),
        el('span', { textContent: source ? 'Moving this window: click another to swap with it' : 'Click to swap here' }));
      pick.addEventListener('click', () => {
        if (!source) swapOrder(i, j);
        endSwap();
      });
      t.tile.append(pick);
    });
  }

  // ---- borderless player ----
  // YouTube TV renders its control bar and its settings menu (speed, captions, audio track,
  // quality) outside the player element. The fit rules hide everything outside the player, and
  // a hidden container makes an opened menu inherit "hidden" and never appear. So the branches
  // leading to these elements are marked data-mv-keep and left out of the hiding rule.
  const KEEP_TARGETS = ['ytu-player-controls', '#id-settings-menu'];
  const FIT_CSS = `
    html[data-mv-fit="true"], html[data-mv-fit="true"] body { overflow: hidden !important; }
    html[data-mv-fit="true"] [data-mv-anc] { transform: none !important; filter: none !important; perspective: none !important; contain: none !important; position: static !important; overflow: visible !important; opacity: 1 !important; clip-path: none !important; }
    html[data-mv-fit="true"] [data-mv-anc] > :not([data-mv-anc]):not([data-mv-keep]):not([data-mv-root]):not(style):not(link):not(script) { visibility: hidden !important; }
    html[data-mv-fit="true"] #id-settings-menu { z-index: 2147483647 !important; }
    html[data-mv-fit="true"] [data-mv-root] { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; min-width: 0 !important; min-height: 0 !important; max-width: none !important; max-height: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; overflow: hidden !important; z-index: 2147483646 !important; background: #000 !important; visibility: visible !important; }
    html[data-mv-fit="true"] [data-mv-root] video, html[data-mv-fit="true"] video[data-mv-root] { width: 100% !important; height: 100% !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
  `;

  // On a /watch page, make the player fill the frame and hide everything else.
  function fitFrame(frame) {
    const doc = frameDoc(frame);
    if (!doc || !doc.documentElement || !doc.location) return;
    const watching = doc.location.pathname.startsWith('/watch');
    doc.documentElement.dataset.mvFit = String(watching);
    if (!watching) return;
    for (const selector of KEEP_TARGETS) {
      const target = doc.querySelector(selector);
      if (!target || target.hasAttribute('data-mv-keep')) continue;
      for (let node = target; node && node !== doc.documentElement; node = node.parentElement) {
        node.setAttribute('data-mv-keep', '');
      }
    }
    // The /watch page keeps the guide mounted behind the player, and the guide
    // has dozens of thumbnail <video>s, so never pick "the largest video":
    // use the real player (#movie_player, which holds video.html5-main-video).
    const root = doc.querySelector('#movie_player') || doc.querySelector('.html5-video-player');
    if (!root || !root.querySelector('video')) return;
    if (!root.hasAttribute('data-mv-root')) {
      doc.querySelectorAll('[data-mv-root], [data-mv-anc]').forEach(node => {
        node.removeAttribute('data-mv-root');
        node.removeAttribute('data-mv-anc');
      });
      root.setAttribute('data-mv-root', '');
      for (let node = root.parentElement; node && node !== doc.documentElement; node = node.parentElement) {
        node.setAttribute('data-mv-anc', '');
      }
    }
    if (!doc.getElementById('mv-fit-style')) {
      const style = doc.createElement('style');
      style.id = 'mv-fit-style';
      style.textContent = FIT_CSS;
      doc.documentElement.append(style);
    }
  }

  // ---- control bar ----
  function showHud() {
    clearTimeout(hudTimer);
    hud.classList.add('show');
  }
  function scheduleHide() {
    clearTimeout(hudTimer);
    // Stay open while a drop-down is focused, or its list would close with the bar.
    if (hudPinned || hud.contains(document.activeElement)) return;
    hudTimer = setTimeout(() => hud.classList.remove('show'), HUD_IDLE_MS);
  }

  function renderHud() {
    const buttons = tiles.map((t, i) => {
      const active = !state.muted && i === state.audio;
      const audio = el('button', {
        title: 'Play audio from this game',
        className: `audio${active ? ' on' : ''}`
      }, el('span', { className: 'n', textContent: String(i + 1) }), `${t.label} ${active ? '🔊' : '🔇'}`);
      audio.addEventListener('click', () => selectAudio(i));
      const star = el('button', { textContent: '★', title: 'Make this the main window' });
      star.addEventListener('click', () => makeMain(i));
      const swapBtn = el('button', {
        textContent: '⇆',
        title: 'Swap places with another window',
        className: swapFrom === i ? 'on' : ''
      });
      swapBtn.addEventListener('click', () => startSwap(i));
      const focused = state.focus === i;
      const zoom = el('button', {
        textContent: focused ? '⤡' : '⤢',
        title: focused ? 'Back to the multiview' : 'Show only this game',
        className: focused ? 'on' : ''
      });
      zoom.addEventListener('click', () => toggleFocus(i));
      const refresh = el('button', {
        textContent: '↻',
        title: 'Reload this game (Shift-click: go back to the guide)'
      });
      refresh.addEventListener('click', e => refreshFrame(i, { fromGuide: e.shiftKey }));

      // Replace this window's game with another from today's list.
      const swap = el('select', { title: 'Replace this game: pick another from the list' });
      swap.append(new Option('☰', ''));
      const inUse = new Set(tiles.map(x => x.label));
      for (const game of gameList.filter(g => !inUse.has(g.label))) {
        swap.append(new Option(game.text, game.id));
      }
      swap.addEventListener('change', () => { swapGame(i, swap.value); swap.blur(); });
      swap.addEventListener('blur', scheduleHide);
      return el('div', { className: `group${active ? ' active' : ''}` }, audio, zoom, star, swapBtn, refresh, swap);
    });

    const layout = el('select', { title: 'Layout' });
    for (const [key, label] of Object.entries(L.LABELS)) {
      layout.append(new Option(label, key, false, key === state.layout));
    }
    layout.addEventListener('change', () => setLayout(layout.value));

    const edit = el('button', { textContent: '✎', title: 'Edit the layout: drag and resize the windows, then save it' });
    edit.addEventListener('click', startEdit);
    const del = el('button', { textContent: '🗑', title: 'Delete this saved layout' });
    del.addEventListener('click', deleteLayout);
    del.hidden = !state.layout.startsWith(L.PREFIX);

    const size = el('select', { title: 'Overlay size (control bar, name tags, editor)' });
    for (const [value, label] of L.UI_SIZES) size.append(new Option(`Aa ${label}`, value, false, value === uiScale));
    size.addEventListener('change', () => {
      setUiScale(size.value);
      chrome.storage.local.set({ uiScale: size.value }).catch(() => {});
      size.blur();
    });
    size.addEventListener('blur', scheduleHide);

    const mute = el('button', { textContent: state.muted ? 'Restore audio' : 'Mute all' });
    mute.addEventListener('click', () => { state.muted = !state.muted; applyAudio(); renderHud(); });
    const full = el('button', { textContent: '⛶', title: 'Toggle fullscreen' });
    full.addEventListener('click', () => send({ type: 'grid-fullscreen' }).catch(() => {}));
    const close = el('button', { textContent: '✕', title: 'Close grid', className: 'danger' });
    close.addEventListener('click', () => send({ type: 'close-grid' }).catch(() => {}));

    hud.replaceChildren(...buttons, el('span', { className: 'sep' }), layout, size, edit, del, mute, full, close);
  }

  // ---- commands from the background (keyboard shortcuts, popup) ----
  function handleCommand(msg) {
    const n = tiles.length;
    const audioN = /^audio-(\d)$/.exec(msg.command);
    if (audioN) {
      const i = Number(audioN[1]) - 1;
      if (i < n) selectAudio(i);
      return;
    }
    switch (msg.command) {
      case 'cycle-audio': selectAudio((state.audio + 1) % n); break;
      case 'last-audio': selectAudio((state.audio + n - 1) % n); break;
      case 'mute-all': state.muted = !state.muted; applyAudio(); renderHud(); break;
      case 'toggle-focus': toggleFocus(); break;
      case 'toggle-menus':
        hudPinned = !hudPinned;
        if (hudPinned) showHud(); else scheduleHide();
        break;
      case 'set-layout': setLayout(msg.layout); break;
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === 'mv-status') {
      reply({ audio: state.audio, muted: state.muted, layout: state.layout });
    } else if (msg.type === 'mv-command') {
      handleCommand(msg);
      reply({ ok: true });
    }
  });

  // ---- mount ----
  function showError(error) {
    document.documentElement.replaceChildren(el('body', {
      style: 'margin:0;padding:32px;background:#000;color:#fff;font:16px system-ui,sans-serif'
    }, `Game Multiview could not start: ${error.message || error}`));
  }

  function mount(boot) {
    slots = boot.slots;
    order = slots.map((_, i) => i);
    state.layout = L.LABELS[boot.layout] ? boot.layout : L.DEFAULT;

    const root = document.documentElement;
    root.replaceChildren();
    const body = el('body');
    root.append(el('head', {}, el('title', { textContent: 'Game Multiview' }), el('style', { textContent: CSS })), body);

    const grid = el('div', { id: 'mv-grid' });
    slots.forEach((slot, i) => {
      // allow/name must be set before src so the frame boots with them.
      const frame = el('iframe', {
        name: `mv:${i}`,
        allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture',
        src: FRAME_URL
      });
      const tile = el('div', { className: 'mv-tile' }, frame);
      frame.addEventListener('load', () => { enforceMedia(); fitFrame(frame); });
      const tag = el('div', { className: 'mv-tag' });
      tile.append(tag);
      tiles.push({ tile, frame, label: slot.label, tag });
      grid.append(tile);
    });

    edge = el('div', { id: 'mv-edge' });
    hud = el('div', { id: 'mv-hud' });
    banner = el('div', { id: 'mv-banner', textContent: 'Click a game to enable sound', hidden: true });
    edge.addEventListener('mouseenter', showHud);
    edge.addEventListener('mouseleave', scheduleHide);
    hud.addEventListener('mouseenter', showHud);
    hud.addEventListener('mouseleave', scheduleHide);
    banner.addEventListener('click', () => applyAudio());

    const button = (text, title, onClick, className = '') => {
      const b = el('button', { textContent: text, title, className });
      b.addEventListener('click', onClick);
      return b;
    };
    editBar = el('div', { id: 'mv-edit-bar', hidden: true },
      el('span', { textContent: 'Drag to move, drag the handles to resize' }),
      button('Save as…', 'Save this arrangement as a named layout', saveEdit, 'primary'),
      button('Reset', 'Start again from the current layout', resetEdit),
      button('Cancel', 'Leave without saving', endEdit));
    body.append(grid, edge, hud, banner, editBar);

    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (state.editing) endEdit();
      else if (swapFrom >= 0) endSwap();
    });

    // Clicking into a frame moves focus to it; treat that as "play this one's audio".
    window.addEventListener('blur', () => setTimeout(() => {
      const i = tiles.findIndex(t => t.frame === document.activeElement);
      if (i >= 0 && i !== state.audio) selectAudio(i, { keepMuted: state.muted });
      else if (i >= 0) applyAudio();
    }, 0));

    applyLayout();
    applyAudio();
    renderHud();
    showHud();
    scheduleHide();
    setInterval(() => {
      enforceMedia();
      tiles.forEach(t => fitFrame(t.frame));
      banner.hidden = state.muted || canUnmute(state.audio);
    }, 1000);

    send({ type: 'grid-ready' }).catch(() => {});
    loadGames();
    setInterval(loadGames, 60000);

    // Overlay size is a saved setting shared with the picker.
    applyScale();
    window.addEventListener('resize', applyScale); // 'auto' follows the window width
    chrome.storage.local.get({ uiScale: 'auto' }).then(v => setUiScale(String(v.uiScale))).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.uiScale && String(changes.uiScale.newValue) !== uiScale) {
        setUiScale(String(changes.uiScale.newValue));
      }
    });
  }

  // Visible progress so a stuck start-up is distinguishable from the script not running.
  const showStatus = text => document.documentElement.replaceChildren(el('body', {
    style: 'margin:0;padding:32px;background:#000;color:#fff;font:16px system-ui,sans-serif'
  }, text));
  function start() {
    // Stop the YouTube TV app from loading further. This must happen after the
    // document has parsed: calling stop() at document_start leaves Chrome with
    // a page that never paints (a blank grey window).
    window.stop();
    showStatus('Game Multiview: starting…');
    console.info('[Game Multiview] host started', location.href);

    send({ type: 'grid-bootstrap' }).then(boot => {
      console.info('[Game Multiview] bootstrap ok', boot);
      // Saved layouts must be registered before mount checks the layout name.
      return L.load().catch(() => {}).then(() => mount(boot));
    }).catch(error => {
      console.error('[Game Multiview] start-up failed', error);
      showError(error);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
