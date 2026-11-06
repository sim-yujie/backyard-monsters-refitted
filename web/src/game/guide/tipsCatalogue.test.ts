import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GOALS_CLAIM_TARGET } from "@/ui/goals/GoalsPanel";
import { GuideScreen } from "./guideBus";
import { TutTarget } from "./targets";
import { GUIDED_SCREENS, targetsOf, TIPS, tipsFor, tipWording } from "./tipsCatalogue";

/** Bob's screen tips, the words (issue #227, `docs/design/tutorial.md` §7.2). */

const SCREENS = Object.values(GuideScreen);

describe("the tips catalogue", () => {
  it("gives every screen one to three tips, except the planner, whose help card is its tips", () => {
    for (const screen of SCREENS) {
      const count = tipsFor(screen).length;
      if (screen === GuideScreen.PLANNER) expect(count).toBe(0);
      else expect(count, screen).toBeGreaterThanOrEqual(1);
      expect(count, screen).toBeLessThanOrEqual(3);
    }
    expect(Object.keys(TIPS)).not.toContain(GuideScreen.PLANNER);
  });

  it("points only at target names the foundation put in place, or at selectors", () => {
    // The Goals panel names its own Claim buttons (package a).
    const names = new Set<string>([...Object.values(TutTarget), GOALS_CLAIM_TARGET]);
    for (const screen of SCREENS) {
      for (const tip of tipsFor(screen)) {
        for (const target of targetsOf(tip)) {
          if (typeof target === "string") expect(names.has(target), target).toBe(true);
          else expect(target.selector).toMatch(/^[.#[]/);
        }
      }
    }
  });

  it("the guided start's screens are the yard, the Build menu and the building panel (Q14)", () => {
    expect([...GUIDED_SCREENS].sort()).toEqual(["build", "building", "yard"]);
  });

  it("knows the same screens as the server's tips/seen", () => {
    const source = readFileSync(
      new URL("../../../../server/src/services/onboarding/tips.ts", import.meta.url),
      "utf8",
    );
    const list = /TIP_SCREENS = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
    const server = [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(server.sort()).toEqual([...SCREENS].sort());
  });
});

describe("tipWording", () => {
  it("says tap on a touch screen and click elsewhere (#45)", () => {
    expect(tipWording("{Tap} it, then {tap} again.", true)).toBe("Tap it, then tap again.");
    expect(tipWording("{Tap} it, then {tap} again.", false)).toBe("Click it, then click again.");
  });

  it("says the Inferno yard's own words there: Under Hall, Magma, Sulfur, Incubators, Compound", () => {
    const hatch = tipsFor(GuideScreen.MONSTERS_HATCH).map((tip) => tipWording(tip.text, false, "inferno"));
    expect(hatch).toEqual([
      "Incubators turn Magma into monsters. Queue several and come back later.",
      "Hatched monsters move into Compound. When it's full, hatching waits.",
    ]);
    expect(tipWording(tipsFor(GuideScreen.MONSTERS_UNLOCK)[0]!.text, false, "inferno")).toContain("Sulfur");
    expect(tipWording(tipsFor(GuideScreen.BUILD)[1]!.text, false, "inferno")).toBe(
      "Greyed-out buildings say what they need, usually a bigger Under Hall.",
    );
    expect(tipWording(tipsFor(GuideScreen.BUILD)[1]!.text, false, "surface")).toBe(
      "Greyed-out buildings say what they need, usually a bigger Town Hall.",
    );
  });

  it("leaves no token unfilled, and no surface word outside one, in either realm", () => {
    const surfaceWords = /\b(Town Hall|Flinger|Hatcher(y|ies)|Housing|Monster Academy|goo|putty|Twigs|Pebbles|Putty|Goo)\b/;
    for (const screen of SCREENS) {
      for (const tip of tipsFor(screen)) {
        for (const realm of ["surface", "inferno"] as const) {
          expect(tipWording(tip.text, false, realm), tip.text).not.toMatch(/[{}]/);
        }
        // The surface's two Map Rooms never show over the Inferno.
        if (screen === GuideScreen.MR1 || screen === GuideScreen.MR2) continue;
        expect(tip.text.replace(/\{[^}]+\}/g, ""), tip.text).not.toMatch(surfaceWords);
      }
    }
  });

  it("no tip says click or tap except through the token", () => {
    for (const screen of SCREENS) {
      for (const tip of tipsFor(screen)) {
        expect(tip.text.replace(/\{tap\}/gi, ""), tip.text).not.toMatch(/\b(click|tap)/i);
      }
    }
  });
});
