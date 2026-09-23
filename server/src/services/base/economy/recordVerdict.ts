import type { Context } from "koa";
import type { EconomyValidationMode } from "../../../config/EconomyConfig.js";
import type { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { economySaveRejectedErr } from "../../../errors/errors.js";
import { logger } from "../../../utils/logger.js";
import { logReport } from "../reportManager.js";
import type { EconomyDerived, EconomyVerdict, EconomyViolation } from "./auditEconomySave.js";

/**
 * What happens to an economy verdict once the audit has produced one
 * (`docs/design/economy-save-validation.md` §3.2, §3.3).
 *
 * Everything else under `economy/` is pure; this is the one file in the set
 * that talks to the logger, the database and the request. It is deliberately
 * the only place the *mode* changes behaviour, so the audit itself can be read
 * and tested without knowing which mode the server is running:
 *
 * - `off`   — nothing at all. The audit is not even run (`baseSave.ts`).
 * - `log`   — one structured `logger.warn` per save with violations and one
 *             `Report` row. Nothing the player sees changes, which is the whole
 *             promise of log mode (§6, item 8): the save still succeeds and
 *             `rNmax`, `basevalue` and `points` are still stored as sent.
 * - `reject`— the same log line and the same row, and then a refusal when any
 *             violation is enforced.
 *
 * Writing the row can never be the reason a save fails, so it is wrapped: a
 * database problem in the audit trail is logged and swallowed rather than
 * turned into a 500 on an honest player's save.
 */

/** How many violations one `Report` entry spells out before it says "and N more". */
const MAX_SUMMARISED = 20;

/**
 * Records one verdict, and refuses the save in `reject` mode.
 *
 * Called before any save key is applied, so a refusal leaves the stored row
 * untouched and `logReport`'s flush carries nothing but its own entity.
 *
 * @param ctx The Koa context, for the caller's IP.
 * @param user The account that sent the save.
 * @param save The base being saved.
 * @param verdict The audit's verdict.
 * @param mode The active `ECONOMY_SAVE_VALIDATION` mode.
 * @throws {ClientSafeError} In `reject` mode, when a violation is enforced.
 */
export const recordEconomyVerdict = async (
  ctx: Context,
  user: User,
  save: Save,
  verdict: EconomyVerdict,
  mode: EconomyValidationMode
): Promise<void> => {
  if (mode === "off") return;

  const { violations, elapsed } = verdict;
  if (violations.length === 0) return;

  const enforced = violations.filter((violation) => violation.enforced);
  const rejected = mode === "reject" && enforced.length > 0;

  // One line per save, with the rule list in the message so a console or a
  // `grep` finds it, and the whole verdict in the properties so the JSON Lines
  // file can be counted by rule and by user with `jq` (`utils/logger.ts:29-36`).
  logger.warn(
    "Economy save {outcome} for {username} (userid {userid}) on base {baseid}: {rules}",
    {
      event: "economy-save-audit",
      outcome: rejected ? "rejected" : "flagged",
      mode,
      userid: user.userid,
      username: user.username,
      baseid: save.baseid,
      basesaveid: save.basesaveid,
      ip: ctx.ip,
      elapsed,
      rules: violations.map((violation) => violation.rule),
      enforcedRules: enforced.map((violation) => violation.rule),
      violations,
      charged: verdict.charged,
      budget: verdict.budget,
    }
  );

  await writeReport(user, save, verdict, mode, rejected);

  if (rejected) throw economySaveRejectedErr(enforced, elapsed);
};

/**
 * Appends one `Report` entry for this save and bumps the user's violation
 * count (`services/base/reportManager.ts:18-29`), the existing audit trail the
 * anti-cheat stub also points at (§6, item 11). One entry per save rather than
 * one per violation, so a persistent cheat shows up as a count without anyone
 * reading the logs.
 *
 * Never throws. The verdict has already been logged by the time this runs, so
 * a database failure here costs the row and nothing else.
 */
const writeReport = async (
  user: User,
  save: Save,
  verdict: EconomyVerdict,
  mode: EconomyValidationMode,
  rejected: boolean
): Promise<void> => {
  try {
    await logReport(user, reportMessage(save, verdict, mode, rejected));
  } catch (err) {
    logger.error("Could not write the economy audit report row for userid {userid}: {error}", {
      userid: user.userid,
      error: err,
    });
  }
};

/** The one-line summary a `Report` entry carries. */
const reportMessage = (
  save: Save,
  verdict: EconomyVerdict,
  mode: EconomyValidationMode,
  rejected: boolean
): string => {
  const { violations, elapsed } = verdict;
  const listed = violations.slice(0, MAX_SUMMARISED).map(summarise).join("; ");
  const remainder = violations.length - Math.min(violations.length, MAX_SUMMARISED);
  const tail = remainder > 0 ? `; and ${remainder} more` : "";

  return (
    `ECONOMY SAVE ${rejected ? "REJECTED" : "FLAGGED"} (mode=${mode}): ` +
    `base ${save.baseid}, ${elapsed}s since the last save — ${listed}${tail}`
  );
};

/** One violation as a short phrase: the rule, the ids it names and its detail. */
const summarise = (violation: EconomyViolation): string => {
  const ids = violation.ids?.length ? ` [${violation.ids.join(", ")}]` : "";
  const detail = violation.detail ? ` ${JSON.stringify(violation.detail)}` : "";
  const enforced = violation.enforced ? "" : " (recorded only)";

  return `${violation.rule}${ids}${detail}${enforced}`;
};

/**
 * Writes the fields the server derives for itself onto the save
 * (§3.3): the storage caps and the base value.
 *
 * Only ever called in `reject` mode, and only for a main-yard audit. In `log`
 * mode nothing written may differ from today (§6, item 8), and an outpost
 * session derives nothing of its own — its verdict carries the main pool's caps
 * unchanged, which the outpost row has no business storing.
 *
 * `points` is checked, never derived, so it is not touched here.
 */
export const applyDerivedFields = (save: Save, derived: EconomyDerived): void => {
  const resources = (save.resources ??= {});

  resources.r1max = derived.r1max;
  resources.r2max = derived.r2max;
  resources.r3max = derived.r3max;
  resources.r4max = derived.r4max;

  save.basevalue = derived.basevalue;
};
