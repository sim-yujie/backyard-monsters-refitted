// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/config";
import type { ChampionOwnership, MonsterCount, MonsterStats, TribeCount } from "./api";
import { campLevels, countingWords, MonstersView, periodWords, share } from "./monsters";

/** The Monsters tab of Game activity (owner, 23 Nov 2026; layout A). */

const IDS = [...Array.from({ length: 17 }, (_, i) => `C${i + 1}`), "C19", ...Array.from({ length: 8 }, (_, i) => `IC${i + 1}`)];
const NAMES: Record<string, string> = { C1: "Pokey", C2: "Octo-ooze", C5: "Eye-ra", IC2: "Zagnoid" };

const monster = (id: string, flung: number, attacks: number, days: number): MonsterCount => ({
  id,
  name: NAMES[id] ?? id,
  kind: id.startsWith("IC") ? "inferno" : "normal",
  maxLevel: id === "C15" ? 5 : 6,
  flung,
  attacks,
  players: attacks,
  levels: Array.from({ length: id === "C15" ? 5 : 6 }, (_, i) => ({ level: i + 1, flung: i === 2 ? flung : 0, attacks: i === 2 ? attacks : 0, players: i === 2 ? attacks : 0 })),
  daily: Array.from({ length: days }, (_, i) => (i === days - 1 ? flung : 0)),
});

const tribe = (key: string, name: string, where: TribeCount["where"], attacks: number, more: Partial<TribeCount> = {}): TribeCount => ({
  key,
  name,
  where,
  attacks,
  players: attacks,
  range: [1, 13],
  levels: [],
  ...more,
});

const stats = (days: string[], over: Partial<MonsterStats> = {}): MonsterStats => {
  const flung = { C1: 40, C2: 90, C5: 10, IC2: 7 } as Record<string, number>;
  const monsters = IDS.map((id) => monster(id, flung[id] ?? 0, flung[id] ? 2 : 0, days.length));
  return {
    generatedAt: "2026-11-24T10:00:00Z",
    period: "30",
    since: days[0] ?? null,
    daysCounted: days.length,
    days,
    players: { attacks: 4, players: 3, flung: 147, daily: days.map(() => 0), monsters },
    camps: {
      attacks: 3,
      players: 2,
      flung: 9,
      daily: days.map(() => 0),
      monsters: IDS.map((id) => monster(id, id === "C9" ? 9 : 0, id === "C9" ? 3 : 0, days.length)),
      tribes: [
        tribe("mr2:kozu", "Kozu", "Map Room 2", 2, { range: [30, 42], only: [30, 34, 38, 42], levels: [{ level: 34, attacks: 2, players: 1 }] }),
        tribe("inferno:moloch", "Moloch", "Inferno", 1, { range: [1, 59], levels: [{ level: 9, attacks: 1, players: 1 }] }),
        tribe("mr1:practice", "Practice camp", "Map Room 1", 0, { range: null }),
        tribe("descent:descent", "Descent", "Descent", 0),
      ],
    },
    assumed: 2,
    unreplayed: 0,
    ...over,
  };
};

const champions: ChampionOwnership = {
  generatedAt: "2026-11-24T10:00:00Z",
  active: { players: 10, none: 4, owned: ["G1", "G2", "G3", "G4", "G5"].map((id, i) => ({ id, count: i + 1 })), byCount: [5, 1] },
  every: { players: 20, none: 12, owned: ["G1", "G2", "G3", "G4", "G5"].map((id) => ({ id, count: 2 })), byCount: [8] },
};

let answer: { stats: MonsterStats; champions: ChampionOwnership };
const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ token: "owner-token", userId: 2505 }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(url);
      return Response.json({ error: 0, ...answer });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.replaceChildren();
});

const open = async (): Promise<MonstersView> => {
  const view = new MonstersView();
  document.body.append(view.picker, view.counting, view.element);
  await view.show();
  return view;
};

const names = () => [...document.querySelectorAll(".mrow .mname")].map((name) => name.firstChild?.textContent);

describe("the words", () => {
  it("says how far back, honestly, from before the first attack on", () => {
    expect(periodWords("30", 0)).toBe("so far");
    expect(periodWords("30", 1)).toBe("in the first day");
    expect(periodWords("7", 7)).toBe("in the last 7 days");
    expect(periodWords("all", 45)).toBe("in all 45 days so far");
    expect(countingWords({ since: null, daysCounted: 0 })).toBe("Monster counts start with the first attack after update 8.3.");
    expect(countingWords({ since: "2026-11-24", daysCounted: 1 })).toBe(
      "Monster counts since Tue 24 Nov · 1 day so far · every period shows the same days for now",
    );
    expect(countingWords({ since: "2026-11-24", daysCounted: 12 })).toContain("30 days and All time show the same days for now");
    expect(countingWords({ since: "2026-11-24", daysCounted: 40 })).toBe("Monster counts since Tue 24 Nov · 40 days so far");
    expect(share(1, 300)).toBe("<1%");
    expect(share(0, 0)).toBe("0%");
  });

  it("a camp chart shows a Map Room 2 tribe's real levels, the Descent's 13 yards, else the span attacked", () => {
    expect(campLevels(tribe("mr2:kozu", "Kozu", "Map Room 2", 1, { only: [30, 34, 38, 42] }))).toEqual([30, 34, 38, 42]);
    expect(campLevels(tribe("descent:descent", "Descent", "Descent", 0))).toHaveLength(13);
    expect(
      campLevels(tribe("mr1:kozu", "Kozu", "Map Room 1", 2, { range: [1, 56], levels: [{ level: 12, attacks: 1, players: 1 }, { level: 15, attacks: 1, players: 1 }] })),
    ).toEqual([12, 13, 14, 15]);
    expect(campLevels(tribe("mr1:practice", "Practice camp", "Map Room 1", 1, { range: null }))).toEqual([]);
  });
});

describe("the Monsters tab", () => {
  it("lists every monster, most flung first, with its share of attacks and the Inferno note", async () => {
    answer = { stats: stats(["2026-11-24"]), champions };
    await open();
    expect(asked[0]).toContain("/admin/stats/monsters?period=30");
    expect(document.querySelectorAll(".mrow")).toHaveLength(26);
    expect(names().slice(0, 4)).toEqual(["Octo-ooze", "Pokey", "Eye-ra", "Zagnoid"]);
    expect(document.querySelector(".mrow .c-share")?.textContent).toBe("50%");
    expect(document.querySelector(".mon-tab .not-counted")?.textContent).toContain("2 Inferno attacks counted as whole army, not shown.");
    // Day 1: one bar, and the note that says why.
    expect(document.querySelector(".trend-card .drawer-note")?.textContent).toBe("The line starts once 3 days are counted; until then each day is a bar.");
    expect(document.querySelector(".mon-tab .activity-panel .small")?.textContent).toBe("4 attacks on players by 3 players in the first day");
  });

  it("a row opens its levels and puts its own line in the chart; the chip takes it out again", async () => {
    answer = { stats: stats(["2026-11-22", "2026-11-23", "2026-11-24"]), champions };
    await open();
    document.querySelectorAll<HTMLButtonElement>(".mrow-main")[1]!.click();
    expect(document.querySelector(".mrow[data-open] .levels-wide")?.textContent).toContain("L3");
    expect(document.querySelector(".trend-card h3")?.textContent).toBe("Pokey flung each day");
    document.querySelector<HTMLButtonElement>(".pinned-chip")!.click();
    expect(document.querySelector(".trend-card h3")?.textContent).toBe("Monsters flung each day");
  });

  it("On camps shows the camp side; Inferno and Find narrow the list", async () => {
    answer = { stats: stats(["2026-11-24"]), champions };
    await open();
    const seg = (text: string) => [...document.querySelectorAll<HTMLButtonElement>(".seg")].find((b) => b.textContent?.startsWith(text))!;
    seg("On camps").click();
    expect(names()[0]).toBe("C9");
    expect(document.querySelector(".mon-tab .activity-panel .small")?.textContent).toContain("· Repeat attacks included");
    seg("Inferno").click();
    expect(document.querySelectorAll(".mrow")).toHaveLength(8);
    seg("All 26").click();
    const find = document.querySelector<HTMLInputElement>(".toolbar-row .input")!;
    find.value = "pok";
    find.dispatchEvent(new Event("input"));
    expect(names()).toEqual(["Pokey"]);
  });

  it("camps: the busiest tribe first, the practice camp hidden while nobody attacks it", async () => {
    answer = { stats: stats(["2026-11-24"]), champions };
    await open();
    const pills = [...document.querySelectorAll(".tribe-pill")].map((pill) => pill.firstChild?.textContent);
    expect(pills).toEqual(["Kozu", "Moloch", "Descent"]);
    expect(document.querySelector(".tribe-pill[aria-pressed=true]")?.textContent).toContain("Kozu");
    expect(document.querySelectorAll(".mon-tab .activity-panel")[1]!.textContent).toContain("Camps at levels 30, 34, 38, 42 only");
  });

  it("champions: the pie, and the players with none, active or every account", async () => {
    answer = { stats: stats(["2026-11-24"]), champions };
    await open();
    expect(document.querySelector(".nochamp strong")?.textContent).toBe("4");
    expect(document.querySelector(".nochamp")?.textContent).toContain("40% of 10");
    expect(document.querySelector(".pie-total")?.textContent).toBe("15");
    [...document.querySelectorAll<HTMLButtonElement>(".seg")].find((b) => b.textContent === "Every account")!.click();
    expect(document.querySelector(".nochamp strong")?.textContent).toBe("12");
  });

  it("before the first attack: nothing counted, said plainly", async () => {
    answer = { stats: stats([], { since: null, assumed: 0 }), champions };
    const view = await open();
    expect(view.counting.textContent).toBe("Monster counts start with the first attack after update 8.3.");
    expect(document.querySelector(".trend-card .empty-state")?.textContent).toContain("Nothing counted yet");
    expect(document.querySelector(".mon-tab .activity-panel .small")?.textContent).toBe("4 attacks on players by 3 players so far");
  });

  it("the period picker asks again", async () => {
    answer = { stats: stats(["2026-11-24"]), champions };
    const view = await open();
    [...view.picker.querySelectorAll<HTMLButtonElement>(".seg")].find((b) => b.textContent === "All time")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked.at(-1)).toContain("period=all");
  });
});
