# Gametime API Client

A typed JavaScript client for live sports data, player predictions, and historical situation analysis. Supports **NBA** and **Soccer**.

- **npm:** [gametime-api-client](https://www.npmjs.com/package/gametime-api-client)
- **API:** https://gametimeapi.onrender.com

---

## Install

```bash
npm install gametime-api-client
```

---

## Quick Start

```js
import { gametime } from 'gametime-api-client';

// Live soccer games
const games = await gametime.live.games('soccer');
console.log(games[0]); // { sportEventId, homeTeam, awayTeam, score, ... }

// Soccer analysis (focus player optional; API can auto-pick)
const analysis = await gametime.live.soccerAnalysis({
  sportEventId: games[0].sportEventId,
});
console.log(analysis.prediction.projectedFinal); // { goals, assists, shots, touches }
```

---

## Usage

### Live games & analysis (Soccer)

```js
import { gametime } from 'gametime-api-client';

// 1. Get live games
const games = await gametime.live.games('soccer');

// 2. Optional: list players for a game
const players = await gametime.live.players(games[0].sportEventId, 'soccer');

// 3. Get prediction analysis
const analysis = await gametime.live.soccerAnalysis({
  sportEventId: games[0].sportEventId,
  focusPlayerId: players[0]?.playerId, // optional
});

console.log(analysis.live.currentTotals);   // goals, assists, shots, touches
console.log(analysis.prediction.projectedFinal);
```

### Live games & analysis (NBA)

```js
import { gametime } from 'gametime-api-client';

const games = await gametime.live.games('nba');
const analysis = await gametime.live.nbaAnalysis({
  sportEventId: games[0].sportEventId,
  focusPlayerId: 'sr:player:123',  // optional
  verbosity: 'short',               // optional: 'short' | 'medium' | 'high'
});
```

### Custom base URL (local or alternate host)

```js
import { createClient } from 'gametime-api-client';

const api = createClient({ baseUrl: 'http://localhost:3000' });

const games = await api.live.games('soccer');
const analysis = await api.live.soccerAnalysis({
  sportEventId: games[0].sportEventId,
});
```

### Situations (historical stats + CSV export)

Query player performance in specific game situations (e.g. 4th quarter, down 1–15):

```js
import { gametime } from 'gametime-api-client';
import { writeFileSync } from 'fs';

// Create situation: Austin Reaves, 4th quarter, down 1–15
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

// Get analysis (totals, per-start, reliability)
const summary = await gametime.situations.analysis(id, 'nba');
console.log(summary.analysis.totals, summary.analysis.perStart);

// Export to CSV
const csv = await gametime.situations.exportCsv(id, 'nba');
writeFileSync('austin-reaves-q4-down-1-15.csv', csv);
```

`situations.create` retries transient upstream errors (`429`, `502`, `503`, `504`) with exponential backoff.

### Error handling

```js
import { gametime, ApiError } from 'gametime-api-client';

try {
  const games = await gametime.live.games('soccer');
} catch (err) {
  if (err instanceof ApiError) {
    console.error(err.message, err.status, err.code);
    // err.status: 404, 422, 502, 504, etc.
    // err.code: 'UPSTREAM_ERROR', 'NOT_FOUND', 'INVALID_REQUEST', etc.
  }
  throw err;
}
```

---

## API Reference

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

---

## TypeScript

The client ships with type definitions. Use for better editor support:

```ts
import type {
  LiveGame,
  SoccerAnalysis,
  NbaAnalysis,
  CreateSituationParams,
  SituationAnalysis,
} from 'gametime-api-client';
```

---

## Situation Schemas

### NBA

```ts
{
  sport: 'nba',
  player: { name: 'LeBron James', team: 'LAL' },
  filters: {
    nba: {
      quarter: 4,
      timeRemainingSeconds: { gte: 0, lte: 720 },
      scoreDiff: { gte: -15, lte: -1 },
    },
  },
  season: { year: 2025, type: 'REG' },
}
```

### Soccer

```ts
{
  sport: 'soccer',
  player: { name: 'Erling Haaland', team: 'MCI' },
  filters: {
    soccer: {
      half: 2,
      minuteRange: { gte: 60, lte: 85 },
      scoreState: 'drawing',
      goalDiffRange: { gte: -1, lte: 1 },
    },
  },
  season: { year: 2025, type: 'REG' },
}
```

---

## Links

- **Hosted API:** https://gametimeapi.onrender.com
- **npm:** https://www.npmjs.com/package/gametime-api-client
