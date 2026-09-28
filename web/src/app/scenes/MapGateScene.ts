import { loadOwnYard } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import { MapRoomChoice, mapRoomOf, primeOwnYard } from "@/game/maproom/mapRoute";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

/**
 * The door to "the map" when nothing on screen knows yet which one that is
 * (issue #162): from the yard's Map button, from a visit and from the end of
 * an attack. Sign-in no longer comes through here: it lands in the yard
 * (issue #172). It
 * loads the own yard, picks the map from it (`mapRoute.ts`) and hands the
 * load on, so the map it opens does not load the yard again.
 *
 * With no Map Room there is no map: the yard opens instead, where the Map
 * button explains how to get one. Never the Map Room 2 world, which is a
 * dead end for a player with no home cell in it.
 */

/** The scene each map choice opens. */
export const sceneForMap = (choice: MapRoomChoice): string =>
  choice === MapRoomChoice.MAP_ROOM_2
    ? SceneName.MAP_ROOM_2
    : choice === MapRoomChoice.MAP_ROOM_1
      ? SceneName.MAP_ROOM_1
      : SceneName.YARD;

export class MapGateScene implements Scene {
  private panel: Panel | null = null;
  private context: SceneContext | null = null;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;
    const wrapper = document.createElement("div");
    wrapper.className = "scene-centre";
    const status = document.createElement("div");
    status.className = "boot-status";
    status.textContent = "Opening the map…";
    this.panel = new Panel({ title: "Backyard Monsters", closable: false });
    this.panel.setContent(status);
    wrapper.append(this.panel.element);
    context.overlay.content.append(wrapper);

    await this.open(status);
  }

  exit(): void {
    this.panel?.close();
    this.panel = null;
    this.context = null;
  }

  private async open(status: HTMLElement): Promise<void> {
    const context = this.context;
    if (!context) return;
    try {
      const save = await loadOwnYard();
      if (this.context !== context) return;
      primeOwnYard(save);
      context.goTo(sceneForMap(mapRoomOf(save)));
    } catch (caught) {
      if (this.context !== context) return;
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      status.replaceChildren(
        caught instanceof NetworkError
          ? "Could not reach the server to open the map."
          : "Could not load your yard to open the map.",
      );
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn--primary";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        status.textContent = "Opening the map…";
        void this.open(status);
      });
      const yard = document.createElement("button");
      yard.type = "button";
      yard.className = "btn";
      yard.textContent = "Go to your yard";
      yard.addEventListener("click", () => context.goTo(SceneName.YARD));
      const row = document.createElement("div");
      row.className = "map-gate__actions";
      row.append(retry, yard);
      status.append(row);
    }
  }
}
