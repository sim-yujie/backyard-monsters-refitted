// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfernoMapResponse, TribeAttackStart } from "@/api/inferno";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { combatKind } from "@/game/attack/AttackSession";
import { resetInfernoMapScreen } from "@/ui/inferno/InfernoMapScreen";
import { housesMonsters, openInfernoMap, tribeRoster, type TribeEntryDeps } from "./tribeEntry";
import { TRIBE_MAP_FAILED, TRIBE_NO_MONSTERS } from "./tribeMap";

/**
 * The Map button on the Inferno yard (WP 2.9): the Inferno map of Moloch's
 * seven tribes, a wrecked one dark with its countdown, and Attack on a
 * standing one starting the server's tribe attack and handing the attack
 * scene a target fought as an Inferno yard with the Inferno yard's army.
 */

const NOW = 2_000_000;

const mapOf = (wreckedAt: number | null = null): InfernoMapResponse => ({
  error: 0,
  currenttime: NOW,
  level: 5,
  tribes: [214, 215, 216, 217, 218, 219, 220].map((baseid, index) => ({
    baseid: String(baseid),
    level: [3, 4, 5, 5, 5, 6, 8][index]!,
    destroyed: baseid === 216 && wreckedAt !== null ? 1 : 0,
    respawnat: baseid === 216 && wreckedAt !== null ? wreckedAt : 0,
    damage: baseid === 216 && wreckedAt !== null ? 100 : 0,
  })),
});

const startOf = (baseid: string): TribeAttackStart => ({
  error: 0,
  kind: "tribe",
  yardkind: "inferno",
  attackid: 77,
  level: 5,
  base: { baseid, buildingdata: {} } as Partial<BaseLoadResponse>,
  defenderforces: { bunkers: [] },
  armybaseid: "9001",
  army: { IC1: 6, IC2: 0 },
  attackeracademy: { IC1: 2 },
  attackerlevel: 30,
  attpowerups: [],
  flingercapacity: 780,
});

const infernoSave = (housed: Record<string, number>): BaseLoadResponse =>
  ({ baseid: "9001", type: "inferno", monsters: { housed, hid: [] } }) as unknown as BaseLoadResponse;

const refusal = (reason: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", data: { reason, ...extra } } } as never);

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe("the tribe army", () => {
  it("is the Inferno yard's housing, with no champion, catapult or siege", () => {
    const roster = tribeRoster(startOf("216"), infernoSave({ IC1: 6 }));
    expect(roster).toMatchObject({
      monsters: { IC1: 6 },
      levels: { IC1: 2 },
      champions: [],
      catapultLevel: 0,
      siege: null,
      storageCap: null,
    });
    expect(roster.sources).toEqual([{ baseid: "9001", m: { housed: { IC1: 6 }, hid: [] } }]);
  });

  it("knows housing with nothing in it", () => {
    expect(housesMonsters(infernoSave({ IC1: 0 }))).toBe(false);
    expect(housesMonsters(infernoSave({ IC1: 1 }))).toBe(true);
    expect(housesMonsters({ monsters: undefined } as unknown as BaseLoadResponse)).toBe(false);
  });

  it("fights a tribe as an Inferno yard", () => {
    expect(combatKind({ kind: "wild", infernoTribe: true })).toBe("inferno");
  });
});

describe("openInfernoMap", () => {
  let modal: HTMLElement;
  let deps: TribeEntryDeps & { notice: ReturnType<typeof vi.fn>; openAttack: ReturnType<typeof vi.fn> };
  let map: ReturnType<typeof vi.fn>;
  let start: ReturnType<typeof vi.fn>;
  let housed: Record<string, number>;
  let clockMs: number;

  beforeEach(() => {
    resetInfernoMapScreen();
    modal = document.createElement("div");
    document.body.append(modal);
    housed = { IC1: 6 };
    clockMs = 50_000;
    map = vi.fn(async () => mapOf());
    start = vi.fn(async (baseid: string) => startOf(baseid));
    deps = {
      modal,
      own: () => infernoSave(housed),
      notice: vi.fn(),
      openAttack: vi.fn(),
      api: { map, start },
      nowMs: () => clockMs,
    };
  });

  afterEach(() => {
    modal.querySelector<HTMLButtonElement>(".inferno-map .popup__close, .inferno-map .panel__close")?.click();
    for (const popup of document.querySelectorAll(".popup-backdrop")) popup.remove();
    modal.remove();
  });

  it("shows the seven tribes on the map and in the list, with Flash's names", async () => {
    await openInfernoMap(deps);
    const markers = [...modal.querySelectorAll<HTMLElement>(".inferno-tribe")];
    expect(markers).toHaveLength(7);
    expect(markers[0]!.textContent).toContain("Moloch's Minions");
    const rows = [...modal.querySelectorAll<HTMLElement>(".inferno-row")];
    expect(rows.map((row) => row.querySelector(".inferno-row__name")!.textContent)).toEqual([
      "Moloch's Minions, Level 3",
      "Moloch's Minions, Level 4",
      "Moloch's Minions, Level 5",
      "Moloch's Minions, Level 5",
      "Moloch's Minions, Level 5",
      "Moloch's Minions, Level 6",
      "Moloch's Minions, Level 8",
    ]);
    expect(modal.textContent).toContain("Return Home");
  });

  it("darkens a wrecked tribe, counts it down and keeps its Attack off", async () => {
    map.mockResolvedValue(mapOf(NOW + 125));
    await openInfernoMap(deps);
    const marker = modal.querySelector<HTMLElement>('.inferno-tribe[data-baseid="216"]')!;
    expect(marker.classList.contains("inferno-tribe--wrecked")).toBe(true);
    expect(marker.textContent).toContain("Back in 2:05");
    const row = modal.querySelector<HTMLElement>('.inferno-row[data-baseid="216"]')!;
    expect(row.classList.contains("inferno-row--wrecked")).toBe(true);
    expect(row.querySelector<HTMLButtonElement>("[data-attack]")!.disabled).toBe(true);
    // The wrecked one goes to the bottom of the list.
    expect(modal.querySelector<HTMLElement>(".inferno-row:last-child")!.dataset["baseid"]).toBe("216");
  });

  it("asks the map again once a wrecked tribe's time is up", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      map.mockResolvedValueOnce(mapOf(NOW + 2));
      await openInfernoMap(deps);
      expect(map).toHaveBeenCalledTimes(1);
      clockMs += 3_000;
      vi.advanceTimersByTime(1_000);
      await settle();
      expect(map).toHaveBeenCalledTimes(2);
      expect(modal.querySelector(".inferno-tribe--wrecked")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a marker opens its card, whose Attack starts the tribe attack and hands the scene its target", async () => {
    await openInfernoMap(deps);
    modal.querySelector<HTMLButtonElement>('.inferno-tribe[data-baseid="219"]')!.click();
    const card = modal.querySelector<HTMLElement>(".inferno-card")!;
    expect(card.textContent).toContain("Moloch's Minions, Level 6");
    card.querySelector<HTMLButtonElement>(".inferno-card__attack")!.click();
    await settle();
    expect(start).toHaveBeenCalledWith("219");
    expect(deps.openAttack).toHaveBeenCalledTimes(1);
    const target = deps.openAttack.mock.calls[0]![0] as AttackTarget;
    expect(target).toMatchObject({ baseid: "219", kind: "wild", name: "Moloch's Minions", infernoTribe: true });
    expect(target.load).toMatchObject({
      baseid: "219",
      type: "inferno",
      attackid: 77,
      attackeracademy: { IC1: 2 },
      attackerlevel: 30,
    });
    expect(target.roster.monsters).toEqual({ IC1: 6 });
    expect(modal.querySelector(".inferno-map")).toBeNull();
  });

  it("a list row's Attack starts its tribe", async () => {
    await openInfernoMap(deps);
    modal.querySelector<HTMLButtonElement>('.inferno-row[data-baseid="214"] [data-attack]')!.click();
    await settle();
    expect(start).toHaveBeenCalledWith("214");
  });

  it("with nothing housed says Flash's words and starts nothing", async () => {
    housed = {};
    await openInfernoMap(deps);
    const go = modal.querySelector<HTMLButtonElement>('.inferno-row[data-baseid="214"] [data-attack]')!;
    go.click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith(TRIBE_NO_MONSTERS);
    expect(start).not.toHaveBeenCalled();
    expect(go.disabled).toBe(false);
  });

  it("a tribe found wrecked says when it is back and redraws the map", async () => {
    start.mockRejectedValueOnce(refusal("tribeDestroyed", { respawnAt: NOW + 61 }));
    await openInfernoMap(deps);
    map.mockResolvedValue(mapOf(NOW + 61));
    modal.querySelector<HTMLButtonElement>('.inferno-row[data-baseid="216"] [data-attack]')!.click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith("Moloch's Minions are wrecked. They are back in 1:01.");
    expect(map).toHaveBeenCalledTimes(2);
    expect(modal.querySelector<HTMLButtonElement>('.inferno-row[data-baseid="216"] [data-attack]')!.disabled).toBe(true);
    expect(modal.querySelector<HTMLButtonElement>('.inferno-row[data-baseid="214"] [data-attack]')!.disabled).toBe(false);
    expect(deps.openAttack).not.toHaveBeenCalled();
  });

  it("offline, says so and lets Attack be pressed again", async () => {
    start.mockRejectedValueOnce(new NetworkError("offline", null));
    await openInfernoMap(deps);
    const go = modal.querySelector<HTMLButtonElement>('.inferno-row[data-baseid="214"] [data-attack]')!;
    go.click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith(expect.stringMatching(/connection/));
    expect(go.disabled).toBe(false);
  });

  it("says on the map when the tribes could not be loaded", async () => {
    map.mockRejectedValueOnce(new Error("boom"));
    await openInfernoMap(deps);
    expect(modal.querySelector(".inferno-map__status")!.textContent).toBe(TRIBE_MAP_FAILED);
  });

  it("sorts the list by level, highest first then lowest first", async () => {
    await openInfernoMap(deps);
    const levels = (): string[] =>
      [...modal.querySelectorAll<HTMLElement>(".inferno-row__name")].map((name) => name.textContent!.slice(-1));
    const sort = modal.querySelector<HTMLButtonElement>(".inferno-map__sort")!;
    sort.click();
    expect(levels()).toEqual(["8", "6", "5", "5", "5", "4", "3"]);
    sort.click();
    expect(levels()).toEqual(["3", "4", "5", "5", "5", "6", "8"]);
  });
});
