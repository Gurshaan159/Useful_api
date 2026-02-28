import { Situation } from "../domain/situation";

export interface SituationRepository {
  create(situation: Situation): Promise<void>;
  getById(id: string): Promise<Situation | null>;
  update?(id: string, patch: Partial<Situation>): Promise<void>;
}
