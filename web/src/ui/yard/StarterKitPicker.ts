import {
  STARTER_KIT_KEY,
  starterKitActions,
  type KitPayment,
  type StarterKitActions,
  type StarterKitReport,
} from "@/api/yardStarterKit";
import type { YardActionResult, YardUiBinding } from "@/game/yard/YardStore";
import { typeName } from "@/game/yard/planner/summary";
import {
  kitOffer,
  kitReplacesBuildings,
  STARTER_KIT_SUMMARIES,
  type KitOffer,
  type StarterKitSummary,
} from "@/game/yard/starterKits";
import { formatAmount, formatCompact } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { costAmounts, resourceAmount, RESOURCE_NAMES } from "@/ui/resourceIcon";
import "@/ui/styles/starter-kits.css";

/**
 * The outpost Starter Kit picker (outposts WP9, issue #188): Flash's
 * `popup_prefab` (`client/scripts/popup_prefab.as`) in the revamp's style.
 *
 * Three cards, Regular, Mega and Ultra, each with its thumbnail
 * (`ui/prefab-2..4.v5.jpg`, `:23`), what it builds, its price in twigs,
 * pebbles and putty, **Use Resources** and **Use N Shiny** (`:26-32`).
 *
 * A press never spends at once: it opens one confirmation under the cards,
 * which says what will happen and is the only place money moves.
 * - A yard holding more than its core is warned first that the kit replaces
 *   every building (`kit_warning`, `:99-112`, `:133-145`).
 * - With resources and a short pool, it offers the Shiny top-up in Flash's
 *   words (`Select`, `:173-176`), or says there is not enough Shiny.
 * - With resources otherwise, the buildings build up over time without the
 *   worker (`newmap_sk_hlp`); with Shiny they are finished at once.
 *
 * The request goes through the store's queue (`starterKitActions`), whose
 * answer redraws the yard; the picker closes on success and reports through
 * `onBought`.
 */

export interface StarterKitPickerOptions {
  /** The own outpost. */
  readonly binding: YardUiBinding;
  /** After a kit was bought, with the server's report. */
  readonly onBought?: (report: StarterKitReport, kit: StarterKitSummary) => void;
  /** After the picker closes, bought or not. */
  readonly onClose?: () => void;
  /** Stand-in calls, under test. */
  readonly actions?: StarterKitActions;
}

/** Flash's help line for the kits (`newmap_sk_hlp`). */
export const KITS_HELP =
  "Don't wait to level up: get a jump on the competition with an Outpost Starter Kit! Starter Kits still take time to build, but they don't need a worker.";

/** `kit_warning`, in the revamp's words. */
export const KIT_WARNING =
  "A Starter Kit replaces every building on this outpost except its core. Buildings you have here now are removed without a refund.";

/** "4× Sniper Tower L6": one line of a card's list, same types merged. */
export const contentLines = (kit: Pick<StarterKitSummary, "contents">): string[] => {
  const byType = new Map<number, { count: number; levels: number[] }>();
  for (const [type, level, count] of kit.contents) {
    const entry = byType.get(type) ?? { count: 0, levels: [] };
    entry.count += count;
    if (!entry.levels.includes(level)) entry.levels.push(level);
    byType.set(type, entry);
  }
  return [...byType.entries()].map(([type, { count, levels }]) => {
    const low = Math.min(...levels);
    const high = Math.max(...levels);
    const level = low === high ? `L${low}` : `L${low}-${high}`;
    return `${count}× ${typeName(type)} ${level}`;
  });
};

/** "1,000,000 Twigs and 500,000 Putty": what a short pool misses, in words. */
export const shortfallText = (shortfall: KitOffer["shortfall"]): string => {
  const parts = (["r1", "r2", "r3"] as const)
    .filter((key) => shortfall[key] > 0)
    .map((key) => `${formatAmount(shortfall[key])} ${RESOURCE_NAMES[key]}`);
  return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};

interface Pending {
  readonly kit: StarterKitSummary;
  readonly pay: KitPayment;
}

export class StarterKitPicker {
  private readonly binding: YardUiBinding;
  private readonly options: StarterKitPickerOptions;
  private readonly actions: StarterKitActions;
  private readonly popup: Popup;
  private readonly cards: HTMLElement;
  private readonly confirm: HTMLElement;
  private readonly status: HTMLElement;
  private readonly unsubscribe: () => void;
  private pending: Pending | null = null;
  private sending = false;
  private closed = false;

  constructor(options: StarterKitPickerOptions) {
    this.options = options;
    this.binding = options.binding;
    this.actions = options.actions ?? starterKitActions(options.binding.store);

    this.popup = new Popup({
      title: "Outpost Starter Kits",
      className: "kit-picker",
      onClose: () => this.onClosed(),
    });

    const help = document.createElement("p");
    help.className = "kit-picker__help";
    help.textContent = KITS_HELP;

    this.cards = document.createElement("div");
    this.cards.className = "kit-picker__cards";
    this.cards.setAttribute("role", "list");

    this.confirm = document.createElement("section");
    this.confirm.className = "kit-picker__confirm";
    this.confirm.setAttribute("aria-live", "polite");
    this.confirm.hidden = true;

    this.status = document.createElement("p");
    this.status.className = "kit-picker__status";
    this.status.setAttribute("role", "status");

    this.popup.setContent(help, this.cards, this.confirm, this.status);
    this.unsubscribe = this.binding.store.subscribe(() => this.render());
    this.render();
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  mount(modal: HTMLElement): this {
    this.popup.mount(modal);
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** Opens the confirmation for a kit and a payment, as a card's button does. */
  choose(kitId: number, pay: KitPayment): void {
    const kit = STARTER_KIT_SUMMARIES.find((one) => one.id === kitId);
    if (!kit || this.sending) return;
    this.pending = { kit, pay };
    this.status.textContent = "";
    this.render();
    this.confirm.querySelector<HTMLButtonElement>(".kit-picker__go:not([disabled])")?.focus();
  }

  private onClosed(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.options.onClose?.();
  }

  private offer(kit: StarterKitSummary): KitOffer {
    const store = this.binding.store;
    return kitOffer(kit, { resources: store.resources, credits: store.credits });
  }

  private render(): void {
    if (this.closed) return;
    this.cards.replaceChildren(...STARTER_KIT_SUMMARIES.map((kit) => this.card(kit)));
    this.renderConfirm();
  }

  private card(kit: StarterKitSummary): HTMLElement {
    const offer = this.offer(kit);
    const busy = this.sending || this.binding.store.isRunning(STARTER_KIT_KEY);
    const card = document.createElement("article");
    card.className = "kit-card";
    card.setAttribute("role", "listitem");
    card.dataset["kit"] = String(kit.id);
    if (this.pending?.kit.id === kit.id) card.classList.add("kit-card--chosen");

    const picture = document.createElement("img");
    picture.className = "kit-card__picture";
    picture.src = kit.thumbnail;
    picture.alt = `${kit.name}: the outpost it builds`;
    picture.decoding = "async";

    const name = document.createElement("h3");
    name.className = "kit-card__name";
    name.textContent = kit.name;

    const count = document.createElement("p");
    count.className = "kit-card__count";
    count.textContent = `${kit.buildingCount} buildings`;

    const list = document.createElement("ul");
    list.className = "kit-card__contents";
    for (const line of contentLines(kit)) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }

    const price = document.createElement("div");
    price.className = "kit-card__price";
    const amounts = costAmounts(kit.resources, formatCompact);
    if (amounts) price.append(amounts);

    const useResources = document.createElement("button");
    useResources.type = "button";
    useResources.className = "btn kit-card__resources";
    useResources.textContent = "Use Resources";
    useResources.title =
      offer.short > 0
        ? `You are short of ${shortfallText(offer.shortfall)}: ${formatAmount(offer.topUp)} Shiny makes up the difference.`
        : "Pay with twigs, pebbles and putty. The buildings build up over time without your worker.";
    useResources.disabled = busy;
    useResources.addEventListener("click", () => this.choose(kit.id, "resources"));

    const useShiny = document.createElement("button");
    useShiny.type = "button";
    useShiny.className = "btn btn--primary kit-card__shiny";
    useShiny.append("Use ", resourceAmount("shiny", formatAmount(kit.shiny)), " Shiny");
    useShiny.setAttribute("aria-label", `Use ${formatAmount(kit.shiny)} Shiny`);
    useShiny.title = offer.shinyAffordable
      ? "Every building is finished at once."
      : `You need ${formatAmount(kit.shiny - this.binding.store.credits)} more Shiny.`;
    useShiny.disabled = busy;
    useShiny.addEventListener("click", () => this.choose(kit.id, "shiny"));

    const buttons = document.createElement("div");
    buttons.className = "kit-card__buttons";
    buttons.append(useResources, useShiny);

    card.append(picture, name, count, list, price, buttons);
    return card;
  }

  /** The one confirmation: what happens, what it costs, and the button that spends. */
  private renderConfirm(): void {
    const pending = this.pending;
    this.confirm.hidden = pending === null;
    if (!pending) {
      this.confirm.replaceChildren();
      return;
    }
    const { kit, pay } = pending;
    const offer = this.offer(kit);
    const lines: HTMLElement[] = [];
    const line = (text: string | Node, className = ""): void => {
      const paragraph = document.createElement("p");
      paragraph.className = `kit-picker__line ${className}`.trim();
      paragraph.append(text);
      lines.push(paragraph);
    };

    const heading = document.createElement("h3");
    heading.className = "kit-picker__confirm-title";
    heading.textContent = `${kit.name}, paid with ${pay === "shiny" ? "Shiny" : "resources"}`;

    if (kitReplacesBuildings(this.binding.store.yard)) line(KIT_WARNING, "kit-picker__warning");

    let label: string;
    let blocked: string | null = null;
    let topUp: number | undefined;
    if (pay === "shiny") {
      line(`${formatAmount(kit.shiny)} Shiny. All ${kit.buildingCount} buildings are finished at once.`);
      label = `Use ${formatAmount(kit.shiny)} Shiny`;
      if (!offer.shinyAffordable) {
        blocked = `You need ${formatAmount(kit.shiny - this.binding.store.credits)} more Shiny.`;
      }
    } else if (offer.short > 0) {
      line(
        `You need an extra ${shortfallText(offer.shortfall)} to build this kit. You can bank resources in your main yard, or use ${formatAmount(offer.topUp)} Shiny to make up the difference.`,
      );
      line(`Your storage pays what it holds; the ${kit.buildingCount} buildings build up over time without your worker.`);
      label = `Use ${formatAmount(offer.topUp)} Shiny`;
      topUp = offer.topUp;
      if (!offer.topUpAffordable) {
        blocked = `You need ${formatAmount(offer.topUp - this.binding.store.credits)} more Shiny.`;
      }
    } else {
      const cost = document.createElement("span");
      cost.append("Costs ", costAmounts(kit.resources) ?? "", ".");
      line(cost);
      line(`The ${kit.buildingCount} buildings build up over time, without your worker.`);
      label = "Build the kit";
    }
    if (blocked) line(blocked, "kit-picker__blocked");

    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--primary kit-picker__go";
    go.textContent = this.sending ? "Building…" : label;
    go.disabled = this.sending || blocked !== null;
    go.addEventListener("click", () => void this.buy(kit, pay, topUp));

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--ghost kit-picker__back";
    back.textContent = "Back";
    back.disabled = this.sending;
    back.addEventListener("click", () => {
      this.pending = null;
      this.render();
    });

    const actions = document.createElement("div");
    actions.className = "kit-picker__actions";
    actions.append(back, go);
    this.confirm.replaceChildren(heading, ...lines, actions);
  }

  private async buy(kit: StarterKitSummary, pay: KitPayment, topUp: number | undefined): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    this.status.textContent = `Placing the ${kit.name}…`;
    this.status.classList.remove("kit-picker__status--error");
    this.render();
    const result: YardActionResult<StarterKitReport> = await this.actions.buy(kit.id, pay, topUp);
    this.sending = false;
    if (this.closed) return;
    if (!result.ok) {
      this.status.textContent = result.refusal.message;
      this.status.classList.add("kit-picker__status--error");
      this.render();
      return;
    }
    this.options.onBought?.(result.report, kit);
    this.close();
  }
}
