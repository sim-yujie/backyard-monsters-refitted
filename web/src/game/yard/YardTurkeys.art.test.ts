import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { turkeyArt } from "./YardTurkeys";

const PUBLIC = path.resolve(__dirname, "../../../../server/public");

describe("The turkey strips follow the Classic/Modern switch (owner's picks, 8 Nov)", () => {
  it("draws Classic A or Modern A, both shipped, each with its golden strip", () => {
    for (const classic of [true, false]) {
      const art = turkeyArt(classic);
      const look = classic ? "classic" : "modern";
      expect(art.walk).toContain(`/turkey-${look}.png?v=`);
      expect(art.golden).toContain(`/turkey-${look}-golden.png?v=`);
      for (const url of [art.walk, art.golden]) {
        const file = path.join(PUBLIC, url.split("?")[0] ?? "");
        expect(existsSync(file), file).toBe(true);
      }
    }
  });
});
