import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHANGELOG } from "./index";

const PUBLIC = fileURLToPath(new URL("../../../public", import.meta.url));

describe("the changelog pictures", () => {
  it("are all shipped in web/public", () => {
    for (const card of CHANGELOG.flatMap((release) => release.cards)) {
      expect(existsSync(`${PUBLIC}${card.image}`), card.image).toBe(true);
    }
  });
});
