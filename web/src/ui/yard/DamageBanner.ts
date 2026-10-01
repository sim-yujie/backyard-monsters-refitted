import { tutTarget, TutTarget } from "@/game/guide/targets";
import { repairActions, type RepairActions } from "@/api/yardRepair";
import { unrepairedCount } from "@/game/yard/repair";
import type { YardUiBinding } from "@/game/yard/YardStore";

/**
 * The post-attack banner (`docs/design/yard-buildings.md` §5.5): one line in
 * the yard's notice dock, "Your yard was attacked: 14 buildings damaged
 * [Repair all]", in place of the original's popup (`client/scripts/BASE.as:2050-2106`).
 *
 * It counts what the original's popup counted, buildings below full health
 * that are not being repaired, and appears when the own yard opens with any,
 * or when the count rises from none (an answer that shows new damage). Its
 * count follows the store while it is up; it goes by itself once nothing is
 * waiting for a repair, and a dismissed banner stays dismissed until the yard
 * has none again. **Repair all** is one request (`POST /bm/yard/repair`
 * `all=1`): free, no worker, and the buildings heal over at most an hour.
 */

/** The notice key, so the banner is always one line. */
export const DAMAGE_NOTICE = "yard-damage";

/** "Your yard was attacked: 14 buildings damaged". */
export const damageBannerText = (count: number): string =>
  `Your yard was attacked: ${count} ${count === 1 ? "building" : "buildings"} damaged`;

export class DamageBanner {
  private readonly binding: YardUiBinding;
  private readonly actions: RepairActions;
  private readonly text: HTMLElement;
  private count = 0;
  /** Shown and not yet taken down by this class: a missing text node then means the player dismissed it. */
  private shown = false;

  constructor(binding: YardUiBinding, actions: RepairActions = repairActions(binding.store)) {
    this.binding = binding;
    this.actions = actions;
    this.text = document.createElement("span");
    this.text.className = "damage-banner";
    this.refresh();
  }

  /** Re-counts and shows, updates or takes the banner down. The owner (the HUD) calls it on every store change. */
  refresh(): void {
    const store = this.binding.store;
    const before = this.count;
    this.count = unrepairedCount(store.save, store.now());

    if (this.count === 0) {
      this.hide();
      return;
    }
    // Dismissed by the player: stays down until the yard has no damage again.
    if (this.shown && !this.text.isConnected) return;
    if (!this.shown && before > 0) return;

    this.text.textContent = damageBannerText(this.count);
    this.binding.notices.show(DAMAGE_NOTICE, this.text, {
      level: "warning",
      actionLabel: "Repair all",
      onAction: () => void this.repairAll(),
    });
    // Repair all is the notice's own action button (`Notices`), the one that is not Dismiss.
    const repairAll = this.text.closest(".notice")?.querySelector<HTMLElement>("button:not(.btn--icon)");
    if (repairAll) tutTarget(repairAll, TutTarget.REPAIR_ALL);
    this.shown = true;
  }

  destroy(): void {
    this.hide();
  }

  private hide(): void {
    if (this.shown) this.binding.notices.clear(DAMAGE_NOTICE);
    this.shown = false;
  }

  private async repairAll(): Promise<void> {
    const result = await this.actions.all();
    if (result.ok) {
      const started = result.report.started.length;
      this.binding.notices.show(
        DAMAGE_NOTICE,
        `Repairing ${started} ${started === 1 ? "building" : "buildings"}. They are back to full health within the hour.`,
        { level: "info", timeoutMs: 6_000 },
      );
      // The notice under the key is now the confirmation, not the banner.
      this.shown = false;
      return;
    }
    if (result.refusal.local && result.refusal.reason === "notDamaged") {
      this.hide();
      return;
    }
    this.binding.notices.show(DAMAGE_NOTICE, result.refusal.message, {
      level: "error",
      timeoutMs: 6_000,
    });
    this.shown = false;
  }
}
