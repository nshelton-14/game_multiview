// ESPN's public scoreboard endpoint is undocumented and may change without notice.
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

const STATE_ORDER = { in: 0, pre: 1, post: 2 };

function networksOf(competition) {
  const fromBroadcasts = (competition.broadcasts || []).flatMap(b => b.names || []);
  if (fromBroadcasts.length) return [...new Set(fromBroadcasts)];
  const fromGeo = (competition.geoBroadcasts || [])
    .map(b => b.media && b.media.shortName)
    .filter(Boolean);
  return [...new Set(fromGeo)];
}

function parseEvent(event) {
  const competition = event.competitions[0];
  const side = homeAway => {
    const c = competition.competitors.find(x => x.homeAway === homeAway);
    return {
      abbr: c.team.abbreviation,
      name: c.team.displayName,
      nickname: c.team.name,
      score: c.score
    };
  };
  return {
    id: event.id,
    state: event.status.type.state, // 'pre' | 'in' | 'post'
    detail: event.status.type.shortDetail,
    home: side('home'),
    away: side('away'),
    networks: networksOf(competition)
  };
}

export async function fetchGames() {
  const res = await fetch(SCOREBOARD_URL);
  if (!res.ok) throw new Error(`ESPN scoreboard request failed (${res.status})`);
  const data = await res.json();
  return (data.events || [])
    .map(parseEvent)
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]);
}
