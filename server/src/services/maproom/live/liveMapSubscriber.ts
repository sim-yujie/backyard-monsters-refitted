import type { ChangeSet, EventSubscriber, FlushEventArgs, TransactionEventArgs } from "@mikro-orm/core";

import { Alliance } from "../../../database/models/alliance.model.js";
import { Save } from "../../../database/models/save.model.js";
import { Truce } from "../../../database/models/truce.model.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { calculateBaseLevel } from "../../base/calculateBaseLevel.js";
import { markAlliances, markCells, markSaveOwners, markSaves, markUsers } from "./liveMarks.js";

/**
 * The live map's hook on every ORM write (beta 9, stage 1): a flush that
 * changes something a map cell shows marks that cell's zone
 * (`liveMarks.ts`), so every player watching it re-asks it within a second
 * or two. Catching the flush rather than each route means a new write path
 * is live without anyone remembering to call it.
 *
 * Marks are released only once their transaction commits: a zone re-asked
 * before the commit would read the old row, and the version would not move
 * again. A plain `flush()` runs in its own transaction that has already
 * committed when `afterFlush` fires; inside `em.transactional` (or
 * `em.begin`) the marks wait on that transaction, a savepoint's are handed to
 * its parent when it is released, and a rollback drops them.
 *
 * What counts as "shows": the fields `userCell.ts`, `wildMonsterCell.ts` and
 * `getArea.ts` read. Resources and monsters are left out on purpose: only the
 * owner sees them, they change on nearly every yard save, and the owner's own
 * map asks for them itself (own hatches: `nh`).
 */

/** Save fields a map cell shows (`userCell.ts`, `wildMonsterCell.ts`). */
export const SAVE_MAP_FIELDS: ReadonlySet<string> = new Set([
  "protected",
  "locked",
  "damage",
  "destroyed",
  "empirevalue",
  "attackid",
  "attacks",
  "starterkit",
  "thlevel",
  "flinger",
  "catapult",
  "worldid",
  "cell",
  "baseid",
]);

/** User fields a map cell shows: the plate's name, the picture, the alliance colour. */
export const USER_MAP_FIELDS: ReadonlySet<string> = new Set(["username", "pic_square", "alliance_id"]);

/** Alliance fields `getarea`'s roster sends. */
export const ALLIANCE_MAP_FIELDS: ReadonlySet<string> = new Set(["name", "image"]);

type Mark = () => void;

/** The world id a cell row points at, loaded or as a bare reference. */
const worldOf = (cell: WorldMapCell): string | null => {
  const world = cell.world as unknown as { uuid?: string } | string | undefined;
  if (typeof world === "string") return world;
  return world?.uuid ?? null;
};

/** The 3x3 block around a cell: its neighbours' `nb` counts follow its owner. */
const around = (x: number, y: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push([x + dx, y + dy]);
  return out;
};

/** The level a save's points and value give, or null when it cannot be read. */
const levelOf = (points: unknown, basevalue: unknown): number | null => {
  if (points === undefined || basevalue === undefined || points === null || basevalue === null) return null;
  try {
    return calculateBaseLevel(String(points), String(basevalue));
  } catch {
    return null;
  }
};

/** What one change set means for the map: the marks to make once it commits. */
export const marksFor = (changeSet: ChangeSet<object>): Mark[] => {
  const entity = changeSet.entity;
  const payload = changeSet.payload as Record<string, unknown>;
  const changed = Object.keys(payload);

  if (entity instanceof WorldMapCell) {
    const cell = entity;
    if (cell.map_version !== undefined && cell.map_version !== MapRoomVersion.V2) return [];
    const world = worldOf(cell);
    if (!world) return [];
    const coords = around(cell.x, cell.y);
    const before = changeSet.originalEntity as { x?: number; y?: number } | undefined;
    if (before && typeof before.x === "number" && typeof before.y === "number" && (before.x !== cell.x || before.y !== cell.y)) {
      coords.push(...around(before.x, before.y));
    }
    return [() => markCells(world, coords)];
  }

  if (entity instanceof Save) {
    if (changeSet.type !== "update") return [];
    // Keyed by the primary key, the one field a save loaded with `fields:` always has; its cell
    // and owner are looked up when the bundle goes out.
    const id = entity.basesaveid;
    const marks: Mark[] = [];
    if (changed.some((field) => SAVE_MAP_FIELDS.has(field))) marks.push(() => markSaves([id]));
    if (changed.includes("points") || changed.includes("basevalue")) {
      const before = changeSet.originalEntity as { points?: unknown; basevalue?: unknown } | undefined;
      const was = levelOf(before?.points, before?.basevalue);
      const now = levelOf(entity.points ?? before?.points, entity.basevalue ?? before?.basevalue);
      if (was === null || now === null || was !== now) marks.push(() => markSaveOwners([id]));
    }
    return marks;
  }

  if (entity instanceof User) {
    if (changeSet.type !== "update" || !changed.some((field) => USER_MAP_FIELDS.has(field))) return [];
    const userid = entity.userid;
    return [() => markUsers([userid])];
  }

  if (entity instanceof Truce) {
    // A truce's tick (`t`) shows on both players' cells, to each other.
    const pair = [entity.initiator_userid, entity.recipient_userid];
    return [() => markUsers(pair)];
  }

  if (entity instanceof Alliance) {
    if (changeSet.type !== "update" || !changed.some((field) => ALLIANCE_MAP_FIELDS.has(field))) return [];
    const id = entity.id;
    return [() => markAlliances([id])];
  }

  return [];
};

/** A transaction's waiting marks; a savepoint's go to its parent when released. */
const pending = new WeakMap<object, Mark[]>();
/** A savepoint's parent transaction. */
const parentOf = new WeakMap<object, object>();
/** The parent transaction an `em` was in when it opened a savepoint (start events carry the fork). */
const openingFrom = new WeakMap<object, object>();

const run = (marks: readonly Mark[]): void => {
  for (const mark of marks) mark();
};

export class LiveMapSubscriber implements EventSubscriber {
  afterFlush(args: FlushEventArgs): void {
    try {
      const marks = args.uow.getChangeSets().flatMap((changeSet) => marksFor(changeSet as ChangeSet<object>));
      if (!marks.length) return;
      const context = args.em.isInTransaction() ? (args.em.getTransactionContext() as object | undefined) : undefined;
      if (!context) {
        // A plain flush: its own transaction has already committed.
        run(marks);
        return;
      }
      const waiting = pending.get(context);
      if (waiting) waiting.push(...marks);
      else pending.set(context, marks);
    } catch {
      // Never fail a game write over a live mark.
    }
  }

  beforeTransactionStart(args: TransactionEventArgs): void {
    // A savepoint: `transaction` is the parent it opens inside, `em` the fork that will hold it.
    if (args.transaction) openingFrom.set(args.em, args.transaction);
  }

  afterTransactionStart(args: TransactionEventArgs): void {
    const parent = openingFrom.get(args.em);
    if (!parent || !args.transaction?.savepointName) return;
    openingFrom.delete(args.em);
    parentOf.set(args.transaction, parent);
  }

  afterTransactionCommit(args: TransactionEventArgs): void {
    const context = args.transaction as object | undefined;
    if (!context) return;
    const marks = pending.get(context);
    pending.delete(context);
    if (!marks?.length) return;
    const parent = parentOf.get(context);
    if (parent) {
      // A released savepoint: its marks now wait on the transaction around it.
      const waiting = pending.get(parent);
      if (waiting) waiting.push(...marks);
      else pending.set(parent, marks);
      return;
    }
    try {
      run(marks);
    } catch {
      // As above.
    }
  }

  afterTransactionRollback(args: TransactionEventArgs): void {
    if (args.transaction) pending.delete(args.transaction as object);
  }
}
