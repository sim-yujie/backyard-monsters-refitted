import type { ResourceCaps, Resources } from "@/api/types";
import { nextWorkerJob } from "@/game/yard/jobs";
import { YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { formatAmount, formatCompact } from "./format";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount, type ResourceKey } from "./resourceIcon";
import { JobNotices } from "./yard/JobNotices";

/**
 * The persistent top bar: resource readouts on the left, a scene switcher on
 * the right.
 *
 * Each readout is the resource's icon (issue #93) and the amount in full,
 * "11,158,040,000" (issue #134). When the bar is too narrow for every readout
 * in full — a phone — it drops the brand, then falls back to short amounts
 * ("11.16B") rather than wrap or scroll; see {@link HudFit}. A short amount
 * hides small changes on a big pool, so every readout also carries the exact
 * figure (issue #92): as its tooltip and accessible name for a mouse or a
 * screen reader, and in a small bubble on a tap for a finger, which has no
 * hover. A change of amount floats its difference beside the readout for a
 * moment, so a 5M bomb out of 11B is still seen to cost something.
 *
 * On the player's own yard the scene hands over a binding (`bindYard`), and
 * the bar adds what only that yard knows (issue #100, design §3.1): each
 * resource's storage cap as "amount / cap" with a thin fill bar that turns
 * amber when the silo is full, a Workers control ("free / total") that goes
 * to the job finishing soonest, and a toast for every job the server says
 * finished (`JobNotices`). The map, the attack screen and a foreign yard have
 * no binding and show the amounts alone.
 */

/**
 * How much the bar shows, most first. {@link Hud} takes the first level at
 * which the readouts fit beside the scene switcher, measured again whenever
 * an amount, a cap or the window's width changes.
 */
export const HudFit = {
  /** Brand, every amount in full, and the caps beside them. */
  FULL: "full",
  /** The brand gives its room to the readouts. */
  NO_BRAND: "no-brand",
  /** Caps leave the text for the tooltip and the bubble; the fill bars stay. */
  NO_CAPS: "no-caps",
  /** Short amounts ("15.0M"): the phone fallback. The tap bubble stays exact. */
  COMPACT: "compact",
} as const;
export type HudFit = (typeof HudFit)[keyof typeof HudFit];

const FIT_ORDER: readonly HudFit[] = [HudFit.FULL, HudFit.NO_BRAND, HudFit.NO_CAPS, HudFit.COMPACT];

/** What a full silo's readout says on hover and in its bubble (design §3.1). */
export const FULL_NOTE = "Full: new income is lost. Build or upgrade Storage Silos.";

/** The worker art: the orange builder with the hammer and the hard hat. */
const WORKER_ICON_URL = "/assets/archived/worker.v1.png";

/** How full a silo is: the fill bar's share, and whether new income is lost. */
export interface CapState {
  /** 0 to 1. */
  readonly fraction: number;
  readonly full: boolean;
}

/**
 * A readout's fill against its cap, or null when there is nothing to draw: no
 * cap known (the map, a foreign yard, a yard before its first `state`
 * answer) or no amount yet. Full at the cap, not only over it: at the cap the
 * next twig harvested is already lost.
 */
export const capState = (amount: number | undefined, cap: number | undefined): CapState | null => {
  if (amount === undefined || cap === undefined || !(cap > 0)) return null;
  const whole = Math.floor(amount);
  return { fraction: Math.min(1, Math.max(0, whole / cap)), full: whole >= cap };
};

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

/**
 * "−5.0M" or "+120": a change as the float shows it. U+2212, not a hyphen.
 * Short on purpose: it is on screen for a second and only says how big.
 */
export const formatDelta = (delta: number): string =>
  `${delta < 0 ? "−" : "+"}${formatCompact(Math.abs(delta))}`;

/** "11,158,040,000": an amount in full, the same in every locale (`formatAmount`). */
export const formatExact = (amount: number): string => formatAmount(amount);

/**
 * "Twigs: 11,158,040,000", the readout's tooltip and accessible name; with a
 * cap, "Twigs: 15,000,000 of 23,050,000".
 */
export const exactLabel = (key: ResourceKey, amount: number | undefined, cap?: number): string => {
  const name = RESOURCE_NAMES[key];
  if (amount === undefined) return `${name}: not known yet`;
  return cap === undefined
    ? `${name}: ${formatExact(amount)}`
    : `${name}: ${formatExact(amount)} of ${formatExact(cap)}`;
};

/** "2 / 5" free of total, and the Workers control's tooltip. */
export const workersText = (free: number, total: number): { value: string; label: string } => ({
  value: `${free} / ${total}`,
  label:
    free >= total
      ? `Workers: all ${total} free.`
      : `Workers: ${free === 0 ? "none" : free} of ${total} free. Click to go to the job that finishes soonest.`,
});

interface Readout {
  readonly key: ResourceKey;
  readonly button: HTMLButtonElement;
  readonly value: HTMLElement;
  /** " / 23,050,000"; empty without a cap. */
  readonly capText: HTMLElement;
  /** The fill bar's track and fill; hidden without a cap. */
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
  amount: number | undefined;
  cap: number | undefined;
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
  private yardBinding: YardUiBinding | null = null;
  private unsubscribeYard: (() => void) | null = null;
  private jobNotices: JobNotices | null = null;
  private readonly workers: HTMLLIElement;
  private readonly workersButton: HTMLButtonElement;
  private readonly workersName: HTMLElement;
  private readonly workersValue: HTMLElement;
  private fitted: HudFit = HudFit.FULL;

  constructor(options: HudOptions) {
    this.element = document.createElement("header");
    this.element.className = "hud";
    this.element.dataset["fit"] = HudFit.FULL;

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
      const capText = document.createElement("span");
      capText.className = "hud__resource-cap";
      const bar = document.createElement("span");
      bar.className = "hud__cap-bar";
      bar.setAttribute("aria-hidden", "true");
      bar.hidden = true;
      const fill = document.createElement("span");
      fill.className = "hud__cap-fill";
      bar.append(fill);
      button.append(amount, capText, bar);
      button.addEventListener("click", () => this.toggleExact(key));

      item.append(button);
      resources.append(item);
      const readout: Readout = { key, button, value, capText, bar, fill, amount: undefined, cap: undefined };
      this.readouts.set(key, readout);
      this.label(readout);
    }

    // Workers: only on the player's own yard, so hidden until a binding comes.
    this.workers = document.createElement("li");
    this.workers.className = "hud__resource hud__workers";
    this.workers.hidden = true;
    this.workersButton = document.createElement("button");
    this.workersButton.type = "button";
    this.workersButton.className = "hud__resource-button hud__workers-button";
    const workerIcon = document.createElement("span");
    workerIcon.className = "hud__workers-icon";
    workerIcon.setAttribute("aria-hidden", "true");
    workerIcon.style.backgroundImage = `url("${WORKER_ICON_URL}")`;
    this.workersName = document.createElement("span");
    this.workersName.className = "hud__workers-name";
    this.workersName.textContent = "Workers";
    this.workersValue = document.createElement("span");
    this.workersValue.className = "hud__resource-value";
    this.workersButton.append(workerIcon, this.workersName, this.workersValue);
    this.workersButton.addEventListener("click", () => this.goToNextJob());
    this.workers.append(this.workersButton);
    resources.append(this.workers);

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
    const changes: [Readout, number][] = [];
    for (const key of [...RESOURCE_KEYS, "shiny"] as const) {
      const change = this.setAmount(key, key === "shiny" ? shiny : resources[key]);
      if (change) changes.push(change);
    }
    // Refit before floating, so each float starts where its readout now is.
    this.fit();
    for (const [readout, delta] of changes) this.float(readout, delta);
  }

  /** The level the bar is showing at (`HudFit`). */
  get fitLevel(): HudFit {
    return this.fitted;
  }

  /**
   * Picks the fullest {@link HudFit} level at which the readouts fit, by
   * trying each in turn. A bar that is not on the page measures zero wide
   * and takes the fullest.
   */
  fit(): void {
    for (const level of FIT_ORDER) {
      this.applyFit(level);
      if (this.list.scrollWidth <= this.list.clientWidth + 1) return;
    }
  }

  /**
   * The player's own yard, while one is open: its `YardStore`, the scene's
   * hooks and its notice dock (`YardStore.ts`, "Hooks for the UI work
   * packages"). Null on any other screen and on a foreign yard. It gives the
   * bar its caps, the Workers control and the job notices.
   */
  get yard(): YardUiBinding | null {
    return this.yardBinding;
  }

  /**
   * Hands the HUD the own yard's binding, or takes it away with null.
   *
   * The amounts still come through {@link setResources}, which the scene
   * calls on every store change; the HUD's own subscription reads what only
   * the store has — caps, workers, the `completed` list — after it.
   */
  bindYard(binding: YardUiBinding | null): void {
    this.unsubscribeYard?.();
    this.unsubscribeYard = null;
    this.jobNotices = null;
    this.yardBinding = binding;
    if (binding) {
      this.jobNotices = new JobNotices(binding.notices, (id) => binding.scene.selectBuilding(id));
      this.unsubscribeYard = binding.store.subscribe((change) => this.onYardChange(change));
    }
    this.syncYard();
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
    window.addEventListener("resize", this.onResize);
    this.fit();
    return this;
  }

  destroy(): void {
    this.bindYard(null);
    window.removeEventListener("resize", this.onResize);
    this.hideExact();
    for (const float of this.floats) float.remove();
    this.floats.clear();
    this.element.remove();
  }

  /** Sets one readout's amount; returns the change to float, if there is one. */
  private setAmount(key: ResourceKey, amount: number | undefined): [Readout, number] | null {
    if (amount === undefined) return null;
    const readout = this.readouts.get(key);
    if (!readout) return null;
    const before = readout.amount;
    readout.amount = amount;
    this.render(readout);
    this.label(readout);
    if (this.bubbleFor === key) this.fillExact(readout);
    return before !== undefined && Math.floor(before) !== Math.floor(amount)
      ? [readout, Math.floor(amount) - Math.floor(before)]
      : null;
  }

  /** The readout's visible amount, cap and fill bar, spelled for the current fit. */
  private render(readout: Readout): void {
    if (readout.amount === undefined) return;
    readout.value.textContent =
      this.fitted === HudFit.COMPACT ? formatCompact(readout.amount) : formatAmount(readout.amount);
    const showCap =
      readout.cap !== undefined && (this.fitted === HudFit.FULL || this.fitted === HudFit.NO_BRAND);
    readout.capText.textContent = showCap ? ` / ${formatAmount(readout.cap)}` : "";
    const state = capState(readout.amount, readout.cap);
    readout.bar.hidden = state === null;
    readout.fill.style.width = state === null ? "" : `${+(state.fraction * 100).toFixed(2)}%`;
    readout.button.classList.toggle("hud__resource-button--full", state?.full === true);
  }

  /* ── The own yard: caps, workers, job notices ──────────────────────── */

  private onYardChange(change: YardChange): void {
    if (change.completed.length > 0) this.jobNotices?.show(change.completed);
    if (change.reason !== YardChangeReason.PENDING) this.syncYard();
  }

  /** Reads the caps and the workers from the bound store, or clears them. */
  private syncYard(): void {
    const store = this.yardBinding?.store ?? null;
    const caps: ResourceCaps | null = store?.caps ?? null;
    for (const key of RESOURCE_KEYS) {
      const readout = this.readouts.get(key);
      if (!readout) continue;
      readout.cap = caps?.[key];
      this.render(readout);
      this.label(readout);
      if (this.bubbleFor === key) this.fillExact(readout);
    }

    this.workers.hidden = store === null;
    if (store) {
      const { total, busy } = store.workers;
      const free = Math.max(0, total - busy);
      const text = workersText(free, total);
      this.workersValue.textContent = text.value;
      this.workersButton.title = text.label;
      this.workersButton.setAttribute("aria-label", text.label);
      this.workersButton.setAttribute("aria-disabled", String(free >= total));
    }
    this.fit();
  }

  /** The Workers control's click: the building of the job that ends soonest. */
  private goToNextJob(): void {
    const binding = this.yardBinding;
    if (!binding) return;
    const job = nextWorkerJob(binding.store.jobs());
    if (job?.buildingId != null) binding.scene.selectBuilding(job.buildingId);
  }

  private applyFit(level: HudFit): void {
    if (this.fitted === level) return;
    this.fitted = level;
    this.element.dataset["fit"] = level;
    for (const readout of this.readouts.values()) this.render(readout);
    // The icon says "workers" once the bar is short of room.
    this.workersName.hidden = level === HudFit.NO_CAPS || level === HudFit.COMPACT;
  }

  private readonly onResize = (): void => this.fit();

  private label(readout: Readout): void {
    const text = exactLabel(readout.key, readout.amount, readout.cap);
    const full = capState(readout.amount, readout.cap)?.full === true;
    readout.button.title = full ? `${text}\n${FULL_NOTE}` : text;
    readout.button.setAttribute("aria-label", full ? `${text}. ${FULL_NOTE}` : text);
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
    if (!this.bubble) return;
    const { amount, cap } = readout;
    const text =
      amount === undefined
        ? "Not known yet"
        : cap === undefined
          ? formatExact(amount)
          : `${formatExact(amount)} / ${formatExact(cap)}`;
    this.bubble.replaceChildren(resourceAmount(readout.key, text, { className: "hud__exact-amount" }));
    if (capState(amount, cap)?.full) {
      const note = document.createElement("p");
      note.className = "hud__exact-note";
      note.textContent = FULL_NOTE;
      this.bubble.append(note);
    }
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
