// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { CUES, GUIDE_BUILDS, type GuideCue } from "@/game/guide/steps";
import { buttonUrl } from "@/game/yard/buildButtonArt";
import { guideCue } from "./guideCue";

describe("Bob's cue pictures", () => {
  it("draws a yard button as its dome with the dock's icon", () => {
    const cue = guideCue({ kind: "icon", name: "map" });
    expect(cue.className).toBe("guide-cue guide-cue--icon");
    expect(cue.dataset["name"]).toBe("map");
    expect(cue.querySelector("svg")).not.toBeNull();
  });

  it("draws a building as its Build menu card picture", () => {
    const image = guideCue({ kind: "building", type: 21 }).querySelector<HTMLImageElement>("img")!;
    expect(image.className).toBe("guide-cue__building");
    expect(image.getAttribute("src")).toBe(buttonUrl(21));
    expect(image.alt).toBe("");
  });

  it("draws Pokeys with their count", () => {
    const cue = guideCue({ kind: "pokeys", count: 15 });
    expect(cue.querySelector(".guide-cue__count")?.textContent).toBe("×15");
    expect(cue.querySelector<HTMLImageElement>(".guide-cue__monster")?.getAttribute("src")).toContain("C1");
  });

  it("draws a pile, the Shiny coin or a painted icon", () => {
    expect(guideCue({ kind: "resource", key: "shiny" }).querySelector(".res-icon--shiny")).not.toBeNull();
    const painted = guideCue({ kind: "painted", name: "shield" }).querySelector<HTMLImageElement>("img")!;
    expect(painted.dataset["icon"]).toBe("shield");
    expect(painted.getAttribute("aria-hidden")).toBe("true");
  });

  it("is a picture only: every cue Bob uses is hidden from a screen reader", () => {
    const cues: GuideCue[] = [
      ...Object.values(CUES),
      ...Object.values(GUIDE_BUILDS).map((build) => build.finishCue),
    ];
    for (const one of cues) expect(guideCue(one).getAttribute("aria-hidden")).toBe("true");
  });
});
