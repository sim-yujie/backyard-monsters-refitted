import type { YardKind } from "@/game/yard/buildingCosts";
import { HatchTab } from "./HatchTab";
import { LockerTab } from "./LockerTab";
import { HousingTab } from "./HousingTab";
import { LabTab } from "./LabTab";
import { TrainTab } from "./TrainTab";
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
    create: (context) => new HatchTab(context),
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
    // WP4.2.
    create: (context) => new TrainTab(context),
  },
  {
    id: MonstersTabId.LAB,
    label: "Lab",
    buildings: [MonsterBuilding.LAB],
    // WP4.4.
    create: (context) => new LabTab(context),
  },
];

/**
 * The tabs an outpost offers: Hatch and Housing. The Monster Locker, the
 * Academy and the Lab cannot be built in an outpost (outpost props, research
 * §1.2), and their routes refuse one (`notInOutpost`).
 */
export const OUTPOST_MONSTERS_TABS: readonly MonstersTabDefinition[] = MONSTERS_TABS.filter(
  (tab) => tab.id === MonstersTabId.HATCH || tab.id === MonstersTabId.HOUSING,
);

/**
 * The tabs the Inferno yard offers (Inferno WP 2.4): Unlock (its Strongbox),
 * Hatch (its Incubators), Housing (its Compounds, the Housing Bunker type)
 * and Train (its Infernal Academy). The Inferno has no Monster Lab and no
 * Hatchery Control Centre (`INFERNO_BUILDABLE_TYPES`). The words are Flash's
 * Inferno ones: "Compound" on the strip for its housing (`mhi_title`).
 */
export const INFERNO_MONSTERS_TABS: readonly MonstersTabDefinition[] = MONSTERS_TABS.filter(
  (tab) => tab.id !== MonstersTabId.LAB,
).map((tab) => {
  if (tab.id === MonstersTabId.HATCH) return { ...tab, buildings: [MonsterBuilding.HATCHERY] };
  if (tab.id === MonstersTabId.HOUSING) {
    return { ...tab, label: "Compound", buildings: [MonsterBuilding.HOUSING_BUNKER] };
  }
  return tab;
});

/** The tabs of the Monsters screen over a yard of `kind`. */
export const monstersTabsFor = (kind: YardKind): readonly MonstersTabDefinition[] =>
  kind === "outpost" ? OUTPOST_MONSTERS_TABS : kind === "inferno" ? INFERNO_MONSTERS_TABS : MONSTERS_TABS;
