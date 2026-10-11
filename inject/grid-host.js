// Grid host. When the background opens tv.youtube.com/live#mv-grid, this
// replaces the page with a borderless grid of same-origin YouTube TV iframes
// (same origin is what lets us mute each frame's <video> and restyle its
// player directly). Each iframe is named "mv:<slot>" so the geo/nav content
// scripts running inside it can look up their game.
(() => {
  if (window !== window.top || location.hash !== '#mv-grid') return;
  const L = globalThis.MVLayout;

  const FRAME_URL = 'https://tv.youtube.com/live';
  const HUD_IDLE_MS = 1500;

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
    .mv-tile.audio::after { box-shadow: inset 0 0 0 2px #0a84ff; }
    #mv-edge { position: fixed; top: 0; left: 0; right: 0; height: 6px; z-index: 2147483646; }
    #mv-hud { position: fixed; top: 0; left: 50%; transform: translate(-50%, -120%); transition: transform .15s;
      z-index: 2147483647; display: flex; gap: 6px; align-items: center; padding: 8px 10px; color: #fff;
      background: rgba(0, 0, 0, .85); border-radius: 0 0 10px 10px; max-width: 96vw; flex-wrap: wrap; justify-content: center; }
    #mv-hud.show { transform: translate(-50%, 0); }
    #mv-hud button, #mv-hud select { font: inherit; color: #fff; background: #333; border: 1px solid #555; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
    #mv-hud button.on { background: #0a84ff; border-color: #0a84ff; }
    #mv-hud .group { display: flex; gap: 2px; }
    #mv-banner { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647;
      padding: 8px 14px; border-radius: 8px; color: #fff; background: rgba(0, 0, 0, .85); cursor: pointer; }
    #mv-banner[hidden] { display: none; }
    .mv-error { color: #fff; padding: 32px; }
  `;

  let slots = [];
  let order = []; // order[tile] = layout position the tile occupies
  const state = { audio: 0, muted: false, layout: L.DEFAULT };
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

  function applyAudio() {
    tiles.forEach((t, i) => t.tile.classList.toggle('audio', !state.muted && i === state.audio));
    enforceMedia();
    banner.hidden = state.muted || canUnmute(state.audio);
  }

  function selectAudio(i, { keepMuted = false } = {}) {
    state.audio = i;
    if (!keepMuted) state.muted = false;
    applyAudio();
    renderHud();
  }

  // ---- per-game refresh ----
  // A plain reload makes the page ask for its location again (the geo bridge
  // re-fetches it from the background). `fromGuide` also clears guide-nav's
  // once-per-slot flag and loads the guide, so the game is searched for anew.
  function refreshFrame(i, { fromGuide = false } = {}) {
    const { frame } = tiles[i];
    const win = frame.contentWindow;
    try {
      if (fromGuide) {
        win.sessionStorage.removeItem(`mv-nav-done:${i}`);
        win.location.assign(FRAME_URL);
      } else {
        win.location.reload();
      }
    } catch (err) {
      // Frame is on another origin or detached: fall back to re-setting src.
      frame.src = FRAME_URL;
    }
  }

  // ---- layout ----
  function applyLayout() {
    const rects = L.rects(state.layout, tiles.length);
    tiles.forEach((t, i) => {
      const r = rects[order[i]];
      Object.assign(t.tile.style, { left: `${r.x}%`, top: `${r.y}%`, width: `${r.width}%`, height: `${r.height}%` });
    });
  }

  function setLayout(name) {
    if (!L.LABELS[name]) return;
    state.layout = name;
    applyLayout();
    renderHud();
    send({ type: 'grid-layout', layout: name }).catch(() => {});
  }

  function makeMain(i) {
    const j = order.indexOf(0);
    [order[i], order[j]] = [order[j], order[i]];
    applyLayout();
  }

  // ---- borderless player ----
  const FIT_CSS = `
    html[data-mv-fit="true"], html[data-mv-fit="true"] body { overflow: hidden !important; }
    html[data-mv-fit="true"] [data-mv-anc] { transform: none !important; filter: none !important; perspective: none !important; contain: none !important; position: static !important; overflow: visible !important; opacity: 1 !important; clip-path: none !important; }
    html[data-mv-fit="true"] [data-mv-anc] > :not([data-mv-anc]):not([data-mv-root]):not(style):not(link):not(script) { visibility: hidden !important; }
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
    if (hudPinned) return;
    hudTimer = setTimeout(() => hud.classList.remove('show'), HUD_IDLE_MS);
  }

  function renderHud() {
    const buttons = tiles.map((t, i) => {
      const audio = el('button', {
        textContent: `${!state.muted && i === state.audio ? '🔊' : '🔇'} ${i + 1} ${t.label}`,
        title: 'Play audio from this game',
        className: !state.muted && i === state.audio ? 'on' : ''
      });
      audio.addEventListener('click', () => selectAudio(i));
      const star = el('button', { textContent: '★', title: 'Make this the main window' });
      star.addEventListener('click', () => makeMain(i));
      const refresh = el('button', {
        textContent: '↻',
        title: 'Reload this game (Shift-click: restart from the guide and find the game again)'
      });
      refresh.addEventListener('click', e => refreshFrame(i, { fromGuide: e.shiftKey }));
      return el('div', { className: 'group' }, audio, star, refresh);
    });

    const layout = el('select', { title: 'Layout' });
    for (const [key, label] of Object.entries(L.LABELS)) {
      layout.append(new Option(label, key, false, key === state.layout));
    }
    layout.addEventListener('change', () => setLayout(layout.value));

    const mute = el('button', { textContent: state.muted ? 'Restore audio' : 'Mute all' });
    mute.addEventListener('click', () => { state.muted = !state.muted; applyAudio(); renderHud(); });
    const full = el('button', { textContent: '⛶', title: 'Toggle fullscreen' });
    full.addEventListener('click', () => send({ type: 'grid-fullscreen' }).catch(() => {}));
    const close = el('button', { textContent: '✕', title: 'Close grid' });
    close.addEventListener('click', () => send({ type: 'close-grid' }).catch(() => {}));

    hud.replaceChildren(...buttons, layout, mute, full, close);
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
      tiles.push({ tile, frame, label: slot.label });
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
    body.append(grid, edge, hud, banner);

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
      mount(boot);
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
