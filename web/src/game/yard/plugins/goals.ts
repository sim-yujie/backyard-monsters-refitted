import { goalsActions, type GoalsActions, type GoalView } from "@/api/goals";
import { prefersReducedMotion } from "@/game/attack/AttackBattleLayer";
import { guideBus, GuideScreen } from "@/game/guide/guideBus";
import { startBank, type AnswerBank, type BankShowFx, type BankShowHud } from "@/game/yard/bankShow";
import type { HarvestKey } from "@/game/yard/harvest";
import { claimFigure, REWARD_KEYS, type ClaimFigure } from "@/ui/goals/claimFigure";
import { goalsArt } from "@/ui/goals/goalsArt";
import { GoalsPanel, monstersText, type GoalsPanelView } from "@/ui/goals/GoalsPanel";
import { dockButton } from "@/ui/yard/YardDock";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the new-player tutorial's Goals package (a)
 * (`docs/design/tutorial.md` §6.3, issue #227): the Goals button on the dock
 * with its badge, the Goals panel, and Claim with the Collect all balls.
 *
 * - **Badge.** The count of goals ready to claim, `onboarding.goalsReady`,
 *   which every yard answer and the load carry; it follows the store.
 * - **First read.** On mount it asks `goals/state` once, so a save from
 *   before Goals gets its baseline (decision Q1) the first time the yard
 *   opens, and goals met since the last visit are marked done.
 * - **Claim.** The button says what will arrive after the storage cap
 *   (`claimFigure`, Q2). On the press the reward's balls fly from under the
 *   Goals button to the Town Hall and the HUD counts up across their flight,
 *   as Collect all's do (`bankShow.ts`); the server's answer corrects the
 *   totals, and a refusal takes the balls back. Monster rewards show a notice
 *   (the guided start's walk-in will play for them once it lands).
 * - **Guide.** Opening the panel emits `screen` ("goals") and closing it
 *   `screenClosed`, for the guided start's last step and the tips.
 *
 * Main yard only: an outpost has no Goals (the routes refuse there).
 */

/** The notice key for claim results. */
const GOALS_NOTICE = "goals";

/** Where the Goals button sits, as a world point for the balls to leave from. */
const buttonWorldPoint = (mounts: YardMounts, button: HTMLElement): { x: number; y: number } | null => {
  const rect = button.getBoundingClientRect();
  const canvas = mounts.canvas.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return mounts.camera.screenToWorld({
    x: rect.left + rect.width / 2 - canvas.left,
    y: rect.top - canvas.top,
  });
};

/**
 * Starts the balls of a claim: `credited` is what the claim will pay. Null
 * when nothing flies (no Town Hall drawn, nothing to pay, reduced motion).
 */
export const startGrant = (
  credited: Readonly<Partial<Record<HarvestKey, number>>>,
  from: { x: number; y: number } | null,
  fx: Pick<YardMounts["renderer"], "throwGrant" | "cancelBank">,
  hud: BankShowHud,
): AnswerBank | null => {
  if (!from) return null;
  const amounts: Partial<Record<HarvestKey, number>> = {};
  for (const key of REWARD_KEYS) {
    const amount = credited[key] ?? 0;
    if (amount > 0) amounts[key] = amount;
  }
  // `startBank` drives the HUD; the balls come from one point rather than from harvesters.
  const grantFx: BankShowFx = {
    throwBank: (_predicted, onLand) => fx.throwGrant(amounts, from, onLand),
    cancelBank: (group) => fx.cancelBank(group),
  };
  return startBank({}, grantFx, hud);
};

/** The Goals button, its badge and its panel on one yard. */
export class GoalsDoor {
  readonly button: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly mounts: YardMounts;
  private readonly actions: GoalsActions;
  private panel: GoalsPanel | null = null;
  private goals: readonly GoalView[] | null = null;
  private claiming: string | null = null;
  private refusal: { id: string; message: string } | null = null;
  private loadFailed: string | null = null;
  private readonly unsubscribe: () => void;
  private destroyed = false;

  constructor(mounts: YardMounts, actions: GoalsActions = goalsActions(mounts.store)) {
    this.mounts = mounts;
    this.actions = actions;
    const { element, disc } = dockButton("goals", "Goals", goalsArt(29), () => this.toggle());
    this.button = element;
    this.badge = document.createElement("span");
    this.badge.className = "yard-dock__badge goals-badge";
    this.badge.hidden = true;
    disc.append(this.badge);
    mounts.dock.placeBesideMonsters(element);
    this.unsubscribe = mounts.store.subscribe(() => this.onStore());
    this.refreshBadge();
  }

  /** Goals ready to claim, from the latest answer. */
  get ready(): number {
    const count = Number(this.mounts.store.save.onboarding?.goalsReady);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  /** Reads the list (and so applies the baseline on a first read). */
  async load(): Promise<void> {
    const result = await this.actions.state();
    if (this.destroyed) return;
    if (result.ok) {
      this.goals = result.report.goals;
      this.loadFailed = null;
    } else {
      this.loadFailed = result.refusal.message;
    }
    this.render();
  }

  toggle(): void {
    if (this.panel) {
      this.panel.close();
      return;
    }
    this.panel = new GoalsPanel({
      onClaim: (goal) => void this.claim(goal),
      onRetry: () => void this.reload(),
      onClose: () => {
        this.panel = null;
        this.refusal = null;
        guideBus.emit("screenClosed", { id: GuideScreen.GOALS });
      },
    }).mount(this.mounts.overlay.content);
    this.render();
    // The guided start waits for the panel (step 17); the tips can attach to it.
    guideBus.emit("screen", { id: GuideScreen.GOALS, root: this.panel.element, header: this.panel.header });
    void this.reload();
  }

  private async reload(): Promise<void> {
    if (!this.goals) this.panel?.render({ kind: "loading" });
    await this.load();
  }

  /** What each ready goal's claim pays now. */
  private figures(): Map<string, ClaimFigure> {
    const { resources, caps } = this.mounts.store;
    const figures = new Map<string, ClaimFigure>();
    for (const goal of this.goals ?? []) {
      if (goal.status === "ready") figures.set(goal.id, claimFigure(goal.reward, resources, caps));
    }
    return figures;
  }

  private view(): GoalsPanelView {
    if (this.goals) {
      return {
        kind: "list",
        goals: this.goals,
        figures: this.figures(),
        claiming: this.claiming,
        refusal: this.refusal,
      };
    }
    if (this.loadFailed) return { kind: "error", message: this.loadFailed };
    return { kind: "loading" };
  }

  private render(): void {
    this.panel?.render(this.view());
  }

  private onStore(): void {
    this.refreshBadge();
    // The pool moved: the Claim buttons' figures follow it.
    if (this.panel && this.goals && this.claiming === null) this.render();
  }

  private refreshBadge(): void {
    const count = this.ready;
    this.badge.hidden = count === 0;
    this.badge.textContent = count > 99 ? "99+" : String(count);
    const words = count === 1 ? "1 goal ready to claim" : `${count} goals ready to claim`;
    this.button.setAttribute("aria-label", count > 0 ? `Goals. ${words}` : "Goals");
    this.button.title = count > 0 ? `Goals: ${words}` : "Goals: what to do next, and the rewards";
  }

  private async claim(goal: GoalView): Promise<void> {
    if (this.claiming !== null) return;
    const { store, hud, notices } = this.mounts;
    const figure = claimFigure(goal.reward, store.resources, store.caps);
    this.claiming = goal.id;
    this.refusal = null;
    this.render();

    const answer = prefersReducedMotion()
      ? null
      : startGrant(figure.credited, buttonWorldPoint(this.mounts, this.button), this.mounts.renderer, hud);
    const result = await this.actions.claim(goal.id);
    answer?.(result.ok ? { banked: result.report.credited } : null);
    if (this.destroyed) return;
    this.claiming = null;

    if (result.ok) {
      const { monsters } = result.report;
      if (monsters && goal.monsters) {
        notices.show(GOALS_NOTICE, `${monstersText(monsters.count, goal.monsters.name)} moved into Housing.`, {
          level: "info",
          timeoutMs: 5_000,
        });
      }
      // The claimed goal leaves the list now; the next read reveals what its claim opened.
      this.goals = (this.goals ?? []).map((one) => (one.id === goal.id ? { ...one, status: "claimed" } : one));
    } else {
      this.refusal = { id: goal.id, message: result.refusal.message };
    }
    this.render();
    await this.load();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribe();
    this.panel?.close();
    this.button.remove();
  }
}

export const goalsPlugin: YardPlugin = (mounts) => {
  if (mounts.store.kind !== "main") return;
  const door = new GoalsDoor(mounts);
  void door.load();
  return () => door.destroy();
};

YARD_PLUGINS.push(goalsPlugin);
