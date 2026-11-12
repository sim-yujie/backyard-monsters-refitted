import type { Texture } from "pixi.js";
import { isPlayerCell, type MapCell } from "@/api/types";
import { shieldUrl } from "@/game/alliance/allianceRules";
import { MapPicture } from "./mapPicture";

/**
 * The alliances the map shows (beta 7, design v5 §12): every `/getarea`
 * answer carries `alliancedata`, the roster of the alliances owning a cell in
 * that area plus the viewer's own, as `[{ alliance_id, name, image }]`. A
 * player cell names its owner's alliance by `aid`; the roster turns that into
 * a name (the cell's popup) and a shield (the name plate).
 */

/** One alliance as the map knows it. */
export interface MapAlliance {
  readonly id: number;
  readonly name: string;
  /** Flash's shield, 1 to 41. */
  readonly image: number;
}

/** The roster in a `/getarea` answer, skipping any row it cannot read. */
export const parseAllianceRoster = (data: unknown): MapAlliance[] => {
  if (!Array.isArray(data)) return [];
  const roster: MapAlliance[] = [];
  for (const row of data as unknown[]) {
    if (!row || typeof row !== "object") continue;
    const { alliance_id, name, image } = row as { alliance_id?: unknown; name?: unknown; image?: unknown };
    const id = Number(alliance_id);
    if (!Number.isInteger(id) || id <= 0 || typeof name !== "string") continue;
    const shield = Number(image);
    roster.push({ id, name, image: Number.isInteger(shield) && shield >= 1 ? shield : 1 });
  }
  return roster;
};

/**
 * The player's own alliance when a cell's owner is in it too (beta 7), for
 * the "X is in your alliance, attack anyway?" confirm; null for anyone else,
 * the player's own cells, a camp, or a player in no alliance.
 */
export const mateAllianceOf = (
  cell: MapCell | undefined,
  myAlliance: number | null,
  allianceOf: (id: number) => MapAlliance | undefined,
): { name: string; image: number } | null => {
  if (!cell || !isPlayerCell(cell) || cell.mine === 1 || cell.aid == null || myAlliance === null) return null;
  if (cell.aid !== myAlliance) return null;
  const alliance = allianceOf(myAlliance);
  return { name: alliance?.name ?? MATE_FALLBACK_NAME, image: alliance?.image ?? 1 };
};

/** The mate warning's alliance name when the map has not heard the alliance's own yet. */
export const MATE_FALLBACK_NAME = "Your alliance";

/** Every alliance the open map has heard of, newest word kept (a rename, a new shield). */
export class AllianceRoster {
  private readonly byId = new Map<number, MapAlliance>();

  /** Takes a roster in; true when something the map draws changed. */
  merge(roster: readonly MapAlliance[]): boolean {
    let changed = false;
    for (const alliance of roster) {
      const known = this.byId.get(alliance.id);
      if (known && known.name === alliance.name && known.image === alliance.image) continue;
      this.byId.set(alliance.id, alliance);
      changed = true;
    }
    return changed;
  }

  get(id: number): MapAlliance | undefined {
    return this.byId.get(id);
  }

  clear(): void {
    this.byId.clear();
  }
}

/**
 * The 41 shields' small pictures, each fetched the first time a plate needs
 * it and shared by every chunk. `arrived` runs once per picture when it lands,
 * so the map redraws the plates waiting for it.
 */
export class MapShields {
  private readonly pictures = new Map<number, MapPicture>();

  constructor(private readonly arrived: () => void) {}

  /** The shield's picture, or null while it is on its way (it is asked for here). */
  texture(image: number): Texture | null {
    let picture = this.pictures.get(image);
    if (!picture) {
      picture = new MapPicture(shieldUrl(image, "small"), true);
      this.pictures.set(image, picture);
      void picture.load().then((ok) => ok && this.arrived());
    }
    return picture.texture;
  }

  destroy(): void {
    for (const picture of this.pictures.values()) picture.destroy();
    this.pictures.clear();
  }
}
