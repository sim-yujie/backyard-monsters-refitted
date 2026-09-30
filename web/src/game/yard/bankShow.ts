import type { BankedByBuilding, HarvestKey } from "./harvest";

/**
 * One bank as the player sees it (#208): the balls leave the harvesters on
 * the press, the top bar starts counting on the press too, and the server's
 * answer only corrects the totals.
 *
 * Flash threw its balls once `BASE.Fund` had credited the pool, which was at
 * once because the client kept the books, and tweened its bar to the new
 * amount straight away. Here the pool is the server's, and a bar that waited
 * for the balls to land sat still for over a second (owner, 2026-09-30, "feels
 * a bit laggy"; the server answers in a tenth of that). So the press throws
 * what `predictBank` says each harvester will give, and:
 *
 * - each readout counts up by its resource's predicted amount from the press
 *   to the moment that resource's last ball lands, floating the amount at
 *   once (owner's choice (a): the count runs across the whole flight; the
 *   balls are unchanged);
 * - the answer's credit is held back in the same task the store applies it
 *   in, so the readout neither jumps nor stops counting;
 * - once the answer is in and the last ball is down, whatever the prediction
 *   got wrong (a silo that filled, a buffer the server saw differently) is
 *   counted in or out, so the readout ends on the pool;
 * - a refusal takes the balls still in the air away and counts the readout
 *   back from wherever it had got to down to the pool, which never changed.
 */

/** The HUD's side (`Hud`). */
export interface BankShowHud {
  expectBank(key: HarvestKey, change: 1 | -1): void;
  hold(key: HarvestKey, amount: number): void;
  deliver(key: HarvestKey, amount: number, ms?: number): void;
  showChange(key: HarvestKey, delta: number): void;
}

/** The yard's side (`YardRenderer`). */
export interface BankShowFx {
  throwBank(
    banked: BankedByBuilding,
    onLand: (resource: HarvestKey, share: number) => void,
  ): {
    readonly totals: Partial<Record<HarvestKey, number>>;
    readonly ends: Partial<Record<HarvestKey, number>>;
    readonly balls: number;
    readonly group: number;
  };
  cancelBank(group: number): void;
}

/** The server's answer: what it credited per resource, or null for a refusal. */
export type BankAnswer = { readonly banked: Readonly<Partial<Record<HarvestKey, number>>> } | null;

/** Hands a thrown bank its answer. Later calls are ignored. */
export type AnswerBank = (answer: BankAnswer) => void;

const KEYS: readonly HarvestKey[] = ["r1", "r2", "r3", "r4"];

/**
 * Throws a bank's balls and starts the bar counting, now. Returns what to
 * call with the server's answer, or null when nothing was thrown (no Town
 * Hall, nothing predicted), in which case the HUD shows the answer as it
 * shows any change.
 */
export const startBank = (
  predicted: BankedByBuilding,
  fx: BankShowFx,
  hud: BankShowHud,
): AnswerBank | null => {
  let flying = 0;
  let answered = false;
  let over = false;
  let credited: Readonly<Partial<Record<HarvestKey, number>>> = {};

  const thrown = fx.throwBank(predicted, () => {
    if (over) return;
    flying -= 1;
    finish();
  });
  if (thrown.balls === 0) return null;
  flying = thrown.balls;

  const counted = (key: HarvestKey): number => thrown.totals[key] ?? 0;
  const expected = KEYS.filter((key) => counted(key) > 0);
  for (const key of expected) {
    hud.expectBank(key, 1);
    hud.showChange(key, counted(key));
    hud.deliver(key, counted(key), (thrown.ends[key] ?? 0) * 1000);
  }

  function finish(): void {
    if (over || !answered || flying > 0) return;
    over = true;
    for (const key of KEYS) {
      const wrong = (credited[key] ?? 0) - counted(key);
      if (wrong !== 0) hud.deliver(key, wrong);
    }
  }

  return (answer) => {
    if (answered) return;
    answered = true;
    for (const key of expected) hud.expectBank(key, -1);
    if (!answer) {
      over = true;
      fx.cancelBank(thrown.group);
      for (const key of expected) hud.deliver(key, -counted(key));
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
