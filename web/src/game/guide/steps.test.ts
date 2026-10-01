import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, Onboarding } from "@/api/types";
import { buildOffer, type BuildContext } from "@/game/yard/buildCatalogue";
import { readYard } from "@/game/yard/yardModel";
import {
  buildMicroStep,
  dotsFor,
  GUIDE_BUILDS,
  GUIDE_STEPS,
  guideBuildOf,
  guidePays,
  isGuideStep,
  TOUR,
} from "./steps";
import { TutTarget } from "./targets";

/** The guided start's script (issue #227, `docs/design/tutorial.md` §2.3). */

/**
 * The server's step list, read from its source: importing the module would
 * pull the server's database layer into the web's type check.
 */
const serverSteps = (): string[] => {
  const source = readFileSync(
    new URL("../../../../server/src/services/onboarding/guidedStart.ts", import.meta.url),
    "utf8",
  );
  const list = /export const GUIDE_STEPS = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]!);
};

const active = (step: string): Onboarding => ({
  guide: { state: "active", step },
  camp: "none",
  goalsReady: 0,
  tips: {},
});

describe("the steps", () => {
  it("are the server's, in the server's order", () => {
    expect(serverSteps()).toHaveLength(GUIDE_STEPS.length);
    expect([...GUIDE_STEPS]).toEqual(serverSteps());
  });

  it("name the four buildings by their build and finish steps", () => {
    expect(guideBuildOf("build-sniper")?.type).toBe(21);
    expect(guideBuildOf("finish-housing")?.type).toBe(15);
    expect(guideBuildOf("finish-maproom")?.type).toBe(11);
    expect(guideBuildOf("build-flinger")?.type).toBe(5);
    expect(guideBuildOf("raid")).toBeNull();
    expect(isGuideStep("pokeys")).toBe(true);
    expect(isGuideStep("nope")).toBe(false);
  });

  it("count seven parts for Bob's dots", () => {
    expect(dotsFor("welcome")).toEqual({ index: 0, count: 7 });
    expect(dotsFor("raid")).toEqual({ index: 1, count: 7 });
    expect(dotsFor("finish-flinger")).toEqual({ index: 3, count: 7 });
    expect(dotsFor("protection")).toEqual({ index: 6, count: 7 });
    for (const step of GUIDE_STEPS) expect(dotsFor(step).index).toBeGreaterThanOrEqual(0);
  });
});

describe("guidePays", () => {
  it("is true only for the type of the active build step, on the main yard", () => {
    expect(guidePays(21, active("build-sniper"), "main")).toBe(true);
    expect(guidePays(15, active("build-sniper"), "main")).toBe(false);
    expect(guidePays(21, active("finish-sniper"), "main")).toBe(false);
    expect(guidePays(21, active("build-sniper"), "outpost")).toBe(false);
    expect(guidePays(21, { ...active("build-sniper"), guide: { state: "skipped", step: "build-sniper" } }, "main")).toBe(
      false,
    );
    expect(guidePays(21, undefined, "main")).toBe(false);
  });

  it("waives the Build menu's shortfall gate at that step only (the server tops it up)", () => {
    const save = {
      error: 0,
      currenttime: 1000,
      savetime: 1000,
      resources: { r1: 1600, r2: 1600, r3: 0, r4: 0 },
      credits: 1500,
      buildingdata: { "1": { id: 1, t: 14, X: -65, Y: -65, l: 1 } },
      buildinghealthdata: {},
      storedata: {},
      researchdata: {},
    } as unknown as BaseLoadResponse;
    const context = (onboarding?: Onboarding): BuildContext => {
      const withGuide = { ...save, ...(onboarding && { onboarding }) } as BaseLoadResponse;
      const yard = readYard(withGuide);
      return {
        yard,
        save: withGuide,
        resources: withGuide.resources ?? {},
        credits: 1500,
        caps: null,
        workers: yard.workers,
        now: () => 1000,
      };
    };
    expect(buildOffer(21, context())?.gate?.reason).toBe("shortfall");
    expect(buildOffer(21, context(active("build-sniper")))?.gate).toBeNull();
    // Another building is still gated by what you hold.
    expect(buildOffer(15, context(active("build-sniper")))?.gate?.reason).toBe("shortfall");
  });
});

describe("a build step's micro steps", () => {
  const sniper = GUIDE_BUILDS["build-sniper"]!;
  const screen = { carrying: null, menuOpen: false, picked: false, cardShown: false };

  it("walk Build, tab, card, Build, place from what is on screen", () => {
    expect(buildMicroStep(sniper, screen)).toMatchObject({ key: "open", target: TutTarget.DOCK_BUILD });
    expect(buildMicroStep(sniper, { ...screen, menuOpen: true })).toMatchObject({
      key: "tab",
      target: "build-tab:defensive",
    });
    expect(buildMicroStep(sniper, { ...screen, menuOpen: true, cardShown: true })).toMatchObject({
      key: "card",
      target: "build-card:21",
    });
    expect(buildMicroStep(sniper, { ...screen, menuOpen: true, cardShown: true, picked: true })).toMatchObject({
      key: "go",
      target: TutTarget.BUILD_GO,
    });
    expect(buildMicroStep(sniper, { ...screen, carrying: 21 })).toMatchObject({
      key: "place",
      target: TutTarget.BUILD_HERE,
      block: false,
    });
  });

  it("rewinds by itself: the menu closed is the first micro step again", () => {
    expect(buildMicroStep(sniper, { ...screen, picked: true, cardShown: true }).key).toBe("open");
  });

  it("asks to put down a building that is not the guide's", () => {
    expect(buildMicroStep(sniper, { ...screen, carrying: 20 })).toMatchObject({
      key: "wrong-carry",
      target: TutTarget.BUILD_CANCEL_CARRY,
    });
  });
});

describe("the Help tour", () => {
  it("has a line on every stop and plays the raid once", () => {
    expect(TOUR.length).toBeGreaterThan(5);
    for (const stop of TOUR) expect(stop.text.length).toBeGreaterThan(10);
    expect(TOUR.filter((stop) => stop.raid)).toHaveLength(1);
  });
});
