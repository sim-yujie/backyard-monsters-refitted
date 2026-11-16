import type { AutoAttackResponse } from "@/api/autoAttack";
import type { TakeoverQuoteResponse } from "@/api/types";
import { AutoAttackFlow, type AutoAttackCalls } from "./AutoAttackFlow";

/**
 * The layout check's way to the Repeat attack's result (web/e2e/layout):
 * the real panel, filled with a fixed battle, without a real attack (the
 * check's sandbox yard is not on Map Room 2). Nothing reaches the server:
 * every call is answered here. Installed as `window.__autoAttackResult` in a
 * dev build or one built with VITE_LAYOUT_CHECK=1 (the check's own build),
 * never in a release build.
 */

const BASEID = "layout-check-camp";

/** The busiest result: a conquered camp, 7-digit loot, storage full. */
const WON: AutoAttackResponse = {
  error: 0,
  baseid: BASEID,
  tribe: "Legionnaire",
  level: 33,
  damageBefore: 0,
  damageAfter: 94,
  damageAdded: 94,
  conquered: true,
  destroyed: 1,
  loot: { r1: 2_533_988, r2: 2_526_382, r3: 2_530_349, r4: 839_846 },
  lootLeft: { r1: 10_000, r2: 0, r3: 0, r4: 0 },
  flung: { C6: 20 },
  champions: [{ t: 3, hp: 35_570 }],
  bombs: ["tw1", "pb1"],
  report: "",
  plan: {
    tribe: "Legionnaire",
    level: 33,
    recordedOn: { baseid: "layout-check-yard", x: 239, y: 209 },
    recordedAt: 0,
    monsters: { C6: 20 },
    champions: [{ t: 3, l: 6, pl: 1 }],
    bombs: ["tw1", "pb1"],
    siege: false,
  },
};

const LOST: AutoAttackResponse = {
  ...WON,
  damageAfter: 13,
  damageAdded: 13,
  conquered: false,
  destroyed: 0,
  loot: { r1: 373_219, r2: 373_068, r3: 373_162, r4: 119_257 },
  lootLeft: { r1: 0, r2: 0, r3: 0, r4: 0 },
};

const QUOTE = {
  error: 0,
  baseid: BASEID,
  kind: "camp",
  eligible: true,
  reason: null,
  resources: 450_000,
  shiny: 965,
  adjacent: false,
  welcome: true,
  usualResources: 4_500_000,
  affordable: { resources: true, shiny: true },
  shinyLocked: false,
  now: 0,
} as unknown as TakeoverQuoteResponse;

const refuse = (): Promise<never> => Promise.reject(new Error("Preview only."));

/** Opens the result in `modal`; returns a function that closes it. */
export const previewAutoAttackResult = (modal: HTMLElement, kind: "won" | "lost" = "won"): (() => void) => {
  const result = kind === "won" ? WON : LOST;
  const calls: AutoAttackCalls = {
    plan: refuse,
    run: async () => result,
    replay: refuse,
    quote: async () => ({ ...QUOTE, now: Math.floor(Date.now() / 1000) }),
    takeOver: refuse,
  };
  const flow = new AutoAttackFlow({ baseid: BASEID, modal, onWatch: () => {}, calls });
  flow.showResult(result);
  return () => flow.close();
};
