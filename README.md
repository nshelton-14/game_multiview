# Game Multiview

Pick live NFL games from a popup and watch them together in one borderless
YouTube TV grid. Each grid frame gets its own spoofed geolocation (the home
team's market).

## Load it
- **Chrome:** `chrome://extensions` → Developer mode → Load unpacked → select this folder.
- **Firefox (128+):** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → select `manifest.json`.

Disable the standalone Spoof Geolocation extension while testing so the two don't both wrap `navigator.geolocation`.

## Using it
- Check up to 4 games in the popup (the first one checked is the main window), pick a layout, click **Open grid**.
- Move the mouse to the very top edge of the grid to reveal the control bar: per-game audio buttons, ★ to make a game the main window, layout picker, mute all, fullscreen, close.
- Audio: one game plays at a time. Click a game to hear it, use the control bar or popup, or use shortcuts: **Alt+Shift+A** cycle, **Alt+Shift+X** mute all, **Alt+Shift+M** pin/unpin the control bar. Extra unbound shortcuts (audio 1–4, previous) can be set at `chrome://extensions/shortcuts`.
- Chrome blocks sound until you've clicked in the page once; a "Click a game to enable sound" banner shows until then.

## How it works
- `background.js` opens a popup-type window at `tv.youtube.com/live#mv-grid` sized to the display work area, stores each slot's game and location in `storage.session`, then fullscreens it once the host reports ready.
- `inject/grid-host.js` runs only in that top frame: it halts the YouTube TV app, builds the grid of same-origin iframes (named `mv:<slot>`), mutes/unmutes each frame's `<video>` directly, restyles each `/watch` player to fill its frame, and renders the control bar. Same-origin framing is why the host must live on tv.youtube.com rather than an extension page.
- `inject/geo-main.js` (page world) + `inject/geo-bridge.js` (isolated): spoof `navigator.geolocation`. The bridge reads the frame's `mv:<slot>` name and asks the background for that slot's coordinates, so each frame can sit in a different market. Frames that aren't grid slots are untouched.
- `inject/guide-nav.js`: in each frame, finds the guide row whose current program title contains both team nicknames and navigates to its `/watch/` link.
- `lib/espn.js` (unofficial ESPN scoreboard), `lib/markets.js` (team → coordinates), `lib/layout.js` (percentage layout presets, shared by popup and host).

## Unverified / next steps
1. **Untested end to end.** Nothing here has been run against a live game yet. Likely failure points: whether program titles contain team nicknames (`findWatchLink`), whether the player-fit selectors suit YouTube TV's player (`fitFrame`), and whether Chrome lets the host mute/unmute frame media as expected.
2. **Per-frame location** is untested: all frames share one IP, and one tab; confirm each frame sees its own coordinates.
3. **Stream limits:** YouTube TV caps simultaneous streams per account (3 by default, I believe); four games may need a plan that allows it.
4. **Terms of service:** spoofing location to reach out-of-market games may violate YouTube TV's terms.
5. Possible later: drag-to-arrange custom layouts, remembered channels, a gap setting, WXT/TypeScript port.
