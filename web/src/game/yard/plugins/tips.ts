import { markTipsSeen } from "@/api/tips";
import { GuideScreen } from "@/game/guide/guideBus";
import { TipRunner, type TipView } from "@/game/guide/TipRunner";
import { GuideOverlay } from "@/ui/guide/GuideOverlay";
import { hasLocalPlannerHint, setPlannerHintRemote } from "@/ui/yard/PlannerHelp";
import { YARD_PLUGINS } from "../yardPlugins";

/**
 * Own-yard plugin for the new-player tutorial's screen tips package (c): Bob's one-time tips
 * and the "?" buttons (`docs/design/tutorial.md` §7).
 * Issue #227.
 *
 * The tips themselves run app-wide (`TipRunner`): the map rooms and the
 * attack say they opened after the yard has closed, so the runner is made
 * once, here, when the yard first loads this module, and lives as long as the
 * page. The yard plugin only keeps it told: the account's `onboarding` (the
 * own yard's store has the latest; the runner keeps it after the yard
 * closes), the Yard Planner (no tips over it), and the planner help card's
 * "seen" flag, which moves to the server here.
 */

/** The overlay's guide layer, above the modals (`ui/overlay.ts`). */
const guideLayer = (): HTMLElement | null => document.querySelector<HTMLElement>(".overlay__layer--guide");

/**
 * Bob's kit on the guide layer. A new scene clears the layer under it; the
 * runner reads that from `attached` and lets go.
 */
const createView = (): TipView | null => {
  const layer = guideLayer();
  if (!layer) return null;
  const before = new Set(layer.children);
  const overlay = new GuideOverlay(layer);
  const parts = [...layer.children].filter((child) => !before.has(child));
  return {
    show: (step) => overlay.show(step),
    hide: () => overlay.hide(),
    destroy: () => overlay.destroy(),
    get attached() {
      return parts.every((part) => part.isConnected);
    },
  };
};

/** A touch screen, as the planner tells it (#45): the tips say "tap". */
const touch = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;

const runner = new TipRunner({ send: markTipsSeen, createView, touch });

YARD_PLUGINS.push(({ store, scene }) => {
  const sync = (): void => runner.setOnboarding(store.save.onboarding ?? null);
  sync();
  const unsubscribe = store.subscribe(sync);
  runner.setBlocked(() => scene.plannerOpen());

  setPlannerHintRemote({
    seen: () => runner.isSeen(GuideScreen.PLANNER),
    mark: () => runner.markSeen(GuideScreen.PLANNER),
  });
  // The planner card's old local flag moves to the account.
  if (store.save.onboarding && hasLocalPlannerHint() && !runner.isSeen(GuideScreen.PLANNER)) {
    runner.markSeen(GuideScreen.PLANNER);
  }

  return () => {
    unsubscribe();
    runner.setBlocked(null);
    setPlannerHintRemote(null);
  };
});
