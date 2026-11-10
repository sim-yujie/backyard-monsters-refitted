import { makeWordFilter } from "../chat/badWords.js";

import { ALLIANCE_NAME_MAX_LENGTH, ALLIANCE_NAME_MIN_LENGTH } from "../../config/AllianceConfig.js";
import {
  allianceDescriptionBannedErr,
  allianceNameBannedErr,
  allianceNameTooLongErr,
  allianceNameTooShortErr,
} from "../../errors/errors.js";

const filter = makeWordFilter();
const LEADING_CHARACTER = /^[\p{L}\p{N}]/u;
/**
 * Names that look like an admin rename's placeholder ("#Alliance 12",
 * `ADMIN_RENAME_PLACEHOLDER`), with or without the "#": refused so no
 * alliance can pass itself off as one an admin renamed.
 */
const PLACEHOLDER_LIKE = /^#?\s*alliance[\s_.-]*\d+$/iu;

/**
 * Rejects an alliance name that is too short, too long, opens with a symbol,
 * looks like an admin rename's placeholder ("Alliance 12"), or is profane.
 *
 * Checked here rather than in the Zod schema because a failed parse surfaces as
 * a generic support error, while each of these needs a message the player can
 * act on.
 *
 * @param {string} name - The proposed alliance name, already trimmed.
 * @throws {ClientSafeError} When the name breaks any of the rules.
 */
export const assertNameAllowed = (name: string) => {
  if (name.length < ALLIANCE_NAME_MIN_LENGTH) throw allianceNameTooShortErr();
  if (name.length > ALLIANCE_NAME_MAX_LENGTH) throw allianceNameTooLongErr();
  
  if (!LEADING_CHARACTER.test(name) || PLACEHOLDER_LIKE.test(name) || filter.isProfane(name)) {
    throw allianceNameBannedErr();
  }
};

/**
 * Rejects an alliance description containing a banned word.
 *
 * @param {string} description - The proposed alliance description.
 * @throws {ClientSafeError} When the description contains a banned word.
 */
export const assertDescriptionAllowed = (description: string) => {
  if (filter.isProfane(description)) throw allianceDescriptionBannedErr();
};
