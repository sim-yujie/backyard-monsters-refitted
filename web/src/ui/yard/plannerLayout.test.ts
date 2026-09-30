import { describe, expect, it } from "vitest";
import { costLineParts, isPhone, PlannerLayout, plannerLayout, undoName } from "./plannerLayout";

describe("plannerLayout", () => {
  it("lays a phone held upright out as a phone", () => {
    expect(plannerLayout(412, 915, true)).toBe(PlannerLayout.PORTRAIT);
    expect(plannerLayout(360, 740, true)).toBe(PlannerLayout.PORTRAIT);
  });

  it("lays a phone on its side out with one bar", () => {
    expect(plannerLayout(915, 412, true)).toBe(PlannerLayout.LANDSCAPE);
    expect(plannerLayout(740, 360, true)).toBe(PlannerLayout.LANDSCAPE);
  });

  it("leaves tablets and desktops as they are", () => {
    expect(plannerLayout(768, 1024, true)).toBe(PlannerLayout.DESKTOP);
    expect(plannerLayout(1024, 768, true)).toBe(PlannerLayout.DESKTOP);
    expect(plannerLayout(1440, 900, false)).toBe(PlannerLayout.DESKTOP);
    // A laptop window dragged short keeps its mouse and its full bars.
    expect(plannerLayout(1280, 480, false)).toBe(PlannerLayout.DESKTOP);
  });

  it("treats any window 620 px wide or less as upright, as the bars' own rules do", () => {
    expect(plannerLayout(620, 900, false)).toBe(PlannerLayout.PORTRAIT);
    expect(plannerLayout(621, 900, false)).toBe(PlannerLayout.DESKTOP);
  });

  it("says which layouts are phones", () => {
    expect(isPhone(PlannerLayout.PORTRAIT)).toBe(true);
    expect(isPhone(PlannerLayout.LANDSCAPE)).toBe(true);
    expect(isPhone(PlannerLayout.DESKTOP)).toBe(false);
  });
});

describe("costLineParts", () => {
  const zero = { r1: 0, r2: 0, r3: 0, r4: 0 };

  it("names only what costs something, compact, then the time", () => {
    expect(costLineParts({ r1: 500_000, r2: 0, r3: 2_500, r4: 0 }, zero, 90_000)).toEqual([
      { key: "r1", text: "500.0K", short: false },
      { key: "r3", text: "2.5K", short: false },
      { key: "time", text: "1d 1h", short: false },
    ]);
  });

  it("marks what the yard is short of", () => {
    const parts = costLineParts({ r1: 10, r2: 20, r3: 0, r4: 0 }, { r1: 0, r2: 5, r3: 0, r4: 0 }, 0);
    expect(parts.map((part) => part.short)).toEqual([false, true]);
  });

  it("is empty when nothing costs anything", () => {
    expect(costLineParts(zero, zero, 0)).toEqual([]);
  });
});

describe("undoName", () => {
  it("names the key on a keyboard and the button on a touched screen", () => {
    expect(undoName(false)).toBe("Ctrl+Z");
    expect(undoName(true)).toBe("Undo");
  });
});
