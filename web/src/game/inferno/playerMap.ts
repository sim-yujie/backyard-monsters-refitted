import type { InfernoNeighbourView, InfernoNeighboursResponse } from "@/api/inferno";
import { formatSpan } from "@/game/maproom1/mr1Model";
import { TRIBE_NO_MONSTERS, TRIBE_START_FAILED } from "./tribeMap";

/**
 * The players of the Inferno map (PvP, Inferno WP 3.5, `docs/design/inferno.md`
 * §2.7): the rows of `GET /bm/inferno/neighbours` as the map's Players tab
 * shows them, and what Attack and View say, in Flash's words
 * (`maproom_inferno/PlayerHandler.as`, strings from `english.json`).
 */

/** Flash's attack codes (`PlayerHandler.as`, the server's `AttackPermission`). */
export const PlayerPermission = {
  ATTACKABLE: 1,
  HIGHER_LEVEL: 2,
  LEVEL_TOO_FAR: 3,
  VENGEANCE: 4,
  DAMAGE_PROTECTION: 5,
  UNDER_ATTACK: 7,
} as const;

/** One player of the Players tab. */
export interface PlayerRow {
  /** Their Inferno yard's base id. */
  readonly baseid: string;
  readonly userid: number;
  readonly name: string;
  readonly pic: string;
  readonly level: number;
  readonly online: boolean;
  readonly friend: boolean;
  readonly permission: number;
  readonly protectedUntil: number;
  /** Who is attacking them now, while they are attacked. */
  readonly attacker: string;
  readonly vengeance: number;
}

export const playerRowOf = (view: InfernoNeighbourView): PlayerRow => ({
  baseid: String(view.baseid),
  userid: view.userid,
  name: view.name,
  pic: view.pic,
  level: view.level,
  online: view.online === 1,
  friend: view.friend === 1,
  permission: view.attackpermitted,
  protectedUntil: view.protecteduntil,
  attacker: view.attacker,
  vengeance: view.vengeance,
});

/** The rows, nearest level first, then by name, as Flash's list opened. */
export const playerRows = (answer: Pick<InfernoNeighboursResponse, "neighbours" | "level">): PlayerRow[] =>
  answer.neighbours
    .map(playerRowOf)
    .sort(
      (a, b) =>
        Math.abs(a.level - answer.level) - Math.abs(b.level - answer.level) || a.name.localeCompare(b.name),
    );

/** `player_online`, `player_offline`. */
export const PLAYING_NOW = "Playing Now";
export const OFFLINE = "Offline";

/** What a player's row says and lets the player do (`PlayerHandler.configure`). */
export interface PlayerStatus {
  /** "Playing Now" or "Offline". */
  readonly presence: string;
  /** Flash's extra status: protection, under attack, level, revenge; empty without one. */
  readonly extra: string;
  /** The extra status is a warning (Flash's red). */
  readonly alarm: boolean;
  readonly canAttack: boolean;
  /** View is off only while the yard is attacked. */
  readonly canView: boolean;
}

export const playerStatus = (row: PlayerRow): PlayerStatus => {
  let canAttack = !row.online;
  let canView = true;
  let extra = "";
  let alarm = false;
  switch (row.permission) {
    case PlayerPermission.LEVEL_TOO_FAR:
      canAttack = false;
      extra = "Level too low to attack";
      break;
    case PlayerPermission.VENGEANCE:
      extra = `Vengeance enabled X ${row.vengeance}`;
      alarm = true;
      break;
    case PlayerPermission.DAMAGE_PROTECTION:
      canAttack = false;
      extra = "Damage Protection";
      break;
    case PlayerPermission.UNDER_ATTACK:
      canAttack = false;
      canView = false;
      extra = "UNDER ATTACK!";
      alarm = true;
      break;
  }
  return { presence: row.online ? PLAYING_NOW : OFFLINE, extra, alarm, canAttack: canAttack && canView, canView };
};

/**
 * The plain warning before a player attack starts (owner, 27 Oct): once the
 * start answers, the attack counts, and one left without its result past the
 * server's 10-second grace is landed with its whole army used
 * (`services/inferno/infernoPlayerLanding.ts`, `INFERNO_NO_BATTLE_GRACE`).
 */
export const PLAYER_ATTACK_COUNTS =
  "Once the attack starts it counts. If you leave after 10 seconds without finishing, the monsters you brought are used up.";

/** What Attack on a player does first: ask, with Flash's words, or say why not. */
export type PlayerAttackPrompt =
  | { readonly kind: "confirm"; readonly text: string }
  | { readonly kind: "refuse"; readonly text: string };

/**
 * Flash's `PlayerHandler.onAttack`: the owner playing now refuses; codes 1, 2
 * and 4 ask first (1 warns of the player's own protection, or of a friend);
 * 3, 5 and 7 refuse.
 *
 * @param ownProtectedUntil - When the own Inferno yard's protection ends, unix seconds.
 */
export const playerAttackPrompt = (row: PlayerRow, ownProtectedUntil: number, now: number): PlayerAttackPrompt => {
  if (row.online) return { kind: "refuse", text: ownerPlayingText(row.name) };
  switch (row.permission) {
    case PlayerPermission.ATTACKABLE:
      if (ownProtectedUntil > now) {
        return {
          kind: "confirm",
          text:
            `WARNING - You are protected for ${formatSpan(ownProtectedUntil - now)}. ` +
            "Attacking anyone will remove your protection and leave you open to attacks from others.",
        };
      }
      return {
        kind: "confirm",
        text: row.friend
          ? `Really?! You want to attack ${row.name}? We thought you were friends.`
          : `Are you sure you want to attack ${row.name}?`,
      };
    case PlayerPermission.HIGHER_LEVEL:
      return {
        kind: "confirm",
        text:
          `You can attack ${row.name} but they're a higher level than you and your monsters will have a tough time ` +
          "overpowering their defenses. Also, if you do attack them, they'll have the ability to retaliate. " +
          "Chances are they will destroy your base. Your call, but don't say we didn't warn you!",
      };
    case PlayerPermission.VENGEANCE:
      return {
        kind: "confirm",
        text:
          "Normally you wouldn't be able to attack a person whose level is so much lower than yours, " +
          "but they were dumb enough to attack you first! We'll let you attack them as many times as they " +
          'attacked you to teach them a lesson. As they say, "Revenge is a dish best served cold."',
      };
    case PlayerPermission.DAMAGE_PROTECTION:
      return { kind: "refuse", text: protectedText(row.name) };
    case PlayerPermission.UNDER_ATTACK:
      return { kind: "refuse", text: underAttackText(row.name, row.attacker) };
    default:
      return { kind: "refuse", text: LEVEL_TOO_LOW };
  }
};

/**
 * `map_msg_leveltoolow`. The server refuses a level too far either way
 * (`outOfRange`); Flash had words only for one too far below, so a target
 * too far above gets them too (open item, owner).
 */
export const LEVEL_TOO_LOW =
  "You can't attack this person because their level is too low compared to yours. " +
  "You will receive better loot for attacking someone closer to your level.";

/** `map_msg_ownerinyard`, for an owner playing anywhere in the game (owner, 27 Oct). */
const ownerPlayingText = (name: string): string =>
  `${name} is playing right now. Try attacking later when the coast is clear.`;

/** `map_msg_dp`. */
const protectedText = (name: string): string =>
  `${name} was recently DESTROYED and is under protection for a few hours to give them a chance to rebuild.`;

/** `map_msg_inprogress`. */
const underAttackText = (name: string, attacker: string): string =>
  attacker
    ? `${name} is under attack by ${attacker}! Please wait a few minutes then try again`
    : `${name} is under attack! Please wait a few minutes then try again`;

/**
 * What a refused player start says (`controllers/inferno/playerAttack.ts`),
 * and whether the list should be asked again (the player's state moved on).
 */
export const playerRefusal = (
  reason: string | null,
  data: Readonly<Record<string, unknown>>,
  name: string,
): { readonly text: string; readonly refresh: boolean } => {
  switch (reason) {
    case "ownerOnline":
      return { text: ownerPlayingText(name), refresh: true };
    case "protected":
      return { text: protectedText(name), refresh: true };
    case "targetUnderAttack":
      return { text: underAttackText(name, typeof data["attacker"] === "string" ? data["attacker"] : ""), refresh: true };
    case "outOfRange":
      return { text: LEVEL_TOO_LOW, refresh: true };
    case "noMonsters":
      return { text: TRIBE_NO_MONSTERS, refresh: false };
    case "notInfernoPlayer":
      return { text: `${name}'s Inferno yard is gone from the map. The list shows the players facing you now.`, refresh: true };
    case "underAttack":
      return { text: "Your Inferno yard is under attack. Try again when the attack is over.", refresh: false };
    case "noInfernoYard":
    case "infernoOff":
      return { text: "The Inferno map is not open to you.", refresh: false };
    default:
      return { text: TRIBE_START_FAILED, refresh: false };
  }
};
