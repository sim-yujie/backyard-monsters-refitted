import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { maxHealth } from "./buildingArt";
import { predictBank, type BankedByBuilding } from "./harvest";

/**
 * The balls a bank throws on the press and what the server then banks agree,
 * harvester for harvester (#208).
 *
 * `predictBank` is the client's copy of the server's `planBank`
 * (`server/src/services/yard/bank.ts`): which harvesters Collect all or a tap
 * takes, what each offers, and how the storage cap hands the pool's room out
 * in id order (`credit.ts` `fitCredit`). This drives both over the same saves
 * and requires the same `byBuilding`, so the balls carry what the answer will
 * credit and the correction at the end is nothing.
 *
 * The saves are caught up to `now` (`savetime` = `now`), as the server's
 * route banks straight after its catch-up; the catch-up's own agreement is
 * `harvest.ts`'s business (it mirrors `production.ts`).
 *
 * The server module is loaded by path at run time rather than imported, so
 * the web's type check does not walk the server's sources under the web's
 * compiler settings; `PlanBank` is the slice of its signature used here.
 */

type PlanBank = (
  save: object,
  request: { all: true } | { ids: readonly number[] },
  tutorialStage: number,
) => { report: { byBuilding: BankedByBuilding } };

const SERVER_BANK = fileURLToPath(
  new URL("../../../../server/src/services/yard/bank.ts", import.meta.url),
);

let planBank: PlanBank;
beforeAll(async () => {
  ({ planBank } = (await import(/* @vite-ignore */ SERVER_BANK)) as { planBank: PlanBank });
});

const NOW = 1_800_000_000;

const harvester = (id: number, t: number, st: number, extra: Record<string, unknown> = {}): BuildingData =>
  ({ X: 0, Y: 0, id, t, l: 1, st, pr: 1, cP: 10, ...extra }) as unknown as BuildingData;

interface Case {
  readonly name: string;
  readonly buildings: BuildingData[];
  readonly health?: Record<string, number>;
  readonly resources: { r1: number; r2: number; r3: number; r4: number };
  readonly cap: number;
  readonly ids: readonly number[] | "all";
  /** What both should say, where the case is about the numbers. */
  readonly expect?: Record<string, { resource: string; amount: number }>;
}

const max1 = maxHealth(1, 1)!;

const CASES: readonly Case[] = [
  {
    name: "Collect all over every kind of harvester, plenty of room",
    buildings: [
      harvester(1, 1, 700),
      harvester(2, 2, 300),
      harvester(3, 3, 120, { l: 2 }),
      harvester(4, 4, 55, { l: 3 }),
      harvester(9, 1, 0),
    ],
    resources: { r1: 100, r2: 100, r3: 100, r4: 100 },
    cap: 1_000_000,
    ids: "all",
  },
  {
    name: "Collect all leaves one mid-upgrade, one damaged and one not built",
    buildings: [
      harvester(1, 1, 400),
      harvester(2, 1, 300, { cU: 500 }),
      harvester(3, 1, 200),
      harvester(4, 1, 100, { cB: 50 }),
    ],
    health: { "3": Math.floor(max1 / 2) },
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    cap: 1_000_000,
    ids: "all",
  },
  {
    name: "Collect all into a nearly full silo: the room goes to the lowest ids",
    buildings: [harvester(7, 1, 500), harvester(3, 1, 500), harvester(5, 1, 500), harvester(6, 4, 90)],
    resources: { r1: 9_300, r2: 0, r3: 0, r4: 10_000 },
    cap: 10_000,
    ids: "all",
    expect: { "3": { resource: "r1", amount: 500 }, "5": { resource: "r1", amount: 200 } },
  },
  {
    name: "A tap on a damaged harvester still banks it",
    buildings: [harvester(3, 1, 200), harvester(4, 2, 50)],
    health: { "3": Math.floor(max1 / 2) },
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    cap: 1_000_000,
    ids: [3],
  },
  {
    name: "Taps on one busy, one empty and one full harvester",
    buildings: [harvester(1, 1, 300, { cU: 10 }), harvester(2, 3, 0), harvester(3, 3, 80)],
    resources: { r1: 0, r2: 0, r3: 950, r4: 0 },
    cap: 1_000,
    ids: [1, 2, 3],
    expect: { "3": { resource: "r3", amount: 50 } },
  },
];

describe("predictBank agrees with the server's planBank", () => {
  for (const one of CASES) {
    it(one.name, () => {
      const buildingdata = Object.fromEntries(one.buildings.map((b) => [String(b.id), b]));
      const save = {
        savetime: NOW,
        currenttime: NOW,
        buildingdata,
        buildinghealthdata: one.health ?? {},
        storedata: {},
      } as unknown as BaseLoadResponse;
      const caps = { r1: one.cap, r2: one.cap, r3: one.cap, r4: one.cap };

      const server = planBank(
        {
          buildingdata,
          buildinghealthdata: one.health ?? {},
          storedata: {},
          resources: one.resources,
          poolCap: one.cap,
        },
        one.ids === "all" ? { all: true } : { ids: one.ids },
        999,
      ).report.byBuilding;
      const client = predictBank(save, NOW, one.ids, one.resources, caps);

      expect(client).toEqual(server);
      expect(Object.keys(server).length).toBeGreaterThan(0);
      if (one.expect) expect(server).toEqual(one.expect);
    });
  }
});
