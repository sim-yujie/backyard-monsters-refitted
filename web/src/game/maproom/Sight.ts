import { getSight } from "@/api/maproom";
import type { RevealedSightCell, SightResponse, SightSource } from "@/api/types";
import { isVisible } from "./rules/sight";
import { AREA_ZONE_SIZE } from "@/config";
import type { ZoneRef } from "./zones";

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
  /** Fired when a fetch lands a different `sv` than the one already held. */
  onChange?: () => void;
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

  /** Fetches the whole sight fresh: on entering the map, and on Refresh. */
  async refresh(): Promise<void> {
    const response = await this.fetcher();
    this.apply(response);
  }

  /**
   * Call with a `getarea` response's `sv`. Refetches the whole sight the
   * moment it disagrees with what is held, so the fog edge and the minimap
   * never lag behind a sight change a single zone fetch already noticed.
   */
  async syncVersion(sv: string | undefined): Promise<void> {
    if (sv === undefined || sv === this.snapshot.sv) return;
    await this.refresh();
  }

  /** Whether a cell is inside this sight: own and alliance circles, or an always-visible reveal. */
  isCellVisible(x: number, y: number): boolean {
    return isVisible({ x, y }, this.snapshot.sources, this.snapshot.revealed);
  }

  /**
   * Whether every cell a zone's `getarea` response would cover is outside
   * this sight, so the zone is safe to never request (`fog-of-war.md` §6).
   *
   * Answers false before the sight itself has loaded: fetching normally
   * until then is what lets the map's opening view fill in at all, rather
   * than every zone looking fogged for the one round trip `/worldmapv2/sight`
   * takes.
   */
  isZoneFullyFogged(zone: ZoneRef): boolean {
    if (!this.loaded) return false;

    for (let dx = 0; dx <= AREA_ZONE_SIZE; dx++) {
      for (let dy = 0; dy <= AREA_ZONE_SIZE; dy++) {
        if (this.isCellVisible(zone.originX + dx, zone.originY + dy)) return false;
      }
    }
    return true;
  }

  private apply(response: SightResponse): void {
    const changed = response.sv !== this.snapshot.sv;
    this.snapshot = response;
    if (changed) this.options.onChange?.();
  }
}
