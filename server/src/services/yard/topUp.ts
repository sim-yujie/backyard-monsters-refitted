import { ClientSafeError } from "../../middleware/clientSafeError.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { RESOURCE_KEYS, topupCost } from "../base/economy/resourceBudget.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";
import { capOf, type CreditSave } from "./credit.js";
import { capsOf, purseOf, withPurse } from "./siege.js";
import { yardRefusedErr } from "./yardErrors.js";

/**
 * Paying a build, upgrade or fortification's shortfall in Shiny: Flash's
 * `BRTOPUP` (`client/scripts/BUILDINGOPTIONSPOPUP.as:642-760`, `TopoffUpgrade`,
 * `TopoffBuild`, `TopoffFortify`; issue #393).
 *
 * Flash summed what the pool lacked over all four resources, priced it on the
 * one Shiny curve (`topupCost`, `ceil((sqrt(short / 2)) ^ 0.75)`), funded
 * exactly the difference and started the job, so the short resources end at
 * 0. It refused with `msg_overcapacity` when a price is over the storage cap,
 * since no amount of funding fits it. No points: `BRTOPUP` only funds.
 *
 * The route runs its plan as usual. Only when the plan refuses `409 shortfall`
 * and the request carries `topUp` does this step in: `topUp` must equal the
 * server's price for that shortfall (else `409 shortfall { shortfall, topUp }`
 * names it, as the Starter Kit does), and nothing may be over the cap (`409
 * overCap`). Then the plan runs again on the yard seen with the shortfall
 * funded; its debit (or, for a main-yard Inferno building, its new Inferno
 * purse) already accounts for it, and the Shiny is added to its charge.
 */

/** What a plan returns, as far as the top-up reads and changes it. */
interface Charged {
  debit?: Partial<ResourceAmounts>;
  shiny?: number;
  slices?: { iresources?: JsonObject | null } & object;
}

/** The parts of a yard the top-up reads. */
type TopUpSave = CreditSave & { iresources?: JsonObject | null };

/** A `409 shortfall` refusal's detail, or null for any other error. */
const shortfallOf = (error: unknown): { shortfall: ResourceAmounts; inferno: boolean } | null => {
  if (!(error instanceof ClientSafeError)) return null;
  const data = error.data as { reason?: unknown; shortfall?: Partial<ResourceAmounts>; purse?: unknown };
  if (data.reason !== "shortfall" || !data.shortfall) return null;
  const whole = (raw: unknown) => {
    const value = Math.ceil(Number(raw));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const shortfall: ResourceAmounts = {
    r1: whole(data.shortfall.r1),
    r2: whole(data.shortfall.r2),
    r3: whole(data.shortfall.r3),
    r4: whole(data.shortfall.r4),
  };
  return { shortfall, inferno: data.purse === "inferno" };
};

/** `save` seen with `key` replaced: every other read goes through, a pool view's included. */
const seenWith = <S extends object>(save: S, key: "resources" | "iresources", value: JsonObject): S =>
  new Proxy(save, {
    get: (target, prop) => (prop === key ? value : Reflect.get(target, prop)),
  });

/**
 * Runs `plan` on `save`, paying a shortfall with the `topUp` the player agreed
 * to (see the module comment). Without `topUp` it is `plan(save)`.
 */
export const withTopUp = async <S extends TopUpSave, O extends Charged>(
  save: S,
  topUp: number | undefined,
  plan: (save: S) => O | Promise<O>
): Promise<O> => {
  if (topUp === undefined) return plan(save);
  let short: { shortfall: ResourceAmounts; inferno: boolean } | null;
  try {
    return await plan(save);
  } catch (error) {
    short = shortfallOf(error);
    if (!short) throw error;
  }
  const { shortfall, inferno } = short;

  const held: ResourceAmounts = inferno
    ? purseOf(save.iresources)
    : {
        r1: Number(save.resources?.r1) || 0,
        r2: Number(save.resources?.r2) || 0,
        r3: Number(save.resources?.r3) || 0,
        r4: Number(save.resources?.r4) || 0,
      };
  const caps: ResourceAmounts = inferno
    ? capsOf(save.iresources)
    : (() => {
        const cap = capOf(save);
        return { r1: cap, r2: cap, r3: cap, r4: cap };
      })();
  const shortKeys = RESOURCE_KEYS.filter((key) => shortfall[key] > 0);
  if (shortKeys.some((key) => held[key] + shortfall[key] > caps[key])) {
    // `msg_overcapacity`.
    throw yardRefusedErr("overCap", "That costs more than your storage holds. Build more storage first.", {
      shortfall,
    });
  }

  const price = topupCost(shortfall);
  if (topUp !== price) {
    throw yardRefusedErr("shortfall", "You do not have enough resources for that.", {
      shortfall,
      topUp: price,
      ...(inferno ? { purse: "inferno" } : {}),
    });
  }

  const funded: ResourceAmounts = {
    r1: held.r1 + shortfall.r1,
    r2: held.r2 + shortfall.r2,
    r3: held.r3 + shortfall.r3,
    r4: held.r4 + shortfall.r4,
  };
  if (inferno) {
    // The plan charges the funded purse into its `iresources` slice itself.
    const outcome = await plan(seenWith(save, "iresources", withPurse(save.iresources, funded)));
    return { ...outcome, shiny: (outcome.shiny ?? 0) + price };
  }
  const outcome = await plan(seenWith(save, "resources", { ...(save.resources ?? {}), ...funded }));
  const debit = { ...(outcome.debit ?? {}) };
  for (const key of shortKeys) debit[key] = Math.max(0, (debit[key] ?? 0) - shortfall[key]);
  return { ...outcome, debit, shiny: (outcome.shiny ?? 0) + price };
};
