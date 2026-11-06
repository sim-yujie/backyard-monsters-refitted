// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfernoMapResponse, InfernoNeighbourView, InfernoNeighboursResponse, PlayerAttackStart } from "@/api/inferno";
import { ApiError, NetworkError } from "@/api/http";
import type { BaseLoadResponse } from "@/api/types";
import { fromInfernoYard, type AttackTarget, type ViewTarget } from "@/game/attack/attackTarget";
import { combatKind } from "@/game/attack/AttackSession";
import { resetInfernoMapScreen } from "@/ui/inferno/InfernoMapScreen";
import { PLAYER_ATTACK_COUNTS } from "./playerMap";
import { openInfernoMap, PLAYERS_FAILED, type TribeEntryDeps } from "./tribeEntry";
import { TRIBE_NO_MONSTERS } from "./tribeMap";

/**
 * The Inferno map's Players tab (PvP, WP 3.5): the other players' Inferno
 * yards, View opening one to look at only (WP 3.4), and Attack asking first,
 * with the warning that the attack counts once it starts, then starting the
 * server's player attack and handing the scene a target whose load carries
 * the yard's `basesaveid`, so its checkpoints reach the server.
 */

const NOW = 2_000_000;

const neighbour = (part: Partial<InfernoNeighbourView>): InfernoNeighbourView => ({
  userid: 42,
  baseid: "5005",
  name: "Bob",
  pic: "",
  level: 6,
  online: 0,
  friend: 0,
  attackpermitted: 1,
  protecteduntil: 0,
  attacker: "",
  attacksfrom: 0,
  attacksto: 0,
  vengeance: 0,
  ...part,
});

const neighboursOf = (rows: InfernoNeighbourView[]): InfernoNeighboursResponse => ({
  error: 0,
  currenttime: NOW,
  level: 5,
  neighbours: rows,
});

const emptyMap: InfernoMapResponse = { error: 0, currenttime: NOW, level: 5, tribes: [] };

const startOf = (baseid: string): PlayerAttackStart => ({
  error: 0,
  kind: "player",
  yardkind: "inferno",
  attackid: 88,
  level: 6,
  ownername: "Bob",
  base: { baseid, basesaveid: 7007, type: "inferno", buildingdata: {} } as Partial<BaseLoadResponse>,
  defenderforces: { bunkers: [] },
  armybaseid: "9001",
  army: { IC1: 6 },
  attackeracademy: { IC1: 2 },
  attackerlevel: 30,
  attpowerups: [],
  flingercapacity: 780,
});

const infernoSave = (housed: Record<string, number>, extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse =>
  ({
    baseid: "9001",
    type: "inferno",
    monsters: { housed, hid: [] },
    buildingdata: {},
    resources: { r1: 100, r2: 0, r3: 0, r4: 0 },
    credits: 5,
    ...extra,
  }) as unknown as BaseLoadResponse;

const refusal = (reason: string, extra: Record<string, unknown> = {}): ApiError =>
  new ApiError("refused", { status: 409, details: { message: "refused", data: { reason, ...extra } } } as never);

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("the Players tab", () => {
  let modal: HTMLElement;
  let deps: TribeEntryDeps & {
    notice: ReturnType<typeof vi.fn>;
    openAttack: ReturnType<typeof vi.fn>;
    openView: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
  };
  let neighbours: ReturnType<typeof vi.fn>;
  let startPlayer: ReturnType<typeof vi.fn>;
  let own: BaseLoadResponse;

  beforeEach(() => {
    resetInfernoMapScreen();
    modal = document.createElement("div");
    document.body.append(modal);
    own = infernoSave({ IC1: 6 });
    neighbours = vi.fn(async () =>
      neighboursOf([
        neighbour({}),
        neighbour({ userid: 43, baseid: "5006", name: "Cleo", online: 1 }),
        neighbour({ userid: 44, baseid: "5007", name: "Dan", attackpermitted: 7, attacker: "Eve" }),
        neighbour({ userid: 45, baseid: "5008", name: "Fay", attackpermitted: 4, vengeance: 2 }),
      ]),
    );
    startPlayer = vi.fn(async (baseid: string) => startOf(baseid));
    deps = {
      modal,
      own: () => own,
      notice: vi.fn(),
      openAttack: vi.fn(),
      openView: vi.fn(),
      confirm: vi.fn(async () => true),
      api: { map: async () => emptyMap, start: vi.fn(), neighbours, startPlayer },
      nowMs: () => 50_000,
    };
  });

  afterEach(() => {
    modal.querySelector<HTMLButtonElement>(".inferno-map .popup__close, .inferno-map .panel__close")?.click();
    for (const popup of document.querySelectorAll(".popup-backdrop")) popup.remove();
    modal.remove();
  });

  const openPlayers = async (): Promise<void> => {
    await openInfernoMap(deps);
    [...modal.querySelectorAll<HTMLButtonElement>(".inferno-map__tabs button")].find((tab) => tab.textContent === "Players")!.click();
  };
  const row = (baseid: string): HTMLElement => modal.querySelector<HTMLElement>(`[data-player="${baseid}"]`)!;
  const attackOf = (baseid: string): HTMLButtonElement => row(baseid).querySelector<HTMLButtonElement>("[data-attack]")!;
  const viewOf = (baseid: string): HTMLButtonElement => row(baseid).querySelector<HTMLButtonElement>(".inferno-player__view")!;

  it("lists the players with Flash's states, and View and Attack off when Flash's were", async () => {
    await openPlayers();
    expect(modal.querySelector<HTMLElement>(".inferno-map__players")!.hidden).toBe(false);
    expect(modal.querySelector<HTMLElement>(".inferno-map__list:not(.inferno-map__players)")!.hidden).toBe(true);
    expect(row("5005").textContent).toContain("Bob");
    expect(row("5005").textContent).toContain("Level 6");
    expect(row("5005").textContent).toContain("Offline");
    expect(attackOf("5005").disabled).toBe(false);
    // Playing now: no attack, a look is fine.
    expect(row("5006").textContent).toContain("Playing Now");
    expect(attackOf("5006").disabled).toBe(true);
    expect(viewOf("5006").disabled).toBe(false);
    // Under attack: neither.
    expect(row("5007").textContent).toContain("UNDER ATTACK!");
    expect(attackOf("5007").disabled).toBe(true);
    expect(viewOf("5007").disabled).toBe(true);
    // Revenge: attack on, with the count.
    expect(row("5008").textContent).toContain("Vengeance enabled X 2");
    expect(attackOf("5008").disabled).toBe(false);
  });

  it("is left out when the map cannot open a look", async () => {
    const { openView: _openView, ...withoutView } = deps;
    await openInfernoMap(withoutView);
    expect(modal.querySelector(".inferno-map__tabs")).toBeNull();
    expect(neighbours).not.toHaveBeenCalled();
  });

  it("says so when the players could not be loaded", async () => {
    neighbours.mockRejectedValueOnce(new Error("boom"));
    await openPlayers();
    expect(modal.querySelector(".inferno-map__players .inferno-map__status")!.textContent).toBe(PLAYERS_FAILED);
  });

  it("View opens their Inferno yard to look at, with the own purse on the HUD", async () => {
    await openPlayers();
    viewOf("5005").click();
    expect(deps.openView).toHaveBeenCalledTimes(1);
    const target = deps.openView.mock.calls[0]![0] as ViewTarget;
    expect(target).toMatchObject({ baseid: "5005", name: "Bob", inferno: true, attack: null, refusal: null });
    expect(target.own).toEqual({ resources: { r1: 100, r2: 0, r3: 0, r4: 0 }, credits: 5 });
    expect(modal.querySelector(".inferno-map")).toBeNull();
  });

  it("Attack asks first, then starts the player attack; its load carries basesaveid for the checkpoints", async () => {
    await openPlayers();
    attackOf("5005").click();
    await settle();
    expect(deps.confirm).toHaveBeenCalledWith(modal, "Bob", "Are you sure you want to attack Bob?");
    expect(startPlayer).toHaveBeenCalledWith("5005");
    const target = deps.openAttack.mock.calls[0]![0] as AttackTarget;
    expect(target).toMatchObject({ baseid: "5005", kind: "main", name: "Bob", owner: 42, infernoPlayer: true });
    expect(target.load).toMatchObject({ baseid: "5005", basesaveid: 7007, type: "inferno", attackid: 88 });
    expect(target.roster.monsters).toEqual({ IC1: 6 });
    expect(target.roster.flingCapacity).toBe(780);
    expect(combatKind(target)).toBe("inferno");
    expect(fromInfernoYard(target)).toBe(true);
  });

  it("No on the question starts nothing and lets Attack be pressed again", async () => {
    deps.confirm.mockResolvedValueOnce(false);
    await openPlayers();
    attackOf("5005").click();
    await settle();
    expect(startPlayer).not.toHaveBeenCalled();
    expect(attackOf("5005").disabled).toBe(false);
  });

  it("warns of the player's own protection first, as Flash did", async () => {
    own = infernoSave({ IC1: 6 }, { protected: NOW + 7_200 } as Partial<BaseLoadResponse>);
    await openPlayers();
    attackOf("5005").click();
    await settle();
    expect(deps.confirm.mock.calls[0]![2]).toMatch(/^WARNING - You are protected for 2 h\. Attacking anyone will remove/);
  });

  it("a revenge attack asks with Flash's revenge words", async () => {
    await openPlayers();
    attackOf("5008").click();
    await settle();
    expect(deps.confirm.mock.calls[0]![2]).toMatch(/they were dumb enough to attack you first/);
  });

  it("with nothing housed says Flash's words and asks nothing", async () => {
    own = infernoSave({});
    await openPlayers();
    attackOf("5005").click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith(TRIBE_NO_MONSTERS);
    expect(deps.confirm).not.toHaveBeenCalled();
  });

  it("a refused start says why in Flash's words and asks the list again", async () => {
    startPlayer.mockRejectedValueOnce(refusal("targetUnderAttack", { attacker: "Eve" }));
    await openPlayers();
    attackOf("5005").click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith("Bob is under attack by Eve! Please wait a few minutes then try again");
    expect(neighbours).toHaveBeenCalledTimes(2);
    expect(deps.openAttack).not.toHaveBeenCalled();
  });

  it("offline, says so and lets Attack be pressed again", async () => {
    startPlayer.mockRejectedValueOnce(new NetworkError("offline", null));
    await openPlayers();
    attackOf("5005").click();
    await settle();
    expect(deps.notice).toHaveBeenCalledWith(expect.stringMatching(/connection/));
    expect(attackOf("5005").disabled).toBe(false);
  });
});

describe("the question before a player attack", () => {
  afterEach(() => {
    for (const popup of document.querySelectorAll(".popup-backdrop")) popup.remove();
    document.body.replaceChildren();
  });

  it("says plainly that the attack counts once it starts", async () => {
    const { confirmPlayerAttack } = await import("@/ui/inferno/PlayerAttackConfirm");
    const host = document.createElement("div");
    document.body.append(host);
    const answer = confirmPlayerAttack(host, "Bob", "Are you sure you want to attack Bob?");
    expect(host.textContent).toContain("Are you sure you want to attack Bob?");
    expect(host.textContent).toContain(PLAYER_ATTACK_COUNTS);
    expect(PLAYER_ATTACK_COUNTS).toBe(
      "Once the attack starts it counts. If you leave after 10 seconds without finishing, the monsters you brought are used up.",
    );
    [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Attack!")!.click();
    expect(await answer).toBe(true);
  });
});
