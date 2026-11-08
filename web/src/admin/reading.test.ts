import { describe, expect, it } from "vitest";
import { readingSection } from "./reading";

const H = 1000;

describe("readingSection", () => {
  it("picks the section that fills the reading area, not the short one above it", () => {
    // Page ended: Moderators' tail still crosses the line, Moderator mail fills the area.
    const boxes = [
      { id: "moderators", top: -300, bottom: 260 },
      { id: "mail", top: 240, bottom: 900 },
    ];
    expect(readingSection(boxes, H)).toBe("mail");
  });

  it("follows the scroll: the section crossing the line with most of its height below it", () => {
    const boxes = [
      { id: "a", top: -800, bottom: 300 },
      { id: "b", top: 300, bottom: 1500 },
    ];
    expect(readingSection(boxes, H)).toBe("b");
    expect(readingSection([{ id: "a", top: -800, bottom: 900 }, { id: "b", top: 900, bottom: 1500 }], H)).toBe("a");
  });

  it("falls back to the last section that starts above the line when nothing fills it", () => {
    expect(readingSection([{ id: "a", top: -900, bottom: -100 }, { id: "b", top: -50, bottom: 100 }], H)).toBe("b");
    expect(readingSection([], H)).toBeUndefined();
  });
});
