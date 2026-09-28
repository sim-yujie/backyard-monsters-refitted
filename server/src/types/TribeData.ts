import type { BuildingHealthData } from "./BuildingData.js";

export interface TribeData {
  baseid: string;
  tribeHealthData: BuildingHealthData;
  monsters?: Record<string, number>;
  destroyed?: number;
  destroyedAt?: number;
  /** Map Room 1: the last attack's damage percentage, this tribe life. */
  damage?: number;
  /** Map Room 1: loot credited from this tribe since it last respawned (issue #161). */
  looted?: Partial<Record<"r1" | "r2" | "r3" | "r4", number>>;
}
