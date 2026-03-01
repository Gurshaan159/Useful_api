# Gametime API

**Live sports data, player predictions, and historical situation analysis for NBA & Soccer.**  
A REST + WebSocket API built for clarity, predictable behavior, and developer experience.

- **Hosted API:** https://gametimeapi.onrender.com  
- **SDK:** `gametime-api-client` ([npm](https://www.npmjs.com/package/gametime-api-client))  
- **Documentation:** [Hosted docs](https://gametimeapi.onrender.com/docs) | [sdk/README.md](sdk/README.md)

---

## Quick Start (cURL)

**Localhost:**
```bash
curl "http://localhost:3000/v1/live/games?sport=soccer"
```

**Public API:**
```bash
curl "https://gametimeapi.onrender.com/v1/live/games?sport=soccer"
```

**JavaScript SDK:**
```bash
npm install gametime-api-client
```

```js
import { gametime } from 'gametime-api-client';

const games = await gametime.live.games('soccer');
const analysis = await gametime.live.soccerAnalysis({ sportEventId: games[0].sportEventId });
console.log(analysis.prediction.projectedFinal); // { goals, assists, shots, touches }
```

See [sdk/README.md](sdk/README.md) for full SDK usage.

---

## Submission Requirements (HackIllinois Best Web API Track)

| Requirement | Status |
|-------------|--------|
| API with valuable endpoints | ✅ Live games, analysis, situations, WebSocket streaming |
| Queryable over HTTP | ✅ REST (`GET`/`POST`) + WebSocket |
| cURL/Postman usable | ✅ All endpoints documented with curl examples |
| Operational on localhost | ✅ `npm run dev` → `http://localhost:3000` |
| Documentation in README | ✅ This file + [hosted docs](https://gametimeapi.onrender.com/docs) |
| **Bonus:** Publicly accessible | ✅ https://gametimeapi.onrender.com |
| **Bonus:** Hosted documentation | ✅ https://gametimeapi.onrender.com/docs |
| **Bonus:** Methods beyond GET | ✅ POST for situations, analysis, sessions |
| **Bonus:** Stateful usage | ✅ Create situations, live sessions; retrieve by ID |

---

## API Endpoints

Base URL: `https://gametimeapi.onrender.com` (or `http://localhost:3000` locally)

### Live

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/live/games?sport=soccer\|nba` | List in-progress live games |
| GET | `/v1/live/games/:sportEventId/players?sport=soccer\|nba` | List players for a game |
| POST | `/v1/live/soccer/analysis` | Soccer player prediction (goals, assists, shots, touches) |
| POST | `/v1/live/nba/analysis` | NBA player prediction analysis |
| POST | `/v1/live/sessions` | Create live session (WebSocket) |
| GET | `/v1/live/sessions/:id` | Get session status |

### Situations (Historical Stats)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/situations` | Create situation (player + filters + season) |
| GET | `/v1/situations/:id/analysis?sport=nba\|soccer` | Get analysis (totals, per-start) |
| GET | `/v1/situations/:id/export.csv?sport=nba\|soccer` | Export stats as CSV |

---

## cURL Examples

### 1. Get live soccer games
```bash
curl "https://gametimeapi.onrender.com/v1/live/games?sport=soccer"
```

### 2. Get players in a game
```bash
curl "https://gametimeapi.onrender.com/v1/live/games/sr:sport_event:66000372/players?sport=soccer"
```

### 3. Soccer live analysis (POST)
```bash
curl -X POST "https://gametimeapi.onrender.com/v1/live/soccer/analysis" \
  -H "content-type: application/json" \
  -d '{"sportEventId": "sr:sport_event:66000372", "focusPlayerId": "sr:player:1957599"}'
```

### 4. NBA live analysis (POST)
```bash
curl -X POST "https://gametimeapi.onrender.com/v1/live/nba/analysis" \
  -H "content-type: application/json" \
  -d '{"sportEventId": "sr:sport_event:123", "focusPlayerId": "sr:player:456"}'
```

### 5. Create situation (POST) – e.g. LeBron James, 4th quarter, down 1–15
```bash
curl -X POST "https://gametimeapi.onrender.com/v1/situations" \
  -H "content-type: application/json" \
  -d '{
    "sport": "nba",
    "player": { "name": "LeBron James", "team": "LAL" },
    "filters": {
      "nba": {
        "quarter": 4,
        "timeRemainingSeconds": { "gte": 0, "lte": 720 },
        "scoreDiff": { "gte": -15, "lte": -1 }
      }
    },
    "season": { "year": 2025, "type": "REG" }
  }'
```

### 6. Get situation analysis (GET)
```bash
curl "https://gametimeapi.onrender.com/v1/situations/sit_<id>/analysis?sport=nba"
```

### 7. Export situation CSV (GET)
```bash
curl "https://gametimeapi.onrender.com/v1/situations/sit_<id>/export.csv?sport=nba"
```

### 8. Create live session (POST)
```bash
curl -X POST "https://gametimeapi.onrender.com/v1/live/sessions" \
  -H "content-type: application/json" \
  -d '{
    "sport": "soccer",
    "sportEventId": "sr:sport_event:66000372",
    "focusPlayerId": "sr:player:1957599",
    "preferences": { "verbosity": "short" }
  }'
```

### 9. WebSocket stream
```bash
npx wscat -c "wss://gametimeapi.onrender.com/v1/live/sessions/<sessionId>/stream"
```

---

## Error Handling & Status Codes

The API returns structured error responses and appropriate HTTP status codes:

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 404 | Resource not found (e.g. invalid situation/session ID) |
| 409 | Ambiguous player (multiple matches; disambiguate) |
| 422 | Invalid request (validation, range errors) |
| 502 | Upstream error (provider returned non-success) |
| 504 | Upstream timeout |

Example error body:
```json
{
  "error": {
    "code": "UPSTREAM_ERROR",
    "message": "Sportradar soccer returned non-success status.",
    "details": { "provider": "sportradar-soccer", "operation": "getLiveSchedules", "status": 403 },
    "requestId": "req-1"
  }
}
```

---

## Tech Stack

- **Runtime:** Node.js  
- **Framework:** [Fastify](https://fastify.dev)  
- **Language:** TypeScript  
- **Upstream data:** Sportradar (NBA + Soccer), OpenAI (narration)  
- **Deploy:** Render (public URL)  
- **SDK:** `gametime-api-client` (npm, ESM)

---

## Setup (Local)

```bash
npm install
cp .env.example .env
# Add SPORTRADAR_SOCCER_API_KEY, SPORTRADAR_NBA_API_KEY, OPENAI_API_KEY to .env
npm run dev
```

Server runs at `http://localhost:3000`.

---

## Situation Schemas

### NBA
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

### Soccer
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

---

## Docker

```bash
docker build -t gametime-api .
docker run --rm -p 3000:3000 --env-file .env gametime-api
```

---

## Testing

```bash
npm test
npm run build
```

---

## Rate Limits & Resilience

- `POST /v1/situations` retries Sportradar `429` and `5xx` with exponential backoff.
- NBA play-by-play fetches are concurrency-limited to reduce upstream pressure.
- Under heavy provider throttling, situation creation may take longer but should fail less often.
