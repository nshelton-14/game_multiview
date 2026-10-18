import { MARKETS } from './markets.js';

// What a grid slot remembers about its game: a label, the team nicknames, and
// the location to spoof. The local broadcast of a game is tied to the home
// team's market.
export function gameToSlot(game) {
  const market = MARKETS[game.home.abbr];
  return {
    label: `${game.away.nickname} @ ${game.home.nickname}`,
    teams: [game.away.nickname, game.home.nickname],
    geo: market ? { lat: market.lat, lng: market.lng, label: market.label } : null
  };
}

// One-line description for a drop-down entry.
export function describeGame(game) {
  const { label } = gameToSlot(game);
  const status = game.state === 'pre'
    ? game.detail
    : `${game.away.score}-${game.home.score} ${game.detail}`;
  return `${game.state === 'in' ? '🔴 ' : ''}${label} · ${status}`;
}
