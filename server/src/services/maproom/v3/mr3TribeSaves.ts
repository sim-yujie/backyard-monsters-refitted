import { EnumYardType } from "../../../enums/EnumYardType.js";
import type { SaveData } from "../../../types/EntityData.js";

/**
 * Map Room 3's tribe yard templates (`game-data/tribes/v3`, about 65,000
 * lines), loaded the first time an MR3 tribe yard is asked for rather than at
 * every server start (owner, 21 Nov 2026: Map Room 3 stays switched off until
 * its build, about six months after launch). They used to sit in
 * `MapRoom3Config.ts`, which the base load imports for its MR3 constants, so
 * every boot parsed them although no player can enter Map Room 3
 * (`setMapVersion` refuses V3, `mapRoom3ClosedErr`).
 */
export interface MR3TribeSaves {
  /** Save data templates per structure type and level. */
  readonly structures: Readonly<Record<number, Record<number, SaveData>>>;
  /** Save data templates for tribe outposts, keyed by tribe index then level. */
  readonly outposts: Readonly<Record<number, Record<number, SaveData>>>;
}

let loading: Promise<MR3TribeSaves> | null = null;

const load = async (): Promise<MR3TribeSaves> => {
  const [{ strongholds }, { resources }, { defenders }, { legionnaire }, { kozu }, { abunakki }, { dreadnaught }] =
    await Promise.all([
      import("../../../game-data/tribes/v3/strongholds.js"),
      import("../../../game-data/tribes/v3/resources.js"),
      import("../../../game-data/tribes/v3/defenders.js"),
      import("../../../game-data/tribes/v3/outposts/legionnaire.js"),
      import("../../../game-data/tribes/v3/outposts/kozu.js"),
      import("../../../game-data/tribes/v3/outposts/abunakki.js"),
      import("../../../game-data/tribes/v3/outposts/dreadnaught.js"),
    ]);
  return {
    structures: {
      [EnumYardType.STRONGHOLD]: strongholds,
      [EnumYardType.RESOURCE]: resources,
      [EnumYardType.FORTIFICATION]: defenders,
    },
    outposts: {
      0: legionnaire,
      1: kozu,
      2: abunakki,
      3: dreadnaught,
    },
  };
};

/** The MR3 tribe templates, read from disk once on first use. A failed read is retried on the next call. */
export const mr3TribeSaves = (): Promise<MR3TribeSaves> => {
  loading ??= load().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
};
