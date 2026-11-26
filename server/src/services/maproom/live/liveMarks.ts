/**
 * The live map's marks (beta 9, stage 1): "something a map cell shows has
 * changed", said by the code that changed it, without that code importing
 * Redis or the server.
 *
 * Like `chat/levelChangeBus.ts`, this module has no imports, so the
 * MikroORM subscriber (`liveMapSubscriber.ts`, loaded by `mikro-orm.config.ts`)
 * and the few services that write around the ORM can call it from anywhere,
 * unit tests included. Until `liveZones.ts` registers the real sink at server
 * start every mark is a no-op. A mark never throws: a lost mark costs one
 * cell's live update, never the game write that made it.
 */

/** Where marks go: `liveZones.ts` bundles them for a second and publishes the zones. */
export interface LiveMarkSink {
  /** Cells by their yard's save (`basesaveid`, always loaded): the save changed; its cell is looked up. */
  saves(ids: readonly number[]): void;
  /** Every cell of the players owning these saves (their level changed). */
  saveOwners(ids: readonly number[]): void;
  /** Players' main yards only (their online flag changed). */
  homes(ids: readonly number[]): void;
  /** Cells by position on one world (a `world_map_cell` row changed). */
  cells(world: string, coords: readonly (readonly [number, number])[]): void;
  /** Every cell a player owns (their name, picture, alliance or level changed). */
  users(ids: readonly number[]): void;
  /** Every cell of every member (an alliance's name or shield changed). */
  alliances(ids: readonly number[]): void;
  /** The players whose fog of war (sight) changed: their map asks `/sight` again. */
  sightUsers(ids: readonly number[]): void;
  /** Every member of these alliances: their shared sight changed. */
  sightAlliances(ids: readonly number[]): void;
}

let sink: LiveMarkSink | null = null;

/** Registers the sink (once, at server start); null switches marks off again (tests). */
export const setLiveMarkSink = (next: LiveMarkSink | null): void => {
  sink = next;
};

/** Runs a mark, swallowing anything it throws. */
const safely = (mark: (to: LiveMarkSink) => void): void => {
  if (!sink) return;
  try {
    mark(sink);
  } catch {
    // A mark must never fail a write; the next change or the 5-minute check catches up.
  }
};

const realIds = (ids: readonly number[]): number[] => ids.filter((id) => Number.isSafeInteger(id) && id > 0);

export const markSaves = (ids: readonly number[]): void => {
  const real = realIds(ids);
  if (real.length) safely((to) => to.saves(real));
};

export const markSaveOwners = (ids: readonly number[]): void => {
  const real = realIds(ids);
  if (real.length) safely((to) => to.saveOwners(real));
};

export const markHomes = (ids: readonly number[]): void => {
  const real = realIds(ids);
  if (real.length) safely((to) => to.homes(real));
};

export const markCells = (world: string, coords: readonly (readonly [number, number])[]): void => {
  if (world && coords.length) safely((to) => to.cells(world, coords));
};

export const markUsers = (ids: readonly number[]): void => {
  const real = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (real.length) safely((to) => to.users(real));
};

export const markAlliances = (ids: readonly number[]): void => {
  const real = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (real.length) safely((to) => to.alliances(real));
};

export const markSightUsers = (ids: readonly number[]): void => {
  const real = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (real.length) safely((to) => to.sightUsers(real));
};

export const markSightAlliances = (ids: readonly number[]): void => {
  const real = ids.filter((id) => Number.isSafeInteger(id) && id > 0);
  if (real.length) safely((to) => to.sightAlliances(real));
};

/** A cell row as code that is about to delete it holds it: the world loaded, a reference or its id. */
export interface CellRowLike {
  x: number;
  y: number;
  world?: unknown;
}

const worldIdOf = (world: unknown): string | null => {
  if (typeof world === "string") return world;
  if (world && typeof world === "object" && "uuid" in world && typeof world.uuid === "string") return world.uuid;
  return null;
};

/**
 * Marks cells a write is removing around the ORM (`nativeDelete`), read before the delete:
 * call it once the transaction has committed. Each cell's 3x3 block, for its neighbours' `nb`.
 */
export const markCellRows = (rows: readonly CellRowLike[]): void => {
  const byWorld = new Map<string, [number, number][]>();
  for (const row of rows) {
    const world = worldIdOf(row.world);
    if (!world) continue;
    const list = byWorld.get(world) ?? [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) list.push([row.x + dx, row.y + dy]);
    byWorld.set(world, list);
  }
  for (const [world, coords] of byWorld) markCells(world, coords);
};
