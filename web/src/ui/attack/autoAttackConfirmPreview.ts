import type { AutoAttackPlanResponse, AutoAttackResponse, PlanShortfall, PlanSummary, YardLabel, YardMove } from "@/api/autoAttack";
import { ApiError } from "@/api/http";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";

/**
 * The layout check's way to Repeat attack's sheet (web/e2e/layout), and the
 * pictures' (owner, 20 Nov 2026: look A): the real sheet in each state it can
 * show, filled with a fixed, busy army (eight kinds, two champions, a bomb
 * that repeats), with no server; every call is answered here, and nothing
 * runs. Installed as `window.__autoAttackConfirm(state)` in a dev build or
 * one built with VITE_LAYOUT_CHECK=1 (the check's own build), never in a
 * release build.
 */

const CAMP = "preview-camp";
const MAIN = "preview-main";
const OUT = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((one) => `preview-out-${one}`);
const out = (index: number): string => OUT[index] ?? "preview-out-a";

const YARDS: Record<string, YardLabel> = {
  [MAIN]: { main: true, x: 231, y: 196 },
  [out(0)]: { main: false, x: 240, y: 208 },
  [out(1)]: { main: false, x: 242, y: 211 },
  [out(2)]: { main: false, x: 252, y: 215 },
  [out(3)]: { main: false, x: 226, y: 203 },
  [out(4)]: { main: false, x: 219, y: 190 },
  [out(5)]: { main: false, x: 258, y: 224 },
  [out(6)]: { main: false, x: 211, y: 214 },
  [out(7)]: { main: false, x: 264, y: 199 },
  [out(8)]: { main: false, x: 233, y: 230 },
};

/** Eight kinds of monster, a 4-digit count among them. */
const ARMY: Record<string, number> = { C3: 1_240, C5: 180, C14: 120, C10: 60, C12: 40, C1: 300, C8: 90, C6: 24 };

/** Five source yards, one card each, up to three kinds a card. */
const MOVES_5: YardMove[] = [
  { from: MAIN, to: out(0), monsters: { C14: 80, C12: 20 } },
  { from: out(2), to: out(0), monsters: { C10: 60 } },
  { from: out(3), to: out(1), monsters: { C3: 150, C5: 100 } },
  { from: out(4), to: out(1), monsters: { C3: 120, C14: 20, C12: 20 } },
  { from: out(5), to: out(0), monsters: { C5: 80 } },
];

/** Eight cards: the list must scroll inside the sheet. */
const MOVES_8: YardMove[] = [
  ...MOVES_5,
  { from: out(6), to: out(1), monsters: { C1: 140, C8: 40, C6: 12 } },
  { from: out(7), to: out(0), monsters: { C3: 30 } },
  { from: out(8), to: out(1), monsters: { C1: 20, C8: 50 } },
];

const MOVES_2: YardMove[] = [
  { from: MAIN, to: out(0), monsters: { C14: 80, C12: 40 } },
  { from: out(3), to: out(1), monsters: { C10: 60, C5: 100 } },
];

const planOf = (): PlanSummary => ({
  tribe: "Legionnaire",
  level: 33,
  recordedOn: { baseid: "preview-camp-before", x: 239, y: 209 },
  recordedAt: Math.floor(Date.now() / 1000) - 90_000,
  monsters: ARMY,
  champions: [
    { t: 3, l: 6, pl: 1 },
    { t: 5, l: 3 },
  ],
  bombs: ["tw1", "tw1", "pb1", "pu0"],
  siege: true,
});

const answerOf = (overrides: Partial<AutoAttackPlanResponse> = {}): AutoAttackPlanResponse => ({
  error: 0,
  baseid: CAMP,
  plan: planOf(),
  missing: [],
  moves: [],
  movesKey: null,
  noRoom: null,
  yards: YARDS,
  outOfRange: false,
  underAttack: false,
  damage: 41,
  ...overrides,
});

const refused = (message: string, data: Record<string, unknown>, status = 409): ApiError =>
  new ApiError(message, { status, details: { data } as never });

const never = (): Promise<never> => new Promise(() => {});
const refuse = (): Promise<never> => Promise.reject(new Error("Preview only."));

/** Short of five kinds, the champion hurt and a bomb too dear. */
const SHORT_MONSTERS: PlanShortfall[] = [
  { kind: "monster", id: "C14", need: 120, have: 85 },
  { kind: "monster", id: "C12", need: 40, have: 12 },
  { kind: "monster", id: "C10", need: 60, have: 0 },
  { kind: "monster", id: "C3", need: 1_240, have: 1_000 },
  { kind: "monster", id: "C8", need: 90, have: 50 },
  { kind: "champion", t: 3, reason: "hurt" },
  { kind: "bomb", id: "pu0", reason: "cost" },
];

const NO_ROOM = { need: 1_840, free: [{ baseid: out(0), free: 120 }, { baseid: out(1), free: 45 }, { baseid: MAIN, free: 300 }] };

export const CONFIRM_STATES = [
  "basic",
  "moves2",
  "moves5",
  "moves8",
  "changed",
  "short-monsters",
  "short-other",
  "short-housing",
  "short-housing-none",
  "under-attack",
  "out-of-range",
  "failed-short",
  "failed-housing",
  "failed-network",
  "failed-busy",
  "no-plan",
  "loading",
  "working",
] as const;

export type ConfirmState = (typeof CONFIRM_STATES)[number];

interface Setup {
  readonly answer?: AutoAttackPlanResponse;
  readonly plan?: AutoAttackCalls["plan"];
  readonly run?: AutoAttackCalls["run"];
  readonly progressBar?: boolean;
  /** Press the sheet's main button once it shows. */
  readonly press?: boolean;
}

const setups = (): Record<ConfirmState, Setup> => ({
  basic: { answer: answerOf() },
  moves2: { answer: answerOf({ moves: MOVES_2, movesKey: "k2" }) },
  moves5: { answer: answerOf({ moves: MOVES_5, movesKey: "k5" }) },
  moves8: { answer: answerOf({ moves: MOVES_8, movesKey: "k8" }) },
  // 2b: the plan changed after "Move and attack"; the new plan with the banner.
  changed: {
    answer: answerOf({ moves: MOVES_5, movesKey: "k5" }),
    run: () => Promise.reject(refused("Your yards changed since you looked. Check the moves again.", { reason: "movesChanged" })),
    plan: async () => answerOf({ moves: MOVES_5.slice(0, 4), movesKey: "k4" }),
    press: true,
  },
  "short-monsters": { answer: answerOf({ missing: SHORT_MONSTERS }) },
  "short-other": {
    answer: answerOf({
      missing: [
        { kind: "champion", t: 3, reason: "away" },
        { kind: "champion", t: 5, reason: "hurt" },
        { kind: "bomb", id: "pu0", reason: "catapult" },
        { kind: "bomb", id: "pb1", reason: "cost" },
      ],
    }),
  },
  "short-housing": { answer: answerOf({ noRoom: NO_ROOM }) },
  "short-housing-none": { answer: answerOf({ noRoom: { need: 1_840, free: [] } }) },
  "under-attack": { answer: answerOf({ underAttack: true }) },
  "out-of-range": { answer: answerOf({ outOfRange: true }) },
  "failed-short": {
    answer: answerOf({ moves: MOVES_2, movesKey: "k2" }),
    run: () => Promise.reject(refused("You do not have everything that attack used.", { reason: "missing", missing: SHORT_MONSTERS.slice(0, 3) })),
    press: true,
  },
  "failed-housing": {
    answer: answerOf({ moves: MOVES_2, movesKey: "k2" }),
    run: () => Promise.reject(refused("Not enough Monster Housing in range.", { reason: "noRoom", noRoom: NO_ROOM, yards: YARDS })),
    press: true,
  },
  "failed-network": { answer: answerOf(), run: () => Promise.reject("offline"), press: true },
  "failed-busy": { answer: answerOf(), run: () => Promise.reject(refused("Too many requests", {}, 429)), press: true },
  "no-plan": { answer: answerOf({ plan: null }) },
  loading: { plan: never },
  working: { answer: answerOf(), run: never, progressBar: true, press: true },
});

/** Opens the sheet in `state` in `modal`; returns a function that closes it. */
export const previewAutoAttackConfirm = (modal: HTMLElement, state: ConfirmState = "moves8"): (() => void) => {
  const setup = setups()[state] ?? setups().moves8;
  const calls: AutoAttackCalls = {
    plan: setup.plan ?? (async () => setup.answer ?? answerOf()),
    run: setup.run ?? (async () => ({}) as AutoAttackResponse),
    replay: refuse,
    quote: refuse,
    takeOver: refuse,
  };
  const flow = new AutoAttackFlow({ baseid: CAMP, modal, onWatch: () => {}, calls, progressBar: setup.progressBar ?? false });
  void flow.start(setup.answer).then(() => {
    if (setup.press) modal.querySelector<HTMLButtonElement>(".auto-attack__go")?.click();
  });
  return () => flow.close();
};
