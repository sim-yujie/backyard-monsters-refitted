import { siegeData, type SiegeId } from "@/game/combat/rules/siege";
import {
  CAPACITY_TEXT,
  noticeText,
  purseOf,
  runningJob,
  shortfallOf,
  siegeOffer,
  siteNotice,
  stockOf,
  warningText,
  type PurseAmounts,
  type SiegeContext,
  type SiegeSite,
  type SiegeStock,
} from "@/game/siege/siege";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * The Siege Lab's and Siege Factory's yard routes (Inferno WP 6.3; wire
 * contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/siege/{lab,factory}/start     weapon, topUp?
 *   POST /api/:apiVersion/bm/yard/siege/{lab,factory}/cancel
 *   POST /api/:apiVersion/bm/yard/siege/{lab,factory}/finish
 *   POST /api/:apiVersion/bm/yard/siege/{lab,factory}/instant   weapon
 *
 * One job per building: cancel and finish name nothing. Each answers like
 * every yard action, and its `report` carries the three weapons and the
 * Inferno purse after it, which the store writes into the save
 * (`siegeSlices`). {@link siegeActions} runs them through the store's
 * one-at-a-time queue.
 */

const SIEGE_PATH = "/api/:apiVersion/bm/yard/siege";

/** What every siege report carries: the weapons and the Inferno purse after it. */
export interface SiegeStateReport {
  site: SiegeSite;
  weapon: SiegeId;
  siege: Record<SiegeId, SiegeStock>;
  purse: PurseAmounts & { caps: PurseAmounts };
}

/** `report` of `start`. */
export interface SiegeStartReport extends SiegeStateReport {
  /** The Lab or Factory doing it. */
  building: number;
  /** When it ends, unix seconds. */
  endsAt: number;
  /** Inferno resources taken, floored. */
  cost: PurseAmounts;
  /** Shiny paid for the shortfall; 0 when nothing was short. */
  credits: number;
}

/** `report` of `cancel`. */
export interface SiegeCancelReport extends SiegeStateReport {
  /** Inferno resources actually returned, after the caps. */
  refund: PurseAmounts;
}

/** `report` of `finish` and `instant`. */
export interface SiegeShinyReport extends SiegeStateReport {
  credits: number;
}

/**
 * Starts researching (`lab`) or making (`factory`) `weapon`. Short of a
 * resource, `topUp` must be the Shiny the server's `409 shortfall` names.
 */
export const siegeStart = (
  site: SiegeSite,
  weapon: SiegeId,
  topUp?: number,
  baseid?: string,
): Promise<YardResponse<SiegeStartReport>> =>
  post<YardResponse<SiegeStartReport>>(
    `${SIEGE_PATH}/${site}/start`,
    yardBody(topUp === undefined ? { weapon } : { weapon, topUp }, baseid),
  );

/** Cancels the job for its cost back, capped. Refusals: `notBusy`. */
export const siegeCancel = (site: SiegeSite, baseid?: string): Promise<YardResponse<SiegeCancelReport>> =>
  post<YardResponse<SiegeCancelReport>>(`${SIEGE_PATH}/${site}/cancel`, yardBody({}, baseid));

/** Finishes the job now for `timeCost(endsAt − now)` Shiny. Refusals: `notBusy`, `shinyLocked`, `credits`. */
export const siegeFinish = (site: SiegeSite, baseid?: string): Promise<YardResponse<SiegeShinyReport>> =>
  post<YardResponse<SiegeShinyReport>>(`${SIEGE_PATH}/${site}/finish`, yardBody({}, baseid));

/** Does the job at once for Shiny, no resources. Refusals: `start`'s but the resources, then `shinyLocked`, `credits`. */
export const siegeInstant = (
  site: SiegeSite,
  weapon: SiegeId,
  baseid?: string,
): Promise<YardResponse<SiegeShinyReport>> =>
  post<YardResponse<SiegeShinyReport>>(`${SIEGE_PATH}/${site}/instant`, yardBody({ weapon }, baseid));

/** Every call above, so the actions can be handed a stand-in under test. */
export interface SiegeApi {
  start: typeof siegeStart;
  cancel: typeof siegeCancel;
  finish: typeof siegeFinish;
  instant: typeof siegeInstant;
}

export const siegeApi: SiegeApi = {
  start: siegeStart,
  cancel: siegeCancel,
  finish: siegeFinish,
  instant: siegeInstant,
};

/** The queue key of one route, for `store.isRunning`. */
export const siegeKey = (site: SiegeSite, verb: "start" | "cancel" | "finish" | "instant"): string =>
  actionKey("siege", `${site}/${verb}`);

/** Every siege key: the screen waits on all its buttons while any siege request runs. */
export const SIEGE_KEYS: readonly string[] = (["lab", "factory"] as const).flatMap((site) =>
  (["start", "cancel", "finish", "instant"] as const).map((verb) => siegeKey(site, verb)),
);

/** What the Siege screen can do at one site, each a queued store action that never throws. */
export interface SiegeActions {
  start(weapon: SiegeId, topUp?: number): Promise<YardActionResult<SiegeStartReport>>;
  cancel(): Promise<YardActionResult<SiegeCancelReport>>;
  finish(): Promise<YardActionResult<SiegeShinyReport>>;
  instant(weapon: SiegeId): Promise<YardActionResult<SiegeShinyReport>>;
}

/** A local refusal, in the server's shape. */
const refuse = (reason: string, message: string, detail: Record<string, unknown> = {}): YardRefusal => ({
  reason,
  message,
  detail,
  local: true,
});

/**
 * The rules the client can see for a start or an instant, against the state
 * the answer ahead left: the site's notice, then the right side's warning.
 * A start also checks the purse: over a cap is `capacity`, short without the
 * matching `topUp` is `shortfall`, both as the server spells them.
 */
const gate =
  (site: SiegeSite, weapon: SiegeId, paying: { topUp?: number } | null) =>
  (context: SiegeContext): YardRefusal | null => {
    if (!siegeData(weapon)) return refuse("badRequest", "That is not a siege weapon.", { weapon });
    const notice = siteNotice(context, site);
    if (notice && notice !== "noWeapon") return refuse(notice, `${noticeText(site, notice)}`);
    if (site === "factory" && stockOf(context.save.siege, weapon).level < 1) {
      return refuse("locked", "Research that weapon in the Chaos Lab first.", { weapon });
    }
    const offer = siegeOffer(context, site, weapon);
    if (offer.kind === "running") {
      return refuse(site === "lab" ? "labBusy" : "factoryBusy", "That weapon is already in hand.", { weapon });
    }
    if (offer.kind === "max") return refuse(site === "lab" ? "maxLevel" : "locked", "That weapon cannot go further.");
    if (offer.kind === "holding") return refuse("holding", warningText({ reason: "holding" }), { weapon });
    if (offer.kind === "warning") return refuse(offer.warning.reason, warningText(offer.warning));
    if (!paying) return null;
    const short = shortfallOf(offer.cost, purseOf(context.save.iresources));
    if (!short) return null;
    if (short.overCap) return refuse("capacity", CAPACITY_TEXT);
    if (paying.topUp !== short.topUp) {
      return refuse("shortfall", "You do not have enough Inferno resources for that.", {
        shortfall: short.short,
        topUp: short.topUp,
      });
    }
    return null;
  };

/**
 * One site's routes, routed through `store.run` so they queue behind any
 * request in flight and re-check the rules against the state the answer ahead
 * of them left. The store merges every answer and refreshes after a 409.
 */
export const siegeActions = (store: YardStore, site: SiegeSite, api: SiegeApi = siegeApi): SiegeActions => {
  const running = (context: SiegeContext) =>
    runningJob(context, site)
      ? null
      : refuse(
          "notBusy",
          site === "lab" ? "The Chaos Lab is not researching." : "The Chaos Factory is not building a weapon.",
        );
  return {
    start: (weapon, topUp) =>
      store.run({
        key: siegeKey(site, "start"),
        check: gate(site, weapon, topUp === undefined ? {} : { topUp }),
        send: (_api, ...yard) => api.start(site, weapon, topUp, ...yard),
      }),
    cancel: () => store.run({ key: siegeKey(site, "cancel"), check: running, send: (_api, ...yard) => api.cancel(site, ...yard) }),
    finish: () => store.run({ key: siegeKey(site, "finish"), check: running, send: (_api, ...yard) => api.finish(site, ...yard) }),
    instant: (weapon) =>
      store.run({
        key: siegeKey(site, "instant"),
        check: gate(site, weapon, null),
        send: (_api, ...yard) => api.instant(site, weapon, ...yard),
      }),
  };
};
