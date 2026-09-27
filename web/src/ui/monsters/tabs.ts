import { LockerTab } from "./LockerTab";
import { HousingTab } from "./HousingTab";
import {
  MonsterBuilding,
  MonstersTabId,
  type MonstersTab,
  type MonstersTabDefinition,
} from "./monstersTab";

/**
 * The Monsters screen's tabs, in strip order (`monstersTab.ts` has the
 * contract). A work package that builds a tab replaces its placeholder's
 * `create` here — one line — and leaves `MonstersScreen.ts` alone.
 */

/** A tab whose work package has not landed: says what is coming and nothing else. */
export const placeholderTab = (text: string): MonstersTab => {
  const element = document.createElement("div");
  element.className = "monsters-placeholder";
  const paragraph = document.createElement("p");
  paragraph.className = "monsters-placeholder__text";
  paragraph.textContent = text;
  element.append(paragraph);
  return {
    element,
    show: () => undefined,
    update: () => undefined,
    tick: () => undefined,
    destroy: () => element.remove(),
  };
};

export const MONSTERS_TABS: readonly MonstersTabDefinition[] = [
  {
    id: MonstersTabId.UNLOCK,
    label: "Unlock",
    buildings: [MonsterBuilding.LOCKER],
    create: (context) => new LockerTab(context),
  },
  {
    id: MonstersTabId.HATCH,
    label: "Hatch",
    buildings: [MonsterBuilding.HATCHERY, MonsterBuilding.HCC],
    // WP2.6.
    create: () => placeholderTab("Hatching monsters from here is on its way."),
  },
  {
    id: MonstersTabId.HOUSING,
    label: "Housing",
    buildings: [MonsterBuilding.HOUSING],
    // WP2.7.
    create: (context) => new HousingTab(context),
  },
  {
    id: MonstersTabId.TRAIN,
    label: "Train",
    buildings: [MonsterBuilding.ACADEMY],
    // Phase 4.
    create: () => placeholderTab("Training at the Monster Academy comes in a later update."),
  },
  {
    id: MonstersTabId.LAB,
    label: "Lab",
    buildings: [MonsterBuilding.LAB],
    // Phase 4.
    create: () => placeholderTab("Monster Lab research comes in a later update."),
  },
];
