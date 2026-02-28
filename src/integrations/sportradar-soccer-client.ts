import { SituationInputs } from "../domain/situation";
import { InvalidRequestError, UpstreamError, UpstreamTimeoutError } from "../lib/errors";

export interface SportradarSoccerClientConfig {
  apiKey: string;
  accessLevel: string;
  languageCode: string;
  format: string;
  timeoutMs?: number;
}

export class SportradarSoccerClient {
  private readonly timeoutMs: number;

  constructor(private readonly config: SportradarSoccerClientConfig) {
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async getLiveSchedules(): Promise<unknown> {
    return this.fetchSoccerJson(
      `/soccer/${this.config.accessLevel}/v4/${this.config.languageCode}/schedules/live/schedules.${this.config.format}`,
      "getLiveSchedules",
    );
  }

  async getLiveTimelines(): Promise<unknown> {
    return this.fetchSoccerJson(
      `/soccer/${this.config.accessLevel}/v4/${this.config.languageCode}/schedules/live/timelines.${this.config.format}`,
      "getLiveTimelines",
    );
  }

  async getSportEventTimeline(sportEventId: string): Promise<unknown> {
    return this.fetchSoccerJson(
      `/soccer-extended/${this.config.accessLevel}/v4/${this.config.languageCode}/sport_events/${encodeURIComponent(sportEventId)}/timeline.${this.config.format}`,
      "getSportEventTimeline",
    );
  }

  async getHistoricalGameIds(inputs: SituationInputs, limit: number): Promise<string[]> {
    if (inputs.game?.id) {
      return [inputs.game.id];
    }
    const teamToken = inputs.player.team?.trim().toLowerCase();
    if (!teamToken) {
      throw new InvalidRequestError("For soccer historical scan, provide player.team or game.id.");
    }
    const timelinesPayload = await this.getLiveTimelines();
    const events = extractLiveSportEvents(timelinesPayload);
    const completed = events
      .filter((event) => isEndedStatus(event.status))
      .filter((event) => event.homeAlias?.toLowerCase() === teamToken
        || event.awayAlias?.toLowerCase() === teamToken
        || event.homeTeamId?.toLowerCase().includes(teamToken)
        || event.awayTeamId?.toLowerCase().includes(teamToken))
      .map((event) => event.sportEventId);
    return completed.slice(0, limit);
  }

  private async fetchSoccerJson(path: string, operation: string): Promise<unknown> {
    const url = `https://api.sportradar.com${path}?api_key=${encodeURIComponent(this.config.apiKey)}`;
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (isAbortError(error)) {
        throw new UpstreamTimeoutError("Sportradar soccer request timed out.", {
          provider: "sportradar-soccer",
          operation,
          timeoutMs: this.timeoutMs,
        });
      }
      throw new UpstreamError("Failed to reach Sportradar soccer endpoint.", {
        provider: "sportradar-soccer",
        operation,
      });
    }
    if (!response.ok) {
      throw new UpstreamError("Sportradar soccer returned non-success status.", {
        provider: "sportradar-soccer",
        operation,
        status: response.status,
      });
    }
    try {
      return await response.json();
    } catch {
      throw new UpstreamError("Sportradar soccer returned invalid JSON payload.", {
        provider: "sportradar-soccer",
        operation,
      });
    }
  }
}

export interface LiveSportEventSummary {
  sportEventId: string;
  scheduled?: string;
  status?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  homeAlias?: string;
  awayAlias?: string;
  homeName?: string;
  awayName?: string;
  homeScore?: number;
  awayScore?: number;
  competition?: string;
}

export function extractLiveSportEvents(payload: unknown): LiveSportEventSummary[] {
  const root = asObject(payload);
  const direct = asArray(root.sport_events) ?? [];
  const schedules = asArray(root.schedules) ?? [];
  const timelines = asArray(root.timelines) ?? [];
  const flattenedTimelineEvents = timelines.flatMap((entry) => {
    const row = asObject(entry);
    return asArray(row.sport_events) ?? [];
  });
  const all = [...direct, ...schedules, ...flattenedTimelineEvents];
  const out: LiveSportEventSummary[] = [];
  for (const raw of all) {
    const row = asObject(raw);
    const sportEvent = asObject(row.sport_event?.id ? row.sport_event : row);
    const status = asObject(row.sport_event_status?.status ? row.sport_event_status : row.status);
    const competitors = asArray(sportEvent.competitors) ?? [];
    const home = competitors.find((c) => asObject(c).qualifier === "home");
    const away = competitors.find((c) => asObject(c).qualifier === "away");
    const score = asObject(status.period_scores?.at?.(-1) ?? status.score ?? {});
    const homeGoals = asNumber(score.home_score) ?? asNumber(status.home_score);
    const awayGoals = asNumber(score.away_score) ?? asNumber(status.away_score);
    const sportEventId = asString(sportEvent.id) ?? asString(row.id);
    if (!sportEventId) {
      continue;
    }
    out.push({
      sportEventId,
      scheduled: asString(sportEvent.start_time) ?? asString(sportEvent.scheduled),
      status: asString(status.match_status) ?? asString(status.status),
      homeTeamId: asString(asObject(home).id),
      awayTeamId: asString(asObject(away).id),
      homeAlias: asString(asObject(home).abbreviation),
      awayAlias: asString(asObject(away).abbreviation),
      homeName: asString(asObject(home).name),
      awayName: asString(asObject(away).name),
      homeScore: homeGoals ?? undefined,
      awayScore: awayGoals ?? undefined,
      competition: asString(asObject(sportEvent.sport_event_context).competition?.name),
    });
  }
  return dedupeBySportEventId(out);
}

function dedupeBySportEventId(rows: LiveSportEventSummary[]): LiveSportEventSummary[] {
  const map = new Map<string, LiveSportEventSummary>();
  for (const row of rows) {
    if (!map.has(row.sportEventId)) {
      map.set(row.sportEventId, row);
    }
  }
  return [...map.values()];
}

function isEndedStatus(status?: string): boolean {
  if (!status) {
    return false;
  }
  const normalized = status.toLowerCase();
  return normalized.includes("ended")
    || normalized.includes("closed")
    || normalized.includes("complete")
    || normalized.includes("finished");
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "name" in error && (error as { name: string }).name === "AbortError";
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function asArray(value: unknown): any[] | null {
  return Array.isArray(value) ? value : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}
