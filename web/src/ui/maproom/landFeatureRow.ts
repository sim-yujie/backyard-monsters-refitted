import { iconAmount } from "@/ui/gameIcon";
import { resourceAmount, RESOURCE_KEYS } from "@/ui/resourceIcon";
import type { AmountChange } from "@/ui/amountChange";
import { landFeatureEffect, landFeatureOf, LandFeature } from "@/game/combat/rules";
import { landFeatureIconUrl, LAND_FEATURE_NAMES } from "@/game/maproom/landArt";

/**
 * The Map Room 2 cell pop-up's land feature row (`landFeatures.ts`, design A
 * of `docs/mr2-civ-study.md`): the feature's painted picture, then what it
 * does as painted icons and numbers only (owner: icons over words), green
 * for a gain and red for a loss:
 *
 *   [forest]  [heart] +20%  [tower] -10%  [twigs] +50%
 *
 * Its own small component, so the neighbour bonus row (`mr2-bonus5`) and
 * this one merge without touching each other. The word for the feature and
 * a sentence of what it does are on hover, for a mouse and a screen reader.
 */

const changeOf = (percent: number): AmountChange | undefined =>
  percent > 0 ? "gain" : percent < 0 ? "loss" : undefined;

const signed = (percent: number): string => `${Math.abs(percent)}%`;

/** One sentence for the hover, e.g. "Forest: health +20%, tower range -10%, Twigs +50%." */
export const landFeatureSentence = (feature: number): string => {
  const id = landFeatureOf(feature);
  const effect = landFeatureEffect(id);
  const parts: string[] = [];
  const add = (label: string, pct: number): void => {
    if (pct !== 0) parts.push(`${label} ${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`);
  };
  add("building health", effect.hp);
  add("tower damage", effect.damage);
  add("tower range", effect.range);
  const resources = ["Twigs", "Pebbles", "Putty", "Goo"];
  effect.income.forEach((pct, index) => add(`${resources[index]} income`, pct));
  return `${LAND_FEATURE_NAMES[id]}: ${parts.join(", ")}.`;
};

/**
 * The row as a chip for the pop-up, or null for open ground or a cell the
 * server sent no feature for (switch off).
 */
export const landFeatureChip = (feature: number | undefined): HTMLElement | null => {
  const id = landFeatureOf(feature);
  if (id === LandFeature.OPEN) return null;
  const effect = landFeatureEffect(id);

  const chip = document.createElement("span");
  chip.className = "mr2-chip mr2-chip--info mr2-chip--ground mr2-chip--land";
  chip.dataset["land"] = String(id);
  chip.title = landFeatureSentence(id);

  const picture = document.createElement("img");
  picture.className = "mr2-land-icon";
  picture.src = landFeatureIconUrl(id);
  picture.alt = LAND_FEATURE_NAMES[id];
  picture.width = 28;
  picture.height = 28;
  picture.decoding = "async";
  // No picture yet (or it failed): the numbers still read on their own.
  picture.addEventListener("error", () => picture.remove());
  chip.append(picture);

  const stat = (name: "health" | "damage" | "range", pct: number): void => {
    if (pct === 0) return;
    const change = changeOf(pct);
    chip.append(
      iconAmount(name, signed(pct), { size: 24, className: "ground-bonus", ...(change ? { change } : {}) }),
    );
  };
  stat("health", effect.hp);
  stat("damage", effect.damage);
  stat("range", effect.range);
  effect.income.forEach((pct, index) => {
    if (pct === 0) return;
    const change = changeOf(pct);
    chip.append(
      resourceAmount(RESOURCE_KEYS[index]!, signed(pct), {
        className: "ground-bonus",
        ...(change ? { change } : {}),
      }),
    );
  });
  return chip;
};
