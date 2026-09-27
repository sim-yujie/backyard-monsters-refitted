import type { Resources } from "@/api/types";
import { formatAmount } from "./format";
import { RESOURCE_KEYS, resourceAmount, type ResourceKey } from "./resourceIcon";

/**
 * The persistent top bar: resource readouts on the left, a scene switcher on
 * the right.
 *
 * Each readout is the resource's icon and its amount (issue #93); the icon
 * carries the resource's name as its accessible name and tooltip.
 */

export interface HudSceneOption {
  id: string;
  label: string;
}

export interface HudOptions {
  scenes: HudSceneOption[];
  onSceneSelect: (id: string) => void;
  onSignOut?: () => void;
}

export class Hud {
  readonly element: HTMLElement;

  private readonly values = new Map<ResourceKey, HTMLElement>();
  private readonly sceneButtons = new Map<string, HTMLButtonElement>();

  constructor(options: HudOptions) {
    this.element = document.createElement("header");
    this.element.className = "hud";

    const brand = document.createElement("span");
    brand.className = "hud__brand";
    brand.textContent = "Backyard Monsters";

    const resources = document.createElement("ul");
    resources.className = "hud__resources";
    resources.setAttribute("aria-label", "Resources");

    for (const key of [...RESOURCE_KEYS, "shiny"] as const) {
      const item = document.createElement("li");
      item.className = "hud__resource";

      const amount = resourceAmount(key, "—");
      const value = amount.querySelector<HTMLElement>(".res-amount__value")!;
      value.classList.add("hud__resource-value");

      item.append(amount);
      resources.append(item);
      this.values.set(key, value);
    }

    const spacer = document.createElement("div");
    spacer.className = "hud__spacer";

    const scenes = document.createElement("nav");
    scenes.className = "hud__scenes";
    scenes.setAttribute("aria-label", "Screens");

    for (const scene of options.scenes) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn--ghost hud__scene-button";
      button.textContent = scene.label;
      button.addEventListener("click", () => options.onSceneSelect(scene.id));
      scenes.append(button);
      this.sceneButtons.set(scene.id, button);
    }

    this.element.append(brand, resources, spacer, scenes);

    if (options.onSignOut) {
      const signOut = document.createElement("button");
      signOut.type = "button";
      signOut.className = "btn btn--ghost";
      signOut.textContent = "Sign out";
      signOut.addEventListener("click", options.onSignOut);
      this.element.append(signOut);
    }
  }

  /** Updates the resource readouts. Missing keys are left as they were. */
  setResources(resources: Resources, shiny?: number): void {
    for (const key of RESOURCE_KEYS) {
      const amount = resources[key];
      if (amount === undefined) continue;
      const node = this.values.get(key);
      if (node) node.textContent = formatAmount(amount);
    }
    if (shiny !== undefined) {
      const node = this.values.get("shiny");
      if (node) node.textContent = formatAmount(shiny);
    }
  }

  /** Marks one scene button as the current screen. */
  setActiveScene(id: string): void {
    for (const [sceneId, button] of this.sceneButtons) {
      button.setAttribute("aria-current", String(sceneId === id));
    }
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  destroy(): void {
    this.element.remove();
  }
}
