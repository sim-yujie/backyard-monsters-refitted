import type { YardChange, YardUiBinding } from "@/game/yard/YardStore";

/**
 * The contract between the Monsters screen and its tabs
 * (`docs/design/yard-buildings.md` §4.1, §4.9: WP2.6 and WP2.7 plug their tabs
 * in here without editing the shell).
 *
 * The screen owns the frame: the title bar, the tab strip, the header (housing
 * used/total, goo and putty), the "build one first" state for a tab whose
 * building the yard lacks, and the store subscription. A tab owns only its
 * body. To add one, write a {@link MonstersTab} and point its entry in
 * `MONSTERS_TABS` (`tabs.ts`) at a factory for it.
 *
 * Life of a tab:
 *
 * 1. `create(context)` runs the first time the tab is shown, never before;
 *    the tab builds its `element` once and keeps it.
 * 2. `show(focus)` runs every time the tab becomes the visible one, after the
 *    element is on the page, with what the opener asked to focus (a clicked
 *    Hatchery's id, a monster). Redraw here: the yard may have changed while
 *    the tab was hidden.
 * 3. `update(change)` runs on every store change while the tab is visible,
 *    `pending` ones included (only the set of running requests changed:
 *    re-sync disabled buttons, nothing else). Hidden tabs are not told.
 * 4. `tick()` runs once a second while the tab is visible, for countdowns and
 *    time-priced Shiny.
 * 5. `destroy()` runs when the screen is destroyed (the yard closes). Destroy
 *    any `ShinyButton` so none stays armed.
 *
 * The screen stays open after every action (§4.1); a tab reports an outcome
 * on its own status line.
 */

/** The five tabs, in strip order (§4.1). */
export const MonstersTabId = {
  UNLOCK: "unlock",
  HATCH: "hatch",
  HOUSING: "housing",
  TRAIN: "train",
  LAB: "lab",
} as const;
export type MonstersTabId = (typeof MonstersTabId)[keyof typeof MonstersTabId];

export const MONSTERS_TAB_ORDER: readonly MonstersTabId[] = [
  MonstersTabId.UNLOCK,
  MonstersTabId.HATCH,
  MonstersTabId.HOUSING,
  MonstersTabId.TRAIN,
  MonstersTabId.LAB,
];

/** What an opener asks the tab to put first. Every field is optional. */
export interface MonstersFocus {
  /** The building that was clicked: a Hatchery or HCC selects its chip (§4.4). */
  readonly buildingId?: number;
  /** A monster to select, by roster id. */
  readonly monster?: string;
}

/** What the screen hands a tab when it creates it. */
export interface MonstersTabContext {
  /**
   * The own yard: `binding.store` to read and to run actions (`YardStore.ts`,
   * "Hooks for the UI work packages"), `binding.scene`, `binding.notices`.
   */
  readonly binding: YardUiBinding;
  /** Switches the screen to another tab, e.g. from Hatch to Housing. */
  showTab(id: MonstersTabId, focus?: MonstersFocus): void;
}

/** One tab's body. See the life cycle above. */
export interface MonstersTab {
  readonly element: HTMLElement;
  show(focus: MonstersFocus): void;
  update(change: YardChange): void;
  tick(): void;
  destroy(): void;
}

/** A tab as the screen registers it. */
export interface MonstersTabDefinition {
  readonly id: MonstersTabId;
  /** The word on the strip. */
  readonly label: string;
  /**
   * The building types that open this tab. When the yard holds none of them,
   * the screen shows what to build (the first type) and its Town Hall
   * requirement instead of the tab.
   */
  readonly buildings: readonly number[];
  readonly create: (context: MonstersTabContext) => MonstersTab;
}

/** Building type ids of the monster buildings (`client/scripts/YARD_PROPS.as`). */
export const MonsterBuilding = {
  LOCKER: 8,
  HATCHERY: 13,
  HOUSING: 15,
  HCC: 16,
  ACADEMY: 26,
  LAB: 116,
} as const;

/** The tab each monster building opens (D4). */
export const TAB_FOR_BUILDING: Readonly<Record<number, MonstersTabId>> = {
  [MonsterBuilding.LOCKER]: MonstersTabId.UNLOCK,
  [MonsterBuilding.HATCHERY]: MonstersTabId.HATCH,
  [MonsterBuilding.HCC]: MonstersTabId.HATCH,
  [MonsterBuilding.HOUSING]: MonstersTabId.HOUSING,
  [MonsterBuilding.ACADEMY]: MonstersTabId.TRAIN,
  [MonsterBuilding.LAB]: MonstersTabId.LAB,
};

/** The tab a building opens, or null for a building that is not a monster building. */
export const monstersTabFor = (type: number): MonstersTabId | null =>
  TAB_FOR_BUILDING[type] ?? null;
