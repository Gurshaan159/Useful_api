import { Sport } from "../../domain/situation";
import { InvalidRequestError } from "../../lib/errors";
import { SportAdapter } from "./sport-adapter";

export class AdapterRegistry {
  private readonly bySport = new Map<Sport, SportAdapter>();

  constructor(adapters: SportAdapter[]) {
    for (const adapter of adapters) {
      this.bySport.set(adapter.sport, adapter);
    }
  }

  get(sport: Sport): SportAdapter {
    const adapter = this.bySport.get(sport);
    if (!adapter) {
      throw new InvalidRequestError(`Unsupported sport '${sport}'.`);
    }
    return adapter;
  }
}
