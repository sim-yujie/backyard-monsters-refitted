import type { TakeoverPayment } from "@/api/maproom";
import {
  CellType,
  isFogCell,
  isPlayerCell,
  isWaterCell,
  type MapCell,
  type Resources,
  type TakeoverGrantOffer,
  type TakeoverQuoteResponse,
  type TakeoverRefusalReason,
} from "@/api/types";
import { formatAmount, formatCountdown } from "@/ui/format";

/**
 * Taking over a Map Room 2 camp or outpost (issue #82, outposts plan WP6).
 *
 * Nothing here decides who may take what, or for how much: that is the
 * server's takeover quote (`POST /worldmapv2/takeoverquote`), which runs the
 * takeover's own rules and price. This file turns a quote into what the map's
 * Take over button, the confirm dialog and the end-of-attack panel say, in
 * Flash's words where Flash had them (`PopupTakeover.as:85-122`,
 * `PopupInfoEnemy.as:523-529`, `BASE.as:2292-2319`, the `KEYS` in
 * `english.json`), and in plain ones where it did not.
 *
 * The only clock kept is the countdown to a grant's end, shown against the
 * server's time (`clockSkew`). When it runs out the caller asks the server
 * again rather than deciding locally.
 */

/** Flash's strings. */
export const TAKEOVER_TEXT = {
  /** `btn_takeover` */
  button: "Take over",
  /** `takeover_wildmonsteryard` */
  campTitle: "Take over this Wild Monster Yard",
  /** `takeover_expand` */
  expand: "Expand your empire!",
  /** `btn_useresources` */
  useResources: "Use Resources",
  /** `takeover_instant` */
  instant: "Keep your resources and takeover instantly!",
  /** `newmap_take4` */
  needResources: "You need more resources to take over this base.",
  /** `err_takeoverproblem` (Flash appends the server's error). */
  problem: "There was a problem taking over this yard: ",
  /** `venividivici` */
  firstOpenTitle: "Veni, Vidi, Vici!",
  /** `newmap_des_pl1` */
  outpostDestroyed: "You have destroyed this outpost and can now take it and all its buildings.",
  /** Not Flash's: its end popup offered no takeover on a camp (`popup_attackend.as`). */
  campDestroyed: "You destroyed at least 90% of this camp, so you can take it over as an outpost.",
} as const;

/** `takeover_outpost`: "Take Over #v1#'s Outpost". */
export const outpostTitle = (owner: string): string => `Take Over ${owner}'s Outpost`;

/** `btn_useshiny`: "Use #v1# Shiny". */
export const useShinyLabel = (shiny: number): string => `Use ${formatAmount(shiny)} Shiny`;

/**
 * The first-open line (`BASE.as:2292-2319`): `destroyedbase_takeover` for a
 * camp, `destroyedoutpost_takeover` for a player's outpost.
 */
export const firstOpenText = (kind: TakeoverKind, name: string): string =>
  kind === "camp"
    ? `You destroyed a ${name} base. Take over their yard and expand your empire.`
    : `You destroyed ${name}'s Outpost. Take over their yard and expand your empire.`;

/** The art Flash showed with it (`building-outpost.png`). */
export const FIRST_OPEN_ART = "/assets/popups/building-outpost.png";

export type TakeoverKind = "camp" | "outpost";

/** A cell the map may offer Take over on, before the server has been asked. */
export interface TakeoverCandidate {
  readonly baseid: string;
  readonly kind: TakeoverKind;
  /** The tribe's name for a camp, the owner's for an outpost. */
  readonly name: string;
}

/**
 * Whether the map should ask the server about taking this cell over: a wild
 * camp, or another player's outpost. Main yards, the caller's own cells and
 * water are never asked about (`takeoverRules.ts` refuses them all anyway).
 */
export const takeoverCandidate = (payload: MapCell | undefined): TakeoverCandidate | null => {
  if (!payload || isWaterCell(payload)) return null;
  if (payload.b === CellType.WILD_MONSTER) return { baseid: payload.bid, kind: "camp", name: payload.n };
  if (isPlayerCell(payload) && payload.mine === 0 && payload.b === CellType.OUTPOST) {
    return { baseid: payload.bid, kind: "outpost", name: payload.n };
  }
  return null;
};

/**
 * What of a cell's payload a quote depends on. When any of it changes the
 * map asks again; the rest of the payload (and the once-a-second panel
 * refresh) does not.
 */
export const quoteKey = (payload: MapCell | undefined): string | null => {
  const candidate = takeoverCandidate(payload);
  if (!candidate || !payload || isWaterCell(payload) || isFogCell(payload)) return null;
  const flags = isPlayerCell(payload) ? `${payload.uid}:${payload.p}:${payload.lo}` : "0";
  return `${candidate.baseid}:${payload.b}:${payload.d}:${flags}`;
};

/** A refusal in plain words. `kind` picks Flash's camp or outpost wording where it differs. */
export const refusalText = (reason: TakeoverRefusalReason, kind: TakeoverKind = "camp"): string => {
  switch (reason) {
    case "notFound":
      return "This yard could not be found.";
    case "mainYard":
      return "A main yard cannot be taken over.";
    case "ownYard":
      return "This yard is already yours.";
    case "noTakeoverChance":
      return "Only the player who destroyed this outpost can take it over, and only just after the attack.";
    case "notDestroyed":
      return "Not yet: destroy at least 90% of this yard first.";
    case "regenerated":
      return "The wild monsters have rebuilt this yard. Destroy it again first.";
    case "protected":
      return "This yard is under damage protection.";
    case "locked":
      // newmap_take2 / newmap_take3
      return kind === "camp"
        ? "This yard is currently under attack by another player."
        : "This yard is currently being worked on by its owner or is under attack by another player.";
    case "underAttack":
      return "An attack on this yard is still going on.";
    case "maxOutposts":
      return "You already hold the most outposts allowed.";
    case "outOfRange":
      return "None of your Flingers reach this yard.";
    case "notEnoughResources":
      return TAKEOVER_TEXT.needResources;
    case "notEnoughShiny":
      return "You do not have enough Shiny.";
  }
};

/** The refusal reason an {@link ApiError}-like failure carries in `details.data.reason`. */
export const refusalReasonOf = (caught: unknown): TakeoverRefusalReason | null => {
  const data = (caught as { details?: { data?: unknown } } | null)?.details?.data;
  if (typeof data !== "object" || data === null) return null;
  const reason = (data as { reason?: unknown }).reason;
  return typeof reason === "string" ? (reason as TakeoverRefusalReason) : null;
};

/**
 * A failed takeover as Flash put it: `err_takeoverproblem` followed by why,
 * in plain words when the server named a rule.
 */
export const takeoverFailureText = (caught: unknown, kind: TakeoverKind): string => {
  const reason = refusalReasonOf(caught);
  if (reason) return TAKEOVER_TEXT.problem + lowerFirst(refusalText(reason, kind));
  const name = (caught as { name?: unknown } | null)?.name;
  if (name === "NetworkError") return `${TAKEOVER_TEXT.problem}the server could not be reached.`;
  const message = caught instanceof Error && caught.message ? caught.message : "something went wrong.";
  return TAKEOVER_TEXT.problem + message;
};

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** "1,000,000 of each resource or 549 Shiny". */
export const priceText = (price: { resources?: number | undefined; shiny?: number | undefined }): string => {
  if (price.resources === undefined) return "Price unknown";
  const resources = `${formatAmount(price.resources)} of each resource`;
  return price.shiny === undefined ? resources : `${resources} or ${formatAmount(price.shiny)} Shiny`;
};

/**
 * Seconds the server's clock is ahead of this one, from a response that
 * carries the server's `now`. Countdowns add it to the local clock.
 */
export const clockSkew = (serverNow: number | undefined, localNowSeconds: number): number =>
  typeof serverNow === "number" && Number.isFinite(serverNow) ? serverNow - localNowSeconds : 0;

/** "Offer ends in 9m 58s", or that it has ended. */
export const grantCountdownText = (expiresAt: number, serverNowSeconds: number): string => {
  const left = expiresAt - serverNowSeconds;
  return left > 0 ? `Offer ends in ${formatCountdown(left)}` : "The offer has ended.";
};

/** Where the map's Take over control stands. */
export type TakeoverQuoteState =
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "quoted"; readonly quote: TakeoverQuoteResponse };

/** What the map's Take over control shows. */
export interface TakeoverActionView {
  /** Hidden on a player outpost unless the caller's grant is live. */
  readonly visible: boolean;
  readonly enabled: boolean;
  /** The line under the button: the price, or why not. */
  readonly note: string;
  /** Server seconds the grant ends, for a countdown; absent on camps. */
  readonly expiresAt?: number;
}

const HIDDEN: TakeoverActionView = { visible: false, enabled: false, note: "" };

/**
 * The Take over control for one cell. A camp always shows it (disabled with
 * the reason when it cannot be taken); a player outpost only while the
 * caller holds the grant, since for anyone else the answer is always no and
 * the button would be noise.
 */
export const takeoverActionView = (kind: TakeoverKind, state: TakeoverQuoteState): TakeoverActionView => {
  switch (state.status) {
    case "loading":
      return kind === "camp"
        ? { visible: true, enabled: false, note: "Checking whether this yard can be taken over…" }
        : HIDDEN;
    case "failed":
      return kind === "camp"
        ? { visible: true, enabled: false, note: "Could not check whether this yard can be taken over." }
        : HIDDEN;
    case "quoted": {
      const { quote } = state;
      const expiresAt = quote.grantExpiresAt;
      if (kind === "outpost" && expiresAt === undefined) return HIDDEN;
      const note = quote.eligible ? priceText(quote) : refusalText(quote.reason ?? "notFound", kind);
      return {
        visible: true,
        enabled: quote.eligible,
        note,
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };
    }
  }
};

/**
 * The grant on a final attack save, when it is a usable one: for the target
 * just attacked, with an end in the future by the server's own clock.
 */
export const takeoverGrantOf = (
  response: { takeovergrant?: unknown },
  baseid: string,
): TakeoverGrantOffer | null => {
  const grant = response.takeovergrant;
  if (typeof grant !== "object" || grant === null) return null;
  const { baseid: grantBase, expiresAt } = grant as Partial<TakeoverGrantOffer>;
  if (String(grantBase) !== String(baseid)) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return grant as TakeoverGrantOffer;
};

/**
 * Flash's `_outpostCapacity` (`GLOBAL.as:806`): every outpost adds this much
 * storage of each resource. The server's caps count it too
 * (`resourceBudget.ts`); this is only for showing it before they arrive.
 */
export const OUTPOST_CAPACITY = 2_000_000;

/**
 * The HUD's pool right after a takeover, as Flash showed it
 * (`PopupTakeover.as:140-159`): the price off (of each resource, or the
 * Shiny) and every cap raised by {@link OUTPOST_CAPACITY}. The next resource
 * sync replaces it with the server's own figures.
 */
export const takenOverResources = (
  resources: Resources,
  credits: number | undefined,
  price: { resources?: number | undefined; shiny?: number | undefined },
  payment: TakeoverPayment,
): { resources: Resources; credits: number | undefined } => {
  const next: Resources = { ...resources };
  for (const key of ["r1", "r2", "r3", "r4"] as const) {
    const max = next[`${key}max`];
    if (max !== undefined) next[`${key}max`] = max + OUTPOST_CAPACITY;
    const held = next[key];
    if (payment === "resources" && held !== undefined && price.resources !== undefined) {
      next[key] = Math.max(0, held - price.resources);
    }
  }
  const shiny = price.shiny;
  const paidShiny = payment === "shiny" && credits !== undefined && shiny !== undefined;
  return { resources: next, credits: paidShiny ? Math.max(0, credits - shiny) : credits };
};
