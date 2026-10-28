import type { PurseKey } from "@/game/siege/siege";
import { formatAmount } from "@/ui/format";
import { INFERNO_RESOURCE_NAMES as INFERNO_NAMES, resourceIcon } from "@/ui/resourceIcon";

/**
 * The four Inferno resources, as the Siege screen spells them
 * (`GLOBAL.getResourceName(id, true)`): Bone, Coal, Sulfur and Magma.
 *
 * An amount is the resource's painted pile (`resourceIcon.ts`), its name and
 * the figure; the pile is decorative, as the name beside it already says it.
 */

/** The names the yard's icons carry too (`resourceIcon.ts`). */
export const INFERNO_RESOURCE_NAMES: Readonly<Record<PurseKey, string>> = INFERNO_NAMES;

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
  node.append(resourceIcon(key, { decorative: true, realm: "inferno" }), name, " ", value);
  return node;
};
