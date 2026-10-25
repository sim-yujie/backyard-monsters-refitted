import type { PurseKey } from "@/game/siege/siege";
import { formatAmount } from "@/ui/format";

/**
 * The four Inferno resources, as the Siege screen spells them
 * (`GLOBAL.getResourceName(id, true)`): Bone, Coal, Sulfur and Magma.
 *
 * Their icons are not painted yet (art track A2, `docs/design/inferno.md`;
 * Flash's are vector art inside assets.swf), so an amount reads as its name
 * and figure. Every Inferno amount on the screen is drawn here, so the icons
 * go in at this one place: give `inferno-amount` an image before the figure,
 * as `resourceAmount` does for the yard's resources.
 */

export const INFERNO_RESOURCE_NAMES: Readonly<Record<PurseKey, string>> = {
  r1: "Bone",
  r2: "Coal",
  r3: "Sulfur",
  r4: "Magma",
};

/** "Bone 12,345", or the given text in place of the figure ("12,345 / 100,000"). */
export const infernoAmount = (key: PurseKey, amount: number | string, className?: string): HTMLElement => {
  const node = document.createElement("span");
  node.className = className ? `inferno-amount ${className}` : "inferno-amount";
  node.dataset["resource"] = key;
  const name = document.createElement("span");
  name.className = "inferno-amount__name";
  name.textContent = INFERNO_RESOURCE_NAMES[key];
  const value = document.createElement("span");
  value.className = "inferno-amount__value";
  value.textContent = typeof amount === "number" ? formatAmount(amount) : amount;
  node.append(name, " ", value);
  return node;
};
