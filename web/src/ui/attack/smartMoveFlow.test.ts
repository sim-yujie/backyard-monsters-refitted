// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "@/api/http";
import type { SmartMoveResponse } from "@/api/smartMove";
import type { BaseLoadResponse } from "@/api/types";
import { rosterWithHousing } from "@/game/attack/attackEntry";
import type { AttackRoster, AttackTarget } from "@/game/attack/attackTarget";
import { MOVES_CHANGED } from "./autoAttackText";
import { SMART_MOVE_ERRORS, smartMoveBeforeAttack, type SmartMoveCalls } from "./smartMoveFlow";
import { SMART_MOVE_TEXT } from "./smartMoveSheet";

/**
 * Smart moving for hand attacks (beta 9, owner 24 Nov 2026): what the map's
 * Attack does on a camp before the Attack window, over stand-in calls.
 */

const HOME = "3502";
const NEAR = "22913802230214";
const FAR = "22913802240209";
const KEY = `${FAR}>${NEAR}:C4=20`;

const roster = (extra: Partial<AttackRoster> = {}): AttackRoster => ({
  monsters: { C3: 5 },
  levels: {},
  champions: [],
  flingerLevel: 4,
  catapultLevel: 0,
  sources: [{ baseid: NEAR, m: { housed: { C3: 5 }, space: 540 } }],
  siege: null,
  resources: null,
  ...extra,
});

const camp = (extra: Partial<AttackTarget> = {}): AttackTarget => ({
  baseid: "22913802230215",
  kind: "wild",
  name: "Kozu camp",
  cell: { col: 230, row: 215 },
  roster: roster(),
  ...extra,
});

const offer = (extra: Partial<SmartMoveResponse> = {}): SmartMoveResponse => ({
  error: 0,
  baseid: "22913802230215",
  verdict: "moves",
  camp: { tribe: "Kozu", level: 42, damage: 0 },
  monsters: { C3: 5, C4: 20 },
  moves: [{ from: FAR, to: NEAR, monsters: { C4: 20 } }],
  movesKey: KEY,
  missing: [],
  noRoom: null,
  yards: { [FAR]: { main: false, x: 240, y: 209 }, [NEAR]: { main: false, x: 230, y: 214 } },
  ...extra,
});

const loaded = (extra: Partial<BaseLoadResponse> = {}) =>
  ({
    error: 0,
    smartmoved: { moves: [{ from: FAR, to: NEAR, monsters: { C4: 20 } }], housed: { [NEAR]: { C3: 5, C4: 20 } } },
    ...extra,
  }) as unknown as BaseLoadResponse;

const refused = (reason: string, message = "Refused") =>
  new ApiError(message, { status: 409, details: { data: { reason } } as never });

const setup = (calls: Partial<SmartMoveCalls> = {}) => {
  const modal = document.createElement("div");
  document.body.append(modal);
  const offerCall = vi.fn(calls.offer ?? (async () => offer()));
  const start = vi.fn(calls.start ?? (async () => loaded()));
  return { modal, offerCall, start, calls: { offer: offerCall, start } };
};

const sheet = (modal: HTMLElement) => modal.querySelector<HTMLElement>(".smart-move");
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  document.body.replaceChildren();
});

describe("Attack on a camp with smart moving", () => {
  it("the setting off, or anything but a Map Room 2 camp: the Attack window, nothing asked", async () => {
    const { modal, offerCall, calls } = setup();
    for (const [attack, isOn] of [
      [camp(), () => false],
      [camp({ kind: "main" }), () => true],
      [camp({ mapversion: 1 }), () => true],
    ] as const) {
      expect(await smartMoveBeforeAttack({ modal, attack, calls, isOn })).toEqual({ kind: "window", note: null });
    }
    expect(offerCall).not.toHaveBeenCalled();
  });

  it("no plan, the army in range already, or no answer: the Attack window without a note", async () => {
    for (const answer of [offer({ verdict: "none", moves: [] }), offer({ verdict: "ready", moves: [] })]) {
      const { modal, calls } = setup({ offer: async () => answer });
      expect(await smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true })).toEqual({ kind: "window", note: null });
    }
    const failing = setup({ offer: async () => Promise.reject(new NetworkError("down", null)) });
    expect(await smartMoveBeforeAttack({ modal: failing.modal, attack: camp(), calls: failing.calls, isOn: () => true })).toEqual({
      kind: "window",
      note: null,
    });
    const slow = setup({ offer: () => new Promise(() => {}) });
    expect(await smartMoveBeforeAttack({ modal: slow.modal, attack: camp(), calls: slow.calls, isOn: () => true, offerMs: 5 })).toEqual({
      kind: "window",
      note: null,
    });
  });

  it("can't gather: the Attack window with the note, what is short or where there is no room", async () => {
    const short = setup({
      offer: async () => offer({ verdict: "short", moves: [], movesKey: null, missing: [{ kind: "monster", id: "C4", need: 20, have: 8 }] }),
    });
    const one = await smartMoveBeforeAttack({ modal: short.modal, attack: camp(), calls: short.calls, isOn: () => true });
    expect(one.kind).toBe("window");
    const note = (one as { note: HTMLElement }).note;
    expect(note.textContent).toContain(SMART_MOVE_TEXT.short);
    expect(note.querySelectorAll(".repeat-prompt__short")).toHaveLength(1);
    expect(note.textContent).toContain("12 short");

    const room = setup({
      offer: async () =>
        offer({ verdict: "housing", moves: [], movesKey: null, noRoom: { need: 1_000, free: [{ baseid: NEAR, free: 40 }] } }),
    });
    const two = await smartMoveBeforeAttack({ modal: room.modal, attack: camp(), calls: room.calls, isOn: () => true });
    const roomNote = (two as { note: HTMLElement }).note;
    expect(roomNote.textContent).toContain("1,000 needed");
    expect(roomNote.textContent).toContain(SMART_MOVE_TEXT.room);
    expect(roomNote.querySelectorAll(".repeat-prompt__room-yard")).toHaveLength(1);
    expect(sheet(room.modal)).toBeNull();
  });

  it("the moves: the sheet with the camp and a card per move; Skip opens the Attack window, nothing started", async () => {
    const { modal, start, calls } = setup();
    const running = smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    const open = sheet(modal)!;
    expect(open.querySelector(".panel__title")?.textContent).toBe(SMART_MOVE_TEXT.title);
    expect(open.querySelector(".repeat-prompt__camp-name")?.textContent).toContain("Kozu");
    expect(open.querySelectorAll(".repeat-prompt__move")).toHaveLength(1);
    open.querySelector<HTMLButtonElement>(".smart-move__skip")!.click();
    expect(await running).toEqual({ kind: "window", note: null });
    expect(start).not.toHaveBeenCalled();
    expect(sheet(modal)).toBeNull();
  });

  it("closing the sheet goes back to the map, nothing started", async () => {
    const { modal, start, calls } = setup();
    const running = smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    sheet(modal)!.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
    expect(await running).toEqual({ kind: "closed" });
    expect(start).not.toHaveBeenCalled();
  });

  it("Move & attack: one attack load with the key, then straight into the battle with the moved monsters", async () => {
    const { modal, start, calls } = setup();
    const running = smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    sheet(modal)!.querySelector<HTMLButtonElement>(".smart-move__go")!.click();
    const outcome = await running;
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ baseid: "22913802230215" }), KEY);
    expect(outcome.kind).toBe("moved");
    const target = (outcome as { target: AttackTarget }).target;
    expect(target.load).toBeDefined();
    expect(target.roster.monsters).toEqual({ C3: 5, C4: 20 });
    expect(target.roster.sources).toEqual([{ baseid: NEAR, m: { housed: { C3: 5, C4: 20 }, space: 540 } }]);
    expect(sheet(modal)).toBeNull();
  });

  it("while it runs nothing closes the sheet, and a refusal shows above the buttons with the sheet open", async () => {
    let fail: (reason: unknown) => void = () => {};
    const { modal, calls } = setup({ start: () => new Promise((_, reject) => (fail = reject)) });
    void smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    const open = sheet(modal)!;
    const go = open.querySelector<HTMLButtonElement>(".smart-move__go")!;
    go.click();
    expect(go.disabled).toBe(true);
    expect(go.textContent).toBe(SMART_MOVE_TEXT.moving);
    open.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
    expect(sheet(modal)).not.toBeNull();
    fail(refused("busy", "This camp is under attack."));
    await flush();
    expect(open.querySelector(".smart-move__error")?.textContent).toBe("This camp is under attack.");
    expect(go.disabled).toBe(false);
    expect(go.textContent).toBe(SMART_MOVE_TEXT.move);
  });

  it("the yards changed: the new moves are shown with a line saying so", async () => {
    const fresh = offer({
      moves: [{ from: HOME, to: NEAR, monsters: { C4: 20 } }],
      movesKey: `${HOME}>${NEAR}:C4=20`,
      yards: { [HOME]: { main: true, x: 239, y: 208 }, [NEAR]: { main: false, x: 230, y: 214 } },
    });
    let asked = 0;
    const { modal, start, calls } = setup({
      offer: async () => (asked++ === 0 ? offer() : fresh),
      start: async () => Promise.reject(refused("movesChanged")),
    });
    void smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    sheet(modal)!.querySelector<HTMLButtonElement>(".smart-move__go")!.click();
    await flush();
    await flush();
    expect(sheet(modal)!.querySelector(".smart-move__error")?.textContent).toBe(MOVES_CHANGED);
    expect(sheet(modal)!.querySelector(".repeat-prompt__yard-name")?.textContent).toBe("Main yard");
    sheet(modal)!.querySelector<HTMLButtonElement>(".smart-move__go")!.click();
    expect(start).toHaveBeenLastCalledWith(expect.anything(), `${HOME}>${NEAR}:C4=20`);
  });

  it("the yards changed and nothing is left to move: said, Skip still there", async () => {
    let asked = 0;
    const { modal, calls } = setup({
      offer: async () => (asked++ === 0 ? offer() : offer({ verdict: "ready", moves: [], movesKey: null })),
      start: async () => Promise.reject(refused("movesChanged")),
    });
    void smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    sheet(modal)!.querySelector<HTMLButtonElement>(".smart-move__go")!.click();
    await flush();
    await flush();
    expect(sheet(modal)!.querySelector(".smart-move__error")?.textContent).toBe(SMART_MOVE_ERRORS.gone);
  });

  it("a page with older battle rules: the sheet closes (the New version card says why)", async () => {
    const { modal, calls } = setup({ start: async () => Promise.reject(refused("newVersion", "New version — reload the page.")) });
    const running = smartMoveBeforeAttack({ modal, attack: camp(), calls, isOn: () => true });
    await flush();
    sheet(modal)!.querySelector<HTMLButtonElement>(".smart-move__go")!.click();
    expect(await running).toEqual({ kind: "closed" });
    expect(sheet(modal)).toBeNull();
  });
});

describe("rosterWithHousing", () => {
  it("takes each served yard's housing, adds a yard the map had none for, keeps the others", () => {
    const before = roster({
      sources: [
        { baseid: "B", m: { housed: { C1: 3 } } },
        { baseid: "D", m: { housed: { C2: 1 }, space: 10 } },
      ],
      monsters: { C1: 3, C2: 1 },
    });
    const after = rosterWithHousing(before, { D: { C2: 1, C4: 20 }, A: { C3: 2 } });
    expect(after.sources.map((source) => source.baseid)).toEqual(["A", "B", "D"]);
    expect(after.sources[2]!.m).toEqual({ housed: { C2: 1, C4: 20 }, space: 10 });
    expect(after.monsters).toEqual({ C1: 3, C2: 1, C3: 2, C4: 20 });
    expect(after.flingerLevel).toBe(before.flingerLevel);
  });
});
