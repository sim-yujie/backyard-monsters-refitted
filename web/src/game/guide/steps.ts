import type { Onboarding } from "@/api/types";
import { TutTarget } from "./targets";

/**
 * The guided start as data (issue #227, `docs/design/tutorial.md` §2.3): the
 * server's macro steps, what Bob says at each, what he points at, and how a
 * build step splits into micro steps from what is on screen.
 *
 * Pure, so the runners (`game/yard/plugins/guidedStart.ts` on the yard,
 * `mr1Guide.ts` on Map Room 1, `game/attack/plugins/practice.ts` in the
 * attack) and the Help tour read one script. The server keeps the same step
 * names (`server/src/services/onboarding/guidedStart.ts`) and decides
 * everything: nothing here grants or advances.
 *
 * Lines are adapted from Flash's `tut_*` strings
 * (`server/public/gamestage/assets/english.json`), the key in a comment, and
 * cut short (the owner's text cut, 28 Oct): one thing to do per bubble, in
 * Bob's voice, with a picture of the button or the building it is about
 * ({@link GuideCue}) at its start.
 */

/** The macro steps, in order: the server's `GUIDE_STEPS`. */
export const GUIDE_STEPS = [
  "welcome",
  "collect",
  "build-sniper",
  "finish-sniper",
  "raid",
  "build-housing",
  "finish-housing",
  "pokeys",
  "build-maproom",
  "finish-maproom",
  "build-flinger",
  "finish-flinger",
  "open-map",
  "pick-camp",
  "attack",
  "attack-result",
  "home-goals",
  "finish-now",
  "protection",
] as const;

export type GuideStepName = (typeof GUIDE_STEPS)[number];

/** Whether a string is one of the steps. */
export const isGuideStep = (step: unknown): step is GuideStepName =>
  typeof step === "string" && (GUIDE_STEPS as readonly string[]).includes(step);

/** Housed Pokeys the guide tops up to (the server's `FREE_POKEYS`). */
export const FREE_POKEYS = 15;

/**
 * The picture at the start of Bob's bubble: what he asks the player to tap,
 * as it looks on screen (the dock's own line icon, the building's card
 * picture), or what the line is about (the Shiny coin, the painted clock).
 * Drawn by `ui/guide/guideCue.ts`; the words still name it.
 */
export type GuideCue =
  /** A yard button's line icon (`ui/icons.ts`), as the button wears it. */
  | { readonly kind: "icon"; readonly name: "build" | "map" | "collect" | "attack" }
  /** The Goals button's art. */
  | { readonly kind: "goals" }
  /** A building's picture, as on its Build menu card. */
  | { readonly kind: "building"; readonly type: number }
  /** A Pokey and how many. */
  | { readonly kind: "pokeys"; readonly count: number }
  /** A resource's pile, or the Shiny coin. */
  | { readonly kind: "resource"; readonly key: "r1" | "shiny" }
  /** A painted icon (`ui/gameIcon.ts`). */
  | { readonly kind: "painted"; readonly name: "time" | "shield" };

/** The Build button's cue. */
const BUILD_CUE: GuideCue = { kind: "icon", name: "build" };

/** One of the four buildings the guide pays for. */
export interface GuideBuild {
  readonly type: number;
  /** The Build menu tab it is on (`BuildCategory`). */
  readonly tab: "defensive" | "buildings";
  /** "Sniper Tower". */
  readonly name: string;
  /** Bob's lines for the five micro steps (§2.3). */
  readonly lines: {
    readonly open: string;
    readonly tab: string;
    readonly card: string;
    readonly go: string;
    readonly place: string;
    readonly finishTap: string;
    readonly finishNow: string;
  };
  /** The picture beside `finishNow`: the clock, or the Shiny a skip would cost. */
  readonly finishCue: GuideCue;
}

/** The painted clock: building takes time. */
const TIME_CUE: GuideCue = { kind: "painted", name: "time" };

/** The four guide buildings, by their build step. */
export const GUIDE_BUILDS: Readonly<Record<string, GuideBuild>> = {
  "build-sniper": {
    type: 21,
    tab: "defensive",
    name: "Sniper Tower",
    lines: {
      open: "Wild monsters nearby! We need a Sniper Tower. Tap Build.", // tut_31
      tab: "Tap Defensive.", // tut_32
      card: "Pick the Sniper Tower.", // tut_33
      go: "This one's on me. Tap Build.", // tut_34
      place: "Drag it onto the grass. Tap Build here.", // tut_35
      finishTap: "Tap your Sniper Tower.", // tut_36
      finishNow: "Building takes time, but not today. On me: Finish now!", // tut_37
    },
    finishCue: TIME_CUE,
  },
  "build-housing": {
    type: 15,
    tab: "buildings",
    name: "Monster Housing",
    lines: {
      open: "Your army needs a home. Tap Build.", // tut_50
      tab: "Tap Buildings.", // tut_51
      card: "Pick Monster Housing.", // tut_52
      go: "On me again: tap Build.", // tut_53
      place: "Drag it onto the grass. Tap Build here.", // tut_54
      finishTap: "Tap your Housing.", // tut_55
      finishNow: "And Finish now, free again.",
    },
    finishCue: TIME_CUE,
  },
  "build-maproom": {
    type: 11,
    tab: "buildings",
    name: "Map Room",
    lines: {
      open: "Now a Map Room, to find those Legionnaires. Tap Build.", // tut_90_b
      tab: "Tap Buildings.", // tut_91
      card: "Pick the Map Room.", // tut_92
      go: "On me: tap Build.", // tut_93
      place: "Drag it onto the grass. Tap Build here.", // tut_94
      finishTap: "Tap your Map Room.", // tut_97
      finishNow: "Finish now. Free again.",
    },
    finishCue: TIME_CUE,
  },
  "build-flinger": {
    type: 5,
    tab: "buildings",
    name: "Flinger",
    lines: {
      open: "Last piece: a Flinger, to fling our Pokeys. Tap Build.", // tut_65
      tab: "Tap Buildings.", // tut_66
      card: "Pick the Flinger.", // tut_67
      go: "On me: tap Build.", // tut_68
      place: "Drag it onto the grass. Tap Build here.", // tut_69
      finishTap: "Tap your Flinger.",
      finishNow: "Skipping this wait costs Shiny. Today it's free: Finish now!", // tut_96
    },
    finishCue: { kind: "resource", key: "shiny" },
  },
};

/** The build a `build-*` or `finish-*` step is about. */
export const guideBuildOf = (step: string | undefined): GuideBuild | null => {
  if (!step) return null;
  const key = step.startsWith("finish-") ? `build-${step.slice("finish-".length)}` : step;
  return GUIDE_BUILDS[key] ?? null;
};

/**
 * Whether the guide pays for a build of `type` right now: it is active at
 * that type's build step, on the main yard. The Build menu waives its own
 * shortfall gate then (`buildCatalogue.ts`), because the server tops the
 * build up (`/bm/yard/build`, §2.4) and checks the same thing itself.
 */
export const guidePays = (
  type: number,
  onboarding: Onboarding | null | undefined,
  kind: string,
): boolean => {
  if (kind !== "main" || onboarding?.guide.state !== "active") return false;
  const build = GUIDE_BUILDS[onboarding.guide.step ?? ""];
  return build?.type === type;
};

/* ── The build step's micro steps ─────────────────────────────────────── */

/** What is on screen that decides a build step's micro step. */
export interface BuildScreen {
  /** The type in hand, or null. */
  readonly carrying: number | null;
  /** The Build menu is open. */
  readonly menuOpen: boolean;
  /** The menu's info panel shows the guide's building (its tile is picked). */
  readonly picked: boolean;
  /** The guide's building's tile is on screen. */
  readonly cardShown: boolean;
}

/** One micro step: what Bob says, the picture beside it, and what he points at. */
export interface MicroStep {
  readonly key: string;
  readonly text: string;
  readonly cue: GuideCue;
  readonly target: string;
  /** False while placing: the yard must pan (§2.1). */
  readonly block: boolean;
}

/**
 * The micro step a build step is at, from the screen (§2.1, "Macro steps and
 * micro steps"): the furthest one whose control is up. Backing out of one
 * (closing the menu, putting the building down) lands on an earlier one by
 * itself, which is the rewind.
 */
export const buildMicroStep = (build: GuideBuild, screen: BuildScreen): MicroStep => {
  const { lines } = build;
  // Past the Build button every step is about the building: its picture.
  const cue: GuideCue = { kind: "building", type: build.type };
  if (screen.carrying === build.type) {
    return { key: "place", text: lines.place, cue, target: TutTarget.BUILD_HERE, block: false };
  }
  if (screen.carrying !== null) {
    return {
      key: "wrong-carry",
      text: `Not that one! Put it down: we want the ${build.name}.`,
      cue,
      target: TutTarget.BUILD_CANCEL_CARRY,
      block: true,
    };
  }
  if (screen.menuOpen && screen.picked) {
    return { key: "go", text: lines.go, cue, target: TutTarget.BUILD_GO, block: true };
  }
  if (screen.menuOpen && screen.cardShown) {
    return { key: "card", text: lines.card, cue, target: `${TutTarget.BUILD_CARD}${build.type}`, block: true };
  }
  if (screen.menuOpen) {
    return { key: "tab", text: lines.tab, cue, target: `${TutTarget.BUILD_TAB}${build.tab}`, block: true };
  }
  return { key: "open", text: lines.open, cue: BUILD_CUE, target: TutTarget.DOCK_BUILD, block: true };
};

/* ── The other lines ──────────────────────────────────────────────────── */

/** Bob's lines for the steps that are not a build. */
export const LINES = {
  welcome: (name: string): string =>
    `Welcome to Backyard Monsters${name ? `, ${name}` : ""}! I'm Bob. Eight minutes, and your yard's ready for anything.`, // tut_1
  collect: "Harvesters stop when they're full. Tap Collect all!", // tut_3, tut_4
  collected: "Nice! Twigs pay for your buildings.", // tut_5
  raidBanner: "Legionnaire scouts are attacking!",
  raidStart: "WHOA! Here they come! Sit back and watch your Sniper Tower work.", // tut_40
  raidEnd: "Towers hit anything in range. Now let's strike back before they come back bigger!", // tut_42, tut_44
  pokeys: `I got you ${FREE_POKEYS} Pokeys! Small and slow, but there's loads of them.`, // tut_57
  openMap: "Let's find who attacked you. Tap Map.", // tut_101
  mapAgain: "Back to the map: tap Map.",
  pickCamp: "That glowing camp is a Legionnaire outpost, just for you to practise on. Tap it.", // tut_102
  tapAttack: "Now tap Attack!", // tut_102
  attackBase: "One tower and a few walls: easy pickings!", // tut_110
  fillAll: `Tap Fill all to load your ${FREE_POKEYS} Pokeys.`, // tut_111
  dropBox: "Now tap inside the glowing box to fling them in!", // tut_112
  outsideBox: "Inside the glowing box, please!",
  battle: [
    "Excellent! Your Pokeys are attacking.", // tut_113
    "Take out that tower and the rest is easy.",
    "Your Pokeys are looting their harvesters!", // tut_115
    "Flatten the base and you win.", // tut_116
  ],
  won: "You flattened their whole base! Check out that loot.", // tut_120, tut_130
  wonHome: "You flattened their whole base! Let's head home and count the loot.",
  lost: `Ouch, the Legionnaires got lucky. Here's ${FREE_POKEYS} fresh Pokeys: let's go again!`,
  lostHere: "Ouch, the Legionnaires got lucky. Back to the map, and we'll go again!",
  checking: "Let's see how your Pokeys did...",
  homeGoals: "You finished a pile of Goals! Tap Goals for your rewards.", // tut_131, tut_191
  homeGoalsNoButton: "You finished a pile of Goals! Check Goals for your rewards.",
  goalsLater: "Don't forget them!",
  finishNow: "Finish now and Instant cost Shiny, but they're cheap early on: Town Hall level 2 is about 24.",
  protection: "Your yard is protected for 7 days: nobody can attack it. Goals has what's next. Good luck!", // tut_190, tut_191
  skipAsk: "Skip the guided start? You'll miss Bob's free army and the gifts.",
} as const;

/** The picture beside each of {@link LINES} that has one. */
export const CUES: Partial<Record<keyof typeof LINES, GuideCue>> = {
  collect: { kind: "icon", name: "collect" },
  collected: { kind: "resource", key: "r1" },
  pokeys: { kind: "pokeys", count: FREE_POKEYS },
  openMap: { kind: "icon", name: "map" },
  mapAgain: { kind: "icon", name: "map" },
  tapAttack: { kind: "icon", name: "attack" },
  fillAll: { kind: "pokeys", count: FREE_POKEYS },
  lost: { kind: "pokeys", count: FREE_POKEYS },
  homeGoals: { kind: "goals" },
  homeGoalsNoButton: { kind: "goals" },
  finishNow: { kind: "resource", key: "shiny" },
  protection: { kind: "painted", name: "shield" },
};

/**
 * The guide in seven parts, the owner's confirmed order (hello and collect;
 * the tower and the raid; Housing and Pokeys; the Map Room and Flinger; the
 * map; the attack; home), for Bob's step dots.
 */
const PHASES: readonly (readonly GuideStepName[])[] = [
  ["welcome", "collect"],
  ["build-sniper", "finish-sniper", "raid"],
  ["build-housing", "finish-housing", "pokeys"],
  ["build-maproom", "finish-maproom", "build-flinger", "finish-flinger"],
  ["open-map", "pick-camp"],
  ["attack", "attack-result"],
  ["home-goals", "finish-now", "protection"],
];

/** Bob's dots for a step: which of the seven parts it is in. */
export const dotsFor = (step: GuideStepName): { index: number; count: number } => ({
  index: Math.max(0, PHASES.findIndex((phase) => phase.includes(step))),
  count: PHASES.length,
});

/* ── The Help tour (Q5) ────────────────────────────────────────────────── */

/** One stop of the replay tour: a line, its picture, and a target to point at if it is on screen. */
export interface TourStop {
  readonly text: string;
  /** The picture beside the line ({@link GuideCue}). */
  readonly cue?: GuideCue;
  readonly target?: string;
  /** Plays the staged raid (the only step the tour acts out; it touches no data). */
  readonly raid?: boolean;
}

/**
 * The Help replay (§2.1, Q5): Bob's lines in order with a Next button on each.
 * Nothing is built, granted or called; the hand points only at what happens
 * to be on screen.
 */
export const TOUR: readonly TourStop[] = [
  { text: LINES.welcome("") },
  { text: LINES.collect, cue: CUES.collect!, target: TutTarget.COLLECT_ALL },
  { text: GUIDE_BUILDS["build-sniper"]!.lines.open, cue: BUILD_CUE, target: TutTarget.DOCK_BUILD },
  { text: "Building takes time. Tap a building and Finish now skips the wait for a little Shiny.", cue: TIME_CUE },
  { text: LINES.raidStart, raid: true },
  { text: LINES.raidEnd },
  { text: GUIDE_BUILDS["build-housing"]!.lines.open, cue: BUILD_CUE, target: TutTarget.DOCK_BUILD },
  { text: LINES.pokeys, cue: CUES.pokeys!, target: TutTarget.DOCK_MONSTERS },
  { text: GUIDE_BUILDS["build-maproom"]!.lines.open, cue: { kind: "building", type: GUIDE_BUILDS["build-maproom"]!.type } },
  { text: GUIDE_BUILDS["build-flinger"]!.lines.open, cue: { kind: "building", type: GUIDE_BUILDS["build-flinger"]!.type } },
  { text: LINES.openMap, cue: CUES.openMap!, target: TutTarget.DOCK_MAP },
  { text: "On the map, tap a tribe's camp, then Attack.", cue: CUES.tapAttack! },
  { text: "Tap Fill all, then tap their yard to fling your army in.", cue: CUES.fillAll! },
  { text: "Flatten 90% of a camp to win it. The loot comes home with your monsters." },
  { text: LINES.homeGoals, cue: CUES.homeGoals!, target: TutTarget.DOCK_GOALS },
  { text: LINES.finishNow, cue: CUES.finishNow!, target: TutTarget.HUD_SHINY },
  { text: "That's the tour. Goals has what to do next. Good luck!" },
];
