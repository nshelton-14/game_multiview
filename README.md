# Game Multiview

Pick live NFL games in a picker window and watch them together in one borderless
YouTube TV grid. Each grid frame gets its own spoofed geolocation (the home
team's market).

## Load it
- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select this folder.
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `manifest.json`.

Disable the standalone Spoof Geolocation extension so it doesn't interfere.

## Using it
- Click the toolbar icon to open the picker, then check up to 8 games (the first one checked is the main window), pick a layout, click **Open grid**.
- Move the mouse to the very top edge of the grid to reveal the control bar: per-game audio buttons, ★ to make a game the main window, layout picker, mute all, fullscreen, close.
- Audio: one game plays at a time. Click a game to hear it, use the control bar or the picker window, or use shortcuts: **Alt+Shift+A** cycle, **Alt+Shift+X** mute all, **Alt+Shift+M** pin/unpin the control bar. Extra unbound shortcuts (audio 1–8, previous) can be set at `chrome://extensions/shortcuts`.
- Custom layouts: click **✎** in the control bar, drag the windows and their handles into place (edges snap to a grid and to each other), then **Save as…**. Saved layouts appear in the layout pickers (in the control bar and the popup) marked with ★; select one and click **🗑** to delete it. **Esc** leaves edit mode without saving.
- Chrome blocks sound until you've clicked in the page once; a "Click a game to enable sound" banner shows until then.

## Unverified / next steps
1. Fix auto-selecting correct game, currently only works some of the time
