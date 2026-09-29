import { describe, expect, it } from "vitest";
import { consumeMapFocus, recallMapView, rememberMapView, setMapFocus } from "./mapFocus";

/** Where the map opens: a one-shot focus, else where it was left (issue #153). */

const view = (yard: string) => ({
  yard,
  centre: { x: 1200, y: 900 },
  zoom: 0.5,
  selected: { col: 244, row: 209 },
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
    rememberMapView({ ...view("3510"), zoom: 1, selected: null });
    expect(recallMapView("3510")).toMatchObject({ zoom: 1, selected: null });
  });
});

describe("the one-shot focus", () => {
  it("is taken once", () => {
    setMapFocus({ cell: { col: 1, row: 2 } });
    expect(consumeMapFocus()).toEqual({ cell: { col: 1, row: 2 } });
    expect(consumeMapFocus()).toBeNull();
  });
});
