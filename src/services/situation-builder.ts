import { randomUUID } from "node:crypto";
import {
  MAX_MATCHED_STARTS,
  SITUATION_SCHEMA_VERSION,
  Situation,
  SituationByGameStatLine,
  SituationInputs,
  SituationMatchedStart,
  SituationStatLine,
} from "../domain/situation";
import { InvalidRequestError } from "../lib/errors";
import { getReliabilityGrade } from "./grading";
import { AdapterRegistry } from "./adapters/adapter-registry";
import { NbaAdapter } from "./adapters/nba-adapter";
import { SportAdapter } from "./adapters/sport-adapter";
import { addStatLines, divideStatLine, emptyStats } from "./adapters/stats";

interface SituationBuilderDeps {
  adapterRegistry?: AdapterRegistry;
  sportAdapters?: SportAdapter[];
  sportradarClient?: any;
  pbpMaxConcurrency?: number;
  now?: () => Date;
  idFactory?: () => string;
}

export class SituationBuilder {
  private readonly registry: AdapterRegistry;

  private readonly now: () => Date;

  private readonly idFactory: () => string;

  private readonly pbpMaxConcurrency: number;

  constructor(deps: SituationBuilderDeps) {
    if (deps.adapterRegistry) {
      this.registry = deps.adapterRegistry;
    } else if (deps.sportAdapters?.length) {
      this.registry = new AdapterRegistry(deps.sportAdapters);
    } else if (deps.sportradarClient) {
      this.registry = new AdapterRegistry([new NbaAdapter(deps.sportradarClient)]);
    } else {
      throw new InvalidRequestError("SituationBuilder requires adapterRegistry, sportAdapters, or sportradarClient.");
    }
    this.now = deps.now ?? (() => new Date());
    this.idFactory = deps.idFactory ?? (() => `sit_${randomUUID()}`);
    this.pbpMaxConcurrency = sanitizePositiveInt(deps.pbpMaxConcurrency, 2);
  }

  async build(rawInputs: SituationInputs): Promise<Situation> {
    const inputs = normalizeInputs(rawInputs);
    const adapter = this.registry.get(inputs.sport);
    const gameIds = await adapter.getHistoricalGameIds(inputs);
    const maxScans = Math.min(inputs.limits.maxGames, gameIds.length);
    const meta: Omit<Situation["meta"], "reliabilityGrade"> = {
      gamesScanned: 0,
      gamesUsed: 0,
      startsMatched: 0,
      gamesSkippedByReason: {
        PLAYER_NOT_IN_GAME: 0,
        PLAYER_TEAM_UNKNOWN: 0,
        SCORE_UNRELIABLE: 0,
        CLOCK_PARSE_FAIL: 0,
        UPSTREAM_PBP_MISSING: 0,
      },
      warnings: [],
    };
    const byGame = new Map<string, SituationByGameStatLine>();
    const matchedStarts: SituationMatchedStart[] = [];
    let totals = emptyStats(inputs.sport === "nba" ? ["pts", "reb", "ast", "threePm"] : ["goals", "assists", "shots"]);

    const focusEntity = {
      playerName: inputs.player.name,
      playerId: undefined as string | undefined,
      team: inputs.player.team,
    };

    let nextIndex = 0;
    const workerCount = Math.min(this.pbpMaxConcurrency, maxScans);
    const worker = async (): Promise<void> => {
      while (true) {
        if (meta.startsMatched >= inputs.limits.minStarts || meta.gamesScanned >= maxScans) {
          return;
        }
        const index = nextIndex;
        nextIndex += 1;
        if (index >= maxScans) {
          return;
        }
        const gameId = gameIds[index];
        meta.gamesScanned += 1;
        const payload = await adapter.getRawGameEvents(gameId);
        const events = adapter.normalizeEvents(payload, gameId);
        if (events.length === 0) {
          meta.gamesSkippedByReason.UPSTREAM_PBP_MISSING += 1;
          byGame.set(gameId, { gameId, stats: emptyStats(Object.keys(totals)) });
          continue;
        }

        if (!focusEntity.playerId) {
          focusEntity.playerId = adapter.resolveFocusPlayerId(payload, focusEntity) ?? undefined;
        }
        const starts = adapter.detectStartPoints(events, inputs.filters, focusEntity)
          .slice(0, inputs.limits.maxStartsPerGame);
        if (starts.length === 0) {
          meta.gamesSkippedByReason.PLAYER_NOT_IN_GAME += 1;
          byGame.set(gameId, { gameId, stats: emptyStats(Object.keys(totals)) });
          continue;
        }
        meta.gamesUsed += 1;

        let gameTotals = emptyStats(Object.keys(totals));
        for (const start of starts) {
          if (matchedStarts.length >= MAX_MATCHED_STARTS) {
            if (!meta.warnings.includes("MATCHED_STARTS_CAPPED")) {
              meta.warnings.push("MATCHED_STARTS_CAPPED");
            }
            break;
          }
          matchedStarts.push(start);
          meta.startsMatched += 1;
          const bundle = adapter.computeStatsAfterStart(events, start, focusEntity);
          totals = addStatLines(totals, bundle);
          gameTotals = addStatLines(gameTotals, bundle);
        }
        const current = byGame.get(gameId)?.stats ?? emptyStats(Object.keys(totals));
        byGame.set(gameId, { gameId, stats: addStatLines(current, gameTotals) });
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    const perStart = divideStatLine(totals, meta.startsMatched);
    const reliabilityGrade = getReliabilityGrade(meta.startsMatched);
    const createdAt = this.now().toISOString();
    return {
      id: this.idFactory(),
      sport: inputs.sport,
      schemaVersion: SITUATION_SCHEMA_VERSION,
      createdAt,
      expiresAt: createdAt,
      status: "ready",
      inputs,
      meta: {
        ...meta,
        reliabilityGrade,
      },
      stats: {
        totals,
        perStart,
        byGame: [...byGame.values()],
      },
      matchedStarts,
    };
  }
}

function normalizeInputs(inputs: SituationInputs): SituationInputs {
  return {
    ...inputs,
    sport: inputs.sport ?? "nba",
  };
}

function sanitizePositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}
