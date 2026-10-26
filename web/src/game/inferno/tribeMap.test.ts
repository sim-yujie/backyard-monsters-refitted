import { describe, expect, it } from "vitest";
import type { InfernoTribeView } from "@/api/inferno";
import {
  TRIBE_NO_MONSTERS,
  TRIBE_START_FAILED,
  TribeSort,
  TribeState,
  respawnDue,
  respawnLeft,
  respawnText,
  serverNow,
  sortTribeRows,
  tribeListName,
  tribeMapName,
  tribeRefusal,
  tribeRows,
  tribeSpot,
} from "./tribeMap";

/**
 * The Inferno map's rows (WP 2.9): Flash's names, the tribe's slot on the
 * map (`PlayerLayer.setMapCoords`), wrecked or standing with its countdown,
 * and the list's order.
 */

const NOW = 1_000_000;

const view = (baseid: number, level: number, destroyed: 0 | 1 = 0, respawnat = 0, damage = 0): InfernoTribeView => ({
  baseid: String(baseid),
  level,
  destroyed,
  respawnat,
  damage,
});

/** The first band at Inferno level 5: bases 214-220 at -2, -1, 0, 0, 0, +1, +3. */
const BAND = [view(214, 3), view(215, 4), view(216, 5), view(217, 5), view(218, 5), view(219, 6), view(220, 8)];

describe("names", () => {
  it("are Flash's: the map's and the list's", () => {
    expect(tribeMapName()).toBe("Moloch's Minions");
    expect(tribeListName(7)).toBe("Moloch's Minions, Level 7");
  });
});

describe("tribeSpot", () => {
  it("puts a tribe on slot baseid % 10, snapped to Flash's 90 px grid", () => {
    // Slot 4 (570, 1000): mapX 6, mapY (870 / 90) 9.
    expect(tribeSpot("214")).toEqual({ x: 570, y: 840 });
    // Slot 0 (350, 320): mapX 3, mapY 2.
    expect(tribeSpot("220")).toEqual({ x: 300, y: 210 });
    expect(tribeSpot("230")).toEqual(tribeSpot("220"));
  });

  it("gives the seven tribes of a band seven places", () => {
    for (const first of [214, 221, 228]) {
      const spots = Array.from({ length: 7 }, (_, index) => JSON.stringify(tribeSpot(String(first + index))));
      expect(new Set(spots).size).toBe(7);
    }
  });

  it("keeps every place on the 1600 x 1200 map", () => {
    for (let baseid = 214; baseid <= 234; baseid += 1) {
      const { x, y } = tribeSpot(String(baseid));
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1600);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1200);
    }
  });
});

describe("tribeRows", () => {
  it("makes one row per tribe, in the server's order", () => {
    const rows = tribeRows({ tribes: BAND }, NOW);
    expect(rows.map((row) => row.baseid)).toEqual(["214", "215", "216", "217", "218", "219", "220"]);
    expect(rows[6]).toMatchObject({
      level: 8,
      name: "Moloch's Minions",
      listName: "Moloch's Minions, Level 8",
      state: TribeState.ATTACKABLE,
      respawnAt: null,
    });
  });

  it("shows a wrecked tribe with its comeback", () => {
    const [row] = tribeRows({ tribes: [view(216, 5, 1, NOW + 125, 100)] }, NOW);
    expect(row).toMatchObject({ state: TribeState.DESTROYED, respawnAt: NOW + 125, damage: 100 });
    expect(respawnLeft(row!, NOW)).toBe(125);
    expect(respawnText(row!, NOW)).toBe("Back in 2:05");
  });

  it("stands a tribe again once its comeback has passed", () => {
    const [row] = tribeRows({ tribes: [view(216, 5, 1, NOW - 1)] }, NOW);
    expect(row).toMatchObject({ state: TribeState.ATTACKABLE, respawnAt: null });
    expect(respawnLeft(row!, NOW)).toBeNull();
    expect(respawnText(row!, NOW)).toBe("");
  });

  it("keeps a standing tribe's damage, held to 0-100", () => {
    const rows = tribeRows({ tribes: [view(214, 3, 0, 0, 42.7), view(215, 4, 0, 0, 140)] }, NOW);
    expect(rows.map((row) => row.damage)).toEqual([42, 100]);
  });

  it("reads a level below 1 as 1", () => {
    expect(tribeRows({ tribes: [view(214, 0)] }, NOW)[0]!.level).toBe(1);
  });
});

describe("respawnDue", () => {
  it("is true once a wrecked tribe's time is up", () => {
    const rows = tribeRows({ tribes: [view(214, 3, 1, NOW + 10)] }, NOW);
    expect(respawnDue(rows, NOW + 9)).toBe(false);
    expect(respawnDue(rows, NOW + 10)).toBe(true);
    expect(respawnDue(tribeRows({ tribes: BAND }, NOW), NOW + 99_999)).toBe(false);
  });
});

describe("sortTribeRows", () => {
  const rows = tribeRows({ tribes: [view(214, 3), view(215, 4, 1, NOW + 60), view(216, 5), view(220, 8)] }, NOW);

  it("opens in the server's order, the wrecked last", () => {
    expect(sortTribeRows(rows, TribeSort.DEFAULT).map((row) => row.baseid)).toEqual(["214", "216", "220", "215"]);
  });

  it("sorts by level highest first, then lowest first reversed", () => {
    expect(sortTribeRows(rows, TribeSort.LEVEL).map((row) => row.level)).toEqual([8, 5, 3, 4]);
    expect(sortTribeRows(rows, TribeSort.LEVEL, true).map((row) => row.level)).toEqual([3, 5, 8, 4]);
  });

  it("keeps the server's order between equal levels", () => {
    const tied = tribeRows({ tribes: [view(216, 5), view(217, 5), view(218, 5)] }, NOW);
    expect(sortTribeRows(tied, TribeSort.LEVEL).map((row) => row.baseid)).toEqual(["216", "217", "218"]);
  });

  it("leaves the rows it was given alone", () => {
    const before = rows.map((row) => row.baseid);
    sortTribeRows(rows, TribeSort.LEVEL);
    expect(rows.map((row) => row.baseid)).toEqual(before);
  });
});

describe("serverNow", () => {
  it("moves the server's time on by the seconds since the answer", () => {
    expect(serverNow(NOW, 5_000, 5_000)).toBe(NOW);
    expect(serverNow(NOW, 5_000, 7_900)).toBe(NOW + 2);
    expect(serverNow(NOW, 5_000, 4_000)).toBe(NOW);
  });
});

describe("tribeRefusal", () => {
  it("uses Flash's words with nothing housed", () => {
    expect(tribeRefusal("noMonsters", null, NOW)).toEqual({ text: TRIBE_NO_MONSTERS, refresh: false });
  });

  it("says when a wrecked tribe is back, and asks the map again", () => {
    expect(tribeRefusal("tribeDestroyed", NOW + 61, NOW)).toEqual({
      text: "Moloch's Minions are wrecked. They are back in 1:01.",
      refresh: true,
    });
    expect(tribeRefusal("tribeDestroyed", null, NOW).refresh).toBe(true);
  });

  it("asks the map again for a tribe that moved on", () => {
    expect(tribeRefusal("notYourTribe", null, NOW).refresh).toBe(true);
    expect(tribeRefusal("notInfernoTribe", null, NOW).refresh).toBe(true);
  });

  it("falls back to a plain failure", () => {
    expect(tribeRefusal(null, null, NOW)).toEqual({ text: TRIBE_START_FAILED, refresh: false });
    expect(tribeRefusal("underAttack", null, NOW).text).toMatch(/under attack/);
  });
});
