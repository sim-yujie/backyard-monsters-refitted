import { LockMode, type EntityManager } from "@mikro-orm/core";
import { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { BaseType } from "../../../enums/Base.js";
import { autoAttackRefusedErr } from "../../../errors/errors.js";
import { postgres } from "../../../server.js";
import { logger } from "../../../utils/logger.js";
import { monsterStorage, planMonsterTransfer } from "../../monsters/transferRules.js";
import { catchUpArmyRow, catchUpTransferYards } from "../../yard/armies.js";
import { academyLevels } from "../../yard/catchUpMonsters.js";
import { highestAcademyLevels, housingCapacityNow, housingExpansionActive } from "../../yard/housing.js";
import { countsOf } from "../../yard/attackRoster.js";
import { readAttackSession } from "../attackSessionStore.js";
import { isAttackActive } from "../isAttackActive.js";
import { movesKey, planMoves, type Counts, type MovePlan, type PlanYard, type YardMove } from "./movePlan.js";

/**
 * Smart Repeat attack's reads and writes (owner, 16 Nov 2026): the player's
 * yards as the planner (`movePlan.ts`) needs them, and the moves themselves,
 * made under the same locks and rules as a hand-made transfer
 * (`controllers/maproom/v2/transferMonsters.ts`).
 */

/** Where a yard sits, so the prompt can name it without a lookup. */
export interface YardLabel {
  readonly main: boolean;
  readonly x: number;
  readonly y: number;
}

/** A yard for the planner, with where it sits. */
export interface RepeatYard extends PlanYard, YardLabel {}

/** Housing space per monster at the player's academy levels (the main yard's, as transfers read them). */
export const sizeOfFor =
  (mainSave: Pick<Save, "academy">) =>
  (id: string): number =>
    monsterStorage(id, academyLevels(mainSave.academy));

/** The player's outposts on their own world, as `Save.outposts` lists them. */
const outpostIdsOf = (mainSave: Save): string[] => (mainSave.outposts ?? []).map(([, , baseid]) => String(baseid));

const isBusy = async (row: Save): Promise<boolean> =>
  isAttackActive(row) || (await readAttackSession(row.basesaveid)) !== null;

/**
 * One yard as the planner reads it: caught up in memory (nothing written),
 * with its housing and whether an attack is running on it.
 */
const repeatYardOf = async (row: Save, mainSave: Save, reaching: readonly string[], now: number): Promise<RepeatYard> => {
  const main = row.baseid === mainSave.baseid;
  const at = main
    ? { x: Number(mainSave.homebase?.[0] ?? 0), y: Number(mainSave.homebase?.[1] ?? 0) }
    : (() => {
        const entry = (mainSave.outposts ?? []).find(([, , baseid]) => String(baseid) === row.baseid);
        return { x: Number(entry?.[0] ?? 0), y: Number(entry?.[1] ?? 0) };
      })();
  const expansion = housingExpansionActive(row.storedata, now) || housingExpansionActive(mainSave.storedata, now);
  return {
    baseid: row.baseid,
    main,
    ...at,
    reaches: reaching.includes(row.baseid),
    housed: countsOf(catchUpArmyRow(row, mainSave, now).monsters?.housed),
    // Housing that finished while the yard was closed counts (patch, 24 Nov 2026).
    capacity: housingCapacityNow(row, expansion, now),
    busy: await isBusy(row),
  };
};

/** The player's outpost rows on their main yard's world. */
const outpostRows = async (em: EntityManager, user: User): Promise<Save[]> => {
  const mainSave = user.save!;
  const ids = outpostIdsOf(mainSave);
  if (ids.length === 0) return [];
  const rows = await em.find(Save, { baseid: { $in: ids }, saveuserid: user.userid });
  return rows.filter((row) => row.type === BaseType.OUTPOST && (!mainSave.worldid || !row.worldid || row.worldid === mainSave.worldid));
};

/**
 * Every yard of the player's, main yard first, as the planner sees it now.
 *
 * @param user - The player, with their main save populated.
 * @param reaching - The yards whose own Flinger reaches the camp (`ownYardsInReach`).
 * @param now - Server seconds.
 */
export const repeatYardsFor = async (user: User, reaching: readonly string[], now: number): Promise<RepeatYard[]> => {
  const mainSave = user.save!;
  const rows = [mainSave, ...(await outpostRows(postgres.em, user))];
  return Promise.all(rows.map((row) => repeatYardOf(row, mainSave, reaching, now)));
};

/** The labels of the yards a plan names. */
export const labelsOf = (yards: readonly RepeatYard[], plan: MovePlan): Record<string, YardLabel> => {
  const named = new Set<string>();
  if (plan.kind === "moves") for (const move of plan.moves) named.add(move.from).add(move.to);
  if (plan.kind === "housing") for (const one of plan.free) named.add(one.baseid);
  const labels: Record<string, YardLabel> = {};
  for (const yard of yards) if (named.has(yard.baseid)) labels[yard.baseid] = { main: yard.main, x: yard.x, y: yard.y };
  return labels;
};

/**
 * Locks the player's yards as every multi-yard route does (main yard first,
 * then by save id) and reads them afresh.
 *
 * @returns The locked rows, main yard first.
 */
const lockedYards = async (em: EntityManager, user: User): Promise<Save[]> => {
  const mainId = user.save!.basesaveid;
  const found = await outpostRows(em, user);
  const ids = [...new Set(found.map((row) => row.basesaveid))].sort((one, other) => one - other);
  const locked: Save[] = [];
  for (const basesaveid of [mainId, ...ids.filter((id) => id !== mainId)]) {
    const row = await em.findOne(Save, { basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });
    if (row) locked.push(row);
  }
  return locked;
};

/**
 * Makes the moves a Repeat attack needs, all in one transaction, or none.
 *
 * Under the locks the plan is worked out again from the rows as they are now
 * and has to name exactly the moves the player agreed to (`expected`, the
 * {@link movesKey} the prompt showed); anything else (monsters gone, housing
 * changed, a yard under attack) refuses with `movesChanged` and writes
 * nothing. Each move then passes the transfer rules (`planMonsterTransfer`),
 * as a hand-made transfer does.
 *
 * @param user - The player, with their main save populated.
 * @param needs - Monsters the plan flings, per id.
 * @param reaching - The yards whose own Flinger reaches the camp.
 * @param expected - The moves' key, as the player agreed to it.
 * @param now - Server seconds.
 * @returns The moves made.
 */
export const makeRepeatMoves = async (
  user: User,
  needs: Readonly<Counts>,
  reaching: readonly string[],
  expected: string,
  now: number,
): Promise<readonly YardMove[]> => {
  return postgres.em.transactional(async (em) => {
    const rows = await lockedYards(em, user);
    const mainSave = rows[0];
    if (!mainSave || mainSave.basesaveid !== user.save!.basesaveid) throw autoAttackRefusedErr("movesChanged");

    const yards = await Promise.all(rows.map((row) => repeatYardOf(row, mainSave, reaching, now)));
    const plan = planMoves(needs, yards, sizeOfFor(mainSave));
    if (plan.kind !== "moves" || movesKey(plan.moves) !== expected) throw autoAttackRefusedErr("movesChanged");

    const byId = new Map(rows.map((row) => [row.baseid, row]));
    const involved = [...new Set(plan.moves.flatMap((move) => [move.from, move.to]))].map((baseid) => byId.get(baseid)!);
    // Both ends of every move caught up and written, as a hand-made transfer does.
    catchUpTransferYards(involved, mainSave, now);

    const levels = highestAcademyLevels(rows.map((row) => row.academy));
    const capacityOf = (row: Save) => yards.find((yard) => yard.baseid === row.baseid)?.capacity ?? 0;
    for (const move of plan.moves) {
      const from = byId.get(move.from)!;
      const to = byId.get(move.to)!;
      const verdict = planMonsterTransfer({
        from: { baseid: from.baseid, type: from.type, stored: from.monsters, capacity: capacityOf(from) },
        to: { baseid: to.baseid, type: to.type, stored: to.monsters, capacity: capacityOf(to) },
        moved: move.monsters,
        monsterLevels: levels,
      });
      if (!verdict.ok) throw autoAttackRefusedErr("movesChanged", { rule: verdict.rule });
      from.monsters = { ...(from.monsters ?? {}), housed: verdict.fromHoused };
      to.monsters = { ...(to.monsters ?? {}), housed: verdict.toHoused };
    }
    em.persist(involved);
    return plan.moves;
  });
};

/**
 * Puts made moves back, for an attack refused after its moves were written
 * (the attack load said no). Each move runs backwards, taking from where it
 * went no more than is there. Never throws: a failure is logged, and the
 * monsters stay where they were moved to, all still the player's.
 *
 * @param user - The player, with their main save populated.
 * @param moves - What {@link makeRepeatMoves} made.
 * @param now - Server seconds.
 */
export const undoRepeatMoves = async (user: User, moves: readonly YardMove[], now: number): Promise<void> => {
  try {
    await postgres.em.transactional(async (em) => {
      const rows = await lockedYards(em, user);
      const mainSave = rows[0];
      if (!mainSave) return;
      const byId = new Map(rows.map((row) => [row.baseid, row]));
      const involved = [...new Set(moves.flatMap((move) => [move.from, move.to]))]
        .map((baseid) => byId.get(baseid))
        .filter((row): row is Save => row !== undefined);
      catchUpTransferYards(involved, mainSave, now);
      for (const move of moves) {
        const from = byId.get(move.from);
        const to = byId.get(move.to);
        if (!from || !to) continue;
        const toHoused = countsOf(to.monsters?.housed);
        const fromHoused = countsOf(from.monsters?.housed);
        for (const [id, count] of Object.entries(move.monsters)) {
          const back = Math.min(count, toHoused[id] ?? 0);
          if (back <= 0) continue;
          toHoused[id] = (toHoused[id] ?? 0) - back;
          if (toHoused[id] === 0) delete toHoused[id];
          fromHoused[id] = (fromHoused[id] ?? 0) + back;
        }
        to.monsters = { ...(to.monsters ?? {}), housed: toHoused };
        from.monsters = { ...(from.monsters ?? {}), housed: fromHoused };
      }
      em.persist(involved);
    });
  } catch (err) {
    logger.error("Could not put back a Repeat attack's moves for userid {userid}: {error}", {
      userid: user.userid,
      moves,
      error: err,
    });
  }
};
