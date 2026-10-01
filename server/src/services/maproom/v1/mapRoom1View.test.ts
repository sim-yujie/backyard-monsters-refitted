import { describe, expect, test } from "bun:test";
import { mapRoom1View } from "./mapRoom1View.js";

/** The Map Room 1 read's practice camp entry (issue #227, `docs/design/tutorial.md` §5.5). */
describe("mapRoom1View practice camp", () => {
  const base = { now: 100, level: 1, protectedUntil: 0, slots: [], statuses: [], neighbours: [] };

  test("absent unless the camp is open", () => {
    expect(mapRoom1View({ ...base, tribedata: [] }).practice).toBeUndefined();
    expect(mapRoom1View({ ...base, tribedata: [], practice: null }).practice).toBeUndefined();
  });

  test("carries the camp's state and the guide's step", () => {
    const view = mapRoom1View({
      ...base,
      tribedata: [{ baseid: "1", tribeHealthData: {}, damage: 45 }],
      practice: { baseid: "1", name: "Practice camp", step: "pick-camp" },
    });
    expect(view.practice).toEqual({
      baseid: "1",
      name: "Practice camp",
      level: 1,
      destroyed: 0,
      damage: 45,
      step: "pick-camp",
    });
  });
});
