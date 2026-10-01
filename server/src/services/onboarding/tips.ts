import z from "zod";
import { defineYardAction } from "../../controllers/yard/yardAction.js";
import { updateOnboarding, type Onboarding, type OnboardingSave } from "./state.js";

/**
 * The new-player tutorial's screen tips (`docs/design/tutorial.md` §7, issue
 * #227): which screens have tips, and the `tips/seen` yard action.
 *
 * Tips grant nothing (anti-cheat rule 10, §8.4), so the server only checks
 * that a screen id is one it knows and remembers when its tips were seen, so
 * "seen" carries across devices. The client shows the tips and decides when a
 * screen counts as seen. The route itself is listed in
 * `controllers/yard/tips.ts`; the action lives here so its tests never load
 * the Koa binding.
 */

/**
 * Every screen that has tips, plus the Yard Planner, whose own help card
 * keeps its "seen" flag here (§7.1). Kept equal to the web client's
 * `GuideScreen` (`web/src/game/guide/guideBus.ts`).
 */
export const TIP_SCREENS = [
  "yard",
  "build",
  "building",
  "repair",
  "mail",
  "monsters-unlock",
  "monsters-hatch",
  "monsters-housing",
  "monsters-train",
  "monsters-lab",
  "shop",
  "planner",
  "mr1",
  "mr2",
  "attack",
  "baiter",
  "champion",
  "outposts",
  "goals",
] as const;

export type TipScreen = (typeof TIP_SCREENS)[number];

/**
 * Marks a screen's tips seen at `now`. A screen already seen keeps its first
 * time, so a replay or a second device changes nothing.
 *
 * @returns The new record, for a `slices: { onboarding }` outcome, and
 *   whether it changed.
 */
export const markTipsSeen = (
  save: OnboardingSave,
  screen: TipScreen,
  now: number
): { onboarding: Onboarding; changed: boolean } => {
  let changed = false;
  const onboarding = updateOnboarding(save, (record) => {
    if (record.tips[screen] !== undefined) return;
    record.tips[screen] = now;
    changed = true;
  });
  return { onboarding, changed };
};

/** `POST /bm/yard/tips/seen` body: the screen whose tips were seen. */
export const YardTipsSeenSchema = z.object({ screen: z.enum(TIP_SCREENS) });

/** `report` of `tips/seen`: the screen, and whether this request was the first to mark it. */
export interface TipsSeenReport {
  screen: TipScreen;
  changed: boolean;
}

/**
 * `POST /bm/yard/tips/seen` — remembers that a screen's tips were seen or
 * skipped (§7.1), in the main yard's `onboarding.tips`. Refusals: 400
 * `badRequest` for an unknown screen; 409 `notInOutpost` with a `baseid` (the
 * record lives on the main yard only, and the client never sends one).
 */
export const yardTipsSeenAction = defineYardAction({
  schema: YardTipsSeenSchema,
  run: ({ save, body, now }) => {
    const { onboarding, changed } = markTipsSeen(save, body.screen, now);
    const report: TipsSeenReport = { screen: body.screen, changed };
    return changed ? { report, slices: { onboarding } } : { report };
  },
});
