import { setInAlliance } from "./allianceButton";

/**
 * The player's alliance strengths and weaknesses, as the server sends them on
 * an own main-yard load (`alliancedata.bonuses`, server
 * `services/alliance/allianceBonuses.ts`). Every value is a percent change
 * (positive = more) except `reach`, in cells; a player in no alliance has none.
 */
export interface AllianceBonusesView {
  readonly production: number;
  readonly loot: number;
  readonly raidersCarry: number;
  readonly takeoverCost: number;
  readonly enemyTakeoverCost: number;
  readonly kitCost: number;
  readonly outpostHatchCost: number;
  readonly fortifyCost: number;
  /** Extra cells every flinger reaches (Conquest's full Teratorn: 1); not a percent. */
  readonly reach: number;
}

const KEYS: readonly (keyof AllianceBonusesView)[] = [
  "production",
  "loot",
  "raidersCarry",
  "takeoverCost",
  "enemyTakeoverCost",
  "kitCost",
  "outpostHatchCost",
  "fortifyCost",
  "reach",
];

export const NO_BONUSES: AllianceBonusesView = Object.freeze(
  Object.fromEntries(KEYS.map((key) => [key, 0])) as unknown as AllianceBonusesView,
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The bonuses inside a load's `alliancedata`, all zeros when absent or malformed. */
export const allianceBonusesOf = (alliancedata: unknown): AllianceBonusesView => {
  const raw = isRecord(alliancedata) && isRecord(alliancedata.bonuses) ? alliancedata.bonuses : null;
  if (!raw) return NO_BONUSES;
  const out: Record<string, number> = {};
  for (const key of KEYS) {
    const value = Number(raw[key]);
    out[key] = Number.isFinite(value) ? value : 0;
  }
  return out as unknown as AllianceBonusesView;
};

/** The harvester power factor of a load: 1 + production%, as the server's catch-up runs it. */
export const productionFactorOf = (alliancedata: unknown): number =>
  Math.max(0, 1 + allianceBonusesOf(alliancedata).production / 100);

/** `amount` changed by `percent`% (negative = less), rounded; never below 0. As the server's `byPercent`. */
export const byPercent = (amount: number, percent: number): number =>
  !percent || !(amount > 0) ? amount : Math.max(0, Math.round((amount * (100 + percent)) / 100));

/**
 * The last load's alliance bonuses, for screens that price things outside the
 * yard store (Starter Kits, hatching on an outpost). Set on every own
 * main-yard load.
 */
let current: AllianceBonusesView = NO_BONUSES;

export const setCurrentAllianceBonuses = (alliancedata: unknown): void => {
  current = allianceBonusesOf(alliancedata);
  // The load sends `alliancedata` only to a player in an alliance: the Alliance button's rule hears it.
  setInAlliance(isRecord(alliancedata));
};

export const currentAllianceBonuses = (): AllianceBonusesView => current;
