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
 * (`server/public/gamestage/assets/english.json`), the key in a comment.
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
}

/** The four guide buildings, by their build step. */
export const GUIDE_BUILDS: Readonly<Record<string, GuideBuild>> = {
  "build-sniper": {
    type: 21,
    tab: "defensive",
    name: "Sniper Tower",
    lines: {
      open: "Wild monsters are gathering nearby. Let's build a Sniper Tower. Tap Build.", // tut_31
      tab: "Open the Defensive tab.", // tut_32
      card: "Pick the Sniper Tower.", // tut_33
      go: "Here's what it does and what it costs. This one's on me: tap Build.", // tut_34
      place: "Drag it onto the grass, then tap Build here.", // tut_35
      finishTap: "Tap your Sniper Tower.", // tut_36
      finishNow: "Building usually takes time, but not today. This one's on me: tap Finish now.", // tut_37
    },
  },
  "build-housing": {
    type: 15,
    tab: "buildings",
    name: "Monster Housing",
    lines: {
      open: "First, your army needs somewhere to live. Tap Build.", // tut_50
      tab: "Open the Buildings tab.", // tut_51
      card: "Pick Monster Housing.", // tut_52
      go: "On me again: tap Build.", // tut_53
      place: "Place it on the grass, then tap Build here. You can drag the yard to find space.", // tut_54
      finishTap: "Tap your Housing.", // tut_55
      finishNow: "And Finish now, free again.",
    },
  },
  "build-maproom": {
    type: 11,
    tab: "buildings",
    name: "Map Room",
    lines: {
      open: "Now a Map Room, so we can find those Legionnaires. Tap Build.", // tut_90_b
      tab: "Open the Buildings tab.", // tut_91
      card: "Pick the Map Room.", // tut_92
      go: "On me: tap Build.", // tut_93
      place: "Place it, then tap Build here.", // tut_94
      finishTap: "Tap your Map Room.", // tut_97
      finishNow: "Finish now. Free again.",
    },
  },
  "build-flinger": {
    type: 5,
    tab: "buildings",
    name: "Flinger",
    lines: {
      open: "Last piece: a Flinger, so we can fling our Pokeys into the enemy's yard. Tap Build.", // tut_65
      tab: "Open the Buildings tab.", // tut_66
      card: "Pick the Flinger.", // tut_67
      go: "On me: tap Build.", // tut_68
      place: "Place it, then tap Build here.", // tut_69
      finishTap: "Tap your Flinger.",
      finishNow:
        "A Flinger takes a while to build, which would normally cost a few Shiny to skip. Today it's free: tap Finish now.", // tut_96
    },
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

/** One micro step: what Bob says and what he points at. */
export interface MicroStep {
  readonly key: string;
  readonly text: string;
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
  if (screen.carrying === build.type) {
    return { key: "place", text: lines.place, target: TutTarget.BUILD_HERE, block: false };
  }
  if (screen.carrying !== null) {
    return {
      key: "wrong-carry",
      text: `That's not the one. Put it down, and we'll build the ${build.name}.`,
      target: TutTarget.BUILD_CANCEL_CARRY,
      block: true,
    };
  }
  if (screen.menuOpen && screen.picked) {
    return { key: "go", text: lines.go, target: TutTarget.BUILD_GO, block: true };
  }
  if (screen.menuOpen && screen.cardShown) {
    return { key: "card", text: lines.card, target: `${TutTarget.BUILD_CARD}${build.type}`, block: true };
  }
  if (screen.menuOpen) {
    return { key: "tab", text: lines.tab, target: `${TutTarget.BUILD_TAB}${build.tab}`, block: true };
  }
  return { key: "open", text: lines.open, target: TutTarget.DOCK_BUILD, block: true };
};

/* ── The other lines ──────────────────────────────────────────────────── */

/** Bob's lines for the steps that are not a build. */
export const LINES = {
  welcome: (name: string): string =>
    `Welcome to Backyard Monsters${name ? `, ${name}` : ""}! I'm Bob. Give me eight minutes and I'll have your yard ready for anything.`, // tut_1
  collect:
    "Harvesters work until they're full, so empty them often. Tap Collect all to bank what your Twig Snapper has made.", // tut_3, tut_4
  collected: "Nice! Twigs build and upgrade your buildings.", // tut_5
  raidBanner: "Legionnaire scouts are attacking!",
  raidStart:
    "WHOA! Just in time, here come some wild monsters! Your Sniper Tower will make short work of them. Sit back and watch.", // tut_40
  raidEnd:
    "That's defence: towers fire on anything that comes into range. Those were Legionnaire scouts. Let's strike back before they come back bigger!", // tut_42, tut_44
  pokeys:
    "I've recruited some Pokeys to help. They're slow and small, but what they lack in strength they make up for in numbers!", // tut_57
  openMap: "Let's find the tribe that attacked you. Tap Map.", // tut_101
  pickCamp:
    "This is your map. That glowing camp is a Legionnaire outpost, and it's yours alone to practise on. Tap it.", // tut_102
  tapAttack: "Now tap Attack!", // tut_102
  attackBase: "This is their base: one Sniper Tower and a few walls.", // tut_110
  fillAll: "Your 15 Pokeys are in the army panel. Tap Fill all to load every one.", // tut_111
  dropBox: "Now tap inside the glowing box to fling them in.", // tut_112
  outsideBox: "Inside the glowing box, please!",
  battle: [
    "Excellent! Your Pokeys are attacking.", // tut_113
    "Take out that tower and the rest is easy.",
    "Your Pokeys are looting their harvesters!", // tut_115
    "Flatten the base and you win.", // tut_116
  ],
  won: "Congratulations, you levelled their whole base! Check out that loot.", // tut_120, tut_130
  wonHome: "Congratulations, you levelled their whole base! Let's head home and see what you've earned.",
  lost: "Ouch, the Legionnaires got lucky. Here's a fresh squad of 15 Pokeys: let's go again!",
  lostHere: "Ouch, the Legionnaires got lucky. Head back to the map and we'll go again!",
  checking: "Let's see how your Pokeys did...",
  homeGoals: "You finished a pile of Goals along the way. Tap Goals and claim your rewards.", // tut_131, tut_191
  homeGoalsNoButton:
    "You finished a pile of Goals along the way. Check Goals for your rewards when you're ready.",
  goalsLater: "Don't forget them!",
  finishNow:
    "One more tip. Instant and Finish now cost Shiny, and early on they're cheap: upgrading your Town Hall to level 2 instantly costs about 24 of your 1,500 Shiny.",
  protection:
    "Your yard is protected for the next 7 days: other players can't attack you while it lasts. Check Goals for what to do next. Good luck!", // tut_190, tut_191
  skipAsk: "Skip the guided start? You'll miss Bob's free army and the gifts.",
} as const;

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

/** One stop of the replay tour: a line, and a target to point at if it is on screen. */
export interface TourStop {
  readonly text: string;
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
  { text: LINES.collect, target: TutTarget.COLLECT_ALL },
  { text: GUIDE_BUILDS["build-sniper"]!.lines.open, target: TutTarget.DOCK_BUILD },
  { text: "Building takes time. Tap a building, then Finish now to skip the wait for a little Shiny." },
  { text: LINES.raidStart, raid: true },
  { text: LINES.raidEnd },
  { text: GUIDE_BUILDS["build-housing"]!.lines.open, target: TutTarget.DOCK_BUILD },
  { text: LINES.pokeys, target: TutTarget.DOCK_MONSTERS },
  { text: GUIDE_BUILDS["build-maproom"]!.lines.open },
  { text: GUIDE_BUILDS["build-flinger"]!.lines.open },
  { text: LINES.openMap, target: TutTarget.DOCK_MAP },
  { text: "On the map, tap a tribe's camp, then Attack. Tap Fill all, then tap the yard to fling your army in." },
  { text: "Flatten 90% of a camp and it's yours: the loot comes home with your monsters." },
  { text: LINES.homeGoals, target: TutTarget.DOCK_GOALS },
  { text: LINES.finishNow, target: TutTarget.HUD_SHINY },
  { text: "That's the tour. Check Goals for what to do next. Good luck!" },
];
