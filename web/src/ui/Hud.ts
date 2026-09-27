import type { Resources } from "@/api/types";
import { formatAmount } from "./format";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount, type ResourceKey } from "./resourceIcon";

/**
 * The persistent top bar: resource readouts on the left, a scene switcher on
 * the right.
 *
 * Each readout is the resource's icon and a short amount (issue #93). The
 * short amount hides small changes on a big pool — 11,163,050,000 and
 * 11,158,040,000 twigs both read "11.16B" — so every readout also carries the
 * exact figure (issue #92): as its tooltip and accessible name for a mouse or
 * a screen reader, and in a small bubble on a tap for a finger, which has no
 * hover. A change of amount floats its difference beside the readout for a
 * moment, so a 5M bomb out of 11B is still seen to cost something.
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

/** How long a tapped readout's exact-amount bubble stays up on its own. */
const EXACT_LIFETIME_MS = 5000;

/** How long a change float lives; the animation is a little shorter. */
const FLOAT_LIFETIME_MS = 1800;

/** Gap between a readout and its bubble. */
const OFFSET_PX = 8;

/** "−5.0M" or "+120": a change as the float shows it. U+2212, not a hyphen. */
export const formatDelta = (delta: number): string =>
  `${delta < 0 ? "−" : "+"}${formatAmount(Math.abs(delta))}`;

/** "11,158,040,000": an amount in full, the same in every locale. */
export const formatExact = (amount: number): string => Math.floor(amount).toLocaleString("en-US");

/** "Twigs: 11,158,040,000", the readout's tooltip and accessible name. */
export const exactLabel = (key: ResourceKey, amount: number | undefined): string =>
  `${RESOURCE_NAMES[key]}: ${amount === undefined ? "not known yet" : formatExact(amount)}`;

interface Readout {
  readonly key: ResourceKey;
  readonly button: HTMLButtonElement;
  readonly value: HTMLElement;
  amount: number | undefined;
}

export class Hud {
  readonly element: HTMLElement;

  private readonly list: HTMLElement;
  private readonly readouts = new Map<ResourceKey, Readout>();
  private readonly sceneButtons = new Map<string, HTMLButtonElement>();
  private bubble: HTMLElement | null = null;
  private bubbleFor: ResourceKey | null = null;
  private bubbleTimer: number | undefined;
  private readonly floats = new Set<HTMLElement>();

  constructor(options: HudOptions) {
    this.element = document.createElement("header");
    this.element.className = "hud";

    const brand = document.createElement("span");
    brand.className = "hud__brand";
    brand.textContent = "Backyard Monsters";

    const resources = document.createElement("ul");
    resources.className = "hud__resources";
    resources.setAttribute("aria-label", "Resources");
    this.list = resources;

    for (const key of [...RESOURCE_KEYS, "shiny"] as const) {
      const item = document.createElement("li");
      item.className = "hud__resource";

      // A button so a tap and the keyboard can ask for the exact amount; the
      // icon is decorative because the button's own label names the resource.
      const button = document.createElement("button");
      button.type = "button";
      button.className = "hud__resource-button";
      button.dataset["resource"] = key;
      const amount = resourceAmount(key, "—", { decorative: true });
      const value = amount.querySelector<HTMLElement>(".res-amount__value")!;
      value.classList.add("hud__resource-value");
      button.append(amount);
      button.addEventListener("click", () => this.toggleExact(key));

      item.append(button);
      resources.append(item);
      const readout: Readout = { key, button, value, amount: undefined };
      this.readouts.set(key, readout);
      this.label(readout);
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

  /**
   * Updates the resource readouts. Missing keys are left as they were.
   *
   * A readout that already showed a number and now shows a different one
   * floats the difference; the first number a readout gets does not, because
   * that is the pool arriving rather than changing.
   */
  setResources(resources: Resources, shiny?: number): void {
    for (const key of RESOURCE_KEYS) this.setAmount(key, resources[key]);
    this.setAmount("shiny", shiny);
  }

  /** The amount a readout is showing, or undefined before the first. */
  amountOf(key: ResourceKey): number | undefined {
    return this.readouts.get(key)?.amount;
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
    this.hideExact();
    for (const float of this.floats) float.remove();
    this.floats.clear();
    this.element.remove();
  }

  private setAmount(key: ResourceKey, amount: number | undefined): void {
    if (amount === undefined) return;
    const readout = this.readouts.get(key);
    if (!readout) return;
    const before = readout.amount;
    readout.amount = amount;
    readout.value.textContent = formatAmount(amount);
    this.label(readout);
    if (this.bubbleFor === key) this.fillExact(readout);
    if (before !== undefined && Math.floor(before) !== Math.floor(amount)) {
      this.float(readout, Math.floor(amount) - Math.floor(before));
    }
  }

  private label(readout: Readout): void {
    const text = exactLabel(readout.key, readout.amount);
    readout.button.title = text;
    readout.button.setAttribute("aria-label", text);
  }

  /**
   * The difference, drifting away from the readout and fading. It is fixed on
   * the page rather than inside the bar: the list scrolls sideways on a narrow
   * screen and would clip it, and on the attack screen the strip under the bar
   * would cover it. The stylesheet does the motion and turns it into a plain
   * fade under `prefers-reduced-motion`.
   */
  private float(readout: Readout, delta: number): void {
    for (const old of this.floats) {
      if (old.dataset["resource"] === readout.key) old.remove();
    }
    const float = document.createElement("span");
    float.className = `hud__delta hud__delta--${delta < 0 ? "down" : "up"}`;
    float.dataset["resource"] = readout.key;
    float.setAttribute("aria-hidden", "true");
    float.textContent = formatDelta(delta);
    const box = readout.value.getBoundingClientRect();
    float.style.left = `${Math.round(box.left)}px`;
    float.style.top = `${Math.round(box.bottom + 2)}px`;
    document.body.append(float);
    this.floats.add(float);
    const remove = (): void => {
      float.remove();
      this.floats.delete(float);
    };
    float.addEventListener("animationend", remove, { once: true });
    window.setTimeout(remove, FLOAT_LIFETIME_MS);
  }

  /* ── The exact amount on a tap ─────────────────────────────────────── */

  private toggleExact(key: ResourceKey): void {
    if (this.bubbleFor === key) {
      this.hideExact();
      return;
    }
    const readout = this.readouts.get(key);
    if (!readout) return;
    this.hideExact();
    const bubble = document.createElement("div");
    bubble.className = "popover hud__exact";
    bubble.setAttribute("role", "status");
    this.bubble = bubble;
    this.bubbleFor = key;
    readout.button.setAttribute("aria-expanded", "true");
    this.fillExact(readout);
    document.body.append(bubble);
    this.placeExact(readout, bubble);
    document.addEventListener("pointerdown", this.onDocumentDown, true);
    document.addEventListener("keydown", this.onKey, true);
    this.bubbleTimer = window.setTimeout(() => this.hideExact(), EXACT_LIFETIME_MS);
  }

  private fillExact(readout: Readout): void {
    this.bubble?.replaceChildren(
      resourceAmount(
        readout.key,
        readout.amount === undefined ? "Not known yet" : formatExact(readout.amount),
        { className: "hud__exact-amount" },
      ),
    );
  }

  private placeExact(readout: Readout, bubble: HTMLElement): void {
    const box = readout.button.getBoundingClientRect();
    const size = bubble.getBoundingClientRect();
    const maxLeft = Math.max(OFFSET_PX, window.innerWidth - size.width - OFFSET_PX);
    const left = Math.min(Math.max(OFFSET_PX, box.left + box.width / 2 - size.width / 2), maxLeft);
    bubble.style.top = `${Math.round(box.bottom + OFFSET_PX)}px`;
    bubble.style.left = `${Math.round(left)}px`;
  }

  private hideExact(): void {
    window.clearTimeout(this.bubbleTimer);
    this.bubbleTimer = undefined;
    this.bubble?.remove();
    this.bubble = null;
    if (this.bubbleFor) this.readouts.get(this.bubbleFor)?.button.removeAttribute("aria-expanded");
    this.bubbleFor = null;
    document.removeEventListener("pointerdown", this.onDocumentDown, true);
    document.removeEventListener("keydown", this.onKey, true);
  }

  private readonly onDocumentDown = (event: Event): void => {
    // A press on a readout is that readout's click to handle: closing here
    // first would make the click reopen the bubble it meant to close.
    if (event.target instanceof Node && this.list.contains(event.target)) return;
    this.hideExact();
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.hideExact();
  };
}
