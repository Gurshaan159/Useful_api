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

### Situations (historical stats + CSV export)

```js
import { gametime } from 'gametime-api-client';
import { writeFileSync } from 'fs';

// Austin Reaves, 4th quarter, down 1–15
const { id } = await gametime.situations.create({
  sport: 'nba',
  player: { name: 'Austin Reaves', team: 'LAL' },
  filters: {
    nba: {
      quarter: 4,
      timeRemainingSeconds: { gte: 0, lte: 720 },
      scoreDiff: { gte: -15, lte: -1 },
    },
  },
  season: { year: 2025, type: 'REG' },
});

// Get analysis
const summary = await gametime.situations.analysis(id, 'nba');
console.log(summary.analysis.totals, summary.analysis.perStart);

// Export to CSV file
const csv = await gametime.situations.exportCsv(id, 'nba');
writeFileSync('austin-reaves-q4-down-1-15.csv', csv);
```

`situations.create` automatically retries transient upstream failures (`429`, `502`, `503`, `504`) with capped exponential backoff. This keeps client usage simple, but heavily rate-limited periods can increase response time.

## API reference

| Method | Description |
|--------|-------------|
| **Live** | |
| `live.games(sport)` | `'soccer' \| 'nba'` – list in-progress live games |
| `live.players(sportEventId, sport)` | List players for a game |
| `live.soccerAnalysis({ sportEventId, focusPlayerId? })` | Soccer prediction analysis |
| `live.nbaAnalysis({ sportEventId, focusPlayerId?, verbosity? })` | NBA prediction analysis |
| `live.createSession({ sport, sportEventId, focusPlayerId? })` | Create live WebSocket session |
| **Situations** | |
| `situations.create(params)` | Create situation (player + filters + season or game) |
| `situations.analysis(id, sport)` | Get analysis (totals, perStart, reliability) |
| `situations.exportCsv(id, sport, { includeSummary? })` | Export stats as CSV string |

## Types

The client is written in TypeScript and ships with `.d.ts` definitions. Import types for better IDE support:

```ts
import type { LiveGame, SoccerAnalysis, NbaAnalysis, CreateSituationParams, SituationAnalysis } from 'gametime-api-client';
```

## Links

- **Hosted API**: https://gametimeapi.onrender.com
- **API docs**: See main project README
