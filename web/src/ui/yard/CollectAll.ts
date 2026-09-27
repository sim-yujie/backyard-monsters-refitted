import { bankActions, BankKey, type BankActions, type BankReport } from "@/api/yardBank";
import { harvestWaiting, type HarvestKey } from "@/game/yard/harvest";
import type { YardActionResult, YardUiBinding } from "@/game/yard/YardStore";
import type { Notices } from "@/ui/maproom/Notices";
import { formatAmount, formatCompact } from "@/ui/format";
import { RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";

/**
 * The HUD's **Collect all · 12.4K** button (`docs/design/yard-buildings.md`
 * §5.1, decision D12): the total waiting in every harvester Collect all would
 * bank, and one press banks them all in one request. Hidden when nothing is
 * waiting, and off the own yard (no binding).
 *
 * The buffers grow between server answers, so the total is re-read from the
 * store's prediction (`harvest.ts`) once a second while bound, as well as on
 * every store change the HUD passes on. The press runs through the store's queue
 * (`bankActions`), so the answer is merged like any yard action's and the
 * HUD's readouts float what arrived; the notice says what was collected and
 * what stayed in the harvesters because storage was full.
 *
 * Its own element, beside the Workers control, so the Hud only places it.
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

const KEYS: readonly HarvestKey[] = ["r1", "r2", "r3", "r4"];

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
 * collect" says nothing: the button was about to disappear anyway.
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
  private binding: YardUiBinding | null = null;
  private actions: BankActions | null = null;
  private timer: number | undefined;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "hud__collect";
    this.element.hidden = true;
    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "hud__resource-button hud__collect-button";
    this.button.addEventListener("click", () => void this.collect());
    this.element.append(this.button);
  }

  /**
   * The own yard's binding, or null to hide the button and stop its clock.
   * The owner (the HUD) calls {@link refresh} on every store change it hears.
   */
  bind(binding: YardUiBinding | null): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
    this.binding = binding;
    this.actions = binding ? bankActions(binding.store) : null;
    if (binding) this.timer = window.setInterval(() => this.refresh(), TICK_MS);
    this.refresh();
  }

  /** Re-reads the waiting total and shows, hides or relabels the button. */
  refresh(): void {
    const store = this.binding?.store;
    if (!store) {
      this.element.hidden = true;
      return;
    }
    const waiting = harvestWaiting(store.save, store.now());
    this.element.hidden = waiting.total <= 0;
    if (waiting.total <= 0) return;
    const label = collectAllLabel(waiting.total);
    if (this.button.textContent !== label) this.button.textContent = label;
    this.button.title = collectAllTitle(waiting.amounts);
    this.button.setAttribute("aria-label", `${label}. ${collectAllTitle(waiting.amounts)}`);
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
    const result = await actions.all();
    if (this.binding === binding) {
      showBankResult(binding.notices, result);
      this.refresh();
    }
  }
}
