import type { Camera } from "@/game/Camera";
import type { MonstersFocus, MonstersTabId } from "@/ui/monsters/monstersTab";
import type { Notices } from "@/ui/maproom/Notices";
import type { Hud } from "@/ui/Hud";
import type { Overlay } from "@/ui/overlay";
import type { YardDock } from "@/ui/yard/YardDock";
import type { YardRenderer } from "./YardRenderer";
import type { YardStore, YardUiBinding } from "./YardStore";

/**
 * The registry the own yard mounts the new-player tutorial's packages from
 * (issue #227, `docs/design/tutorial.md` §9.2): Goals (a), the guided start
 * (b) and the screen tips (c); and the Hatchery walk-out (#228), which needs
 * the same own-yard store and renderer. The attack scene's `attackPlugins.ts`
 * is the model.
 *
 * Kept apart from `YardScene.ts` for the same reason: each package's file
 * under `./plugins/` pushes onto {@link YARD_PLUGINS} at module load, and the
 * scene imports `./plugins` so those files run. The registry is a leaf
 * module, fully initialised before any package or the scene runs. So the
 * three packages build in parallel without editing the scene or each other.
 *
 * Mounted on the player's own yard only (main or outpost; `store.kind` says
 * which), once its store is up and the yard is drawn, and torn down when the
 * store goes (the yard closes, or a reload replaces it). Never on a visit.
 */

/** What the scene lets a yard package do to it. Every call is safe at any time. */
export interface YardSceneControls {
  /** Opens the Build menu, on one building's tile when `type` is given. */
  openBuildMenu(type?: number): void;
  /** Closes the Build menu and puts down any building in hand. */
  closeBuildMenu(): void;
  /** Pans to a building and opens its panel. */
  focusBuilding(id: number): void;
  /** Closes the building panel. */
  closePanel(): void;
  /** The building whose panel is open, or null. */
  selectedBuilding(): number | null;
  /** The Map door: Map Room 1 or 2, or the way to build a Map Room. */
  openMap(): void;
  openMonsters(tab: MonstersTabId, focus?: MonstersFocus): void;
  openShop(): void;
  /** Centres the camera on a yard point (`buildingdata` X/Y units). */
  centreOn(x: number, y: number): void;
  /** Whether the Yard Planner is open (the guide waits; tips do not show over it). */
  plannerOpen(): boolean;
  /** Whether a new building is in hand. */
  carrying(): boolean;
  /** Opens the raid scene on the fight handed over with `setRaidRun` (#226). */
  openRaid(): void;
  /** Opens this own yard afresh, as the server has it now. */
  reload(): void;
}

/** Everything a package mounted on the own yard can reach. */
export interface YardMounts {
  readonly store: YardStore;
  /** What the building panel and the HUD are handed: the store, the scene hooks, the notices. */
  readonly binding: YardUiBinding;
  readonly renderer: YardRenderer;
  readonly camera: Camera;
  readonly canvas: HTMLCanvasElement;
  /** The overlay: `content`, `modal`, and `guide` for Bob. */
  readonly overlay: Overlay;
  /** The round buttons; `placeBesideMonsters` takes a new one (`dockButton` makes it). */
  readonly dock: YardDock;
  readonly hud: Hud;
  readonly notices: Notices;
  readonly scene: YardSceneControls;
}

/** A package mounted on the own yard; may return its teardown. */
export type YardPlugin = (mounts: YardMounts) => (() => void) | void;

/** What mounts on the own yard, in mount order. Each package's file under `./plugins/` pushes here. */
export const YARD_PLUGINS: YardPlugin[] = [];

/**
 * Mounts every plugin and returns one teardown for them all. A plugin that
 * throws is reported and skipped: the tutorial must never stop the yard.
 */
export const mountYardPlugins = (
  mounts: YardMounts,
  plugins: readonly YardPlugin[] = YARD_PLUGINS,
): (() => void) => {
  const teardowns: (() => void)[] = [];
  for (const plugin of plugins) {
    try {
      const teardown = plugin(mounts);
      if (teardown) teardowns.push(teardown);
    } catch (error) {
      console.error("A yard plugin failed to mount:", error);
    }
  }
  return () => {
    for (const teardown of teardowns.reverse()) {
      try {
        teardown();
      } catch (error) {
        console.error("A yard plugin failed to tear down:", error);
      }
    }
  };
};
