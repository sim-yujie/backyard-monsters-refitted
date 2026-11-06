import { describe, expect, test } from "bun:test";
import { WishesSchema } from "../../controllers/friends/gift.js";
import { normaliseJsonBody } from "../../middleware/jsonBody.js";
import { MAX_GIFT_WISHES, readWishes, storedWishes } from "./giftWishes.js";

/** Gift wishes (#391): up to 3 of the four gift resources, stored as `r1,r3`. */
describe("gift wishes", () => {
  test("read back as stored, known resources only, each once, at most 3", () => {
    expect(readWishes("r1,r3")).toEqual(["r1", "r3"]);
    expect(readWishes(null)).toEqual([]);
    expect(readWishes("")).toEqual([]);
    expect(readWishes("r4,r4,shiny,r2,r1,r3")).toEqual(["r4", "r2", "r1"]);
    expect(MAX_GIFT_WISHES).toBe(3);
  });

  test("stored as a comma list, null for none", () => {
    expect(storedWishes(["r2", "r4"])).toBe("r2,r4");
    expect(storedWishes([])).toBeNull();
    expect(readWishes(storedWishes(["r1", "r2", "r3"]))).toEqual(["r1", "r2", "r3"]);
  });

  test("the route takes up to 3 known resources, each once", () => {
    expect(WishesSchema.parse({ wishes: ["r1", "r3"] })).toEqual({ wishes: ["r1", "r3"] });
    expect(WishesSchema.parse({ wishes: [] })).toEqual({ wishes: [] });
    expect(() => WishesSchema.parse({ wishes: ["r1", "r2", "r3", "r4"] })).toThrow();
    expect(() => WishesSchema.parse({ wishes: ["r1", "r1"] })).toThrow();
    expect(() => WishesSchema.parse({ wishes: ["shiny"] })).toThrow();
    expect(() => WishesSchema.parse({ wishes: ["r1"], extra: 1 })).toThrow();
  });

  test("the route reads a JSON body's array, which arrives re-stringified (middleware/jsonBody.ts)", () => {
    expect(WishesSchema.parse(normaliseJsonBody({ wishes: ["r2", "r4"] }))).toEqual({ wishes: ["r2", "r4"] });
    expect(WishesSchema.parse(normaliseJsonBody({ wishes: [] }))).toEqual({ wishes: [] });
    expect(() => WishesSchema.parse({ wishes: "r1,r2" })).toThrow();
    expect(() => WishesSchema.parse(normaliseJsonBody({ wishes: ["r1", "r1"] }))).toThrow();
  });
});
