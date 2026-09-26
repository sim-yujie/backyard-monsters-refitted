// WP2 replaces this file.
//
// A placeholder so the route registered in App.ts has something to open while
// the real attack scene (docs/design/attack-flow.md §6, WP2) is built. It does
// the least that proves WP1's plumbing end to end: takes the handed-off target,
// issues the attack load unless one was handed over pre-fetched (the View yard
// door does that), and shows what came back. Nothing here is meant to survive.

import { loadAttack } from "@/api/base";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import { consumeAttackTarget, type AttackTarget } from "@/game/attack/attackTarget";
import { Panel } from "@/ui/Panel";
import type { Scene, SceneContext } from "../SceneManager";
import { SceneName } from "../App";

export class AttackScene implements Scene {
  private panel: Panel | null = null;
  private wrapper: HTMLElement | null = null;
  private context: SceneContext | null = null;

  async enter(context: SceneContext): Promise<void> {
    this.context = context;

    const status = document.createElement("div");
    status.className = "boot-status";
    status.textContent = "Attack — coming up";

    const detail = document.createElement("p");
    detail.className = "field__label";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn";
    back.textContent = "Back to the map";
    back.addEventListener("click", () => context.goTo(SceneName.MAP_ROOM_2));

    this.wrapper = document.createElement("div");
    this.wrapper.className = "scene-centre";
    this.panel = new Panel({ title: "Attack", closable: false });
    this.panel.setContent(status, detail, back);
    this.wrapper.append(this.panel.element);
    context.overlay.content.append(this.wrapper);

    const target = consumeAttackTarget();
    if (!target) {
      detail.textContent = "No target was chosen. Pick a cell on the map and press Attack.";
      return;
    }

    detail.textContent = `Target: ${target.name} (${target.kind}, base ${target.baseid}) at ${target.cell.col}, ${target.cell.row}. ` +
      `Roster: ${describeRoster(target)}.`;

    try {
      const load = target.load ?? (await loadAttack(target.baseid, target.kind, target.roster));
      if (this.context !== context) return;
      status.textContent = target.load
        ? `Attack ${load.attackid ?? "?"} handed over from View yard`
        : `Attack ${load.attackid ?? "?"} started`;
      detail.textContent += ` ${describeLoad(load)}`;
    } catch (caught) {
      if (caught instanceof ApiError && caught.isAuthFailure) {
        context.goTo(SceneName.LOGIN);
        return;
      }
      status.textContent = "The attack could not start";
      detail.textContent =
        caught instanceof NetworkError
          ? "Could not reach the server."
          : caught instanceof Error
            ? caught.message
            : "Unknown error.";
    }
  }

  exit(): void {
    this.panel?.close();
    this.panel = null;
    this.wrapper?.remove();
    this.wrapper = null;
    this.context = null;
  }
}

const describeRoster = (target: AttackTarget): string => {
  const monsters = Object.entries(target.roster.monsters)
    .map(([id, count]) => `${count} ${id}`)
    .join(", ");
  const champions = target.roster.champions.map((champion) => `G${champion.t}`).join(", ");
  return `${monsters || "no monsters"}; champions ${champions || "none"}; flinger level ${target.roster.flingerLevel}`;
};

const describeLoad = (load: BaseLoadResponse): string => {
  const buildings = Object.keys(load.buildingdata ?? {}).length;
  return `Enemy yard: ${buildings} buildings, basesaveid ${load.basesaveid}.`;
};
