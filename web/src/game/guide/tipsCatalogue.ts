import { GOALS_CLAIM_TARGET } from "@/ui/goals/GoalsPanel";
import type { ArrowSide } from "@/ui/guide/GuideArrow";
import { GuideScreen } from "./guideBus";
import { TutTarget } from "./targets";

/**
 * Bob's screen tips (issue #227, `docs/design/tutorial.md` §7.2): one to three
 * short lines per screen, shown the first time the screen opens and again
 * from its "?" button (`TipRunner.ts`).
 *
 * The wording is a draft for the owner and all of it lives here. A line says
 * `{Tap}` / `{tap}` where a desktop player clicks and a phone player taps;
 * {@link tipWording} fills it in for the screen in hand, as the planner's help
 * card does for #45.
 */

/**
 * Where a tip points: a target name (`targets.ts`), or a CSS selector looked up
 * inside the screen's own element, for the few controls the foundation's sweep
 * did not tag. A list is tried in order and the first one on screen wins.
 */
export type TipTarget = string | { readonly selector: string };

export interface Tip {
  /** What Bob says. */
  readonly text: string;
  /**
   * What he points at. A tip with a target is left out when none of it is on
   * screen as the tips start; a tip with none shows without the hand.
   */
  readonly target?: TipTarget | readonly TipTarget[];
  /** Which side the hand comes from; chosen from the target's place when absent. */
  readonly side?: ArrowSide;
}

/**
 * The screens the guided start teaches (Q14): their tips show by themselves
 * only to a player who skipped it (or never had it), while their "?" works
 * for everyone.
 */
export const GUIDED_SCREENS: ReadonlySet<GuideScreen> = new Set<GuideScreen>([
  GuideScreen.YARD,
  GuideScreen.BUILD,
  GuideScreen.BUILDING,
]);

/**
 * The tips, by screen. The Yard Planner has none: its own help card is its
 * tips (`PlannerHelp.ts`), and only its "seen" flag lives with these.
 */
export const TIPS: Readonly<Partial<Record<GuideScreen, readonly Tip[]>>> = {
  [GuideScreen.YARD]: [
    {
      text: "Harvesters fill up and then stop. {Tap} Collect all to bank everything at once.",
      target: TutTarget.COLLECT_ALL,
    },
    {
      text: "Build opens every building you can add. More unlock as your Town Hall grows.",
      target: TutTarget.DOCK_BUILD,
    },
    {
      text: "Goals pay big rewards. Check them whenever you're unsure what to do next.",
      target: TutTarget.DOCK_GOALS,
    },
  ],
  [GuideScreen.BUILD]: [
    {
      text: "Build instantly spends Shiny to skip the wait. Early on it's cheap.",
      target: TutTarget.BUILD_INSTANT,
    },
    {
      text: "Greyed-out buildings say what they need, usually a bigger Town Hall.",
      target: { selector: ".build-tile--locked" },
    },
  ],
  [GuideScreen.BUILDING]: [
    {
      text: "Upgrade makes a building stronger or faster. Each job needs a free worker.",
      target: TutTarget.UPGRADE,
    },
    {
      text: "Jobs with 5 minutes or less left finish free. Longer ones cost a little Shiny.",
      target: TutTarget.FINISH,
    },
    { text: "Instant does the whole upgrade now, for Shiny.", target: TutTarget.INSTANT },
  ],
  [GuideScreen.REPAIR]: [
    {
      text: "Damaged buildings stop working. Repair them here, or use Repair all on the banner.",
      target: [TutTarget.REPAIR, TutTarget.REPAIR_ALL],
    },
  ],
  [GuideScreen.MAIL]: [
    {
      // The first thread (or "No messages yet"), pointed at from below: from
      // above, the hand would sit on New message, the next tip's control.
      text: "Attack reports, notices and messages from other players land here.",
      target: [{ selector: ".mail-list__rows > li" }, TutTarget.MAIL_THREADS],
      side: "below",
    },
    { text: "Write to any player you've met.", target: TutTarget.MAIL_NEW },
    {
      text: "In a player's thread you can propose a truce: neither of you can attack the other while it lasts.",
      target: { selector: ".mail-pane__truce" },
    },
  ],
  [GuideScreen.MONSTERS_UNLOCK]: [
    {
      text: "Unlock new kinds of monster here. It takes putty and time, one at a time.",
      target: [{ selector: ".locker-row--available" }, { selector: ".locker__list" }],
    },
  ],
  [GuideScreen.MONSTERS_HATCH]: [
    {
      text: "Hatcheries turn goo into monsters. Queue several and come back later.",
      target: { selector: ".hatch-lines" },
    },
    {
      text: "Hatched monsters move into Housing. When it's full, hatching waits.",
      target: { selector: ".hatch-housing" },
    },
  ],
  [GuideScreen.MONSTERS_HOUSING]: [
    {
      text: "This is your army. Juicing a monster turns it back into goo.",
      target: { selector: ".housing-juice" },
    },
  ],
  [GuideScreen.MONSTERS_TRAIN]: [
    {
      text: "The Monster Academy trains a monster type to a higher level: more health, more damage.",
      target: [{ selector: ".train__slots .train-slot" }, { selector: ".train__slots" }],
    },
  ],
  [GuideScreen.MONSTERS_LAB]: [
    {
      text: "The Monster Lab researches a special ability for one monster type at a time.",
      target: { selector: ".lab__slot" },
    },
  ],
  [GuideScreen.SHOP]: [
    { text: "More workers mean more jobs at once.", target: TutTarget.SHOP_WORKERS },
    {
      text: "Protection stops other players attacking you. It stacks.",
      target: TutTarget.SHOP_PROTECTION,
    },
  ],
  [GuideScreen.MR1]: [
    {
      text: "Wild monster tribes are always there to raid. A flattened tribe is back in 10 minutes.",
      target: TutTarget.MR1_TRIBES,
    },
    {
      text: "Neighbours are real players. Protected yards can't be attacked.",
      target: TutTarget.MR1_NEIGHBOURS,
    },
  ],
  [GuideScreen.MR2]: [
    {
      text: "The blue area is your Flinger's reach. Attacking further away costs resources.",
      target: TutTarget.MR2_RANGE,
    },
    {
      text: "Beat a wild camp or a player's outpost and you can take it over as your own outpost.",
      target: TutTarget.MR2_TAKEOVER,
    },
    { text: "Find jumps to your yard, your outposts or any cell.", target: TutTarget.MR2_FIND },
  ],
  [GuideScreen.ATTACK]: [
    {
      text: "Pick your army here. Fill all loads as many as your Flinger can carry.",
      target: TutTarget.FILL_ALL,
    },
    { text: "{Tap} open ground to drop. A red ring means too close to a building." },
    {
      text: "2x speeds the battle up. Retreat ends it and keeps what you've looted.",
      target: TutTarget.ATTACK_SPEED,
    },
  ],
  [GuideScreen.BAITER]: [
    {
      text: "Make up any army and test it on your own yard to see how your defences hold. Nothing is lost.",
      target: TutTarget.BAITER_RUN,
    },
  ],
  [GuideScreen.CHAMPION]: [
    { text: "Feed your champion every day to keep it growing.", target: TutTarget.CHAMPION_FEED },
  ],
  [GuideScreen.GOALS]: [
    {
      text: "A finished goal shows Claim. {Tap} it to collect the reward.",
      target: GOALS_CLAIM_TARGET,
    },
    {
      text: "New goals appear as you claim earlier ones. Up next shows what to do now.",
      target: { selector: ".goals-row:not(.goals-row--ready)" },
    },
  ],
  [GuideScreen.OUTPOSTS]: [
    {
      text: "Switch between your yard and your outposts here.",
      target: TutTarget.YARD_SWITCHER,
    },
    { text: "A Starter Kit sets a new outpost up quickly.", target: TutTarget.STARTER_KITS },
  ],
};

/** The tips for a screen; empty for one with none. */
export const tipsFor = (screen: GuideScreen): readonly Tip[] => TIPS[screen] ?? [];

/** A tip's targets as a list, in the order to try them. */
export const targetsOf = (tip: Tip): readonly TipTarget[] =>
  tip.target === undefined ? [] : Array.isArray(tip.target) ? tip.target : [tip.target as TipTarget];

/** Fills in `{Tap}` / `{tap}`: a tap on a touch screen, a click everywhere else. */
export const tipWording = (text: string, touch: boolean): string =>
  text.replaceAll("{Tap}", touch ? "Tap" : "Click").replaceAll("{tap}", touch ? "tap" : "click");
