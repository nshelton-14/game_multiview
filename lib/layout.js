// Layout presets as percentage rectangles, shared by the popup and the grid
// host content script (so this is a classic script that sets a global rather
// than an ES module). Position 0 is always the "main" slot.
(() => {
  const full = { x: 0, y: 0, width: 100, height: 100 };

  // Rows of near-equal size; a short last row stretches to the full width.
  const gridRects = n => {
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const out = [];
    for (let r = 0; r < rows; r++) {
      const inRow = r < rows - 1 ? cols : n - cols * (rows - 1);
      for (let c = 0; c < inRow; c++) {
        out.push({ x: c * 100 / inRow, y: r * 100 / rows, width: 100 / inRow, height: 100 / rows });
      }
    }
    return out;
  };

  const mainSide = (n, mainOnRight) => {
    const sideX = mainOnRight ? 0 : 60;
    return [
      { x: mainOnRight ? 40 : 0, y: 0, width: 60, height: 100 },
      ...Array.from({ length: n - 1 }, (_, i) => ({
        x: sideX, y: i * 100 / (n - 1), width: 40, height: 100 / (n - 1)
      }))
    ];
  };

  const mainTop = n => [
    { x: 0, y: 0, width: 100, height: 60 },
    ...Array.from({ length: n - 1 }, (_, i) => ({
      x: i * 100 / (n - 1), y: 60, width: 100 / (n - 1), height: 40
    }))
  ];

  const LABELS = {
    grid: 'Grid',
    columns: 'Columns',
    rows: 'Rows',
    'main-left': 'Main left',
    'main-right': 'Main right',
    'main-top': 'Main top'
  };

  // User-made layouts live in chrome.storage.local as { name: [rect, ...] }
  // (rect per position, position 0 = main) and show up in LABELS as "custom:<name>".
  const KEY = 'customLayouts';
  const PREFIX = 'custom:';
  let custom = {};

  const validRect = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k]));

  const setCustom = map => {
    for (const key of Object.keys(LABELS)) if (key.startsWith(PREFIX)) delete LABELS[key];
    custom = {};
    for (const [name, list] of Object.entries(map || {})) {
      if (!Array.isArray(list) || !list.length || !list.every(validRect)) continue;
      custom[name] = list;
      LABELS[PREFIX + name] = `★ ${name}`;
    }
  };

  const readCustom = async () => (await chrome.storage.local.get({ [KEY]: {} }))[KEY];
  const load = async () => setCustom(await readCustom());
  const save = async (name, list) => {
    const all = await readCustom();
    all[name] = list.map(({ x, y, width, height }) => ({ x, y, width, height }));
    await chrome.storage.local.set({ [KEY]: all });
    setCustom(all);
  };
  const remove = async name => {
    const all = await readCustom();
    delete all[name];
    await chrome.storage.local.set({ [KEY]: all });
    setCustom(all);
  };

  const rects = (name, n) => {
    if (name.startsWith(PREFIX) && custom[name.slice(PREFIX.length)]) {
      // Positions the layout doesn't define fall back to the grid arrangement.
      const saved = custom[name.slice(PREFIX.length)];
      const fallback = gridRects(n);
      return Array.from({ length: n }, (_, i) => ({ ...(saved[i] || fallback[i]) }));
    }
    if (n <= 1) return [{ ...full }];
    switch (name) {
      case 'columns': return Array.from({ length: n }, (_, i) => ({ x: i * 100 / n, y: 0, width: 100 / n, height: 100 }));
      case 'rows': return Array.from({ length: n }, (_, i) => ({ x: 0, y: i * 100 / n, width: 100, height: 100 / n }));
      case 'main-left': return mainSide(n, false);
      case 'main-right': return mainSide(n, true);
      case 'main-top': return mainTop(n);
      default: return gridRects(n);
    }
  };

  // Overlay-size choices, shared by the picker and the grid's control bar (stored as `uiScale`).
  const UI_SIZES = [['auto', 'Auto'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['2.5', '250%'], ['3', '300%']];

  globalThis.MVLayout = { LABELS, rects, load, save, remove, PREFIX, UI_SIZES, DEFAULT: 'grid' };
})();
