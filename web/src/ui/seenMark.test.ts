// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SEEN_SHORT, seenDims, seenMark } from "./seenMark";

/** "Last seen" marks on list rows (beta 9, the owner's pick: quiet words, hourglass pills when inactive). */
describe("last seen marks", () => {
  it("shows nothing for a hidden, active player", () => {
    expect(seenMark(null)).toBeNull();
  });

  it("names every step in short words, with the full words as its title", () => {
    const mark = seenMark("weeks")!;
    expect(mark.textContent).toBe(SEEN_SHORT.weeks);
    expect(mark.title).toBe("Last seen 1-4 weeks ago");
    expect(mark.getAttribute("aria-label")).toBe("Last seen 1-4 weeks ago");
    expect(seenMark("month")!.textContent).toBe("1mo+");
    expect(seenMark("week")!.textContent).toBe("This wk");
  });

  it("never writes 1m, which reads as a minute", () => {
    for (const words of Object.values(SEEN_SHORT)) expect(words).not.toMatch(/^1m$|\b1m\b/);
  });

  it("puts the painted hourglass only on the two inactive steps, and the dot on online", () => {
    expect(seenMark("weeks")!.querySelector("img")?.dataset["icon"]).toBe("time");
    expect(seenMark("month")!.querySelector("img")?.dataset["icon"]).toBe("time");
    expect(seenMark("today")!.querySelector("img")).toBeNull();
    expect(seenMark("week")!.querySelector("img")).toBeNull();
    expect(seenMark("online")!.querySelector(".online-dot")).not.toBeNull();
    expect(seenMark("online")!.textContent).toBe("Online");
  });

  it("fades only an over-a-month face", () => {
    expect(seenDims("month")).toBe(true);
    expect(seenDims("weeks")).toBe(false);
    expect(seenDims(null)).toBe(false);
  });
});
