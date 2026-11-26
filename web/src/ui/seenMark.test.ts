// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SEEN_SHORT, seenDims, seenFaceMark, seenMark } from "./seenMark";

/** "Last seen" marks on list rows (beta 9): the three phase-1 sample looks. */
describe("last seen marks", () => {
  it("shows nothing for a hidden, active player", () => {
    for (const look of ["a", "b", "c"] as const) {
      expect(seenMark(null, look)).toBeNull();
      expect(seenFaceMark(null, look)).toBeNull();
    }
  });

  it("names every step in short words, with the full words as its title", () => {
    const mark = seenMark("weeks", "a")!;
    expect(mark.textContent).toBe(SEEN_SHORT.weeks);
    expect(mark.title).toBe("Last seen 1-4 weeks ago");
    expect(mark.getAttribute("aria-label")).toBe("Last seen 1-4 weeks ago");
    expect(seenMark("month", "a")!.textContent).toBe("1mo+");
  });

  it("look a: the painted hourglass only on the two inactive steps", () => {
    expect(seenMark("weeks", "a")!.querySelector("img")?.dataset["icon"]).toBe("time");
    expect(seenMark("month", "a")!.querySelector("img")?.dataset["icon"]).toBe("time");
    expect(seenMark("today", "a")!.querySelector("img")).toBeNull();
    expect(seenMark("online", "a")!.querySelector(".online-dot")).not.toBeNull();
  });

  it("look b: online and the hourglass on the face, not in the words", () => {
    expect(seenMark("online", "b")).toBeNull();
    expect(seenFaceMark("online", "b")?.classList.contains("online-dot")).toBe(true);
    expect((seenFaceMark("weeks", "b") as HTMLImageElement).dataset["icon"]).toBe("time");
    expect(seenFaceMark("today", "b")).toBeNull();
    expect(seenFaceMark("weeks", "a")).toBeNull();
  });

  it("look c: a painted seal on every offline step", () => {
    expect(seenMark("today", "c")!.querySelector("img")?.dataset["icon"]).toBe("habitactive");
    expect(seenMark("week", "c")!.querySelector("img")?.dataset["icon"]).toBe("habitunproven");
    expect(seenMark("weeks", "c")!.querySelector("img")?.dataset["icon"]).toBe("time");
    expect(seenMark("month", "c")!.querySelector("img")?.dataset["icon"]).toBe("habitfaded");
  });

  it("a row whose face carries the online dot leaves Online out of the words", () => {
    expect(seenMark("online", "a", { onlineOnFace: true })).toBeNull();
    expect(seenMark("today", "a", { onlineOnFace: true })?.textContent).toBe("Today");
  });

  it("fades an over-a-month face in looks a and b", () => {
    expect(seenDims("month", "a")).toBe(true);
    expect(seenDims("month", "b")).toBe(true);
    expect(seenDims("month", "c")).toBe(false);
    expect(seenDims("weeks", "a")).toBe(false);
  });
});
