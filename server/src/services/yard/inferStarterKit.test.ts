import { describe, expect, test } from "bun:test";
import { STARTER_KITS } from "../../game-data/starterKits.js";
import { kitBuildings } from "./starterKit.js";
import { inferStarterKit } from "./inferStarterKit.js";

describe("inferStarterKit", () => {
  for (const kit of STARTER_KITS) {
    test(`reads back the ${kit.name} from the yard it builds`, () => {
      const { buildingdata } = kitBuildings(kit, "resources", {});
      expect(inferStarterKit(buildingdata)).toBe(kit.id);
    });
  }

  test("an outpost with only its core has no kit", () => {
    expect(inferStarterKit({ "1": { t: 112, X: 0, Y: -50 } })).toBe(0);
    expect(inferStarterKit(null)).toBe(0);
  });
});
