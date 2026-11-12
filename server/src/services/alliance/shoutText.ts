import { ALLIANCE_TYPES, CONSTELLATIONS, GOAL_MENU, SHOUT_TEXT, STANCE_LABEL } from "../../config/AllianceConfig.js";
import { AllianceMessageType, type AllianceStance, type AllianceType } from "../../enums/Alliance.js";
import type { Alliance } from "../../database/models/alliance.model.js";


type ShoutTarget = Pick<Alliance, "name"> | null;

/**
 * Builds a membership shout: promotions, joins, kicks, departures, creation.
 *
 * @param {string} username - The member the shout is about.
 * @param {AllianceMessageType} type - Which shout to build.
 * @returns {string} The finished sentence, or empty if this type has no text.
 */
const createShoutText = (username: string, type: AllianceMessageType): string => {
  const sentence = SHOUT_TEXT[type];

  if (!sentence) return "";

  return `${username} ${sentence}`;
};

/**
 * Builds a relationship shout.
 *
 * The verb is chosen by whether the name ends in "s", which is what the original
 * did - confirmed against footage of one leader flagging five alliances in a
 * row, where `have` appeared for exactly the two names ending in s.
 *
 * @param {string} allianceName - The alliance that was flagged.
 * @param {AllianceStance} relationship - What it was flagged as.
 * @returns {string} The finished sentence.
 */
const createRelationshipShoutText = (allianceName: string, relationship: AllianceStance) => {
  const verb = allianceName.toLowerCase().endsWith("s") ? "have" : "has";

  return `"${allianceName}" ${verb} been flagged as ${STANCE_LABEL[relationship]}`;
};

/** What an under-attack line stores in `body`: the yard's cell, whether it is an outpost, and the attacker. */
export interface UnderAttackFacts {
  x: number;
  y: number;
  outpost: boolean;
  by: string;
}

/**
 * The stored `body` of an under-attack line (beta 7 design v5 §12).
 *
 * @param {UnderAttackFacts} facts - The attacked yard and who attacked it.
 * @returns {string} JSON, read back by {@link readUnderAttack}.
 */
export const underAttackBody = (facts: UnderAttackFacts): string => JSON.stringify(facts);

/**
 * Reads an under-attack line's stored body; null for anything that is not one.
 *
 * @param {string} body - The stored body.
 * @returns {UnderAttackFacts | null} The facts, or null when the body is not a valid one.
 */
export const readUnderAttack = (body: string): UnderAttackFacts | null => {
  try {
    const facts = JSON.parse(body) as Partial<UnderAttackFacts> | null;

    if (!facts || !Number.isInteger(facts.x) || !Number.isInteger(facts.y) || typeof facts.by !== "string") return null;

    return { x: facts.x!, y: facts.y!, outpost: facts.outpost === true, by: facts.by };
  } catch {
    return null;
  }
};

/**
 * The map cell an automatic line is about, for the chat box's Show on map:
 * an under-attack line's yard; nothing for any other line.
 *
 * @param {AllianceMessageType} type - The line's type.
 * @param {string} body - Its stored body.
 * @returns {{ x: number; y: number } | undefined} The cell, or undefined.
 */
type TradeKey = "r1" | "r2" | "r3" | "r4";

/** What a request line stores: the request, and the swap ("I give 1K Twigs, I want 1K Goo"). */
export interface TradeAskFacts {
  request: number;
  give: TradeKey;
  want: TradeKey;
  amount: number;
}

/**
 * What a trade-done line stores. A Send: who got it and what arrived. A
 * swap: who it was `with`, what the accepter `gave` and `got` (as arrived).
 */
export type TradeDoneFacts =
  | { to: string; arrived: Partial<Record<TradeKey, number>> }
  | { with: string; gave: Partial<Record<TradeKey, number>>; got: Partial<Record<TradeKey, number>> };

const RESOURCE_WORDS: Record<string, string> = { r1: "Twigs", r2: "Pebbles", r3: "Putty", r4: "Goo" };

/** "2.0M Goo, 500K Twigs" */
export const amountsText = (amounts: Partial<Record<string, number>>): string =>
  Object.entries(amounts)
    .filter(([key, value]) => RESOURCE_WORDS[key] && Number(value) > 0)
    .map(([key, value]) => `${shortAmount(Number(value))} ${RESOURCE_WORDS[key]}`)
    .join(", ");

/** 2,000,000 as "2.0M", 500,000 as "500K", 950 as "950". */
export const shortAmount = (value: number): string => {
  if (value >= 1_000_000) return `${(Math.floor(value / 100_000) / 10).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.floor(value / 1_000)}K`;
  return String(Math.floor(value));
};

/**
 * The trade request an automatic line is about, for the chat box's Give;
 * nothing for any other line.
 */
export const shoutTradeRequest = (type: AllianceMessageType, body: string): number | undefined => {
  if (type !== AllianceMessageType.TRADE_ASK) return undefined;
  const facts = readJson<Partial<TradeAskFacts>>(body);
  return Number.isInteger(facts?.request) ? facts!.request : undefined;
};

export const shoutCell = (type: AllianceMessageType, body: string): { x: number; y: number } | undefined => {
  if (type !== AllianceMessageType.UNDER_ATTACK) return undefined;

  const facts = readUnderAttack(body);

  return facts ? { x: facts.x, y: facts.y } : undefined;
};

/**
 * Picks the right builder for a stored row.
 *
 * The membership shouts are the default: their whole sentence is the author's
 * name plus a fixed suffix. The cases above it each need something the
 * author does not carry, which is what `body` is for - a relationship shout
 * stores its flag value, a type change the new type, a rename the new name.
 * Rows of a kind no longer built (the old power-up shouts) fall to the default.
 *
 * @param {AllianceMessageType} type - Which shout this is.
 * @param {string} username - The author, subject of every membership shout.
 * @param {string} body - Whatever the sentence needs beyond the author's name.
 * @param {ShoutTarget} targetAlliance - The flagged alliance, present only on a relationship shout.
 * @returns {string} The finished sentence, or empty if it cannot be built.
 */
/** A JSON body, or null. */
const readJson = <T>(body: string): T | null => {
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
};

/** A constellation's name from its id, whatever the type. */
const constellationName = (id: string | undefined): string | null =>
  (id && Object.values(CONSTELLATIONS).flat().find((c) => c.id === id)?.name) || null;

export const composeShout = (type: AllianceMessageType, username: string, body: string, targetAlliance?: ShoutTarget) => {
  switch (type) {
    case AllianceMessageType.TYPE_CHANGED: {
      const label = ALLIANCE_TYPES[body as AllianceType]?.label;

      return label ? `${username} made the alliance a ${label}.` : "";
    }

    case AllianceMessageType.RENAMED:
      return body ? `${username} renamed the alliance to ${body}.` : "";

    case AllianceMessageType.UNDER_ATTACK: {
      const facts = readUnderAttack(body);

      if (!facts) return "";

      // "Ana_B's outpost (12, 40) is under attack by Bob!" (design v5 §12).
      return `${username}'s ${facts.outpost ? "outpost" : "yard"} (${facts.x}, ${facts.y}) is under attack by ${facts.by}!`;
    }

    case AllianceMessageType.STAR_LIT:
    case AllianceMessageType.STAR_SUGGESTED: {
      const facts = readJson<{ id?: string; step?: number }>(body);
      const name = constellationName(facts?.id);
      const step = Number(facts?.step);
      if (!name || !(step >= 1)) return "";
      const stars = `${name} ★${step * 2 - 1}–${step * 2}`;

      // "Mira lit Pokey ★3–4." / "Hexa suggests Brain ★3–4." (design v5 §9a)
      return type === AllianceMessageType.STAR_LIT ? `${username} lit ${stars}.` : `${username} suggests ${stars}.`;
    }

    case AllianceMessageType.GOAL_SET:
    case AllianceMessageType.GOAL_DONE: {
      const facts = readJson<{ kind?: string; tier?: string; points?: number }>(body);
      const goal = GOAL_MENU.find((g) => g.kind === facts?.kind)?.name;
      if (!goal || !facts?.tier) return "";
      const tier = facts.tier.charAt(0).toUpperCase() + facts.tier.slice(1);

      return type === AllianceMessageType.GOAL_SET
        ? `${username} set a goal: ${goal} (${tier}).`
        : `Goal reached: ${goal} (${tier}), +${Number(facts.points) || 0} points!`;
    }

    case AllianceMessageType.TRADE_ASK: {
      const facts = readJson<Partial<TradeAskFacts>>(body);
      const amount = Number(facts?.amount);
      const give = amountsText({ [String(facts?.give)]: amount });
      const want = amountsText({ [String(facts?.want)]: amount });
      if (!give || !want) return "";

      // "PebbleKing gives 1K Twigs for 1K Goo." (owner, 11 Nov 2026: a 1:1 swap)
      return `${username} gives ${give} for ${want}.`;
    }

    case AllianceMessageType.TRADE_DONE: {
      const facts = readJson<Record<string, unknown>>(body);
      if (typeof facts?.["with"] === "string") {
        const gave = amountsText((facts["gave"] ?? {}) as Record<string, number>);
        const got = amountsText((facts["got"] ?? {}) as Record<string, number>);
        if (!gave || !got) return "";

        // "Mira and Thornback traded: 900 Goo for 900 Twigs." (what each got)
        return `${username} and ${facts["with"]} traded: ${gave} for ${got}.`;
      }
      const what = amountsText((facts?.["arrived"] ?? {}) as Record<string, number>);
      if (!what || typeof facts?.["to"] !== "string") return "";

      // "Mira gave Thornback 800K Goo." (design v5 §12b)
      return `${username} gave ${facts["to"]} ${what}.`;
    }

    case AllianceMessageType.RELATIONSHIP:
      if (!targetAlliance) return "";

      return createRelationshipShoutText(targetAlliance.name, Number(body) as AllianceStance);

    default:
      return createShoutText(username, type);
  }
};
