import { describe, expect, it } from "vitest";
import { cardOnEntry, consumeMapFocus, recallMapView, rememberMapView, setMapFocus } from "./mapFocus";

/** Where the map opens: a one-shot focus, else where it was left (issue #153). */

const view = (yard: string) => ({
  yard,
  centre: { x: 1200, y: 900 },
  zoom: 0.5,
});

describe("the map view left behind (#153)", () => {
  it("is recalled for the account that left it, every time the map opens", () => {
    rememberMapView(view("3510"));
    expect(recallMapView("3510")).toEqual(view("3510"));
    expect(recallMapView("3510")).toEqual(view("3510"));
  });

  it("is nobody else's: another account signing in on the page starts at home", () => {
    rememberMapView(view("3510"));
    expect(recallMapView("1000")).toBeNull();
  });

  it("the latest view replaces the last", () => {
    rememberMapView(view("3510"));
    rememberMapView({ ...view("3510"), zoom: 1 });
    expect(recallMapView("3510")).toMatchObject({ zoom: 1 });
  });
});

describe("the one-shot focus", () => {
  it("is taken once", () => {
    setMapFocus({ cell: { col: 1, row: 2 } });
    expect(consumeMapFocus()).toEqual({ cell: { col: 1, row: 2 } });
    expect(consumeMapFocus()).toBeNull();
  });
});

describe("no card pops up on the way into the map (owner, 12 Nov 2026)", () => {
  it("the view left behind keeps the camera, not the cell that was open", () => {
    rememberMapView(view("3510"));
    expect(recallMapView("3510")).not.toHaveProperty("selected");
  });

  it("a focus only centres the map unless the player asked for that cell", () => {
    // Leaving an outpost for the map: centred on it, card shut.
    expect(cardOnEntry({ cell: { col: 240, row: 208 } })).toBe(false);
    // A "Show on map" / "Map" button, or back from attacking it: its panel opens.
    expect(cardOnEntry({ cell: { col: 240, row: 208 }, open: true })).toBe(true);
  });
});
