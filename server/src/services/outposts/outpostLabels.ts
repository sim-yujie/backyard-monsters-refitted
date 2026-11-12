import type { EntityManager } from "@mikro-orm/postgresql";

import { outpostPinRefusal, type OutpostLabels } from "./outpostLabelRules.js";

/**
 * Outpost names and pins (beta 7, `outpostLabelRules.ts`), in
 * `bym.outpost_label` (migration `20261114_CreateOutpostLabelTable`).
 *
 * Every read joins the outpost's save on its owner, so a row for an outpost
 * the player has since lost is never listed nor counted against the pin
 * limit; it comes back if they take the outpost again.
 */

/** Rows of outposts the player owns now. */
const OWNED = `
  FROM bym.outpost_label l
  JOIN bym.save s ON s.baseid = l.baseid AND s.type = 'outpost' AND s.saveuserid = l.userid
  WHERE l.userid = ?`;

/** The player's names and pins, pins in the order they were pinned. */
export const readOutpostLabels = async (em: EntityManager, userid: number): Promise<OutpostLabels> => {
  const rows = await em.execute<{ baseid: string; name: string; pin_order: number | null }[]>(
    `SELECT l.baseid, l.name, l.pin_order ${OWNED} ORDER BY l.pin_order NULLS LAST, l.baseid`,
    [userid],
  );
  const names: Record<string, string> = {};
  const pins: string[] = [];
  for (const row of rows) {
    if (row.name) names[row.baseid] = row.name;
    if (row.pin_order !== null) pins.push(row.baseid);
  }
  return { names, pins };
};

/**
 * The names and pins for an owner's yard load, or null when the read fails
 * (a server running before the migration): the list then shows coordinates.
 */
export const outpostLabelsOnLoad = async (
  em: () => EntityManager,
  userid: number,
): Promise<OutpostLabels | null> => {
  try {
    const labels = await readOutpostLabels(em(), userid);
    return Object.keys(labels.names).length > 0 || labels.pins.length > 0 ? labels : null;
  } catch {
    return null;
  }
};

/** Whether the player owns this outpost now. */
export const ownsOutpost = async (em: EntityManager, userid: number, baseid: string): Promise<boolean> => {
  const [row] = await em.execute<{ one: number }[]>(
    `SELECT 1 AS one FROM bym.save WHERE baseid = ? AND type = 'outpost' AND saveuserid = ? LIMIT 1`,
    [baseid, userid],
  );
  return !!row;
};

/** Drops the row once it holds neither a name nor a pin. */
const dropEmpty = (em: EntityManager, userid: number, baseid: string) =>
  em.execute(`DELETE FROM bym.outpost_label WHERE userid = ? AND baseid = ? AND name = '' AND pin_order IS NULL`, [
    userid,
    baseid,
  ]);

export type LabelOutcome = { outcome: "done"; labels: OutpostLabels } | { outcome: "notOwner" } | { outcome: "pinLimit" };

/** Names (or, with "", un-names) one of the player's outposts. The name is already checked. */
export const setOutpostName = async (
  em: EntityManager,
  userid: number,
  baseid: string,
  name: string,
  now: Date,
): Promise<LabelOutcome> =>
  em.transactional(async (tx) => {
    if (!(await ownsOutpost(tx, userid, baseid))) return { outcome: "notOwner" };
    await tx.execute(
      `INSERT INTO bym.outpost_label (userid, baseid, name, pin_order, updated_at) VALUES (?, ?, ?, NULL, ?)
       ON CONFLICT (userid, baseid) DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at`,
      [userid, baseid, name, now],
    );
    await dropEmpty(tx, userid, baseid);
    return { outcome: "done", labels: await readOutpostLabels(tx, userid) };
  });

/**
 * Pins (`pin`) or unpins one of the player's outposts. Pinning one already
 * pinned, or unpinning one that is not, changes nothing. The player's own
 * `user` row is locked for the count, so two pins at once cannot both slip
 * under the limit.
 */
export const setOutpostPinned = async (
  em: EntityManager,
  userid: number,
  baseid: string,
  pin: boolean,
  now: Date,
): Promise<LabelOutcome> =>
  em.transactional(async (tx) => {
    await tx.execute(`SELECT userid FROM bym."user" WHERE userid = ? FOR UPDATE`, [userid]);
    if (!(await ownsOutpost(tx, userid, baseid))) return { outcome: "notOwner" };
    const before = await readOutpostLabels(tx, userid);
    const pinned = before.pins.includes(baseid);
    if (outpostPinRefusal({ pinned, pinnedCount: before.pins.length }, pin)) return { outcome: "pinLimit" };
    if (pinned === pin) return { outcome: "done", labels: before };
    if (pin) {
      // After every pin the player has, owned or not, so the order holds.
      const [top] = await tx.execute<{ n: number | null }[]>(
        `SELECT max(pin_order) AS n FROM bym.outpost_label WHERE userid = ?`,
        [userid],
      );
      const order = Number(top?.n ?? 0) + 1;
      await tx.execute(
        `INSERT INTO bym.outpost_label (userid, baseid, name, pin_order, updated_at) VALUES (?, ?, '', ?, ?)
         ON CONFLICT (userid, baseid) DO UPDATE SET pin_order = EXCLUDED.pin_order, updated_at = EXCLUDED.updated_at`,
        [userid, baseid, order, now],
      );
    } else {
      await tx.execute(`UPDATE bym.outpost_label SET pin_order = NULL, updated_at = ? WHERE userid = ? AND baseid = ?`, [
        now,
        userid,
        baseid,
      ]);
      await dropEmpty(tx, userid, baseid);
    }
    return { outcome: "done", labels: await readOutpostLabels(tx, userid) };
  });
