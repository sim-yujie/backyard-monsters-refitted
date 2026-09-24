import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./http";
import { LAYOUT_VERSION } from "./types";
import {
  applyConflictIds,
  applyLayout,
  MAX_LAYOUT_NAME_LENGTH,
  normaliseLayoutName,
  rearmTraps,
  upgradeWalls,
} from "./yardplanner";

/** A rejection as the server sends it: a flat body, no `errorDetails`. */
const rejection = (status: number, body: Record<string, unknown>): ApiError =>
  new ApiError(String(body["error"] ?? "failed"), { status, body });

describe("applyConflictIds", () => {
  it("reads the 409 unplaced list", () => {
    const caught = rejection(409, { error: "Some buildings are missing", unplaced: [32, 33] });
    expect(applyConflictIds(caught)).toEqual([32, 33]);
  });

  it("reads the 400 overlapping list", () => {
    const caught = rejection(400, { error: "Two buildings overlap", overlapping: [7, 9] });
    expect(applyConflictIds(caught)).toEqual([7, 9]);
  });

  it("reads the 400 unknown list", () => {
    expect(applyConflictIds(rejection(400, { error: "No such building", unknown: [404] }))).toEqual([
      404,
    ]);
  });

  it("merges several lists and drops duplicates", () => {
    const caught = rejection(400, { error: "Bad layout", overlapping: [1, 2], unknown: [2, 3] });
    expect(applyConflictIds(caught).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it("still reads a body nested under errorDetails", () => {
    const caught = new ApiError("Bad layout", {
      status: 400,
      details: { status: 400, data: { overlapping: [5] } },
    });
    expect(applyConflictIds(caught)).toEqual([5]);
  });

  it("is empty when the server named nothing", () => {
    expect(applyConflictIds(rejection(400, { error: "Bad layout" }))).toEqual([]);
    expect(applyConflictIds(rejection(400, {}))).toEqual([]);
  });

  it("ignores anything that is not a number", () => {
    const caught = rejection(409, { error: "x", unplaced: ["32", null, 33, {}] });
    expect(applyConflictIds(caught)).toEqual([33]);
  });

  it("tolerates a body that is a bare string or missing", () => {
    expect(applyConflictIds(new ApiError("down", { status: 500, body: "Server Error" }))).toEqual(
      [],
    );
    expect(applyConflictIds(new ApiError("down", { status: 500 }))).toEqual([]);
  });

  it("returns nothing for a failure that is not an ApiError", () => {
    expect(applyConflictIds(new Error("offline"))).toEqual([]);
    expect(applyConflictIds(null)).toEqual([]);
  });

  it("reads the batch wall upgrade's own four lists", () => {
    expect(applyConflictIds(rejection(400, { error: "x", notWalls: [11] }))).toEqual([11]);
    expect(applyConflictIds(rejection(400, { error: "x", alreadyAtLevel: [12] }))).toEqual([12]);
    expect(applyConflictIds(rejection(400, { error: "x", busy: [13] }))).toEqual([13]);
    expect(applyConflictIds(rejection(400, { error: "x", damaged: [14] }))).toEqual([14]);
  });

  it("merges a wall rejection that names several faults at once", () => {
    const caught = rejection(400, {
      error: "Those walls cannot be upgraded",
      busy: [1, 2],
      damaged: [2, 3],
      unknown: [4],
    });
    expect(applyConflictIds(caught).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("reads the two a planned upgrade can trip", () => {
    expect(applyConflictIds(rejection(400, { error: "x", planLevel: [32] }))).toEqual([32]);
    expect(applyConflictIds(rejection(400, { error: "x", planCaughtUp: [33] }))).toEqual([33]);
  });
});

/* ── The batch routes ─────────────────────────────────────────────────────── */

/**
 * What the server was actually sent.
 *
 * The two batch calls are one line each, so the only thing worth testing is the
 * thing the server has to agree with: the path, and structure JSON-stringified
 * into a single form field rather than sent as nested JSON.
 */
const sent: { url: string; body: URLSearchParams }[] = [];

const stubFetch = (payload: Record<string, unknown>): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      sent.push({ url, body: new URLSearchParams(String(init.body)) });
      return Promise.resolve(
        new Response(JSON.stringify({ error: 0, ...payload }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("upgradeWalls", () => {
  it("posts the ids as a JSON string beside a plain level", async () => {
    stubFetch({ upgraded: 2, level: 5, cost: { r1: 1, r2: 2, r3: 0, r4: 0 } });
    const response = await upgradeWalls([7, 9], 5);

    const call = sent[0]!;
    expect(call.url).toContain("/bm/yardplanner/walls/upgrade");
    expect(call.body.get("ids")).toBe("[7,9]");
    expect(call.body.get("level")).toBe("5");
    expect(response.upgraded).toBe(2);
  });
});

describe("applyLayout", () => {
  const payload = {
    version: LAYOUT_VERSION,
    expansion: 6,
    nodes: [{ id: 32, t: 20, x: 180, y: -480, plan: { level: 3, order: 0 } }],
  };

  it("posts the layout as a JSON string and nothing else by default", async () => {
    stubFetch({ moved: 1, buildingdata: {} });
    await applyLayout(payload);

    const call = sent[0]!;
    expect(call.url).toContain("/bm/yardplanner/apply");
    expect(JSON.parse(String(call.body.get("data")))).toEqual(payload);
    // Absent, not "0": a server that predates planned upgrades must read this
    // request exactly as it read yesterday's.
    expect(call.body.has("startUpgrades")).toBe(false);
  });

  it("asks for the upgrade walk with the flag the server reads", async () => {
    stubFetch({ moved: 0, buildingdata: {}, upgrades: null });
    await applyLayout(payload, { startUpgrades: true });

    expect(sent[0]!.body.get("startUpgrades")).toBe("1");
  });

  it("hands back the resources and the report the walk returned", async () => {
    stubFetch({
      moved: 0,
      buildingdata: {},
      resources: { r1: 10 },
      upgrades: {
        started: [{ id: 32, t: 20, from: 1, to: 2, seconds: 900, cost: { r1: 1, r2: 0, r3: 0, r4: 0 } }],
        finished: [],
        waiting: [],
        skipped: [],
        cost: { r1: 1, r2: 0, r3: 0, r4: 0 },
        points: 0,
        workers: { total: 5, busyBefore: 0, busyAfter: 1 },
      },
    });

    const response = await applyLayout(payload, { startUpgrades: true });
    expect(response.resources).toEqual({ r1: 10 });
    expect(response.upgrades?.started[0]?.seconds).toBe(900);
  });
});

describe("rearmTraps", () => {
  it("posts the placements as a JSON string in one field", async () => {
    stubFetch({ placed: 1, ids: [601], firedtraps: [] });
    const response = await rearmTraps([{ t: 24, x: 105, y: -60 }]);

    const call = sent[0]!;
    expect(call.url).toContain("/bm/yardplanner/traps/rearm");
    expect(call.body.get("traps")).toBe('[{"t":24,"x":105,"y":-60}]');
    expect(response.ids).toEqual([601]);
  });
});

describe("normaliseLayoutName", () => {
  it("trims surrounding space", () => {
    expect(normaliseLayoutName("  Turtle v3  ")).toBe("Turtle v3");
  });

  it("cuts to the maximum length", () => {
    const long = "x".repeat(MAX_LAYOUT_NAME_LENGTH + 10);
    expect(normaliseLayoutName(long)).toHaveLength(MAX_LAYOUT_NAME_LENGTH);
  });

  it("trims before cutting, so trailing space does not eat the limit", () => {
    expect(normaliseLayoutName(`  ${"a".repeat(MAX_LAYOUT_NAME_LENGTH)}  `)).toHaveLength(
      MAX_LAYOUT_NAME_LENGTH,
    );
  });

  it("leaves an empty name empty for the caller to default", () => {
    expect(normaliseLayoutName("   ")).toBe("");
  });
});
