import { setAvatar } from "@/api/account";
import { getSession } from "@/api/auth";
import type { ResourceCaps, Resources } from "@/api/types";
import { avatarOf, pickedAvatar, type AvatarId } from "@/game/avatars";
import { nextWorkerJob } from "@/game/yard/jobs";
import { YardChangeReason, type YardChange, type YardUiBinding } from "@/game/yard/YardStore";
import { AccountMenu } from "./AccountMenu";
import { formatAmount, formatCompact } from "./format";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount, type ResourceKey } from "./resourceIcon";
import { DamageBanner } from "./yard/DamageBanner";
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
 * finished (`JobNotices`), and the post-attack "N buildings damaged
 * [Repair all]" line in the notice dock (`DamageBanner`, design §5.5). The
 * map, the attack screen and a foreign yard have no binding and show the
 * amounts alone. In an outpost the amounts and caps are the main yard's pool,
 * as the server sends them.
 *
 * The yard lays it out as its `corner` (the HUD redesign, #171, option B:
 * "a game, not a dashboard"): no brand and no screen tabs, the readouts and
 * Workers in one glass bar at the top left, each amount over its thin fill
 * bar, and the Account menu as a pill at the top right with the player's name
 * and critter, and their level under the name while an own yard is bound
 * (#192). On a phone the name and critter lead the top row with Workers
 * and Shiny at its end, and the four resources share the row under it in
 * short amounts. The yard's buttons (Build, Collect all, Monsters, Layout,
 * Map, the yard switcher) are the yard's own round buttons (`YardDock`).
 */

/**
 * How much the bar shows, most first. {@link Hud} takes the first level at
 * which the readouts fit beside the scene switcher, measured again whenever
 * an amount, a cap or the window's width changes.
 */
export const HudFit = {
  /** Brand, every amount in full, and the caps beside them. */
  FULL: "full",
  /** The brand and the word "Workers" give their room to the readouts. */
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
  /**
   * With it, the bar ends in the Account menu (who is signed in, and Log out;
   * issue #173); Log out runs this.
   */
  onSignOut?: () => void;
  /** The name the Account menu shows; the signed-in session's by default. */
  accountName?: string | null;
  /**
   * "bar" (default): one bar across the top with the brand and the screen
   * tabs. "corner": the yard's (#171), see the class comment.
   */
  layout?: "bar" | "corner";
}

/** At or under this width the corner layout is the phone's (`yard-hud.css`). */
const PHONE_QUERY = "(width <= 620px)";

/** How long a tapped readout's exact-amount bubble stays up on its own. */
const EXACT_LIFETIME_MS = 5000;

/** How long a change float lives; the animation is a little shorter. */
const FLOAT_LIFETIME_MS = 1800;

/**
 * How long a readout takes to count up to what a landing resource ball
 * brought: the Flash bar's tween to a new amount, linear
 * (`client/scripts/UI_TOP.as:798-826`).
 */
export const COUNT_MS = 500;

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
  /**
   * What is still flying to the Town Hall (#208): part of `amount` the
   * readout does not show yet. It counts up as the balls land.
   */
  held: number;
  /** The whole of what was held back, floated once when the first ball lands. */
  landing: number;
  /** The amount on show while counting, or null to show the target. */
  shown: number | null;
  /** The count in progress: from, to, and its start (`performance.now()`). */
  count: { from: number; to: number; start: number } | null;
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
  /** The post-attack "N buildings damaged [Repair all]" line, while bound (§5.5). */
  private damageBanner: DamageBanner | null = null;
  private readonly workers: HTMLElement;
  private readonly workersButton: HTMLButtonElement;
  private readonly workersName: HTMLElement;
  private readonly workersValue: HTMLElement;
  /** The yard's corner layout (#171) rather than the bar. */
  private readonly corner: boolean;
  private accountMenu: AccountMenu | null = null;
  private fitted: HudFit = HudFit.FULL;
  /** The animation frame counting a readout up, or 0. */
  private frame = 0;

  constructor(options: HudOptions) {
    this.corner = options.layout === "corner";
    this.element = document.createElement("header");
    this.element.className = this.corner ? "hud hud--corner" : "hud";
    this.element.dataset["fit"] = HudFit.FULL;
    // Listened for from the start rather than on `mount`: the map places the
    // bar itself (`MapRoomUi`) and never calls `mount`.
    window.addEventListener("resize", this.onResize);

    const brand = document.createElement("span");
    brand.className = "hud__brand";
    brand.textContent = "Backyard Monsters";

    const resources = document.createElement("ul");
    resources.className = "hud__resources";
    resources.setAttribute("aria-label", "Resources");
    this.list = resources;

    for (const key of [...RESOURCE_KEYS, "shiny"] as const) {
      const item = document.createElement("li");
      item.className = `hud__resource hud__resource--${key}`;

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
      // On the own yard the Shiny counter is the Shop's door (§8.2); the
      // Shop's header then shows the exact balance.
      button.addEventListener("click", () => {
        const openShop = key === "shiny" ? this.shopOpener() : null;
        if (openShop) {
          this.hideExact();
          openShop();
        } else {
          this.toggleExact(key);
        }
      });

      item.append(button);
      resources.append(item);
      const readout: Readout = {
        key,
        button,
        value,
        capText,
        bar,
        fill,
        amount: undefined,
        cap: undefined,
        held: 0,
        landing: 0,
        shown: null,
        count: null,
      };
      this.readouts.set(key, readout);
      this.label(readout);
    }

    // Workers: only on the player's own yard, so hidden until a binding comes.
    // Beside the readout list rather than in it, so on a phone, where the list
    // takes a row of its own, it stays up with the screen buttons.
    this.workers = document.createElement("div");
    this.workers.className = "hud__workers";
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
    // The corner's Workers is the icon and "5 / 5", as the mock-up draws it.
    this.workersName.hidden = this.corner;

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

    if (this.corner) {
      // One glass bar holds the readouts and Workers (yard-hud.css).
      const bar = document.createElement("div");
      bar.className = "hud__bar";
      bar.append(resources, this.workers);
      this.element.append(bar);
    } else {
      this.element.append(brand, resources, this.workers, spacer, scenes);
    }

    if (options.onSignOut) {
      const session = getSession();
      this.accountMenu = new AccountMenu({
        name: options.accountName === undefined ? session?.username : options.accountName,
        onSignOut: options.onSignOut,
        variant: this.corner ? "pill" : "button",
        ...(session && {
          avatar: {
            current: avatarOf(session.picSquare, session.userId),
            picked: pickedAvatar(session.picSquare) !== null,
            onPick: async (id: AvatarId) => {
              await setAvatar(id);
            },
          },
        }),
      });
      this.element.append(this.accountMenu.element);
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

  /**
   * Holds back what a bank's resource balls carry (#208): the readouts keep
   * showing the pool as it was until {@link deliver} hands the amounts over,
   * ball by ball. Called straight after the answer that credited them, so the
   * float that answer made is dropped: the first landing floats the whole.
   */
  withhold(amounts: Partial<Record<ResourceKey, number>>): void {
    for (const [key, amount] of Object.entries(amounts) as [ResourceKey, number][]) {
      const readout = this.readouts.get(key);
      if (!readout || !(amount > 0)) continue;
      readout.held += amount;
      readout.landing += amount;
      this.dropFloat(key);
      if (readout.count) readout.count.to = this.target(readout) ?? readout.count.to;
      else this.render(readout);
    }
  }

  /** A ball landed: the readout counts up by its share. */
  deliver(key: ResourceKey, amount: number): void {
    const readout = this.readouts.get(key);
    if (!readout || !(amount > 0)) return;
    const from = readout.shown ?? this.target(readout);
    readout.held = Math.max(0, readout.held - amount);
    if (readout.landing > 0) {
      this.float(readout, readout.landing);
      readout.landing = 0;
    }
    if (from !== undefined) this.countTo(readout, from);
  }

  /** Shows every readout's whole amount at once: nothing is flying any more. */
  releaseHeld(): void {
    for (const readout of this.readouts.values()) {
      if (readout.held === 0 && !readout.count) continue;
      readout.held = 0;
      readout.landing = 0;
      readout.count = null;
      readout.shown = null;
      this.render(readout);
    }
  }

  /** What a readout is showing right now, counting included; undefined before the first. */
  shownOf(key: ResourceKey): number | undefined {
    const readout = this.readouts.get(key);
    return readout ? (readout.shown ?? this.target(readout)) : undefined;
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
    // The corner on a phone lays the readouts in a grid of four, which never
    // overflows and so cannot be measured: short amounts, as the mock-up has.
    if (this.corner && window.matchMedia?.(PHONE_QUERY).matches) {
      this.applyFit(HudFit.COMPACT);
      return;
    }
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
    if (!binding) this.releaseHeld();
    this.unsubscribeYard?.();
    this.unsubscribeYard = null;
    this.jobNotices = null;
    this.damageBanner?.destroy();
    this.damageBanner = null;
    this.yardBinding = binding;
    if (binding) {
      this.jobNotices = new JobNotices(binding.notices, (id) => binding.scene.selectBuilding(id));
      this.damageBanner = new DamageBanner(binding);
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
    this.fit();
    return this;
  }

  destroy(): void {
    this.bindYard(null);
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    window.removeEventListener("resize", this.onResize);
    this.hideExact();
    this.accountMenu?.destroy();
    this.accountMenu = null;
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
    if (readout.count) readout.count.to = this.target(readout) ?? readout.count.to;
    this.render(readout);
    this.label(readout);
    if (this.bubbleFor === key) this.fillExact(readout);
    return before !== undefined && Math.floor(before) !== Math.floor(amount)
      ? [readout, Math.floor(amount) - Math.floor(before)]
      : null;
  }

  /** The readout's visible amount, cap and fill bar, spelled for the current fit. */
  private render(readout: Readout): void {
    const shown = readout.shown ?? this.target(readout);
    if (shown === undefined) return;
    readout.value.textContent =
      this.fitted === HudFit.COMPACT ? formatCompact(shown) : formatAmount(shown);
    // The corner draws the cap as the fill bar alone; the figure is in the
    // tooltip and the tap bubble.
    const showCap =
      !this.corner &&
      readout.cap !== undefined &&
      (this.fitted === HudFit.FULL || this.fitted === HudFit.NO_BRAND);
    readout.capText.textContent = showCap ? ` / ${formatAmount(readout.cap)}` : "";
    const state = capState(shown, readout.cap);
    readout.bar.hidden = state === null;
    readout.fill.style.width = state === null ? "" : `${+(state.fraction * 100).toFixed(2)}%`;
    readout.button.classList.toggle("hud__resource-button--full", state?.full === true);
  }

  /** The amount a readout counts toward: the pool less what is still flying. */
  private target(readout: Readout): number | undefined {
    return readout.amount === undefined ? undefined : Math.max(0, readout.amount - readout.held);
  }

  /** Starts a readout counting from `from`, what it shows, to its target over {@link COUNT_MS}. */
  private countTo(readout: Readout, from: number): void {
    const to = this.target(readout);
    if (to === undefined || from === to) return;
    readout.count = { from, to, start: performance.now() };
    readout.shown = from;
    if (!this.frame) this.frame = window.requestAnimationFrame(this.step);
  }

  private readonly step = (now: number): void => {
    this.frame = 0;
    let counting = false;
    let finished = false;
    for (const readout of this.readouts.values()) {
      const count = readout.count;
      if (!count) continue;
      const progress = (now - count.start) / COUNT_MS;
      if (progress >= 1) {
        readout.count = null;
        readout.shown = null;
        finished = true;
      } else {
        readout.shown = Math.round(count.from + (count.to - count.from) * Math.max(0, progress));
        counting = true;
      }
      this.render(readout);
    }
    if (counting) this.frame = window.requestAnimationFrame(this.step);
    // A longer number may no longer fit; measured once a count settles, not every frame.
    if (finished) this.fit();
  };

  /** Takes a readout's change float off the page. */
  private dropFloat(key: ResourceKey): void {
    for (const float of this.floats) {
      if (float.dataset["resource"] !== key) continue;
      float.remove();
      this.floats.delete(float);
    }
  }

  /* ── The own yard: caps, workers, job notices ──────────────────────── */

  private onYardChange(change: YardChange): void {
    if (change.reason === YardChangeReason.AWAY) {
      this.jobNotices?.showAway(change.completed);
      return;
    }
    this.damageBanner?.refresh();
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
    const shiny = this.readouts.get("shiny");
    if (shiny) this.label(shiny);
    this.accountMenu?.setLevel(store?.playerLevel ?? null);

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
    this.workersName.hidden = this.corner || level !== HudFit.FULL;
  }

  private readonly onResize = (): void => this.fit();

  private label(readout: Readout): void {
    const text = exactLabel(readout.key, readout.amount, readout.cap);
    if (readout.key === "shiny" && this.shopOpener()) {
      readout.button.title = `${text}\nOpen the Shop`;
      readout.button.setAttribute("aria-label", `${text}. Open the Shop`);
      return;
    }
    const full = capState(readout.amount, readout.cap)?.full === true;
    readout.button.title = full ? `${text}\n${FULL_NOTE}` : text;
    readout.button.setAttribute("aria-label", full ? `${text}. ${FULL_NOTE}` : text);
  }

  /** The own yard's Shop door, or null where there is no Shop (the map, an attack, a visit). */
  private shopOpener(): (() => void) | null {
    const scene = this.yardBinding?.scene;
    return scene?.openShop ? () => scene.openShop?.() : null;
  }

  /**
   * The difference, drifting away from the readout and fading. It is fixed on
   * the page rather than inside the bar: the list scrolls sideways on a narrow
   * screen and would clip it, and on the attack screen the strip under the bar
   * would cover it. The stylesheet does the motion and turns it into a plain
   * fade under `prefers-reduced-motion`.
   */
  private float(readout: Readout, delta: number): void {
    this.dropFloat(readout.key);
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
