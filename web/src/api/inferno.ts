import { ApiError, get, post } from "./http";
import type { RaidView } from "./raid";
import type { ApiEnvelope, BaseLoadResponse } from "./types";

/**
 * The new Inferno (beta.5, `docs/design/inferno.md` §3.2): how far the player
 * is on the way in. Every route answers `403` with `reason: "infernoOff"`
 * while the server's switch is off (`docs/server-api.md`, "The new Inferno").
 */

/** `GET /bm/inferno/state` without its envelope (`controllers/inferno/infernoState.ts`). */
export interface InfernoState {
  /** The server's clock, unix seconds. */
  readonly now: number;
  readonly cave: {
    /** Whether the cave shows on the main yard: Town Hall 5 (or a cave already up), tutorial over. */
    readonly shown: boolean;
    /** 0-5, one per emergence raid. */
    readonly level: number;
    readonly maxLevel: number;
  };
  readonly emergence: {
    readonly lastAt: number | null;
    /** The earliest the next raid may come (0: any time), or null once all five are done. */
    readonly nextAt: number | null;
    readonly done: boolean;
  };
  readonly descent: {
    readonly level: number;
    readonly destroyed: readonly number[];
    readonly passed: boolean;
  };
  readonly hasYard: boolean;
  /**
   * The Inferno yard's Under Hall level, 0 with none or before the Descent is
   * passed: the hall the main yard's Inferno buildings count by (WP 6.1).
   * Absent from a server that predates it, read as 0.
   */
  readonly underHall?: number;
  /**
   * Korath is unlocked: the player owns an Inferno yard, so the Champion Cage
   * raises him (WP 5.1, owner I10). Absent from a server that predates it, read as false.
   */
  readonly korathUnlocked?: boolean;
  /** Korath is unlocked and the player has not been shown "Korath unlocked" yet. */
  readonly korathNotice: boolean;
}

/** One card of Moloch's warning: a monster type and its count, in Flash's order. */
export interface MolochGroup {
  readonly monster: string;
  readonly count: number;
}

/** Moloch's raid as the load answers it: the raid routes' view, and its groups for the warning. */
export interface MolochRaidView extends RaidView {
  readonly groups: readonly MolochGroup[];
}

/**
 * The `/base/load` answer's `infernostate`, on the owner's build load of the
 * main yard while the Inferno is on: the state, `raised`, the level the cave
 * just went up to on this load, or null, and `raid`, Moloch's raid for it
 * (WP 1.9), due now; null when the first raise found the yard at 10% health
 * or less, which grows the cave with no raid, as Flash did.
 */
export interface InfernoLoadState extends InfernoState {
  readonly raised: number | null;
  readonly raid?: MolochRaidView | null;
}

export type InfernoStateResponse = ApiEnvelope & InfernoState;

export const loadInfernoState = (): Promise<InfernoStateResponse> =>
  get<InfernoStateResponse>("/api/:apiVersion/bm/inferno/state");

/**
 * `POST /bm/inferno/korath/seen` (WP 5.2): "Korath unlocked" has been shown, so
 * the main yard's next load no longer asks for it.
 */
export const markKorathSeen = (): Promise<ApiEnvelope> => post<ApiEnvelope>("/api/:apiVersion/bm/inferno/korath/seen");

/**
 * `POST /bm/inferno/load` (WP 1.14): the caller's own Inferno yard, caught up,
 * as the yard routes read it: its save fields, `baseid` (which every yard
 * route then sends), `type: "inferno"`, the shared Shiny and the Inferno
 * purse with its cap. `409 noInfernoYard` before the Descent is won, and
 * `403 infernoOff` while the server's switch is off.
 */
export const loadInfernoYard = (): Promise<BaseLoadResponse> =>
  post<BaseLoadResponse>("/api/:apiVersion/bm/inferno/load");

/**
 * Whether a refusal says there is no Inferno yard to open: `409 noInfernoYard`
 * before the Descent is won, `403 infernoOff` while the switch is off.
 */
export const isInfernoClosed = (caught: unknown): boolean => {
  const reason = infernoRefusalOf(caught);
  return reason === "noInfernoYard" || reason === "infernoOff";
};

/** The `reason` an Inferno route refused with, and the refusal's `data` beside it; null for anything else. */
export const infernoRefusalOf = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const reason = refusalData(caught).reason;
  return typeof reason === "string" ? reason : null;
};

/** A refusal's `data` (`details.data`) over its body's own fields (an older shape). */
export const refusalData = (caught: ApiError): Record<string, unknown> => {
  const asRecord = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return { ...asRecord(caught.body), ...asRecord(caught.details?.data) };
};

/** What the main yard says when the Inferno yard would not open. */
export const INFERNO_CLOSED_TEXT = "The Inferno yard is not open to you yet.";

/** Bone, Coal, Sulfur, Magma: the Inferno purse's four amounts (`purseAmounts`). */
export interface InfernoAmounts {
  readonly r1: number;
  readonly r2: number;
  readonly r3: number;
  readonly r4: number;
}

/**
 * `POST /bm/inferno/attack/start` with `kind: "descent"` (WP 1.11,
 * `controllers/inferno/descentAttack.ts`): the Descent yard to fight, fought
 * as an Inferno yard, and what the attacker fights it with.
 */
export interface DescentAttackStart extends ApiEnvelope {
  readonly kind: "descent";
  readonly yardkind: "inferno";
  readonly attackid: number;
  /** The yard attacked, 1-13 (base id less 200): from 7 surface monsters burn. */
  readonly descentyard: number;
  /** Flash's Descent counter before this attack, 1-13. */
  readonly level: number;
  /** The yard, as an attack load serves one. */
  readonly base: Partial<BaseLoadResponse>;
  readonly defenderforces: unknown;
  readonly attackerbrains?: unknown;
  readonly attackeracademy?: unknown;
  readonly attackerranks?: unknown;
  readonly attpowerups?: unknown[];
  /** What one fling may carry. */
  readonly flingercapacity: number;
  /** The Inferno purse now: the Descent's running loot total. */
  readonly descentloot?: InfernoAmounts;
}

export const startDescentAttack = (baseid: string): Promise<DescentAttackStart> =>
  post<DescentAttackStart>("/api/:apiVersion/bm/inferno/attack/start", { kind: "descent", baseid });

/**
 * The start answer as the attack scene reads an attack load: the yard with
 * the fight's own fields beside it. `type` says Inferno, so the yard is drawn
 * and fought with the Inferno buildings (`docs/design/inferno.md` §2.4 "Yard
 * kind"), as Flash loads a Descent yard as an Inferno yard.
 */
export const descentAttackLoad = (start: DescentAttackStart): BaseLoadResponse =>
  ({
    ...start.base,
    type: "inferno",
    attackid: start.attackid,
    defenderforces: start.defenderforces,
    ...(start.attackerbrains === undefined ? {} : { attackerbrains: start.attackerbrains }),
    ...(start.attackeracademy === undefined ? {} : { attackeracademy: start.attackeracademy }),
    ...(start.attackerranks === undefined ? {} : { attackerranks: start.attackerranks }),
    ...(start.attpowerups === undefined ? {} : { attpowerups: start.attpowerups }),
  }) as BaseLoadResponse;

/**
 * The landing's word on a Descent attack, the `descent` of the `/base/save`
 * answer that ends it (WP 1.12, `services/inferno/descentLanding.ts`).
 */
export interface DescentLanding {
  /** Damage of 90% or more beat the yard. */
  readonly won: boolean;
  /** The server's damage, 0-100. */
  readonly damage: number;
  /** Flash's counter after the attack: 1 + yards beaten, 14 once passed. */
  readonly level: number;
  /** This attack's loot, credited to the Inferno purse. */
  readonly loot: InfernoAmounts;
  /** The purse after it: the report's running total. */
  readonly total: InfernoAmounts;
  /** The 13th win: the Inferno yard is the player's. */
  readonly captured: boolean;
  readonly infernobaseid?: string | number;
}

/** The landing's `descent`, when the answer carries a well-formed one. */
export const descentLandingOf = (response: unknown): DescentLanding | null => {
  const descent = (response as { descent?: unknown } | null)?.descent;
  if (typeof descent !== "object" || descent === null) return null;
  const value = descent as Partial<DescentLanding>;
  return typeof value.won === "boolean" && typeof value.level === "number" ? (value as DescentLanding) : null;
};

/**
 * What the save's answer says of a landed Moloch tribe attack, under `tribe`
 * (WP 2.8, `services/inferno/infernoTribeLanding.ts`). Only the final save
 * carries it.
 */
export interface TribeLanding {
  /** The Under Hall fell. */
  readonly won: boolean;
  /** The server's damage, 0-100. */
  readonly damage: number;
  /** The loot the tribe gave up. */
  readonly loot: InfernoAmounts;
  /** What of it the Inferno purse took, up to its caps. */
  readonly lootcredited: InfernoAmounts;
  /** The purse after it. */
  readonly total: InfernoAmounts;
  /** When the tribe is back, unix seconds, once it fell; 0 while it stands. */
  readonly respawnat: number;
}

/** The `tribe` block of a save's answer, when it carries one. */
export const tribeLandingOf = (response: unknown): TribeLanding | null => {
  const tribe = (response as { tribe?: unknown } | null)?.tribe;
  if (typeof tribe !== "object" || tribe === null) return null;
  const value = tribe as Partial<TribeLanding>;
  return typeof value.won === "boolean" && typeof value.lootcredited === "object" && value.lootcredited !== null
    ? (value as TribeLanding)
    : null;
};

/* ── The Inferno map: Moloch's tribes (WP 2.7-2.9) ── */

/** One Moloch tribe as `GET /bm/inferno/map` answers it (`services/inferno/infernoTribeMap.ts`). */
export interface InfernoTribeView {
  /** "214"-"234": the tribe's yard. */
  readonly baseid: string;
  /** Its map level. */
  readonly level: number;
  /** 1 while it lies wrecked. */
  readonly destroyed: 0 | 1;
  /** When a wrecked tribe is back, unix seconds; 0 while it stands. */
  readonly respawnat: number;
  /** The last attack's damage this tribe life, 0-100. */
  readonly damage: number;
}

/** `GET /bm/inferno/map` (WP 2.7): the seven tribes the Inferno yard faces at its level. */
export interface InfernoMapResponse extends ApiEnvelope {
  /** The server's clock, unix seconds. */
  readonly currenttime: number;
  /** The Inferno yard's level, which picks the tribes. */
  readonly level: number;
  readonly tribes: readonly InfernoTribeView[];
}

/** `409 noInfernoYard` without an Inferno yard, `403 infernoOff` while the switch is off. */
export const loadInfernoMap = (): Promise<InfernoMapResponse> =>
  get<InfernoMapResponse>("/api/:apiVersion/bm/inferno/map");

/**
 * `POST /bm/inferno/attack/start` with `kind: "tribe"` (WP 2.8,
 * `controllers/inferno/tribeAttack.ts`): the tribe's yard, fought as an
 * Inferno yard, and the Inferno yard's army it is fought with. Refused (409)
 * with `reason` `notInfernoTribe`, `notYourTribe`, `tribeDestroyed` (with
 * `respawnAt`), `noMonsters`, `noInfernoYard` or `underAttack`.
 */
export interface TribeAttackStart extends ApiEnvelope {
  readonly kind: "tribe";
  readonly yardkind: "inferno";
  readonly attackid: number;
  /** The tribe's map level. */
  readonly level: number;
  readonly base: Partial<BaseLoadResponse>;
  readonly defenderforces: unknown;
  /** The Inferno yard's base id: the army's yard. */
  readonly armybaseid: string;
  /** What the Inferno yard's Housing Bunkers hold: everything the attack can fling. */
  readonly army: Readonly<Record<string, number>>;
  /** Infernal Academy levels by monster id. */
  readonly attackeracademy: Readonly<Record<string, number>>;
  /** The player's level, for the low-level loot bonus. */
  readonly attackerlevel?: number;
  readonly attpowerups?: unknown[];
  /** What one fling may carry: a Housing Bunker's load (R11). */
  readonly flingercapacity: number;
}

export const startTribeAttack = (baseid: string): Promise<TribeAttackStart> =>
  post<TribeAttackStart>("/api/:apiVersion/bm/inferno/attack/start", { kind: "tribe", baseid });

/** The tribe start as the attack scene reads an attack load, an Inferno yard as the Descent's is. */
export const tribeAttackLoad = (
  start: Pick<TribeAttackStart, "base" | "attackid" | "defenderforces" | "attackeracademy" | "attackerlevel" | "attpowerups">,
): BaseLoadResponse =>
  ({
    ...start.base,
    type: "inferno",
    attackid: start.attackid,
    defenderforces: start.defenderforces,
    attackeracademy: start.attackeracademy,
    ...(start.attackerlevel === undefined ? {} : { attackerlevel: start.attackerlevel }),
    ...(start.attpowerups === undefined ? {} : { attpowerups: start.attpowerups }),
  }) as BaseLoadResponse;

/* ── The Inferno map: other players (PvP, WP 3.1-3.5) ── */

/**
 * One player of the Inferno map as `GET /bm/inferno/neighbours` answers it
 * (`services/inferno/infernoNeighbours.ts`): Flash's `maproom_inferno`
 * player row.
 */
export interface InfernoNeighbourView {
  readonly userid: number;
  /** Their Inferno yard's base id: what an attack or a look names. */
  readonly baseid: string;
  readonly name: string;
  readonly pic: string;
  /** Their Inferno yard's level. */
  readonly level: number;
  /** 1 while they are playing anywhere in the game, when they cannot be attacked. */
  readonly online: 0 | 1;
  readonly friend: 0 | 1;
  /**
   * What the player may do to them now, Flash's codes (`PlayerHandler.as`):
   * 1 attack, 2 attack a higher level, 3 level too far apart, 4 revenge,
   * 5 damage protection, 7 under attack.
   */
  readonly attackpermitted: number;
  /** When their damage protection ends, unix seconds; 0 without any. */
  readonly protecteduntil: number;
  /** Who is attacking them now, while they are attacked. */
  readonly attacker: string;
  readonly attacksfrom: number;
  readonly attacksto: number;
  /** Revenge attacks left on them. */
  readonly vengeance: number;
}

/** `GET /bm/inferno/neighbours`: the players whose Inferno yards the player's faces. */
export interface InfernoNeighboursResponse extends ApiEnvelope {
  /** The server's clock, unix seconds. */
  readonly currenttime: number;
  /** The player's own Inferno yard level. */
  readonly level: number;
  readonly neighbours: readonly InfernoNeighbourView[];
}

export const loadInfernoNeighbours = (): Promise<InfernoNeighboursResponse> =>
  get<InfernoNeighboursResponse>("/api/:apiVersion/bm/inferno/neighbours");

/**
 * `POST /bm/inferno/attack/start` with `kind: "player"` (WP 3.2,
 * `controllers/inferno/playerAttack.ts`): another player's Inferno yard and
 * the Inferno yard's army it is fought with, as a tribe's. Refused (409) with
 * `reason` `notInfernoPlayer`, `protected` (with `protectedUntil`),
 * `targetUnderAttack` (with `attacker`), `outOfRange`, `ownerOnline`,
 * `noMonsters`, `noInfernoYard` or `underAttack`.
 */
export interface PlayerAttackStart extends ApiEnvelope {
  readonly kind: "player";
  readonly yardkind: "inferno";
  readonly attackid: number;
  /** The defender's Inferno yard level. */
  readonly level: number;
  /** The defender's name. */
  readonly ownername: string;
  readonly base: Partial<BaseLoadResponse>;
  readonly defenderforces: unknown;
  /** The own Inferno yard's base id: the army's yard. */
  readonly armybaseid: string;
  /** What the own Inferno yard's Housing Bunkers hold: everything the attack can fling. */
  readonly army: Readonly<Record<string, number>>;
  /** Infernal Academy levels by monster id. */
  readonly attackeracademy: Readonly<Record<string, number>>;
  readonly attackerlevel?: number;
  readonly attpowerups?: unknown[];
  /** What one fling may carry: a Housing Bunker's load (R11). */
  readonly flingercapacity: number;
}

export const startPlayerAttack = (baseid: string): Promise<PlayerAttackStart> =>
  post<PlayerAttackStart>("/api/:apiVersion/bm/inferno/attack/start", { kind: "player", baseid });

/**
 * The player start as the attack scene reads an attack load. It carries the
 * yard's `basesaveid`, so the attack's checkpoints go to the server: an
 * attack left without its final save is closed from the last one, and one
 * with none past its first seconds counts its whole army as used.
 */
export const playerAttackLoad = (start: PlayerAttackStart): BaseLoadResponse =>
  ({
    ...tribeAttackLoad(start),
    basesaveid: Number(start.base.basesaveid),
  }) as BaseLoadResponse;

/** `POST /bm/inferno/view` (WP 3.4): another player's Inferno yard, to look at only. */
export interface InfernoViewResponse extends BaseLoadResponse {
  readonly currenttime: number;
  /** The yard's Inferno level. */
  readonly level: number;
  readonly ownername: string;
}

/** Refused (409) with `notInfernoPlayer`, or `targetUnderAttack` while it is attacked. */
export const viewInfernoYard = (baseid: string): Promise<InfernoViewResponse> =>
  post<InfernoViewResponse>("/api/:apiVersion/bm/inferno/view", { baseid });

/**
 * What the save's answer says of a landed attack on another player's Inferno
 * yard, under `player` (WP 3.3, `services/inferno/infernoPlayerLanding.ts`).
 * Only the final save carries it.
 */
export interface PlayerLanding {
  /** The server's damage, 0-100. */
  readonly damage: number;
  /** What the attack took from the defender's purse. */
  readonly loot: InfernoAmounts;
  /** What of it the Inferno purse took, up to its caps. */
  readonly lootcredited: InfernoAmounts;
  /** The purse after it. */
  readonly total: InfernoAmounts;
  /** The housed monsters the defender lost with their fallen Housing Bunkers. */
  readonly housedlost: Readonly<Record<string, number>>;
}

/** The `player` block of a save's answer, when it carries one. */
export const playerLandingOf = (response: unknown): PlayerLanding | null => {
  const player = (response as { player?: unknown } | null)?.player;
  if (typeof player !== "object" || player === null) return null;
  const value = player as Partial<PlayerLanding>;
  return typeof value.damage === "number" && typeof value.lootcredited === "object" && value.lootcredited !== null
    ? (value as PlayerLanding)
    : null;
};
