import { RESOURCE_KEYS, resourceAmount, type ResourceCost, type ResourceRealm } from "@/ui/resourceIcon";
import "@/ui/styles/build-menu.css";

/**
 * One chip per resource a build, upgrade or fortify step costs, green when
 * the yard holds it and red when it falls short (#278).
 *
 * Gold used to mark a shortfall here, and the owner read it backwards — gold
 * looks like a prize, not a warning. Every cost chip in the client now shares
 * this one function and the build tab's own `build-info__fact` styling, so
 * green/red keeps one meaning whether the chip is picking a new building
 * (`BuildMenu.ts`) or upgrading or fortifying one already built
 * (`BuildingPanel.ts`).
 *
 * `realm` draws the chips as that realm's resources: a main-yard Inferno
 * building's price, held against the Inferno purse (Inferno WP 6.1).
 */
export const costFactChips = (cost: ResourceCost, held: ResourceCost, realm?: ResourceRealm): HTMLElement[] =>
  RESOURCE_KEYS.filter((key) => Number(cost[key] ?? 0) > 0).map((key) => {
    const amount = Number(cost[key] ?? 0);
    const chip = document.createElement("li");
    chip.className = "build-info__fact";
    chip.classList.add(
      Number(held[key] ?? 0) < amount ? "build-info__fact--short" : "build-info__fact--ok",
    );
    chip.append(resourceAmount(key, amount, realm ? { realm } : {}));
    return chip;
  });
