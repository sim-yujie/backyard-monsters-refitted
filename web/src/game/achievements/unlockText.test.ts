import { describe, expect, it } from "vitest";
import { achievementLineText, nameList, shinyText, unlockLineText } from "./unlockText";

/** How an unlock reads on the bell and the card (#204, WP6). */

describe("unlock wording", () => {
  it("spells the Shiny, and nothing for none", () => {
    expect(shinyText(10)).toBe("+10 Shiny");
    expect(shinyText(1500)).toMatch(/^\+1[,.]?500 Shiny$/);
    expect(shinyText(0)).toBe("");
  });

  it("joins names with a final 'and'", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["A"])).toBe("A");
    expect(nameList(["A", "B"])).toBe("A and B");
    expect(nameList(["A", "B", "C"])).toBe("A, B and C");
  });

  it("words one unlock as the design's bell line", () => {
    expect(unlockLineText([{ name: "Town Planner", shiny: 10 }], false)).toBe(
      "Achievement earned: Town Planner, +10 Shiny",
    );
    expect(unlockLineText([{ name: "Free One", shiny: 0 }], false)).toBe("Achievement earned: Free One");
  });

  it("words the backfill's unlocks as one summary line", () => {
    expect(
      unlockLineText(
        [
          { name: "A", shiny: 5 },
          { name: "B", shiny: 10 },
          { name: "C", shiny: 10 },
        ],
        true,
      ),
    ).toBe("3 achievements earned for what you had already done: A, B and C, +25 Shiny");
  });

  it("reads a bell row's jobs, as the server writes them", () => {
    const job = (id: number, name: string, shiny: number, backfill = false) => ({
      kind: "achievement",
      id,
      t: null,
      at: 1,
      detail: { name, shiny, ...(backfill && { backfill: true }) },
    });
    expect(achievementLineText([job(2, "Town Planner", 10)])).toBe("Achievement earned: Town Planner, +10 Shiny");
    expect(achievementLineText([job(1, "A", 5, true), job(2, "B", 5, true)])).toBe(
      "2 achievements earned for what you had already done: A and B, +10 Shiny",
    );
    expect(achievementLineText([{ kind: "achievement", id: 4, detail: {} }])).toBe("Achievement earned: Achievement 4");
    expect(achievementLineText([])).toBe("Achievement earned");
  });
});
