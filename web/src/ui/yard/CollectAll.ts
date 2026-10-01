import { tutTarget, TutTarget } from "@/game/guide/targets";
import type { BaseLoadResponse, ResourceCaps, Resources } from "@/api/types";
import { bankActions, BankKey, type BankActions, type BankReport } from "@/api/yardBank";
import {
  harvesterNow,
  harvestWaiting,
  predictBank,
  type HarvestKey,
  type HarvestWaiting,
} from "@/game/yard/harvest";
import type { YardActionResult, YardUiBinding } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { formatAmount, formatCompact } from "@/ui/format";
import { icon } from "@/ui/icons";
import { RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";

/**
 * The yard's Collect all button (`docs/design/yard-buildings.md` §5.1,
 * decision D12), drawn as the round harvest bubble of the HUD redesign
 * (#171, option B): the total waiting in every harvester Collect all would
 * bank in the middle, and a ring around it that fills as the harvesters fill.
 * One press banks them all in one request.
 *
 * It has three looks (`CollectRing.state`): **ready**, something to collect;
 * **full**, something to collect but a silo it would go to is full, so the
 * ring turns amber and the bank would leave that in the harvesters; and
 * **empty**, nothing to collect, a small ring with no number that cannot be
 * pressed. Going from empty to ready it wobbles once. Off the own yard (no
 * binding) it is hidden, and an outpost never binds it: it banks by itself.
 *
 * The buffers grow between server answers, so the total is re-read from the
 * store's prediction (`harvest.ts`) once a second while bound, as well as on
 * every store change the dock passes on. The press runs through the store's
 * queue (`bankActions`), so the answer is merged like any yard action's and the
 * HUD's readouts float what arrived; the notice says what was collected and
 * what stayed in the harvesters because storage was full.
 */

/** How often the waiting total is re-read while bound. */
const TICK_MS = 1_000;

/** The notice key both the button and a tap on a harvester use, so one replaces the other. */
export const BANK_NOTICE = "yard-bank";

/** "Collect all · 12.4K". */
export const collectAllLabel = (total: number): string => `Collect all · ${formatCompact(total)}`;

/** The tooltip: every resource waiting, in full. */
export const collectAllTitle = (amounts: Readonly<Record<HarvestKey, number>>): string =>
  [
    "Collect everything your harvesters hold:",
    ...(Object.keys(amounts) as HarvestKey[])
      .filter((key) => amounts[key] > 0)
      .map((key) => `${RESOURCE_NAMES[key]} ${formatAmount(amounts[key])}`),
  ].join("\n");

/** What the tooltip adds while a silo the bank would fill is full. */
export const COLLECT_FULL_NOTE =
  "Storage is full: what does not fit stays in your harvesters. Build or upgrade Storage Silos.";

/** What the empty bubble says. */
export const COLLECT_EMPTY_LABEL =
  "Collect all: nothing to collect yet. The ring fills as your harvesters do.";

const KEYS: readonly HarvestKey[] = ["r1", "r2", "r3", "r4"];

/** The bubble's three looks. */
export const CollectState = {
  /** Nothing to collect: a small ring, no number, not pressable. */
  EMPTY: "empty",
  /** Something to collect. */
  READY: "ready",
  /** Something to collect, and a silo it would go to is full: amber. */
  FULL: "full",
} as const;
export type CollectState = (typeof CollectState)[keyof typeof CollectState];

/** What the bubble shows. */
export interface CollectRing extends HarvestWaiting {
  /**
   * 0 to 1: what the harvesters hold of what they can hold, over every
   * harvester that could be banked now (built, no countdown). The ring's fill.
   */
  readonly fraction: number;
  readonly state: CollectState;
}

/**
 * The bubble's figures from the save: the total and amounts Collect all would
 * bank, the ring's fill, and whether a silo it would fill is full (the HUD's
 * rule, `capState`: at the cap is full).
 */
export const collectRing = (
  save: Pick<
    BaseLoadResponse,
    "savetime" | "currenttime" | "buildingdata" | "buildinghealthdata" | "storedata"
  >,
  now: number,
  resources?: Partial<Resources>,
  caps?: ResourceCaps | null,
): CollectRing => {
  const waiting = harvestWaiting(save, now);
  let held = 0;
  let room = 0;
  for (const building of Object.values(save.buildingdata ?? {})) {
    const one = building && harvesterNow(building, save, now);
    if (!one?.bankable || one.capacity <= 0) continue;
    held += one.offer;
    room += one.capacity;
  }
  const fraction = room > 0 ? Math.min(1, Math.max(0, held / room)) : 0;
  const full = KEYS.some((key) => {
    const cap = caps?.[key];
    const amount = Number(resources?.[key]);
    return waiting.amounts[key] > 0 && cap !== undefined && cap > 0 && Math.floor(amount) >= cap;
  });
  const state =
    waiting.total <= 0 ? CollectState.EMPTY : full ? CollectState.FULL : CollectState.READY;
  return { ...waiting, fraction, state };
};

/** "icon 720 icon 300": the non-zero amounts of a report field, or null for none. */
const amountsNode = (amounts: Readonly<Record<HarvestKey, number>>): Node | null => {
  const shown = KEYS.filter((key) => amounts[key] > 0);
  if (shown.length === 0) return null;
  const span = document.createElement("span");
  shown.forEach((key, index) => {
    if (index > 0) span.append(" ");
    span.append(resourceAmount(key, amounts[key]));
  });
  return span;
};

/**
 * Says how a bank came out in the yard's notice dock: what was collected, and
 * what stayed in the harvesters because the pool was full. A local "nothing to
 * collect" says nothing: the bubble was about to empty anyway.
 */
export const showBankResult = (notices: Notices, result: YardActionResult<BankReport>): void => {
  if (!result.ok) {
    if (result.refusal.local && result.refusal.reason === "empty") return;
    notices.show(BANK_NOTICE, result.refusal.message, { level: "error", timeoutMs: 6_000 });
    return;
  }
  const { banked, leftInBuffers } = result.report;
  const got = amountsNode(banked);
  const kept = amountsNode(leftInBuffers);
  const message = document.createElement("span");
  if (got) message.append("Collected ", got, ".");
  if (kept) {
    if (got) message.append(" ");
    message.append(
      kept,
      " stayed in your harvesters: storage is full. Build or upgrade Storage Silos.",
    );
  }
  if (!got && !kept) return;
  notices.show(BANK_NOTICE, message, { level: kept ? "warning" : "info", timeoutMs: kept ? 8_000 : 4_000 });
};

export class CollectAll {
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly icons: HTMLElement;
  private readonly amount: HTMLElement;
  private binding: YardUiBinding | null = null;
  private actions: BankActions | null = null;
  private timer: number | undefined;
  /** The look last drawn, so a change from empty to ready wobbles once. */
  private drawn: CollectState | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "yard-collect";
    this.element.hidden = true;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "yard-collect__button";
    tutTarget(this.button, TutTarget.COLLECT_ALL);
    const ring = document.createElement("span");
    ring.className = "yard-collect__ring";
    const core = document.createElement("span");
    core.className = "yard-collect__core";
    // An arrow into a tray, in the dock's own line style (#198): it says
    // "collect" at a glance, where the four resource icons it replaces read
    // as a heap of stuff. The amount under it and the button's name are unchanged.
    this.icons = document.createElement("span");
    this.icons.className = "yard-collect__icons";
    this.icons.setAttribute("aria-hidden", "true");
    this.icons.append(icon("collect", 26, "yard-collect__glyph"));
    this.amount = document.createElement("span");
    this.amount.className = "yard-collect__amount";
    core.append(this.icons, this.amount);
    ring.append(core);
    const label = document.createElement("span");
    label.className = "yard-collect__label";
    label.textContent = "Collect all";
    this.button.append(ring, label);
    this.button.addEventListener("click", () => void this.collect());
    this.element.addEventListener("animationend", () =>
      this.element.classList.remove("yard-collect--wobble"),
    );
    this.element.append(this.button);
  }

  /** The look on show, or null while hidden. */
  get state(): CollectState | null {
    return this.element.hidden ? null : this.drawn;
  }

  /**
   * The own yard's binding, or null to hide the button and stop its clock.
   * The owner (the dock) calls {@link refresh} on every store change it hears.
   */
  bind(binding: YardUiBinding | null): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.binding = binding;
    this.drawn = null;
    this.actions = binding ? bankActions(binding.store) : null;
    if (binding) this.timer = window.setInterval(() => this.refresh(), TICK_MS);
    this.refresh();
  }

  /** Re-reads the waiting total and redraws the bubble. */
  refresh(): void {
    const store = this.binding?.store;
    this.element.hidden = !store;
    if (!store) return;

    const ring = collectRing(store.save, store.now(), store.resources, store.caps);
    const before = this.drawn;
    this.drawn = ring.state;
    this.element.dataset["state"] = ring.state;
    this.element.style.setProperty("--collect-fill", `${+(ring.fraction * 100).toFixed(2)}%`);
    if (before === CollectState.EMPTY && ring.state !== CollectState.EMPTY) {
      this.element.classList.add("yard-collect--wobble");
    }

    if (ring.state === CollectState.EMPTY) {
      this.amount.textContent = "";
      this.icons.hidden = true;
      this.button.title = COLLECT_EMPTY_LABEL;
      this.button.setAttribute("aria-label", COLLECT_EMPTY_LABEL);
      this.button.disabled = true;
      return;
    }

    this.icons.hidden = false;
    this.amount.textContent = formatCompact(ring.total);
    const full = ring.state === CollectState.FULL;
    this.button.title = collectAllTitle(ring.amounts) + (full ? `\n${COLLECT_FULL_NOTE}` : "");
    this.button.setAttribute(
      "aria-label",
      `Collect all: ${formatAmount(ring.total)} waiting in your harvesters.` +
        (full ? ` ${COLLECT_FULL_NOTE}` : ""),
    );
    this.button.disabled = store.isRunning(BankKey.ALL);
  }

  destroy(): void {
    this.bind(null);
    this.element.remove();
  }

  private async collect(): Promise<void> {
    const binding = this.binding;
    const actions = this.actions;
    if (!binding || !actions) return;
    this.button.disabled = true;
    // The balls leave now; the answer only corrects the totals (#208).
    const store = binding.store;
    const answer =
      binding.scene.startBank?.(
        predictBank(store.save, store.now(), "all", store.resources, store.caps),
      ) ?? null;
    const result = await actions.all();
    answer?.(result.ok ? { banked: result.report.banked } : null);
    if (this.binding === binding) {
      showBankResult(binding.notices, result);
      this.refresh();
    }
  }
}
