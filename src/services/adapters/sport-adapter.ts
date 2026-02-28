import {
  Situation,
  SituationInputs,
  SituationMatchedStart,
  SituationStatLine,
  Sport,
} from "../../domain/situation";

export interface NormalizedEvent {
  gameId: string;
  sequence: number;
  periodOrHalf: number;
  minuteOrClock: number;
  scoreFor: number;
  scoreAgainst: number;
  actorPlayerId?: string;
  actorPlayerName?: string;
  type: string;
  description?: string;
  statsDelta?: SituationStatLine;
}

export interface FocusEntity {
  playerId?: string;
  playerName: string;
  team?: string;
}

export interface AnalysisResult {
  gamesScanned: number;
  gamesUsed: number;
  startsMatched: number;
  reliabilityGrade: "A" | "B" | "C" | "D";
  totals: SituationStatLine;
  perStart: SituationStatLine;
}

export interface SportAdapter {
  readonly sport: Sport;

  getHistoricalGameIds(inputs: SituationInputs): Promise<string[]>;
  getRawGameEvents(gameId: string): Promise<unknown>;
  resolveFocusPlayerId(rawUpstream: unknown, focusEntity: FocusEntity): string | null;

  normalizeEvents(rawUpstream: unknown, gameIdHint?: string): NormalizedEvent[];
  detectStartPoints(events: NormalizedEvent[], filters: SituationInputs["filters"], focusEntity: FocusEntity): SituationMatchedStart[];
  computeStatsAfterStart(
    events: NormalizedEvent[],
    startPoint: SituationMatchedStart,
    focusEntity: FocusEntity,
  ): SituationStatLine;
  aggregate(statBundles: SituationStatLine[]): SituationStatLine;
  exportCsv(situation: Situation): string;
  analysis(situation: Situation): AnalysisResult;
}
