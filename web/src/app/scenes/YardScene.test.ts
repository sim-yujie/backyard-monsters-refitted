// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import type { ViewTarget } from "@/game/attack/attackTarget";
import { INFERNO_YARD, MAIN_YARD, outpostTarget } from "@/game/yard/ownYards";
import { PlannerAccess } from "@/game/yard/planner/access";
import { dockButtonsFor } from "@/ui/yard/YardDock";
import {
  hudPoolFor,
  infernoViewFailureText,
  loadYardFor,
  plannerAccessFor,
  refusalNotice,
  storageText,
  whoseYard,
  yardDockOptions,
  type YardDockActions,
} from "./YardScene";

const response = { error: 0, id: 1, baseid: "1000", basesaveid: 1 } as BaseLoadResponse;

const api = () => ({
  loadOwnYard: vi.fn(() => Promise.resolve(response)),
  loadOwnBase: vi.fn(() => Promise.resolve(response)),
  viewBase: vi.fn(() => Promise.resolve(response)),
  loadFriendYard: vi.fn((_userid: number) => Promise.resolve(response)),
  loadInfernoYard: vi.fn(() => Promise.resolve(response)),
  viewInfernoYard: vi.fn((_baseid: string) => Promise.resolve(response)),
});

const visit = (kind: ViewTarget["kind"]): ViewTarget => ({
  baseid: "21970243208",
  kind,
  cell: { col: 243, row: 208 },
  name: "Abunakki",
  attack: null,
  refusal: "None of your flingers can reach this cell.",
});

describe("loadYardFor", () => {
  it("loads the player's own yard when there is no target", async () => {
    const loaders = api();
    await loadYardFor(null, loaders);
    expect(loaders.loadOwnYard).toHaveBeenCalledTimes(1);
    expect(loaders.viewBase).not.toHaveBeenCalled();
  });

  it("opens an own outpost by its baseid, and the main yard as it always did (#146)", async () => {
    const loaders = api();
    await loadYardFor(null, loaders, outpostTarget("2000242209", { col: 242, row: 209 }));
    await loadYardFor(null, loaders, MAIN_YARD);
    expect(loaders.loadOwnBase.mock.calls).toEqual([["2000242209"]]);
    expect(loaders.loadOwnYard).toHaveBeenCalledTimes(1);
    expect(loaders.viewBase).not.toHaveBeenCalled();
  });

  it("opens the Inferno yard with its own load, which names no yard (WP 1.18)", async () => {
    const loaders = api();
    await loadYardFor(null, loaders, INFERNO_YARD);
    expect(loaders.loadInfernoYard).toHaveBeenCalledTimes(1);
    expect(loaders.loadOwnYard).not.toHaveBeenCalled();
    expect(loaders.loadOwnBase).not.toHaveBeenCalled();
  });

  it("looks at another player's Inferno yard with the Inferno view, never the surface one (WP 3.4)", async () => {
    const loaders = api();
    await loadYardFor({ ...visit("main"), baseid: "5005", inferno: true }, loaders, INFERNO_YARD);
    expect(loaders.viewInfernoYard.mock.calls).toEqual([["5005"]]);
    expect(loaders.viewBase).not.toHaveBeenCalled();
    expect(loaders.loadInfernoYard).not.toHaveBeenCalled();
  });

  it("views a foreign target even when an own outpost was asked for", async () => {
    const loaders = api();
    await loadYardFor(visit("main"), loaders, outpostTarget("2000242209"));
    expect(loaders.loadOwnBase).not.toHaveBeenCalled();
    expect(loaders.viewBase).toHaveBeenCalledTimes(1);
  });

  it("never loads the own yard for a foreign target, and views it by kind", async () => {
    const loaders = api();
    await loadYardFor(visit("wild"), loaders);
    await loadYardFor(visit("main"), loaders);
    expect(loaders.loadOwnYard).not.toHaveBeenCalled();
    expect(loaders.viewBase.mock.calls).toEqual([
      ["21970243208", "wild"],
      ["21970243208", "main"],
    ]);
  });

  it("names Map Room 1 on a Map Room 1 visit, which has no cell", async () => {
    const loaders = api();
    const target: ViewTarget = { baseid: "11", kind: "wild", name: "Kozu Tribe", attack: null, refusal: null, mapversion: 1 };
    await loadYardFor(target, loaders);
    expect(loaders.viewBase.mock.calls).toEqual([["11", "wild", { mapversion: 1 }]]);
  });

  it("opens a friend's yard by the friend's user id, never by view (#372)", async () => {
    const loaders = api();
    const target: ViewTarget = { baseid: "", kind: "friend", friend: 77, name: "Bob", attack: null, refusal: null };
    await loadYardFor(target, loaders, outpostTarget("2000242209"));
    expect(loaders.loadFriendYard.mock.calls).toEqual([[77]]);
    expect(loaders.viewBase).not.toHaveBeenCalled();
    expect(loaders.loadOwnYard).not.toHaveBeenCalled();
    expect(loaders.loadOwnBase).not.toHaveBeenCalled();
  });
});

describe("hudPoolFor (#60)", () => {
  const defender = { resources: { r1: 9, r2: 9, r3: 9, r4: 9 }, credits: 9 };
  const mine = { r1: 1500, r2: 2500, r3: 3500, r4: 4500 };

  it("shows the yard's own pool on the player's own yard", () => {
    expect(hudPoolFor(null, defender)).toEqual(defender);
  });

  it("shows the visitor's own pool on a visit, never the defender's", () => {
    const target = { ...visit("wild"), own: { resources: mine, credits: 42 } };
    expect(hudPoolFor(target, defender)).toEqual({ resources: mine, credits: 42 });
  });

  it("leaves the placeholders when the map never read the own yard", () => {
    expect(hudPoolFor(visit("main"), defender)).toBeNull();
    expect(hudPoolFor({ ...visit("main"), own: { resources: null } }, defender)).toBeNull();
  });
});

describe("refusalNotice (#153)", () => {
  it("says why a visit has no Attack button, as text", () => {
    expect(refusalNotice(visit("wild"))).toBe("No attack from here: None of your flingers can reach this cell.");
  });

  it("says nothing on the own yard, or when the visit can attack", () => {
    const attack = { baseid: "21970243208", kind: "wild" } as unknown as NonNullable<ViewTarget["attack"]>;
    expect(refusalNotice(null)).toBeNull();
    expect(refusalNotice({ ...visit("wild"), attack, refusal: null })).toBeNull();
  });
});

describe("storageText (#128)", () => {
  it("says what Apply put into storage and took out", () => {
    expect(storageText({ stored: [], placed: [] })).toBe("");
    expect(storageText({ stored: [5], placed: [] })).toBe("1 decoration put in storage.");
    expect(storageText({ stored: [5, 6], placed: [9] })).toBe(
      "2 decorations put in storage. 1 decoration placed from storage.",
    );
  });
});

/**
 * Owner report 2026-10-22: the planner, opened over someone else's yard, read
 * out every building's level, tower ranges, storage room and the traps by kind
 * and count. It is the own yard's only, with no way in from a visit.
 */
describe("the planner on a visit (2026-10-22)", () => {
  const VISITS: ViewTarget[] = [
    visit("main"),
    visit("outpost"),
    visit("wild"),
    { baseid: "", kind: "friend", friend: 77, name: "Bob", attack: null, refusal: null },
    { baseid: "11", kind: "wild", name: "Kozu Tribe", attack: null, refusal: null, mapversion: 1 },
  ];

  const actions = (): YardDockActions => ({
    map: vi.fn(),
    home: vi.fn(),
    layout: vi.fn(),
    build: vi.fn(),
    yardSelect: vi.fn(),
    kits: vi.fn(),
    attack: vi.fn(),
  });

  it("opens on the player's own yard", () => {
    expect(plannerAccessFor(null)).toBe(PlannerAccess.EDIT);
    expect(dockButtonsFor(yardDockOptions(null, actions()), null).layout).toBe(true);
  });

  it("never opens on someone else's yard, of any kind", () => {
    for (const target of VISITS) {
      expect(plannerAccessFor(target)).toBe(PlannerAccess.LOCKED);
      expect(yardDockOptions(target, actions()).onLayout).toBeUndefined();
      expect(dockButtonsFor(yardDockOptions(target, actions()), null).layout).toBe(false);
    }
  });

  it("leaves a visit its way home and, where the gate passed, its attack", () => {
    const attack = { baseid: "21970243208", kind: "wild" } as unknown as NonNullable<ViewTarget["attack"]>;
    const options = yardDockOptions({ ...visit("wild"), attack, refusal: null }, actions());
    expect(dockButtonsFor(options, null)).toMatchObject({ home: true, attack: true, build: false, layout: false });
  });
});

describe("infernoViewFailureText", () => {
  const refused = (reason: string) =>
    new ApiError("refused", { status: 409, details: { data: { reason } } });

  it("says why another player's Inferno yard did not open (WP 3.4)", () => {
    expect(infernoViewFailureText("Bob", refused("targetUnderAttack"))).toBe(
      "Bob's Inferno yard is under attack. Look again when it is over.",
    );
    expect(infernoViewFailureText("Bob", refused("notInfernoPlayer"))).toBe(
      "Bob's Inferno yard cannot be looked at any more.",
    );
    expect(infernoViewFailureText("Bob", new NetworkError("down", null))).toBe(
      "Could not reach the server to look at Bob's Inferno yard.",
    );
    expect(infernoViewFailureText("Bob", new Error("?"))).toBe("Could not load Bob's Inferno yard.");
  });
});

describe("whoseYard", () => {
  it("names another player's Inferno yard as one, for the status line of a look (WP 3.4)", () => {
    expect(whoseYard({ ...visit("main"), inferno: true }, MAIN_YARD)).toBe("Abunakki's Inferno yard");
    expect(whoseYard(visit("main"), MAIN_YARD)).toBe("Abunakki's yard");
    expect(whoseYard(null, INFERNO_YARD)).toBe("your Inferno yard");
    expect(whoseYard(null, MAIN_YARD)).toBe("your yard");
  });
});
