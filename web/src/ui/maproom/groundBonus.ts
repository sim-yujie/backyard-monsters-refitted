import type { AmountChange } from "@/ui/amountChange";
import { iconAmount } from "@/ui/gameIcon";
import { heightBonus } from "@/game/maproom/heightBonus";

/** What the ground does, said once for whoever hovers it. */
export const GROUND_BONUS_TITLE = "Higher ground: towers reach farther, income is lower. Lower ground: the other way round.";

const changeOf = (percent: number): AmountChange | undefined =>
  percent > 0 ? "gain" : percent < 0 ? "loss" : undefined;

/**
 * Flash's two height lines (`PopupInfoEnemy` "newmap_h1" / "newmap_h2") as
 * painted icons and numbers: "[tower] +20%  [resources] −17%", green for a
 * gain and red for a loss.
 */
export const groundBonusIcons = (height: number): HTMLElement[] => {
  const bonus = heightBonus(height);
  const amount = (name: "range" | "income", percent: number): HTMLElement => {
    const change = changeOf(percent);
    return iconAmount(name, `${Math.abs(percent)}%`, {
      size: 24,
      className: "ground-bonus",
      ...(change ? { change } : {}),
    });
  };
  return [amount("range", bonus.towerPct), amount("income", bonus.incomePct)];
};
