import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
    const names = new Set<string>(Object.values(TutTarget));
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

  it("no tip says click or tap except through the token", () => {
    for (const screen of SCREENS) {
      for (const tip of tipsFor(screen)) {
        expect(tip.text.replace(/\{tap\}/gi, ""), tip.text).not.toMatch(/\b(click|tap)/i);
      }
    }
  });
});
