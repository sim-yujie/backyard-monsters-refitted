import {
  AttackPermission,
  type MapRoom1NeighbourWire,
  type MapRoom1Response,
  type MapRoom1TribeWire,
} from "@/api/maproom1";
import type { BaseLoadResponse } from "@/api/types";
import { isHealthyChampion } from "@/game/attack/attackEntry";
import { readYard } from "@/game/yard/yardModel";
import { tribeFromName, tribeInfo, tribeOfBaseId, type TribeId } from "./tribes";

/**
 * Map Room 1, read into what the screen shows (issue #132).
 *
 * Pure: the route's answer and the own-yard load go in, pins, rows, card
 * lines and the Attack gate come out. Nothing here fetches or touches the
 * DOM, so every rule the card states is tested here.
 *
 * The Attack gate is UX, never the authority: the server refuses the same
 * cases on the attack load (`baseModeAttack.ts:71-84`) and its refusal is
 * shown the same way. The checks are the Flash client's
 * (`com/monsters/maproom/PlayerHandler.as:235-347`), but the card names the
 * target's reason before your own yard's (the Flinger, then anything to
 * send): the footer already states your yard's for every target.
 */

/** A wild monster tribe on the map. */
export interface Mr1Tribe {
  readonly kind: "tribe";
  /** Unique across tribes and players, for pins and rows. */
  readonly key: string;
  readonly baseid: string;
  readonly tribe: TribeId;
  /** "Kozu Tribe" (`ai_tribe`). */
  readonly name: string;
  readonly level: number;
  readonly wrecked: boolean;
  /** Unix seconds a wrecked camp comes back; null when unknown or standing. */
  readonly respawnAt: number | null;
  /** Building damage done so far, 0-100, when the route sends it. */
  readonly damage: number | null;
}

/** A neighbouring player. */
export interface Mr1Neighbour {
  readonly kind: "player";
  readonly key: string;
  readonly userid: number;
  readonly baseid: string;
  readonly name: string;
  readonly level: number;
  /** Times they attacked you. */
  readonly attacksFrom: number;
  /** Times you attacked them. */
  readonly attacksTo: number;
  readonly seed: number;
  /** Their last save, unix seconds; 0 when never. */
  readonly lastSeen: number;
  readonly permission: number;
  readonly attacker: string | null;
  /** Unix seconds their protection ends, when the route says. */
  readonly protectedUntil: number | null;
  /** Unix seconds an accepted truce ends; null for no truce. */
  readonly truceUntil: number | null;
}

export type Mr1Target = Mr1Tribe | Mr1Neighbour;

/** The route's answer, read. */
export interface Mr1World {
  /** Server time of the answer, unix seconds. */
  readonly now: number;
  readonly tribes: readonly Mr1Tribe[];
  readonly neighbours: readonly Mr1Neighbour[];
  /** Your own protection end, unix seconds; 0 for none. */
  readonly protectedUntil: number;
  /** Your base level as the route counts it; null when it did not say. */
  readonly level?: number | null;
}

const num = (value: unknown, fallback = 0): number => {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
};

const readTribe = (wire: MapRoom1TribeWire): Mr1Tribe | null => {
  const baseid = String(wire.baseid);
  const tribe =
    (typeof wire.tribe === "string" ? tribeFromName(wire.tribe) : null) ??
    (typeof wire.name === "string" ? tribeFromName(wire.name) : null) ??
    tribeOfBaseId(num(wire.baseid, -1));
  if (!tribe) return null;
  const wrecked = wire.destroyed === true || num(wire.destroyed) > 0;
  const respawnAt = wrecked && wire.respawnAt != null ? num(wire.respawnAt) || null : null;
  return {
    kind: "tribe",
    key: `tribe-${baseid}`,
    baseid,
    tribe,
    name: `${tribeInfo(tribe).name} Tribe`,
    level: Math.max(1, num(wire.level, 1)),
    wrecked,
    respawnAt,
    damage: typeof wire.damage === "number" ? wire.damage : null,
  };
};

/** Truce states the server treats as binding (`TruceStatus.ACCEPTED`). */
const TRUCE_ACCEPTED = "accepted";

const readNeighbour = (wire: MapRoom1NeighbourWire, now: number): Mr1Neighbour => {
  const baseid = String(wire.baseid);
  const truce =
    wire.attackpermitted === AttackPermission.TRUCE_ACTIVE ||
    String(wire.trucestate ?? "").toLowerCase() === TRUCE_ACCEPTED;
  return {
    kind: "player",
    key: `player-${wire.userid}`,
    userid: wire.userid,
    baseid,
    name: wire.username || wire.basename || `Player ${wire.userid}`,
    level: Math.max(1, num(wire.level, 1)),
    attacksFrom: num(wire.attacksfrom),
    attacksTo: num(wire.attacksto),
    seed: num(wire.baseseed),
    lastSeen: num(wire.saved),
    permission: num(wire.attackpermitted, AttackPermission.ATTACKABLE),
    attacker: typeof wire.attacker === "string" && wire.attacker ? wire.attacker : null,
    protectedUntil: num(wire.protectedUntil) > 0 ? num(wire.protectedUntil) : null,
    truceUntil: truce ? (num(wire.truceexpire) > 0 ? now + num(wire.truceexpire) : now) : null,
  };
};

/**
 * Reads the route's answer. A tribe the client cannot place is dropped
 * rather than drawn wrong; so is a second row for the same tribe.
 */
export const readMapRoom1 = (response: MapRoom1Response, fallbackNow: number): Mr1World => {
  const now = num(response.now, fallbackNow) || fallbackNow;
  const seen = new Set<TribeId>();
  const tribes: Mr1Tribe[] = [];
  for (const wire of response.tribes ?? []) {
    const tribe = readTribe(wire);
    if (!tribe || seen.has(tribe.tribe)) continue;
    seen.add(tribe.tribe);
    tribes.push(tribe);
  }
  return {
    now,
    tribes,
    neighbours: (response.neighbours ?? []).map((wire) => readNeighbour(wire, now)),
    protectedUntil: Math.max(0, num(response.protectedUntil)),
    level: num(response.level) > 0 ? num(response.level) : null,
  };
};

/* ── Your own yard ──────────────────────────────────────────────────── */

/** Building type 5, the Flinger (`YARD_PROPS.as:646`). */
export const FLINGER_TYPE = 5;

export type FlingerState =
  | { readonly state: "none" }
  | { readonly state: "busy"; readonly why: "upgrading" | "damaged" }
  | { readonly state: "ready"; readonly level: number };

/** One monster type you could send, with how many are housed. */
export interface Mr1ArmyLine {
  readonly id: string;
  readonly count: number;
}

/** What the screen needs of your own yard. */
export interface Mr1Own {
  readonly baseid: string;
  readonly seed: number;
  readonly name: string;
  readonly level: number;
  /** Unix seconds your damage protection ends, from the yard load; 0 for none. */
  readonly protectedUntil: number;
  readonly flinger: FlingerState;
  /** Housed monsters, most first. */
  readonly army: readonly Mr1ArmyLine[];
  /** A champion that could be flung (`hp > 0`, `status === 0`). */
  readonly champion: boolean;
}

/**
 * The Flinger as the Flash gate saw it (`PlayerHandler.as:252`, `:321-331`):
 * none built (or still on its first build), upgrading, over half damaged
 * (`BUILDING5` cannot function below 50% health), or ready.
 */
export const flingerState = (save: BaseLoadResponse): FlingerState => {
  const flingers = readYard(save).buildings.filter((one) => one.type === FLINGER_TYPE);
  const built = flingers.filter((one) => one.level > 0);
  if (!built.length) return { state: "none" };
  let busy: "upgrading" | "damaged" | null = null;
  for (const flinger of built) {
    const damaged =
      flinger.hp !== null && flinger.maxHp !== null && flinger.hp < flinger.maxHp / 2;
    const upgrading = flinger.countdown?.kind === "upgrade";
    if (!damaged && !upgrading) return { state: "ready", level: flinger.level };
    busy ??= upgrading ? "upgrading" : "damaged";
  }
  return { state: "busy", why: busy ?? "upgrading" };
};

/** Reads your own yard's load. */
export const readOwn = (save: BaseLoadResponse): Mr1Own => {
  const housed = save.monsters?.housed ?? {};
  const army = Object.entries(housed)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  const seed = num((save as Record<string, unknown>)["baseseed"]);
  return {
    baseid: String(save.baseid),
    seed,
    name: save.name || save.basename || "You",
    level: Math.max(1, num(save.level, 1)),
    protectedUntil: Math.max(0, num(save.protected)),
    flinger: flingerState(save),
    army,
    champion: (save.champion ?? []).some(isHealthyChampion),
  };
};

/* ── Words ──────────────────────────────────────────────────────────── */

/** Seconds a player counts as in their yard after a save (`PlayerLayer.as:237`). */
export const ONLINE_SECONDS = 62;

export const isPlayingNow = (neighbour: Mr1Neighbour, now: number): boolean =>
  neighbour.lastSeen > 0 && neighbour.lastSeen >= now - ONLINE_SECONDS;

/** "2 d 4 h", "31 h", "12 min": how long something lasts, two units at most. */
export const formatSpan = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds));
  const days = Math.floor(s / 86_400);
  const hours = Math.floor((s % 86_400) / 3_600);
  if (days >= 2) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (s >= 3_600) return `${Math.floor(s / 3_600)} h`;
  return `${Math.max(1, Math.ceil(s / 60))} min`;
};

/** "7:12": a camp's comeback as the mock-ups count it. */
export const formatRespawn = (seconds: number): string => {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "3 h ago", "just now". */
export const formatAgo = (seconds: number): string => {
  const s = Math.max(0, seconds);
  if (s < 60) return "just now";
  if (s < 3_600) return `${Math.floor(s / 60)} min ago`;
  if (s < 172_800) return `${Math.floor(s / 3_600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
};

/** "Playing now" or "Offline · last seen 3 h ago". */
export const presenceText = (neighbour: Mr1Neighbour, now: number): string => {
  if (isPlayingNow(neighbour, now)) return "Playing now";
  if (!neighbour.lastSeen) return "Offline";
  return `Offline · last seen ${formatAgo(now - neighbour.lastSeen)}`;
};

const times = (count: number): string => (count === 1 ? "1 time" : `${count} times`);

/** "Attacked you 2 times · you attacked 1", or "No battles yet". */
export const battlesText = (neighbour: Mr1Neighbour): string => {
  const { attacksFrom, attacksTo } = neighbour;
  if (!attacksFrom && !attacksTo) return "No battles yet";
  if (!attacksFrom) return `You attacked them ${times(attacksTo)}`;
  return (
    `Attacked you ${times(attacksFrom)}` + (attacksTo ? ` · you attacked ${attacksTo}` : "")
  );
};

/** Seconds until a wrecked camp is back, or null when it is not wrecked. */
export const respawnIn = (tribe: Mr1Tribe, now: number): number | null =>
  tribe.wrecked ? Math.max(0, (tribe.respawnAt ?? now) - now) : null;

/* ── Pin colours ────────────────────────────────────────────────────── */

/**
 * The pin's colour, as the approved legend names it. Flash coloured by
 * relationship (`ForeignBase.as:72-83`); the legend keeps what can be
 * acted on: attacked you (you can hit back) and protected (you cannot).
 */
export const PinTone = {
  NEIGHBOUR: "neighbour",
  ATTACKED_YOU: "attacked",
  PROTECTED: "protected",
  TRIBE: "tribe",
  WRECKED: "wrecked",
} as const;
export type PinTone = (typeof PinTone)[keyof typeof PinTone];

export const isProtected = (neighbour: Mr1Neighbour): boolean =>
  neighbour.permission === AttackPermission.DAMAGE_PROTECTION ||
  neighbour.permission === AttackPermission.SPECIAL_PROTECTION;

export const pinTone = (target: Mr1Target): PinTone => {
  if (target.kind === "tribe") return target.wrecked ? PinTone.WRECKED : PinTone.TRIBE;
  if (isProtected(target)) return PinTone.PROTECTED;
  if (target.attacksFrom > target.attacksTo) return PinTone.ATTACKED_YOU;
  return PinTone.NEIGHBOUR;
};

/** "MB" for Mossbeard, "GR" for Grimble: the pin's face until photos exist. */
export const initials = (name: string): string => {
  const words = name
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const word = words[0] ?? "?";
  const capitals = word.slice(1).match(/[A-Z]/);
  return (word[0]! + (capitals ? capitals[0] : (word[1] ?? ""))).toUpperCase();
};

/* ── The Attack gate ────────────────────────────────────────────────── */

export const ReasonKey = {
  NO_FLINGER: "noFlinger",
  FLINGER_BUSY: "flingerBusy",
  NO_MONSTERS: "noMonsters",
  PLAYING: "playing",
  NEW_PLAYER: "newPlayer",
  DAMAGE_PROTECTION: "damageProtection",
  UNDER_ATTACK: "underAttack",
  TRUCE: "truce",
  WRECKED: "wrecked",
} as const;
export type ReasonKey = (typeof ReasonKey)[keyof typeof ReasonKey];

/** Why Attack is off: the title and the line under the greyed button. */
export interface Mr1Reason {
  readonly key: ReasonKey;
  readonly title: string;
  readonly detail: string;
  /** A way out the card can offer beside the reason. */
  readonly action?: "buildFlinger" | "hatch";
}

export interface Mr1Gate {
  /** Null when Attack is on. */
  readonly reason: Mr1Reason | null;
  /**
   * The one warning that matters, shown before the tap (it replaces Flash's
   * confirm box, `map_msg_protection`): attacking a player ends your own
   * protection. Tribes never do. Null when there is nothing to warn about.
   */
  readonly warning: { readonly strong: string; readonly rest: string } | null;
  /** Why View is off too (a yard under attack), or null. */
  readonly viewOff: string | null;
}

const targetReason = (target: Mr1Target, now: number): Mr1Reason | null => {
  if (target.kind === "tribe") {
    const left = respawnIn(target, now);
    if (left === null) return null;
    return {
      key: ReasonKey.WRECKED,
      title: "Tribe wrecked",
      detail: `Its camp comes back in ${formatRespawn(left)}.`,
    };
  }
  if (isPlayingNow(target, now)) {
    return {
      key: ReasonKey.PLAYING,
      title: "Playing now",
      detail: "They are in their yard. Try again when they leave.",
    };
  }
  const left = target.protectedUntil !== null ? target.protectedUntil - now : null;
  switch (target.permission) {
    case AttackPermission.SPECIAL_PROTECTION:
      return {
        key: ReasonKey.NEW_PLAYER,
        title: "New player",
        detail:
          left !== null && left > 0
            ? `Protected for ${formatSpan(left)} more, or until they attack someone.`
            : "Protected for a few more days, or until they attack someone.",
      };
    case AttackPermission.DAMAGE_PROTECTION:
      return {
        key: ReasonKey.DAMAGE_PROTECTION,
        title: "Damage protection",
        detail:
          left !== null && left > 0
            ? `Recently wrecked. Protected for ${formatSpan(left)} so they can rebuild.`
            : "Recently wrecked. Protected for a few hours so they can rebuild.",
      };
    case AttackPermission.UNDER_ATTACK:
      return {
        key: ReasonKey.UNDER_ATTACK,
        title: "Under attack",
        detail: `${target.attacker ?? "Someone"} is attacking them now. Try again in a few minutes. View is off too.`,
      };
    case AttackPermission.TRUCE_ACTIVE:
      break;
    default:
      if (target.truceUntil === null) return null;
  }
  const truceLeft = (target.truceUntil ?? now) - now;
  return {
    key: ReasonKey.TRUCE,
    title: "Truce",
    detail:
      truceLeft > 0
        ? `Neither of you can attack the other for ${formatSpan(truceLeft)} more.`
        : "Neither of you can attack the other while it lasts.",
  };
};

/** Why your own yard cannot attack anything: the Flinger, then the monsters. */
const ownYardReason = (own: Mr1Own | null): Mr1Reason | null => {
  if (!own || own.flinger.state === "none") {
    return {
      key: ReasonKey.NO_FLINGER,
      title: "No Flinger",
      detail: "Build one to fling monsters at other yards.",
      action: "buildFlinger",
    };
  }
  if (own.flinger.state === "busy") {
    return {
      key: ReasonKey.FLINGER_BUSY,
      title: "Flinger busy",
      detail:
        own.flinger.why === "upgrading"
          ? "It is upgrading. It can fling again when the upgrade finishes."
          : "It is over half damaged. Repair it to fling again.",
    };
  }
  if (!own.army.length && !own.champion) {
    return {
      key: ReasonKey.NO_MONSTERS,
      title: "No monsters",
      detail: "Housing is empty. Hatch some first.",
      action: "hatch",
    };
  }
  return null;
};

/** Whether Attack is on for `target`, and if not, why. */
export const attackGate = (
  target: Mr1Target,
  own: Mr1Own | null,
  world: { protectedUntil: number },
  now: number,
): Mr1Gate => {
  const viewOff =
    target.kind === "player" && target.permission === AttackPermission.UNDER_ATTACK
      ? "They are under attack. View is off until it ends."
      : null;

  // The target's own reason first: the footer already says what is wrong
  // with your yard for every target, and "No Flinger" on a protected
  // player's card would hide that they are protected anyway.
  const reason = targetReason(target, now) ?? ownYardReason(own);

  const protectedFor = Math.max(world.protectedUntil, own?.protectedUntil ?? 0) - now;
  const warning =
    !reason && target.kind === "player" && protectedFor > 0
      ? {
          strong: `You are protected for ${formatSpan(protectedFor)}.`,
          rest: `Attacking ${target.name} ends your protection, and others can attack you again.`,
        }
      : null;

  return { reason, warning, viewOff };
};

/* ── The list ───────────────────────────────────────────────────────── */

/** Rows per page, as Flash's list had (`ListView.as:37`). */
export const LIST_PAGE_SIZE = 7;

/** The list's sorts (`ListView.as:44`, `:181-238`). */
export const ListSort = {
  LEVEL: "level",
  LAST_SEEN: "seen",
  NAME: "name",
  BATTLES: "battles",
  STATUS: "status",
} as const;
export type ListSort = (typeof ListSort)[keyof typeof ListSort];

export const LIST_SORT_LABELS: Readonly<Record<ListSort, string>> = {
  level: "Level",
  seen: "Last seen",
  name: "Name",
  battles: "Battles",
  status: "Status",
};

/** Attackable first, then the ones that attacked you, then the rest. */
const statusRank = (neighbour: Mr1Neighbour, now: number): number => {
  if (targetReason(neighbour, now)) return 2;
  return neighbour.attacksFrom > neighbour.attacksTo ? 0 : 1;
};

/**
 * Sorts the neighbours. Level and battles go highest first, last seen most
 * recent first, name A to Z; ties fall back to the name so a refresh does not
 * shuffle equal rows.
 */
export const sortNeighbours = (
  neighbours: readonly Mr1Neighbour[],
  sort: ListSort,
  now: number,
): Mr1Neighbour[] => {
  const byName = (a: Mr1Neighbour, b: Mr1Neighbour): number =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.userid - b.userid;
  const key: Record<ListSort, (a: Mr1Neighbour, b: Mr1Neighbour) => number> = {
    level: (a, b) => b.level - a.level,
    seen: (a, b) => b.lastSeen - a.lastSeen,
    name: () => 0,
    battles: (a, b) => b.attacksFrom + b.attacksTo - (a.attacksFrom + a.attacksTo),
    status: (a, b) => statusRank(a, now) - statusRank(b, now),
  };
  return [...neighbours].sort((a, b) => key[sort](a, b) || byName(a, b));
};

export interface ListPage<T> {
  readonly items: readonly T[];
  /** Zero-based, clamped into range. */
  readonly page: number;
  /** At least 1, so an empty list still has a page. */
  readonly pages: number;
}

export const pageOf = <T>(
  items: readonly T[],
  page: number,
  size = LIST_PAGE_SIZE,
): ListPage<T> => {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const clamped = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  return { items: items.slice(clamped * size, clamped * size + size), page: clamped, pages };
};

/** The short line under a neighbour's name in the list. */
export const rowLine = (
  neighbour: Mr1Neighbour,
  now: number,
): { text: string; tone: "warn" | "muted" } => {
  const reason = targetReason(neighbour, now);
  if (reason?.key === ReasonKey.PLAYING)
    return { text: "Playing now · can't attack", tone: "muted" };
  if (reason?.key === ReasonKey.NEW_PLAYER) {
    const left = neighbour.protectedUntil !== null ? neighbour.protectedUntil - now : 0;
    return {
      text: left > 0 ? `New player · protected ${formatSpan(left)}` : "New player · protected",
      tone: "muted",
    };
  }
  if (reason?.key === ReasonKey.DAMAGE_PROTECTION)
    return { text: "Damage protection", tone: "muted" };
  if (reason?.key === ReasonKey.UNDER_ATTACK)
    return { text: "Under attack now", tone: "muted" };
  if (reason?.key === ReasonKey.TRUCE) return { text: "Truce", tone: "muted" };
  const seen = neighbour.lastSeen
    ? `offline ${formatAgo(now - neighbour.lastSeen).replace(/ ago$/, "")}`
    : "offline";
  if (neighbour.attacksFrom > neighbour.attacksTo) {
    return { text: `Attacked you ${neighbour.attacksFrom}× · ${seen}`, tone: "warn" };
  }
  const battles = neighbour.attacksFrom + neighbour.attacksTo;
  const capital = seen.charAt(0).toUpperCase() + seen.slice(1);
  const count = battles === 1 ? "1 battle" : battles ? `${battles} battles` : "no battles yet";
  return { text: `${capital} · ${count}`, tone: "muted" };
};
