// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { EventYardLanded, EventYards } from "@/api/eventYards";
import { eventYardLandedOf, isEventYardId } from "@/api/eventYards";
import { BLACK_SPURTZ_TYPE, SPURTZ_TYPE, spurtzAllowed, spurtzTypesFor } from "@/game/yard/spurtzReward";
import { eventYardResult, openYardPrizePopup, prizeName, wantsPrizePopup, yardCardBody } from "./yardEventUi";

const NOW = 1_800_000_000;

const brukwar = (over: Partial<EventYards> = {}): EventYards => ({
  event: "brukwar",
  runId: "brukwar-1",
  endsAt: NOW + 86_400,
  beaten: 3,
  locked: null,
  waves: 20,
  prizes: [
    { yards: 3, spurtz: 1 },
    { yards: 4, spurtz: 2 },
    { yards: 5, spurtz: 3 },
  ],
  yards: [1, 2, 3, 4, 5].map((index) => ({
    baseid: String(900 + index),
    index,
    destroyed: index <= 3,
    damage: index === 4 ? 35 : 0,
    repairsAt: index === 4 ? NOW + 3_600 : 0,
    next: index === 4,
    wavesNeeded: 0,
    copy: index === 5,
  })),
  ...over,
});

describe("the Events card's yard block", () => {
  it("shows the track, the next yard with its damage and prize, and Attack", () => {
    const onAttack = vi.fn(() => null);
    const body = yardCardBody({ yards: brukwar(), now: NOW, onAttack });
    expect(body.querySelectorAll(".yard-track__yard--won")).toHaveLength(3);
    expect(body.querySelector(".yard-track__yard--next")!.textContent).toContain("4");
    expect(body.querySelectorAll(".yard-track__yard")[4]!.textContent).toContain("Copy");
    expect(body.querySelector(".yard-next__kicker")!.textContent).toBe("Next · Yard 4 of 5");
    expect(body.querySelector(".yard-next__damage")!.textContent).toContain("35% damaged");
    expect(body.querySelector(".yard-next__prize")!.textContent).toContain("2nd Spurtz Cannon");
    (body.querySelector(".yard-next__attack") as HTMLButtonElement).click();
    expect(onAttack).toHaveBeenCalledWith(expect.objectContaining({ baseid: "904" }));
  });

  it("says why the player cannot attack: waves to beat, or the Town Hall range", () => {
    const waves = brukwar();
    const gated = { ...waves, yards: waves.yards.map((yard) => (yard.next ? { ...yard, wavesNeeded: 2 } : yard)) };
    const body = yardCardBody({ yards: gated, now: NOW, onAttack: () => null });
    expect(body.querySelector(".yard-next__attack")).toBeNull();
    expect(body.querySelector(".yard-next__locked")!.textContent).toBe("Beat 2 more waves first.");
    const hall = yardCardBody({ yards: brukwar({ locked: "For Town Hall 2 to 4." }), now: NOW, onAttack: () => null });
    expect(hall.querySelector(".yard-next__locked")!.textContent).toBe("For Town Hall 2 to 4.");
  });

  it("shows a refusal from the starter under the box", () => {
    const body = yardCardBody({ yards: brukwar(), now: NOW, onAttack: () => "Build a Flinger to attack." });
    (body.querySelector(".yard-next__attack") as HTMLButtonElement).click();
    expect(body.querySelector(".yard-card__refusal")!.textContent).toBe("Build a Flinger to attack.");
  });
});

describe("after the attack", () => {
  const landed: EventYardLanded = { event: "brukwar", baseid: "903", won: true, damage: 99, beaten: 3, total: 5, prizes: [{ yards: 3, spurtz: 1 }] };

  it("reads the landing off the save answer", () => {
    expect(eventYardLandedOf({ eventyard: landed })).toEqual(landed);
    expect(eventYardLandedOf({ error: 0 })).toBeNull();
    expect(isEventYardId("905")).toBe(true);
    expect(isEventYardId("214")).toBe(false);
  });

  it("the end panel's box says the yard is wrecked and what it paid", () => {
    const box = eventYardResult(landed);
    expect(box.textContent).toContain("3 of 5 yards wrecked!");
    expect(box.textContent).toContain("Spurtz Cannon");
    expect(eventYardResult({ ...landed, won: false, prizes: [] }).textContent).toContain("Town Hall still standing.");
  });

  it("only a building or the trophy earns the pop-up, with Build now", () => {
    expect(wantsPrizePopup({ ...landed, prizes: [{ yards: 2, glimmers: 10 }] })).toBe(false);
    expect(wantsPrizePopup(landed)).toBe(true);
    const container = document.createElement("div");
    const onBuild = vi.fn();
    openYardPrizePopup(container, landed, { onBuild });
    expect(container.textContent).toContain("Spurtz Cannon unlocked!");
    const build = [...container.querySelectorAll("button")].find((button) => button.textContent === "Build now")!;
    build.click();
    expect(onBuild).toHaveBeenCalledWith(SPURTZ_TYPE);
    expect(prizeName({ yards: 5, spurtz: 3 })).toBe("Black Diamond Spurtz");
  });
});

describe("the Spurtz build gate (the server's SpurtzConfig numbers)", () => {
  it("1 / 2 plain cannons, then 2 Black Diamond ones and no plain; Flash's old reward ids open nothing", () => {
    expect(spurtzAllowed(SPURTZ_TYPE, { brukwarSpurtz1: {} })).toBe(1);
    expect(spurtzAllowed(SPURTZ_TYPE, { brukwarSpurtz1: {}, brukwarSpurtz2: {} })).toBe(2);
    expect(spurtzTypesFor({ brukwarSpurtz1: {}, brukwarSpurtz2: {}, brukwarSpurtz3: {} })).toEqual([BLACK_SPURTZ_TYPE]);
    expect(spurtzAllowed(BLACK_SPURTZ_TYPE, { brukwarSpurtz3: {} })).toBe(2);
    expect(spurtzTypesFor({ spurtzCannonReward: {}, spurtzCannonReward3: {} })).toEqual([]);
  });
});
