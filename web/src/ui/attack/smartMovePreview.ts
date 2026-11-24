import type { YardLabel, YardMove } from "@/api/autoAttack";
import type { SmartMoveResponse } from "@/api/smartMove";
import type { AttackRoster } from "@/game/attack/attackTarget";
import { confirmAttackWindow } from "./AttackWindow";
import { SmartMoveSheet, smartMoveNote } from "./smartMoveSheet";

/**
 * The layout check's way to smart moving (web/e2e/layout), and the pictures':
 * the real "Bring saved army?" sheet and the Attack window with its "can't
 * gather" note, filled with a fixed, busy army, with no server and nothing
 * run. Installed as `window.__smartMove(state)` in a dev build or one built
 * with VITE_LAYOUT_CHECK=1 (the check's own build), never in a release build.
 */

const CAMP = "preview-camp";
const NEAR = "preview-near";
const NEAR_2 = "preview-near-2";
const OUT = ["a", "b", "c", "d", "e", "f", "g", "h"].map((one) => `preview-out-${one}`);
const out = (index: number): string => OUT[index] ?? "preview-out-a";

const YARDS: Record<string, YardLabel> = {
  [NEAR]: { main: true, x: 231, y: 196 },
  [NEAR_2]: { main: false, x: 230, y: 214 },
  [out(0)]: { main: false, x: 240, y: 208 },
  [out(1)]: { main: false, x: 242, y: 211 },
  [out(2)]: { main: false, x: 252, y: 215 },
  [out(3)]: { main: false, x: 226, y: 203 },
  [out(4)]: { main: false, x: 219, y: 190 },
  [out(5)]: { main: false, x: 258, y: 224 },
  [out(6)]: { main: false, x: 211, y: 214 },
  [out(7)]: { main: false, x: 264, y: 199 },
};

/** Eight cards, up to three kinds and a 4-digit count: the list must scroll inside the sheet. */
const MOVES_8: YardMove[] = [
  { from: out(0), to: NEAR, monsters: { C14: 80, C12: 20 } },
  { from: out(1), to: NEAR, monsters: { C10: 60 } },
  { from: out(2), to: NEAR_2, monsters: { C3: 1_240, C5: 100 } },
  { from: out(3), to: NEAR_2, monsters: { C3: 120, C14: 20, C12: 20 } },
  { from: out(4), to: NEAR, monsters: { C5: 80 } },
  { from: out(5), to: NEAR_2, monsters: { C1: 140, C8: 40, C6: 12 } },
  { from: out(6), to: NEAR, monsters: { C3: 30 } },
  { from: out(7), to: NEAR_2, monsters: { C1: 20, C8: 50 } },
];

const MOVES_2: YardMove[] = [
  { from: out(0), to: NEAR_2, monsters: { C3: 20 } },
  { from: out(1), to: NEAR_2, monsters: { C4: 8 } },
];

const offerOf = (overrides: Partial<SmartMoveResponse> = {}): SmartMoveResponse => ({
  error: 0,
  baseid: CAMP,
  verdict: "moves",
  camp: { tribe: "Legionnaire", level: 33, damage: 41 },
  monsters: { C3: 1_390, C5: 180, C14: 100, C10: 60, C12: 40, C1: 160, C8: 90, C6: 12 },
  moves: MOVES_8,
  movesKey: "preview",
  missing: [],
  noRoom: null,
  yards: YARDS,
  ...overrides,
});

/** The Attack window's own army: a few kinds in range, the champion, the Catapult. */
const ROSTER: AttackRoster = {
  monsters: { C3: 20, C12: 13 },
  levels: { C3: 6, C12: 1 },
  champions: [{ t: 3, l: 6, hp: 40_000, status: 0, ft: 0, fd: 0, fb: 0, pl: 1 }],
  flingerLevel: 4,
  catapultLevel: 4,
  sources: [],
  siege: null,
  resources: { r1: 60_000_000, r2: 60_000_000, r3: 60_000_000, r4: 60_000_000 },
};

export const SMART_MOVE_STATES = ["moves8", "moves2", "short-note", "room-note"] as const;
export type SmartMoveState = (typeof SMART_MOVE_STATES)[number];

/** Opens smart moving in `state` in `modal`; returns a function that closes it. */
export const previewSmartMove = (modal: HTMLElement, state: SmartMoveState = "moves8"): (() => void) => {
  if (state === "moves8" || state === "moves2") {
    const sheet = new SmartMoveSheet({
      container: modal,
      offer: state === "moves8" ? offerOf() : offerOf({ camp: { tribe: "Kozu", level: 42, damage: 0 }, moves: MOVES_2 }),
      onMove: () => new Promise(() => {}),
    });
    return () => sheet.close();
  }
  const note = smartMoveNote(
    state === "short-note"
      ? offerOf({
          verdict: "short",
          moves: [],
          movesKey: null,
          missing: [
            { kind: "monster", id: "C3", need: 40, have: 28 },
            { kind: "monster", id: "C4", need: 20, have: 15 },
            { kind: "monster", id: "C13", need: 6, have: 0 },
            { kind: "monster", id: "C10", need: 60, have: 12 },
          ],
        })
      : offerOf({
          verdict: "housing",
          moves: [],
          movesKey: null,
          noRoom: { need: 1_000, free: [{ baseid: NEAR_2, free: 40 }, { baseid: NEAR, free: 120 }] },
        }),
  );
  void confirmAttackWindow(modal, { name: "Kozu", kind: "wild", roster: ROSTER }, { note });
  return () => modal.querySelector<HTMLButtonElement>(".attack-window [aria-label='Close']")?.click();
};
