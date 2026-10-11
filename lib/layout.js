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

  const rects = (name, n) => {
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

  globalThis.MVLayout = { LABELS, rects, DEFAULT: 'grid' };
})();
