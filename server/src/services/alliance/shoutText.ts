import { ALLIANCE_TYPES, SHOUT_TEXT, STANCE_LABEL } from "../../config/AllianceConfig.js";
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

    case AllianceMessageType.RELATIONSHIP:
      if (!targetAlliance) return "";

      return createRelationshipShoutText(targetAlliance.name, Number(body) as AllianceStance);

    default:
      return createShoutText(username, type);
  }
};
