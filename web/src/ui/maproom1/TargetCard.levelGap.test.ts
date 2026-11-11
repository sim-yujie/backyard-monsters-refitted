// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { AttackPermission, type MapRoom1NeighbourWire } from "@/api/maproom1";
import { MR1_LEVEL_GAP, readMapRoom1, type Mr1Own } from "@/game/maproom1/mr1Model";
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
      wire(4, 28, { attackpermitted: AttackPermission.HIGHER_LEVEL }),
      wire(5, 25, { attackpermitted: AttackPermission.ATTACKABLE }),
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
  it("keeps Attack on and shows a target badge with the word and the count", () => {
    const element = card(3);
    expect(attackButton(element).disabled).toBe(false);
    const badge = element.querySelector<HTMLElement>(".mr1-battle--vengeance")!;
    expect(badge.textContent).toBe("Revenge ×2");
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(badge.title).toBe("Revenge: you can hit back 2 times");
  });

  it("the list row says why a yard can't be attacked, and shows the vengeance badge", () => {
    const list = new Mr1ListView({ onSelect: vi.fn() });
    list.setData(world, NOW);
    const low = list.element.querySelector<HTMLElement>('[data-key="player-2"]')!;
    expect(low.textContent).toContain("Too low · 7+ levels below");
    const revenge = list.element.querySelector<HTMLElement>('[data-key="player-3"]')!;
    expect(revenge.querySelector(".mr1-battle--vengeance")?.textContent).toBe("Revenge ×2");
  });
});

describe("a yard more than the gap above", () => {
  const warning = (element: HTMLElement) => element.querySelector<HTMLElement>(".mr1-warning--level");

  it("keeps Attack on and warns that they can hit back once", () => {
    const element = card(4);
    expect(attackButton(element).disabled).toBe(false);
    const note = warning(element)!;
    expect(note.textContent).toBe(
      `More than ${MR1_LEVEL_GAP} levels above you. Attacking lets them hit you back once.`,
    );
    expect(note.querySelector("svg")).not.toBeNull();
  });

  it("does not warn on a yard within the gap", () => {
    expect(warning(card(5))).toBeNull();
  });

  it("does not warn when both are level 40+ (the server sends ATTACKABLE, no gap)", () => {
    const high = readMapRoom1(
      {
        error: 0,
        now: NOW,
        level: 45,
        protectedUntil: 0,
        tribes: [],
        neighbours: [wire(6, 60, { attackpermitted: AttackPermission.ATTACKABLE })],
      },
      NOW,
    );
    const element = targetCard(
      high.neighbours[0]!,
      { world: high, own: { ...own, level: 45 }, now: NOW },
      handlers(),
      "panel",
    );
    expect(attackButton(element).disabled).toBe(false);
    expect(warning(element)).toBeNull();
  });

  it("the list row says so in the warning colour, and only on that yard", () => {
    const list = new Mr1ListView({ onSelect: vi.fn() });
    list.setData(world, NOW);
    const far = list.element.querySelector<HTMLElement>('[data-key="player-4"] .mr1-row__line')!;
    expect(far.textContent).toBe(`${MR1_LEVEL_GAP}+ levels above you`);
    expect(far.classList.contains("mr1-row__line--warn")).toBe(true);
    expect(far.querySelector("svg")).not.toBeNull();
    const near = list.element.querySelector<HTMLElement>('[data-key="player-5"] .mr1-row__line');
    expect(near?.classList.contains("mr1-row__line--warn") ?? false).toBe(false);
  });
});
