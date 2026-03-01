## GAMETIME.API
Fastify + TypeScript API for:
- historical situation analysis (`nba` and `soccer`)
- analysis retrieval + CSV export from stored situations
- live soccer demo flows with REST + WebSocket streaming

## JavaScript Client (SDK)

For a better developer experience, use the typed JavaScript client:

```bash
npm install gametime-api-client
```

```js
import { gametime } from 'gametime-api-client';

const games = await gametime.live.games('soccer');
const analysis = await gametime.live.soccerAnalysis({ sportEventId: games[0].sportEventId });
```

See [sdk/README.md](sdk/README.md) for full usage and API reference.

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Required API Keys

Create `.env` in the project root with:

```env
PORT=3000

# Sportradar Soccer (live + soccer historical)
SPORTRADAR_SOCCER_API_KEY=your_sportradar_soccer_key
SPORTRADAR_SOCCER_ACCESS_LEVEL=trial
SPORTRADAR_SOCCER_LANGUAGE_CODE=en
SPORTRADAR_SOCCER_FORMAT=json

# Sportradar NBA (existing NBA support)
SPORTRADAR_NBA_API_KEY=your_sportradar_nba_key
SPORTRADAR_NBA_BASE_URL=https://api.sportradar.com/nba/trial/v7/en

# OpenAI narration
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-5.2-mini
```

Keys to acquire:
- Sportradar Soccer v4 + Soccer Extended v4 API key
- Sportradar NBA API key (if keeping NBA mode enabled)
- OpenAI API key (Responses API)

## Existing Endpoints (Now Sport-Aware)

### Create Situation

`POST /v1/situations`

NBA payload (new schema):

```json
{
  "sport": "nba",
  "player": { "name": "Stephen Curry", "team": "GSW" },
  "filters": {
    "nba": {
      "quarter": 4,
      "timeRemainingSeconds": { "gte": 120, "lte": 300 },
      "scoreDiff": { "gte": -5, "lte": 5 }
    }
  },
  "season": { "year": 2025, "type": "REG" }
}
```

Soccer payload:

```json
{
  "sport": "soccer",
  "player": { "name": "Erling Haaland", "team": "MCI" },
  "filters": {
    "soccer": {
      "half": 2,
      "minuteRange": { "gte": 60, "lte": 85 },
      "scoreState": "drawing",
      "goalDiffRange": { "gte": -1, "lte": 1 }
    }
  },
  "season": { "year": 2025, "type": "REG" }
}
```

Response:

```json
{ "id": "sit_<uuid>", "gamesScanned": 30, "gamesUsed": 12 }
```

### Analysis

`GET /v1/situations/:id/analysis?sport=nba|soccer`

### CSV Export

`GET /v1/situations/:id/export.csv?sport=nba|soccer`

The API serves both endpoints from stored canonical situation data (no upstream refetch).

## Live Soccer Demo Flow

### 1) Get Live Games

```bash
curl "http://localhost:3000/v1/live/games?sport=soccer"
```

### 2) Get Players in a Live Game

```bash
curl "http://localhost:3000/v1/live/games/<sportEventId>/players?sport=soccer"
```

### 2b) Soccer Live Player Analysis

Get projected goals, assists, and shots for a focus player (mirrors NBA analysis):

```bash
curl -X POST "http://localhost:3000/v1/live/soccer/analysis" \
  -H "content-type: application/json" \
  -d '{
    "sportEventId": "sr:sport_event:66000372",
    "focusPlayerId": "sr:player:1957599"
  }'
```

Response includes `currentTotals`, `projectedFinal`, `blendedPrediction`, and optional `historical` averages. NBA has a similar endpoint: `POST /v1/live/nba/analysis`.

### 3) Start a Live Session

```bash
curl -X POST "http://localhost:3000/v1/live/sessions" \
  -H "content-type: application/json" \
  -d '{
    "sport": "soccer",
    "sportEventId": "sr:sport_event:123",
    "focusPlayerId": "sr:player:456",
    "preferences": { "verbosity": "short" }
  }'
```

Response:

```json
{ "id": "sess_<uuid>" }
```

### 4) Connect WebSocket Stream

Use any WS client (example with `wscat`):

```bash
npx wscat -c "ws://localhost:3000/v1/live/sessions/<sessionId>/stream"
```

Message envelope:

```json
{
  "type": "event | insight | narration | status | error",
  "ts": "2026-02-28T12:00:00.000Z",
  "data": {}
}
```

Example messages:

```json
{
  "type": "event",
  "ts": "2026-02-28T12:00:00.000Z",
  "data": {
    "minute": 67,
    "eventType": "goal",
    "description": "Goal by ...",
    "team": "Manchester City",
    "playersInvolved": ["sr:player:456"],
    "scoreSnapshot": "1-0",
    "focusPlayerInvolved": true
  }
}
```

```json
{
  "type": "insight",
  "ts": "2026-02-28T12:00:10.000Z",
  "data": {
    "similarMatches": [{ "sportEventId": "sr:sport_event:999", "distance": 0.25 }],
    "trends": { "nextGoalIn10MinChance": 0.42, "focusPlayerSubChance": 0.22 },
    "confidence": "med"
  }
}
```

```json
{
  "type": "narration",
  "ts": "2026-02-28T12:00:20.000Z",
  "data": {
    "narration": "City are pressing with sustained momentum...",
    "bullets": ["Goal raised pressure", "Sub risk remains moderate"],
    "callouts": [{ "type": "trend", "text": "Next-goal probability is elevated." }]
  }
}
```

## Docker

```bash
docker build -t useful-api .
docker run --rm -p 3000:3000 --env-file .env useful-api
```

## Testing

```bash
npm test
npm run build
```

## MVP Persistence Note

Current storage is in-memory for demo simplicity.

TODO:
- move situations + live sessions to Redis/Postgres for production durability
- add distributed pub/sub for multi-instance websocket fanout
