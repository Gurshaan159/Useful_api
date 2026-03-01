# Gametime API Client

A typed JavaScript client for the [Gametime API](https://gametimeapi.onrender.com) – live sports data, player analysis, and predictions for NBA & Soccer.

## Install

```bash
npm install gametime-api-client
```

## Usage

### Quick start

```js
import { gametime } from 'gametime-api-client';

// Live soccer games
const games = await gametime.live.games('soccer');
console.log(games[0]); // { sportEventId, homeTeam, awayTeam, score, ... }

// One-line soccer analysis (auto-picks game + focus player)
const analysis = await gametime.live.soccerAnalysis({
  sportEventId: games[0].sportEventId,
});
console.log(analysis.prediction.projectedFinal); // { goals, assists, shots, touches }
```

### Custom base URL

```js
import { createClient } from 'gametime-api-client';

const api = createClient({ baseUrl: 'https://gametimeapi.onrender.com' });

const nbaGames = await api.live.games('nba');
const nbaAnalysis = await api.live.nbaAnalysis({
  sportEventId: nbaGames[0].sportEventId,
  focusPlayerId: 'some-player-id',
});
```

### Full flow (soccer)

```js
import { createClient } from 'gametime-api-client';

const api = createClient();

// 1. Get live games
const games = await api.live.games('soccer');

// 2. Optional: list players for a game
const players = await api.live.players(games[0].sportEventId, 'soccer');

// 3. Get prediction analysis (focus player optional; API can auto-pick)
const analysis = await api.live.soccerAnalysis({
  sportEventId: games[0].sportEventId,
  focusPlayerId: players[0]?.playerId, // optional
});

console.log(analysis.live.currentTotals);   // goals, assists, shots, touches
console.log(analysis.prediction.projectedFinal);
```

### Error handling

```js
import { gametime, ApiError } from 'gametime-api-client';

try {
  const games = await gametime.live.games('soccer');
} catch (err) {
  if (err instanceof ApiError) {
    console.error(err.message, err.status, err.code);
  }
  throw err;
}
```

## API reference

| Method | Description |
|--------|-------------|
| `live.games(sport)` | `'soccer' \| 'nba'` – list in-progress live games |
| `live.players(sportEventId, sport)` | List players for a game |
| `live.soccerAnalysis({ sportEventId, focusPlayerId? })` | Soccer prediction analysis |
| `live.nbaAnalysis({ sportEventId, focusPlayerId?, verbosity? })` | NBA prediction analysis |
| `live.createSession({ sport, sportEventId, focusPlayerId? })` | Create live WebSocket session |

## Types

The client is written in TypeScript and ships with `.d.ts` definitions. Import types for better IDE support:

```ts
import type { LiveGame, SoccerAnalysis, NbaAnalysis } from 'gametime-api-client';
```

## Links

- **Hosted API**: https://gametimeapi.onrender.com
- **API docs**: See main project README
