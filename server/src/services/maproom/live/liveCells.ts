import { RequestContext } from "@mikro-orm/core";

import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { MapRoom2, MapRoomVersion } from "../../../enums/MapRoom.js";
import { postgres } from "../../../server.js";
import { getAllianceRoster } from "../../alliance/allianceData.js";
import { generateNoise, getTerrainHeight } from "../v2/generateMap.js";
import type { MapCell } from "../v2/createCellData.js";
import {
  addNeighbourCounts,
  CELL_SAVE_FIELDS,
  cellContext,
  cellKey,
  generatedPayload,
  OWN_SAVE_FIELDS,
  rowPayloads,
  STRANGER,
  type CellContext,
} from "../v2/areaCells.js";

/**
 * The cells a live push carries (beta 9, stage 2), built by the same code as
 * `getarea` (`v2/areaCells.ts`):
 *
 * - {@link buildPublicCells}: what anyone who can see a cell sees of it, built
 *   once per bundle for every watcher (the gateway then leaves out what each
 *   watcher's fog hides).
 * - {@link buildOwnerCells}: a player's own cells as their own `getarea`
 *   gives them (army, resources, next hatch, workers...), sent on that
 *   player's own channel only.
 *
 * A few queries per bundle, however many players watch.
 */

/** One pushed cell: `[x, y, payload]`, the payload exactly as a zone answer holds it. */
export type PushedCell = [number, number, unknown];

/** An alliance's crest entry, as `getarea`'s `alliancedata` holds it. */
export type RosterEntry = Awaited<ReturnType<typeof getAllianceRoster>>[number];

export interface PublicCells {
  cells: PushedCell[];
  /** The alliances owning the cells, for their crests. */
  alliances: RosterEntry[];
  /** The players owning the cells. */
  owners: number[];
}

/** Rows read per query: a bundle's cells are asked by their exact coordinates. */
const ROWS_PER_QUERY = 300;

const inWorld = ([x, y]: readonly [number, number]): boolean => x >= 0 && y >= 0 && x < MapRoom2.WIDTH && y < MapRoom2.HEIGHT;

const unique = (coords: readonly (readonly [number, number])[]): [number, number][] => {
  const seen = new Map<string, [number, number]>();
  for (const [x, y] of coords) if (inWorld([x, y])) seen.set(cellKey(x, y), [x, y]);
  return [...seen.values()];
};

const loadRows = async (world: string, coords: readonly [number, number][], uid?: number): Promise<MapCell[]> => {
  const rows: MapCell[] = [];
  for (let start = 0; start < coords.length; start += ROWS_PER_QUERY) {
    const chunk = coords.slice(start, start + ROWS_PER_QUERY);
    rows.push(
      ...((await postgres.em.find(
        WorldMapCell,
        {
          world,
          map_version: MapRoomVersion.V2,
          ...(uid !== undefined && { uid }),
          $or: chunk.map(([x, y]) => ({ x, y })),
        },
        { populate: ["save"], fields: CELL_SAVE_FIELDS },
      )) as unknown as MapCell[]),
    );
  }
  return rows;
};

/** Each coordinate's payload for the context's viewer: its row's, else generated ground; then `nb`. */
const payloadsAt = async (
  ctx: CellContext,
  world: string,
  coords: readonly [number, number][],
  rows: readonly MapCell[],
  ownOnly = false,
): Promise<{ cells: PushedCell[]; alliances: Set<number> }> => {
  const { payloads, alliances } = await rowPayloads(ctx, world, rows, { ownOnly });
  const noise = generateNoise(world);
  const grid: Record<number, Record<number, unknown>> = {};
  const cells: PushedCell[] = [];
  for (const [x, y] of coords) {
    let payload = payloads.get(cellKey(x, y));
    if (payload === undefined) payload = await generatedPayload(ctx, world, noise, x, y);
    cells.push([x, y, payload]);
    if (payload) (grid[x] ??= {})[y] = payload;
  }
  await addNeighbourCounts(grid, world, (cx, cy) => getTerrainHeight(noise, cx, cy));
  return { cells, alliances };
};

/** The cells at `coords` as a stranger sees them (nothing owner- or viewer-specific). */
export const buildPublicCells = (world: string, coords: readonly (readonly [number, number])[]): Promise<PublicCells> =>
  RequestContext.create(postgres.orm.em, async () => {
    const wanted = unique(coords);
    if (!wanted.length) return { cells: [], alliances: [], owners: [] };
    const rows = await loadRows(world, wanted);
    const { cells, alliances } = await payloadsAt(cellContext(STRANGER), world, wanted, rows);
    const owners = new Set<number>();
    for (const [, , payload] of cells) {
      const uid = (payload as { uid?: unknown } | undefined)?.uid;
      if (typeof uid === "number" && uid > 0) owners.add(uid);
    }
    return { cells, alliances: await getAllianceRoster([...alliances]), owners: [...owners] };
  });

/**
 * `userid`'s own cells among `coords`, as their own `getarea` gives them; empty when they own none
 * there (or the account is gone).
 */
export const buildOwnerCells = (
  userid: number,
  world: string,
  coords: readonly (readonly [number, number])[],
): Promise<PushedCell[]> =>
  RequestContext.create(postgres.orm.em, async () => {
    const wanted = unique(coords);
    if (!wanted.length) return [];
    const rows = await loadRows(world, wanted, userid);
    if (!rows.length) return [];
    const user = await postgres.em.findOne(User, { userid }, { populate: ["save"], fields: ["userid", "username", "pic_square", "alliance_id", ...OWN_SAVE_FIELDS] });
    if (!user) return [];
    const owned = rows.map((row) => [row.x, row.y] as [number, number]);
    const { cells } = await payloadsAt(cellContext(user as unknown as User), world, owned, rows, true);
    // Only cells that really are theirs (a row whose owner was gone builds as ground).
    return cells.filter(([, , payload]) => (payload as { mine?: unknown } | undefined)?.mine === 1);
  });

/** The zones holding a player's cells on a world (for "ask these again", a relation changed). */
export const cellsOf = (userids: readonly number[]): Promise<{ uid: number; world_id: string; x: number; y: number }[]> =>
  RequestContext.create(postgres.orm.em, async () =>
    userids.length
      ? postgres.em.execute(
          `SELECT c.uid, c.world_id, c.x, c.y FROM bym.world_map_cell c WHERE c.map_version = 2 AND c.uid IN (${userids.map(() => "?").join(", ")})`,
          [...userids],
        )
      : [],
  );
