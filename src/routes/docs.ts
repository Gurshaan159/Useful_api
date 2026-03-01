import { FastifyInstance } from "fastify";

export async function registerDocsRoute(app: FastifyInstance): Promise<void> {
  app.get("/docs", async (_request, reply) => {
    reply.type("text/html");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gametime API – Documentation</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; color: #1a1a1a; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.25rem; margin-top: 2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
    code { background: #f5f5f5; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.9em; }
    pre { background: #1a1a1a; color: #e5e5e5; padding: 1rem; overflow-x: auto; border-radius: 8px; }
    pre code { background: none; padding: 0; }
    a { color: #0066cc; }
    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; }
    th { font-weight: 600; }
  </style>
</head>
<body>
  <h1>Gametime API</h1>
  <p>Live sports data, player predictions, and historical situation analysis for NBA &amp; Soccer.</p>
  <ul>
    <li><strong>Base URL:</strong> <code>https://gametimeapi.onrender.com</code></li>
    <li><strong>npm:</strong> <a href="https://www.npmjs.com/package/gametime-api-client">gametime-api-client</a></li>
  </ul>

  <h2>SDK for Developers</h2>
  <p><strong>Install:</strong></p>
  <pre><code>npm install gametime-api-client</code></pre>

  <p><strong>Example – Historical situation analysis &amp; CSV export</strong></p>
  <p>Create a &quot;situation&quot; (player + game filters, e.g. 4th quarter, down 1–15), fetch stats, and export to CSV. <code>limits</code> controls how many games are scanned and how many matching &quot;starts&quot; (e.g. possessions) per game.</p>
  <pre><code>import { gametime } from 'gametime-api-client';
import { writeFileSync } from 'fs';

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
  limits: {
    maxGames: 5,
    minStarts: 3,
    maxStartsPerGame: 2,
  },
  season: { year: 2025, type: 'REG' },
});

console.log('created situation id:', id);

const summary = await gametime.situations.analysis(id, 'nba');
console.log(summary);

const csv = await gametime.situations.exportCsv(id, 'nba');
const fileName = \`austin-reaves-\${id}.csv\`;
writeFileSync(fileName, csv, 'utf8');
console.log('CSV saved:', fileName);</code></pre>

  <h2>Endpoints</h2>
  <table>
    <tr><th>Method</th><th>Path</th><th>Description</th></tr>
    <tr><td>GET</td><td>/v1/live/games?sport=soccer|nba</td><td>List live games</td></tr>
    <tr><td>GET</td><td>/v1/live/games/:sportEventId/players?sport=soccer|nba</td><td>Players in a game</td></tr>
    <tr><td>POST</td><td>/v1/live/soccer/analysis</td><td>Soccer player prediction</td></tr>
    <tr><td>POST</td><td>/v1/live/nba/analysis</td><td>NBA player prediction</td></tr>
    <tr><td>POST</td><td>/v1/live/sessions</td><td>Create live session</td></tr>
    <tr><td>POST</td><td>/v1/situations</td><td>Create situation (player + filters + season)</td></tr>
    <tr><td>GET</td><td>/v1/situations/:id/analysis?sport=nba|soccer</td><td>Get situation analysis</td></tr>
    <tr><td>GET</td><td>/v1/situations/:id/export.csv?sport=nba|soccer</td><td>Export CSV</td></tr>
  </table>

  <h2>Examples</h2>
  <p><strong>Live soccer analysis:</strong></p>
  <pre><code>curl -X POST "https://gametimeapi.onrender.com/v1/live/soccer/analysis" \\
  -H "content-type: application/json" \\
  -d '{"sportEventId": "sr:sport_event:66000372", "focusPlayerId": "sr:player:1957599"}'</code></pre>

  <p><strong>Create situation (e.g. LeBron, 4th quarter, down 1–15):</strong></p>
  <pre><code>curl -X POST "https://gametimeapi.onrender.com/v1/situations" \\
  -H "content-type: application/json" \\
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
  }'</code></pre>

  <h2>Error Codes</h2>
  <p>200 Success | 404 Not Found | 409 Ambiguous Player | 422 Invalid Request | 502 Upstream Error | 504 Timeout</p>

  <p><a href="/v1/live/games?sport=soccer">Try: GET /v1/live/games?sport=soccer</a></p>
  <p><a href="https://github.com/Gurshaan159/Useful_api">GitHub</a> · <a href="https://www.npmjs.com/package/gametime-api-client">npm: gametime-api-client</a></p>
</body>
</html>`;
  });
}
