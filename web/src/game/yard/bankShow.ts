import type { BankedByBuilding, HarvestKey } from "./harvest";

/**
 * One bank as the player sees it (#208): the balls leave the harvesters on
 * the press, the top bar counts up as they land, and the server's answer only
 * corrects the totals.
 *
 * Flash threw its balls once `BASE.Fund` had credited the pool, which is at
 * once there because the client kept the books; here the pool is the
 * server's, and waiting for its answer before anything moved felt laggy. So
 * the press throws what `predictBank` says each harvester will give, and:
 *
 * - each landing counts its readout up by the ball's share, and the first of
 *   each resource floats the bank's amount beside it;
 * - the answer's credit is held back in the same task the store applies it
 *   in, so the readout does not jump;
 * - once the answer is in and the last ball is down, whatever the prediction
 *   got wrong (a silo that filled, a buffer the server saw differently) is
 *   counted in or out, so the readout ends on the pool;
 * - a refusal takes the balls still in the air away and puts back what the
 *   landed ones counted: the readouts show the pool, which never changed.
 */

/** The HUD's side (`Hud`). */
export interface BankShowHud {
  expectBank(key: HarvestKey, change: 1 | -1): void;
  hold(key: HarvestKey, amount: number): void;
  deliver(key: HarvestKey, amount: number): void;
  showChange(key: HarvestKey, delta: number): void;
}

/** The yard's side (`YardRenderer`). */
export interface BankShowFx {
  throwBank(
    banked: BankedByBuilding,
    onLand: (resource: HarvestKey, share: number) => void,
  ): { readonly totals: Partial<Record<HarvestKey, number>>; readonly balls: number; readonly group: number };
  cancelBank(group: number): void;
}

/** The server's answer: what it credited per resource, or null for a refusal. */
export type BankAnswer = { readonly banked: Readonly<Partial<Record<HarvestKey, number>>> } | null;

/** Hands a thrown bank its answer. Later calls are ignored. */
export type AnswerBank = (answer: BankAnswer) => void;

const KEYS: readonly HarvestKey[] = ["r1", "r2", "r3", "r4"];

/**
 * Throws a bank's balls now. Returns what to call with the server's answer,
 * or null when nothing was thrown (no Town Hall, nothing predicted), in which
 * case the HUD shows the answer as it shows any change.
 */
export const startBank = (
  predicted: BankedByBuilding,
  fx: BankShowFx,
  hud: BankShowHud,
): AnswerBank | null => {
  const landed: Partial<Record<HarvestKey, number>> = {};
  let credited: Readonly<Partial<Record<HarvestKey, number>>> = {};
  let flying = 0;
  let answered = false;
  let over = false;

  const finish = (): void => {
    if (over || !answered || flying > 0) return;
    over = true;
    for (const key of KEYS) {
      const wrong = (credited[key] ?? 0) - (landed[key] ?? 0);
      if (wrong !== 0) hud.deliver(key, wrong);
    }
  };

  const thrown = fx.throwBank(predicted, (resource, share) => {
    if (over) return;
    flying -= 1;
    if (landed[resource] === undefined) {
      hud.showChange(resource, answered ? (credited[resource] ?? 0) : (thrown.totals[resource] ?? 0));
    }
    landed[resource] = (landed[resource] ?? 0) + share;
    hud.deliver(resource, share);
    finish();
  });
  if (thrown.balls === 0) return null;
  flying += thrown.balls;
  const expected = KEYS.filter((key) => (thrown.totals[key] ?? 0) > 0);
  for (const key of expected) hud.expectBank(key, 1);

  return (answer) => {
    if (answered) return;
    answered = true;
    for (const key of expected) hud.expectBank(key, -1);
    if (!answer) {
      over = true;
      fx.cancelBank(thrown.group);
      for (const key of KEYS) {
        const back = landed[key] ?? 0;
        if (back !== 0) hud.hold(key, back);
      }
      return;
    }
    credited = answer.banked;
    for (const key of KEYS) {
      const amount = credited[key] ?? 0;
      if (amount > 0) hud.hold(key, amount);
    }
    finish();
  };
};
