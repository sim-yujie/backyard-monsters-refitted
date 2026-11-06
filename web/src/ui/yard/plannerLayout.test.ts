import { describe, expect, it } from "vitest";
import { isPhone, PlannerLayout, plannerLayout, shownSheet, type SheetChoice, undoName } from "./plannerLayout";

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

describe("undoName", () => {
  it("names the key on a keyboard and the button on a touched screen", () => {
    expect(undoName(false)).toBe("Ctrl+Z");
    expect(undoName(true)).toBe("Undo");
  });
});

describe("shownSheet", () => {
  const choice = (over: Partial<SheetChoice> = {}): SheetChoice => ({
    layout: PlannerLayout.PORTRAIT,
    moreOpen: false,
    raised: "inspector",
    dockFilled: false,
    inspectorFilled: true,
    yardClear: false,
    ...over,
  });

  it("shows the coverage panel (the \"inspector\" sheet) when it is raised on a phone", () => {
    expect(shownSheet(choice())).toBe("inspector");
    expect(shownSheet(choice({ layout: PlannerLayout.LANDSCAPE }))).toBe("inspector");
  });

  // The player's report: a sheet opened over the yard while they lined a building up.
  it("shows no sheet while the yard is kept clear for a move, upright or sideways", () => {
    expect(shownSheet(choice({ yardClear: true }))).toBe("none");
    expect(shownSheet(choice({ layout: PlannerLayout.LANDSCAPE, yardClear: true }))).toBe("none");
    expect(shownSheet(choice({ yardClear: true, raised: "dock", dockFilled: true }))).toBe("none");
  });

  it("still opens More when the player asks for it", () => {
    expect(shownSheet(choice({ yardClear: true, moreOpen: true }))).toBe("more");
  });

  it("leaves a desktop's panels alone", () => {
    expect(shownSheet(choice({ layout: PlannerLayout.DESKTOP }))).toBeNull();
    expect(shownSheet(choice({ layout: PlannerLayout.DESKTOP, yardClear: true }))).toBeNull();
  });

  it("shows the docked panel the player raised last, else whichever has something", () => {
    expect(shownSheet(choice({ raised: "dock", dockFilled: true }))).toBe("dock");
    expect(shownSheet(choice({ raised: "dock", dockFilled: false }))).toBe("inspector");
    expect(shownSheet(choice({ inspectorFilled: false }))).toBe("dock");
  });
});
