import type { AutoAttackPlanResponse, PlanShortfall, PlanSummary, YardLabel } from "@/api/autoAttack";
import { ApiError, NetworkError } from "@/api/http";
import { championName, monsterName } from "@/ui/attack/ArmyPanel";
import { BOMBS } from "@/game/combat/rules";
import { bombSize } from "./AttackWindow";
import { formatShort } from "@/ui/format";

/**
 * What auto-attack says (issue #221): which attack a camp's Repeat attack
 * repeats, what it brings, what is missing, and why it was refused. Pure, so
 * the cell panel, the confirm sheet and the result screen say it the same way.
 */

/** "just now", "5 min ago", "2 h ago", "3 days ago". */
export const agoText = (seconds: number): string => {
  const span = Math.max(0, Math.floor(seconds));
  if (span < 60) return "just now";
  if (span < 3_600) return `${Math.floor(span / 60)} min ago`;
  if (span < 86_400) return `${Math.floor(span / 3_600)} h ago`;
  const days = Math.floor(span / 86_400);
  return days === 1 ? "1 day ago" : `${days} days ago`;
};

/**
 * Which attack this repeats (owner, #221: "the button says which attack it
 * repeats"): "Repeats your attack on the Kozu camp at 240, 208, 2 h ago".
 * The same camp says "on this camp".
 *
 * @param plan - The plan.
 * @param baseid - The camp the button is on.
 * @param nowSeconds - Local unix seconds.
 */
export const planSourceText = (plan: PlanSummary, baseid: string, nowSeconds: number): string => {
  const where =
    plan.recordedOn.baseid === baseid
      ? "this camp"
      : `the ${plan.tribe} camp at ${plan.recordedOn.x}, ${plan.recordedOn.y}`;
  return `Repeats your attack on ${where}, ${agoText(nowSeconds - plan.recordedAt)}`;
};

/** The resources a catapult flings. */
const RESOURCE_WORDS: Readonly<Record<number, string>> = { 1: "twigs", 2: "pebbles", 3: "putty" };

/**
 * "Catapult, big twigs": one of the Catapult's shots in words (screen
 * readers, the camp panel). Repeat attack never says "bomb" (owner, 20 Nov
 * 2026: "it's not bombs but catapult").
 */
export const catapultLabel = (id: string): string => {
  const resource = BOMBS.find((one) => one.id === id)?.resource ?? 1;
  const size = bombSize(id).toLowerCase();
  return `Catapult, ${size ? `${size} ` : ""}${RESOURCE_WORDS[resource] ?? "resources"}`;
};

/**
 * Putty as short as it reads: "2.5M", "850K". A shortfall rounds UP, so
 * "1.3M short" is never less than what is missing.
 */
export const puttyAmount = (value: number, round: "down" | "up" = "down"): string => {
  const whole = Math.max(0, Math.ceil(value));
  if (round === "down" || whole < 1_000) return formatShort(whole);
  const unit = whole < 1_000_000 ? 1_000 : whole < 1_000_000_000 ? 1_000_000 : 1_000_000_000;
  const word = unit === 1_000 ? "K" : unit === 1_000_000 ? "M" : "B";
  return `${Math.ceil(whole / (unit / 10)) / 10}${word}`;
};

/** The fee, for a tooltip and a screen reader. */
export const feeLabel = (fee: number): string => `Repeat fee: ${fee.toLocaleString("en-US")} putty`;

/** One missing thing, as the button and the sheet list it. */
export const shortfallText = (item: PlanShortfall): string => {
  switch (item.kind) {
    case "monster":
      // Counted over every yard the monsters could move in from; the owner's
      // own words, "Pokey: 12 short" (Smart Repeat attack, 16 Nov 2026).
      return `${monsterName(item.id)}: ${(item.need - item.have).toLocaleString("en-US")} short`;
    case "champion": {
      const name = championName(item.t);
      if (item.reason === "hurt") return `${name} has no health left`;
      if (item.reason === "away") return `${name} is not ready (frozen or away)`;
      return `${name}: you no longer have this champion`;
    }
    case "fee":
      // The owner's words, "Putty: 1.2M short" (20 Nov 2026).
      return `Putty: ${puttyAmount(item.need - item.have, "up")} short`;
    case "bomb":
      if (item.reason === "catapult") return `${catapultLabel(item.id)}: your Catapult is too low`;
      if (item.reason === "cost") return `${catapultLabel(item.id)}: not enough resources to fire it`;
      return `${catapultLabel(item.id)}: not available`;
  }
};

/**
 * Why Repeat attack is greyed out, or null when it can run. The missing
 * things are listed in full by {@link shortfallText}; this is the one line.
 */
export const repeatRefusal = (answer: AutoAttackPlanResponse, context: "sheet" | "panel" = "sheet"): string | null => {
  if (!answer.plan) return null;
  if (answer.underAttack) return "Someone else is attacking this camp right now.";
  if (answer.outOfRange) return "This camp is out of your Flingers' range.";
  if (answer.missing.length > 0) return missingHeadline(answer.missing, context);
  if (answer.noRoom) return NO_ROOM_TEXT;
  return null;
};

/* ── Smart Repeat attack (owner, 16 Nov 2026) ─────────────────────────── */

/**
 * The refusal when the only thing short is putty: the fee and the Catapult's
 * putty shots together (astra, round 2: "for the fee" read as if the fee
 * alone were too dear).
 */
export const NOT_ENOUGH_PUTTY = "Not enough putty.";

/** The refusal when the army could be gathered but not housed in range. */
export const NO_ROOM_TEXT = "Not enough Monster Housing in range.";

/** Under {@link NO_ROOM_TEXT}: the space the monsters that would move in take. */
export const ROOM_NEED_TEXT = (need: number): string => `Incoming monsters need ${need.toLocaleString("en-US")} space.`;

/** The confirm sheet's button when monsters move first. */
export const MOVE_AND_ATTACK = "Move and attack";

/** Over the confirm sheet again, when the server's plan changed since the player looked. */
export const MOVES_CHANGED = "Your yards changed. Here is the new plan.";

/** "Main yard" or "Outpost". */
export const yardName = (label: YardLabel | undefined): string => (label?.main ? "Main yard" : "Outpost");

/** "244, 208": where a yard sits. */
export const yardPlace = (label: YardLabel | undefined): string => (label ? `${label.x}, ${label.y}` : "");

/** The camp panel's line when Repeat attack moves monsters in first. */
export const movesLineText = (moves: number): string =>
  moves === 1 ? "1 move needed" : `${moves} moves needed`;

/** Why a camp has no Repeat attack yet. */
export const noPlanText = (tribe: string, level: number): string =>
  `Attack a ${tribe} camp of level ${level} by hand once, and you can repeat that attack here.`;

// Smart Repeat attack (astra): name the shortage without calling bombs or champions monsters.
const missingHeadline = (missing: readonly PlanShortfall[], context: "sheet" | "panel" = "sheet"): string =>
  missing.length > 0 && missing.every((item) => item.kind === "fee")
    ? NOT_ENOUGH_PUTTY
    : missing.some((item) => item.kind === "monster")
    ? context === "panel"
      ? "Missing monsters for that attack:"
      : "Not enough monsters for that attack."
    : "Missing from the attack:";

/** The server's refusal, in words a player can act on. */
export const autoAttackErrorText = (caught: unknown): { message: string; missing: readonly PlanShortfall[] } => {
  if (caught instanceof ApiError) {
    const data = caught.details?.data as { reason?: unknown; missing?: unknown } | undefined;
    const missing = Array.isArray(data?.missing) ? (data.missing as PlanShortfall[]) : [];
    if (caught.status === 429) return { message: "That is ten auto-attacks this minute. Wait a moment.", missing };
    if (data?.reason === "missing") return { message: missingHeadline(missing), missing };
    return { message: caught.message || "The auto-attack was refused.", missing };
  }
  if (caught instanceof NetworkError || !(caught instanceof Error)) {
    return { message: "Could not reach the server. Nothing was spent.", missing: [] };
  }
  return { message: caught.message, missing: [] };
};
