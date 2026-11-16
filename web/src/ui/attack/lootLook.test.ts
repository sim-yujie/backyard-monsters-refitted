import { describe, expect, it } from "vitest";
import { lootLook } from "./lootLook";

describe("the loot design round's switch (?blp=, temporary)", () => {
  it("reads A, B or C from the address, any case", () => {
    expect(lootLook("?blp=A")).toBe("A");
    expect(lootLook("?x=1&blp=c")).toBe("C");
  });

  it("is off without it or with anything else", () => {
    expect(lootLook("")).toBeNull();
    expect(lootLook("?blp=D")).toBeNull();
  });
});
