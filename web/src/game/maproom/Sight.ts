import { getSight } from "@/api/maproom";
import type { RevealedSightCell, SightResponse, SightSource } from "@/api/types";
import { isVisible } from "./rules/sight";
import { type HexShape, axialQ, axialR } from "./rules/range";
import { hexShape } from "@/game/HexGrid";
import { AREA_ZONE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from "@/config";
import { ZONE_COLUMNS, ZONE_ROWS, type ZoneRef } from "./zones";

/**
 * The Map Room 2 fog of war sight the client holds (issue #331,
 * `docs/design/fog-of-war.md` §6): a cache of one `/worldmapv2/sight`
 * response, kept in step with whatever `sv` the map's `getarea` responses
 * are carrying.
 *
 * This is drawing-only data. The server has already redacted anything this
 * sight does not cover out of every `getarea` response — `Sight` exists so
 * the fog edge and the minimap do not have to wait on a zone fetch to know
 * where that edge is, and so a zone entirely outside it is never requested
 * at all.
 */
export type SightFetcher = () => Promise<SightResponse>;

export interface SightOptions {
  /** Injected for tests; defaults to the real `/worldmapv2/sight` call. */
  fetcher?: SightFetcher;
  /**
   * Fired when a fetch lands a different `sv` than the one already held, with `keep`: whether a
   * cached zone (by its origin and the `sv` it was cut to) still shows exactly what the new sight
   * lets it, so only the others need forgetting (`ZoneStore.applySight`).
   */
  onChange?: (keep: (zone: SightZone) => boolean, sv: string) => void;
}

/** A cached zone as the sight change sees it: where it is and the sight it was cut to. */
export interface SightZone extends ZoneRef {
  sv?: string;
}

const EMPTY: SightResponse = { error: 0, sv: "", sources: [], revealed: [] };

export class Sight {
  private snapshot: SightResponse = EMPTY;
  private readonly fetcher: SightFetcher;
  private readonly options: SightOptions;

  constructor(options: SightOptions = {}) {
    this.options = options;
    this.fetcher = options.fetcher ?? getSight;
  }

  /** The fingerprint of the sight currently held; `""` before the first fetch lands. */
  get sv(): string {
    return this.snapshot.sv;
  }

  get sources(): readonly SightSource[] {
    return this.snapshot.sources;
  }

  get revealed(): readonly RevealedSightCell[] {
    return this.snapshot.revealed;
  }

  /** False until the first `/worldmapv2/sight` response has landed. */
  get loaded(): boolean {
    return this.snapshot !== EMPTY;
  }

  /**
   * Fetches the whole sight fresh: on entering the map, and on Refresh. A fetch already on its
   * way is shared rather than doubled (each zone landing with the new `sv` used to start its own).
   *
   * Never rejects: the map calls it without waiting (`void`), so a failed
   * `/worldmapv2/sight` (offline, a timeout, a server error) used to surface
   * as an unhandled rejection in the error reports (beta 9 audit, 21 Nov
   * 2026). A failure keeps the sight already held; the next zone fetch's `sv`
   * or the next Refresh asks again.
   */
  refresh(): Promise<void> {
    this.pending ??= this.fetcher()
      .then(
        (response) => this.apply(response),
        () => undefined,
      )
      .finally(() => {
        this.pending = null;
      });
    return this.pending;
  }

  private pending: Promise<void> | null = null;

  /**
   * Call with a `getarea` response's `sv`. Refetches the whole sight the
   * moment it disagrees with what is held, so the fog edge and the minimap
   * never lag behind a sight change a single zone fetch already noticed.
   */
  async syncVersion(sv: string | undefined): Promise<void> {
    if (sv === undefined || sv === this.snapshot.sv) return;
    if (this.pending) {
      await this.pending;
      if (sv === this.snapshot.sv) return;
    }
    await this.refresh();
  }

  /** Whether a cell is inside this sight: own and alliance circles, or an always-visible reveal. */
  isCellVisible(x: number, y: number): boolean {
    return isVisible({ x, y }, this.snapshot.sources, this.snapshot.revealed, hexShape());
  }

  /**
   * Whether every cell a zone's `getarea` response would cover is outside
   * this sight, so the zone is safe to never request (`fog-of-war.md` §6).
   *
   * Answers false before the sight itself has loaded: fetching normally
   * until then is what lets the map's opening view fill in at all, rather
   * than every zone looking fogged for the one round trip `/worldmapv2/sight`
   * takes.
   *
   * A lookup in the zones the sight touches (`zoneLookup`), worked out once
   * per sight: the map asks this for every unloaded zone on screen several
   * times a second, and a fully fogged zone is never loaded, so it is asked
   * again forever.
   */
  isZoneFullyFogged(zone: ZoneRef): boolean {
    if (!this.loaded) return false;

    const index = gridZoneIndex(zone);
    const lookup = index < 0 ? null : this.zoneLookup();
    if (lookup === null) return this.isZoneFullyFoggedByScan(zone);
    return lookup[index] === 0;
  }

  /**
   * The brute-force form of `isZoneFullyFogged`: tests every one of the
   * zone's 11 x 11 cells against the whole sight. Far too slow to run for
   * every zone on screen several times a second (the MR2 zoom-out lag, 15 Nov
   * 2026), so it is only the fallback for a sight or zone the lookup cannot
   * index, and the reference the lookup is tested against.
   */
  isZoneFullyFoggedByScan(zone: ZoneRef): boolean {
    if (!this.loaded) return false;

    for (let dx = 0; dx <= AREA_ZONE_SIZE; dx++) {
      for (let dy = 0; dy <= AREA_ZONE_SIZE; dy++) {
        if (this.isCellVisible(zone.originX + dx, zone.originY + dy)) return false;
      }
    }
    return true;
  }

  /**
   * One flag per zone of the world's zone grid: 1 when some cell the zone's
   * `getarea` covers is inside this sight. Built once per sight snapshot and
   * hex shape (the first zone question after either changes), so the zone
   * check is a lookup. Null when the sight holds something the lookup cannot
   * index exactly (see `buildZoneLookup`); the scan answers then.
   */
  private zoneLookup(): Uint8Array | null {
    const shape = hexShape();
    if (this.lookupFor !== this.snapshot || this.lookupShape !== shape) {
      this.lookup = buildZoneLookup(this.snapshot.sources, this.snapshot.revealed, shape);
      this.lookupFor = this.snapshot;
      this.lookupShape = shape;
    }
    return this.lookup;
  }

  private lookup: Uint8Array | null = null;
  private lookupFor: SightResponse | null = null;
  private lookupShape: HexShape | null = null;

  private apply(response: SightResponse): void {
    const previous = this.snapshot;
    if (response.sv === previous.sv) {
      this.snapshot = response;
      return;
    }
    this.snapshot = response;
    const onChange = this.options.onChange;
    if (!onChange) return;
    // The zones the change can reach: every zone a circle or revealed cell that came or went
    // touches. Null (forget everything) on the first sight, or one the lookup cannot index.
    const touched = previous === EMPTY ? null : changedZoneLookup(previous, response, hexShape());
    onChange((zone) => {
      // Cut to this very sight (a zone that landed after the change).
      if (zone.sv !== undefined && zone.sv === response.sv) return true;
      if (touched === null || zone.sv !== previous.sv) return false;
      const index = gridZoneIndex(zone);
      return index >= 0 && touched[index] === 0;
    }, response.sv);
  }
}

/**
 * The zones whose cells' visibility can differ between two sights (map lag, 25 Nov 2026): a cell
 * is visible when any circle or revealed cell lights it, so its answer can only change where a
 * circle or revealed cell that is in one sight and not the other reaches. Marks the zones those
 * touch, exactly as `buildZoneLookup` marks a sight's zones (so it never misses one the per-cell
 * rule would light), or null when it cannot index them.
 */
export const changedZoneLookup = (
  before: Pick<SightResponse, "sources" | "revealed">,
  after: Pick<SightResponse, "sources" | "revealed">,
  shape: HexShape,
): Uint8Array | null => {
  const sourceKey = (source: SightSource) => `${source.x},${source.y},${source.reach}`;
  const cellKey = (cell: RevealedSightCell) => `${cell.x},${cell.y}`;
  return buildZoneLookup(
    symmetricDifference(before.sources, after.sources, sourceKey),
    symmetricDifference(before.revealed, after.revealed, cellKey),
    shape,
  );
};

/** The items one list holds more copies of than the other (by `key`), from both sides. */
const symmetricDifference = <T>(a: readonly T[], b: readonly T[], key: (item: T) => string): T[] => {
  const counts = new Map<string, { item: T; count: number }>();
  for (const item of a) {
    const entry = counts.get(key(item));
    if (entry) entry.count += 1;
    else counts.set(key(item), { item, count: 1 });
  }
  for (const item of b) {
    const entry = counts.get(key(item));
    if (entry) entry.count -= 1;
    else counts.set(key(item), { item, count: -1 });
  }
  const out: T[] = [];
  for (const { item, count } of counts.values()) if (count !== 0) out.push(item);
  return out;
};

/**
 * A reach past this is not indexed (the scan answers instead). Real reaches
 * are at most 10 plus an alliance bonus; this only keeps a nonsense value
 * from building a huge box.
 */
const MAX_INDEXED_REACH = 64;

/** The world copies the range rule measures across (`range.ts`, `hexDistance`). */
const WRAPS_X = [0, -WORLD_WIDTH, WORLD_WIDTH] as const;
const WRAPS_Y = [0, -WORLD_HEIGHT, WORLD_HEIGHT] as const;

/**
 * A zone's slot in the lookup, or -1 for a zone off the world's zone grid
 * (an origin that is not a whole multiple of the zone size inside the
 * world), which the scan answers instead.
 */
const gridZoneIndex = (zone: ZoneRef): number => {
  const zx = zone.originX / AREA_ZONE_SIZE;
  const zy = zone.originY / AREA_ZONE_SIZE;
  if (!Number.isInteger(zx) || !Number.isInteger(zy)) return -1;
  if (zx < 0 || zy < 0 || zx >= ZONE_COLUMNS || zy >= ZONE_ROWS) return -1;
  return zx * ZONE_ROWS + zy;
};

/** Marks every grid zone whose `x..x+10`, `y..y+10` cover takes in this cell. */
const markZonesCovering = (seen: Uint8Array, x: number, y: number): void => {
  // A zone at origin o covers o..o+AREA_ZONE_SIZE, so the cell sits in the
  // zones with origins from x - AREA_ZONE_SIZE up to x (two on a zone edge).
  const minZx = Math.max(0, Math.ceil((x - AREA_ZONE_SIZE) / AREA_ZONE_SIZE));
  const maxZx = Math.min(ZONE_COLUMNS - 1, Math.floor(x / AREA_ZONE_SIZE));
  const minZy = Math.max(0, Math.ceil((y - AREA_ZONE_SIZE) / AREA_ZONE_SIZE));
  const maxZy = Math.min(ZONE_ROWS - 1, Math.floor(y / AREA_ZONE_SIZE));
  for (let zx = minZx; zx <= maxZx; zx++) {
    for (let zy = minZy; zy <= maxZy; zy++) seen[zx * ZONE_ROWS + zy] = 1;
  }
};

/**
 * Works out, once, which zones any part of the sight touches, giving exactly
 * the answers the per-cell scan gives (`Sight.test.ts` compares the two over
 * random sights):
 *
 * - A revealed cell lights only itself, matched by its exact coordinates
 *   (`isVisible`), so it marks the zones whose cover holds those coordinates.
 * - A source lights every cell `t` with `steps(source, t + wrap) <= reach` for
 *   one of the nine world copies the range rule measures across. So every
 *   unwrapped cell `u` within reach of the source is walked, and each
 *   `u - wrap` marks the zones covering it. A zone's cover runs to `x + 10`,
 *   so the last zone in a row covers column 800 too; marking by plain
 *   coordinates keeps that cell exactly as the scan sees it.
 *
 * Returns null, leaving the scan to answer, for a source the walk cannot
 * cover exactly: a non-whole cell, or a reach that is not finite or past
 * `MAX_INDEXED_REACH`.
 */
const buildZoneLookup = (
  sources: readonly SightSource[],
  revealed: readonly RevealedSightCell[],
  shape: HexShape,
): Uint8Array | null => {
  const seen = new Uint8Array(ZONE_COLUMNS * ZONE_ROWS);

  // A revealed cell with a fractional coordinate can never equal a zone's
  // whole-numbered cells, so it lights nothing and is skipped.
  for (const cell of revealed) {
    if (Number.isInteger(cell.x) && Number.isInteger(cell.y)) markZonesCovering(seen, cell.x, cell.y);
  }

  for (const source of sources) {
    if (!(source.reach > 0)) continue; // `inReach`: no reach lights nothing
    if (!Number.isInteger(source.x) || !Number.isInteger(source.y)) return null;
    if (!Number.isFinite(source.reach) || source.reach > MAX_INDEXED_REACH) return null;

    // Steps are whole, so `steps <= reach` is `steps <= floor(reach)`.
    const reach = Math.floor(source.reach);
    const q0 = axialQ(source.x, source.y, shape);
    const r0 = axialR(source.x, source.y, shape);
    // Every cell within `reach` steps lies within `reach` columns and
    // `reach + (reach + 1) / 2` rows of the source (or the other way round on
    // pointy), so a box of `2 * reach + 1` either way holds them all.
    const box = 2 * reach + 1;
    for (let ux = source.x - box; ux <= source.x + box; ux++) {
      for (let uy = source.y - box; uy <= source.y + box; uy++) {
        const dq = axialQ(ux, uy, shape) - q0;
        const dr = axialR(ux, uy, shape) - r0;
        if (Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) > reach) continue;
        for (const wx of WRAPS_X) {
          for (const wy of WRAPS_Y) markZonesCovering(seen, ux - wx, uy - wy);
        }
      }
    }
  }
  return seen;
};
