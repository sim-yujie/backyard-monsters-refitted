// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AttackPermission, type MapRoom1NeighbourWire } from "@/api/maproom1";
import { readMapRoom1, type Mr1Own } from "@/game/maproom1/mr1Model";
import { targetCard, type CardHandlers } from "./TargetCard";
import { Mr1ListView } from "./Mr1ListView";

/** The card and list for Map Room 1's level gap and vengeance (owner, 11 Nov 2026). */

const NOW = 1_800_000_000;

const wire = (userid: number, level: number, extra: Partial<MapRoom1NeighbourWire>): MapRoom1NeighbourWire => ({
  userid,
  baseid: `${userid}00`,
  level,
  username: `P${userid}`,
  saved: NOW - 3 * 3600,
  online: 0,
  ...extra,
});

const world = readMapRoom1(
  {
    error: 0,
    now: NOW,
    level: 20,
    protectedUntil: 0,
    tribes: [],
    neighbours: [
      wire(2, 12, { attackpermitted: AttackPermission.LEVEL_RESTRICTION }),
      wire(3, 12, { attackpermitted: AttackPermission.VENGEANCE_MODE, vengeance: 2, attacksfrom: 2 }),
    ],
  },
  NOW,
);

const own: Mr1Own = {
  baseid: "5001",
  seed: 0,
  name: "Me",
  level: 20,
  protectedUntil: 0,
  flinger: { state: "ready", level: 1 },
  army: [{ id: "C1", count: 16 }],
  champion: false,
};

const handlers = (): CardHandlers => ({ onClose: vi.fn(), onView: vi.fn(), onAttack: vi.fn(), onAction: vi.fn() });

const card = (userid: number) =>
  targetCard(world.neighbours.find((one) => one.userid === userid)!, { world, own, now: NOW }, handlers(), "panel");

const attackButton = (element: HTMLElement) =>
  [...element.querySelectorAll("button")].find((one) => one.textContent?.trim() === "Attack")!;

describe("a yard too far below", () => {
  it("greys Attack with a lock and \"Too low. More than 7 levels below you.\"", () => {
    const element = card(2);
    expect(attackButton(element).disabled).toBe(true);
    const reason = element.querySelector(".mr1-reason")!;
    expect(reason.textContent).toBe("Too low. More than 7 levels below you.");
    expect(reason.querySelector("svg")).not.toBeNull();
  });
});

describe("a yard you have vengeance on", () => {
  it("keeps Attack on and shows a target badge with the count", () => {
    const element = card(3);
    expect(attackButton(element).disabled).toBe(false);
    const badge = element.querySelector<HTMLElement>(".mr1-battle--vengeance")!;
    expect(badge.textContent).toBe("2");
    expect(badge.title).toBe("Vengeance: you can hit back 2 times");
  });

  it("the list row says why a yard can't be attacked, and shows the vengeance badge", () => {
    const list = new Mr1ListView({ onSelect: vi.fn() });
    list.setData(world, NOW);
    const low = list.element.querySelector<HTMLElement>('[data-key="player-2"]')!;
    expect(low.textContent).toContain("Too low · 7+ levels below");
    const revenge = list.element.querySelector<HTMLElement>('[data-key="player-3"]')!;
    expect(revenge.querySelector(".mr1-battle--vengeance")?.textContent).toBe("2");
  });
});
