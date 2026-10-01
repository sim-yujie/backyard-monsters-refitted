import type { AutoAttackPlanResponse, PlanShortfall, PlanSummary } from "@/api/autoAttack";
import { ApiError, NetworkError } from "@/api/http";
import { championName, monsterName } from "@/ui/attack/ArmyPanel";
import { bombName } from "@/ui/attack/CatapultPanel";

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

/** "Kozu camp, level 35". */
export const campText = (plan: Pick<PlanSummary, "tribe" | "level">): string => `${plan.tribe} camp, level ${plan.level}`;

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

/** "300 Pokey, 40 Bolt", biggest first. */
export const monstersText = (monsters: Readonly<Record<string, number>>): string =>
  Object.entries(monsters)
    .filter(([, count]) => count > 0)
    .sort((one, other) => other[1] - one[1] || one[0].localeCompare(other[0]))
    .map(([id, count]) => `${count.toLocaleString("en-US")} ${monsterName(id)}`)
    .join(", ");

/** "Gorgo L5", with its power level when it has one. */
export const championText = (champion: { t: number; l: number; pl?: number }): string =>
  `${championName(champion.t)} L${champion.l}` + (champion.pl ? ` (power ${champion.pl})` : "");

/** "Includes Gorgo L5 and 3 bombs", or null when the plan has neither. */
export const includesText = (plan: Pick<PlanSummary, "champions" | "bombs">): string | null => {
  const parts = plan.champions.map(championText);
  if (plan.bombs.length > 0) parts.push(plan.bombs.length === 1 ? "1 bomb" : `${plan.bombs.length} bombs`);
  if (parts.length === 0) return null;
  const last = parts.pop()!;
  return `Includes ${parts.length > 0 ? `${parts.join(", ")} and ${last}` : last}`;
};

/** The confirm sheet's line about siege weapons, when the attack used any. */
export const SIEGE_NOT_REPEATED = "Siege weapons are not repeated.";

/** One missing thing, as the button and the sheet list it. */
export const shortfallText = (item: PlanShortfall): string => {
  switch (item.kind) {
    case "monster":
      return `${monsterName(item.id)}: ${(item.need - item.have).toLocaleString("en-US")} short (you have ${item.have.toLocaleString("en-US")} of ${item.need.toLocaleString("en-US")} in range)`;
    case "champion": {
      const name = championName(item.t);
      if (item.reason === "hurt") return `${name} has no health left`;
      if (item.reason === "away") return `${name} is not ready (frozen or away)`;
      return `${name}: you no longer have this champion`;
    }
    case "bomb":
      if (item.reason === "catapult") return `${bombName(item.id)}: your Catapult is too low`;
      if (item.reason === "cost") return `${bombName(item.id)}: not enough resources to fire it`;
      return `${bombName(item.id)}: not available`;
  }
};

/**
 * Why Repeat attack is greyed out, or null when it can run. The missing
 * things are listed in full by {@link shortfallText}; this is the one line.
 */
export const repeatRefusal = (answer: AutoAttackPlanResponse): string | null => {
  if (!answer.plan) return null;
  if (answer.underAttack) return "Someone else is attacking this camp right now.";
  if (answer.outOfRange) return "This camp is out of your Flingers' range.";
  if (answer.missing.length > 0) return "You are missing what that attack used:";
  return null;
};

/** Why a camp has no Repeat attack yet. */
export const noPlanText = (tribe: string, level: number): string =>
  `Attack a ${tribe} camp of level ${level} by hand once, and you can repeat that attack here.`;

/** The server's refusal, in words a player can act on. */
export const autoAttackErrorText = (caught: unknown): { message: string; missing: readonly PlanShortfall[] } => {
  if (caught instanceof ApiError) {
    const data = caught.details?.data as { reason?: unknown; missing?: unknown } | undefined;
    const missing = Array.isArray(data?.missing) ? (data.missing as PlanShortfall[]) : [];
    if (caught.status === 429) return { message: "That is ten auto-attacks this minute. Wait a moment.", missing };
    return { message: caught.message || "The auto-attack was refused.", missing };
  }
  if (caught instanceof NetworkError || !(caught instanceof Error)) {
    return { message: "Could not reach the server. Nothing was spent.", missing: [] };
  }
  return { message: caught.message, missing: [] };
};
