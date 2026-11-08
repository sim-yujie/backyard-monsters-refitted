// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { RELATION_LOOK } from "@/game/maproom/relationLook";
import { MAP_LEGEND_TEXT, MapLegend, relationSwatch, swatchLineColour } from "./MapLegend";

/** The border colours' key on Map Room 2 (owner, 8 Nov 2026). */
describe("MapLegend", () => {
  const made: MapLegend[] = [];
  const make = (options?: { alliances?: boolean }): MapLegend => {
    const legend = new MapLegend(options);
    document.body.append(legend.toggle, legend.element);
    made.push(legend);
    return legend;
  };

  afterEach(() => {
    for (const legend of made.splice(0)) {
      legend.destroy();
      legend.toggle.remove();
      legend.element.remove();
    }
  });

  const rows = (legend: MapLegend): string[] =>
    [...legend.element.querySelectorAll<HTMLElement>(".mr2-key__row")].map(
      (row) => row.dataset["relation"]!,
    );

  it("lists yours, friend, pinned friend, hostile and neutral, leaving alliance out until alliances exist", () => {
    const legend = make();
    expect(rows(legend)).toEqual(["you", "friend", "pinned", "hostile", "other"]);
    const words = [...legend.element.querySelectorAll(".mr2-key__label")].map(
      (label) => label.textContent,
    );
    expect(words).toEqual(["Yours", "Friend", "Pinned friend", "Hostile", "Neutral"]);
  });

  it("shows the Alliance row once alliances are live", () => {
    expect(rows(make({ alliances: true }))).toEqual([
      "you",
      "friend",
      "pinned",
      "alliance",
      "hostile",
      "other",
    ]);
  });

  it("gives each row a swatch in its colour and a painted icon, except neutral", () => {
    const legend = make();
    const hostile = legend.element.querySelector<HTMLElement>('[data-relation="hostile"]')!;
    const strokes = [...hostile.querySelectorAll("polygon")].map((shape) =>
      shape.getAttribute("stroke"),
    );
    expect(strokes).toContain(swatchLineColour(RELATION_LOOK.hostile.colour));
    expect(hostile.querySelector("img")?.dataset["icon"]).toBe("swords");
    expect(legend.element.querySelector('[data-relation="other"] img')).toBeNull();
  });

  it("draws dashes for hostile, two lines for friends and three for pinned friends", () => {
    expect(relationSwatch("hostile").querySelector("[stroke-dasharray]")).not.toBeNull();
    const friendColour = swatchLineColour(RELATION_LOOK.friend.colour);
    const friendLines = [...relationSwatch("friend").querySelectorAll("polygon")].filter(
      (shape) => shape.getAttribute("stroke") === friendColour,
    );
    expect(friendLines).toHaveLength(2);
    const pinnedColour = swatchLineColour(RELATION_LOOK.pinned.colour);
    const pinnedLines = [...relationSwatch("pinned").querySelectorAll("polygon")].filter(
      (shape) => shape.getAttribute("stroke") === pinnedColour,
    );
    expect(pinnedLines).toHaveLength(3);
    expect(relationSwatch("other").querySelector("[stroke-dasharray]")).toBeNull();
  });

  it("shows the friend swatch in the colour the map line ends up (40 per cent towards white)", () => {
    expect(swatchLineColour(0xff5fd2)).toBe("#ff9fe4");
  });

  it("opens from the Key button and closes on a second press", () => {
    const legend = make();
    expect(legend.toggle.textContent).toContain(MAP_LEGEND_TEXT.button);
    expect(legend.open).toBe(false);
    legend.toggle.click();
    expect(legend.open).toBe(true);
    expect(legend.toggle.getAttribute("aria-expanded")).toBe("true");
    legend.toggle.click();
    expect(legend.open).toBe(false);
  });

  it("closes on Escape and on a press outside, but not on a press inside", () => {
    const legend = make();
    legend.setOpen(true);
    legend.element.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(legend.open).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(legend.open).toBe(false);
    legend.setOpen(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(legend.open).toBe(false);
  });
});
