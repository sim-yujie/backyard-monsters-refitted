import { describe, expect, test } from "bun:test";
import { ChampionListSchema, ChampionSchema } from "./ChampionSchema.js";

const gorgo = { t: 1, hp: 40_000, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };

describe("ChampionSchema", () => {
  test("keeps a champion's Mode through a save (#220)", () => {
    expect(ChampionSchema.parse({ ...gorgo, s: "defensive" }).s).toBe("defensive");
    const [entry] = ChampionListSchema.parse(JSON.stringify([{ ...gorgo, s: "offensive" }]))!;
    expect(entry!.s).toBe("offensive");
  });

  test("drops a Mode it does not know, and the rest of the entry stays", () => {
    const parsed = ChampionSchema.parse({ ...gorgo, s: "berserk" });
    expect(parsed.s).toBeUndefined();
    expect(parsed).toMatchObject(gorgo);
    expect(ChampionSchema.parse(gorgo).s).toBeUndefined();
  });
});
