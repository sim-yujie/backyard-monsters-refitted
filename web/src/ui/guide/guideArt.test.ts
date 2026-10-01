import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOB_HAND, BOB_ICON, bobBust, GUIDE_FILES } from "./guideArt";

/** Bob's art, design A (issue #227): `web/public/guide/`, from `web/tools/gen-guide-art.py`. */

const publicFile = (file: string): string =>
  fileURLToPath(new URL(`../../../public/guide/${file}.webp`, import.meta.url));

describe("Bob's art", () => {
  it("every file the kit draws is published", () => {
    for (const file of GUIDE_FILES) expect(existsSync(publicFile(file)), file).toBe(true);
  });

  it("names the bust by mood, the head and the hand", () => {
    expect(bobBust()).toBe("/guide/bob.webp");
    expect(bobBust("worried")).toBe("/guide/bob-worried.webp");
    expect(BOB_ICON).toBe("/guide/bob-icon.webp");
    expect(BOB_HAND).toBe("/guide/hand.webp");
  });
});
