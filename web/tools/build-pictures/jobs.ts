/**
 * Lists the build menu's Modern pictures to make, as JSON on stdout, for
 * `make.py`: every type in a build menu (main yard, outpost and Inferno)
 * that shows a new look in the yard at level 1 (`newLookFor`), with the files
 * and offsets the yard draws it from (`resolveArt`): its whole picture (the
 * still of a tower whose turret turns, or of a 3D building whose moving parts
 * are a strip) and its ground shadow.
 *
 *     cd web && bun tools/build-pictures/jobs.ts
 */
import { ArtState, newLookFor, resolveArt } from "@/game/yard/buildingArt";
import { catalogueFor } from "@/game/yard/buildCatalogue";
import type { YardKind } from "@/game/yard/buildingCostData";
import { maxLevel } from "@/game/yard/buildingCosts";

/** The level whose look the menu shows: the one a new building has, as Flash's buttons did. */
export const PICTURE_LEVEL = 1;

/**
 * Housing (15) and the Champion Cage (114) are a bare fence at level 1, nearly
 * empty in a tile, so they show their top level (owner, 2 Nov 2026).
 */
const TOP_LEVEL_TYPES: ReadonlySet<number> = new Set([15, 114]);

/**
 * The Inferno's types shown at their top level, as Flash's own Inferno
 * buttons were: the Bone Cruncher (1), whose button (`bone_crusher.v2.jpg`)
 * is its later look with the hopper and chute, not the bare tub of level 1
 * (9 Nov 2026: its level-1 tile looked small and plain beside the others).
 */
const INFERNO_TOP_LEVEL_TYPES: ReadonlySet<number> = new Set([1]);

const pictureLevel = (type: number, kind: YardKind): number =>
  TOP_LEVEL_TYPES.has(type) || (kind === "inferno" && INFERNO_TOP_LEVEL_TYPES.has(type))
    ? maxLevel(type, kind)
    : PICTURE_LEVEL;

const jobs: object[] = [];
for (const kind of ["main", "inferno"] as const satisfies readonly YardKind[]) {
  const kinds: readonly YardKind[] = kind === "main" ? ["main", "outpost"] : ["inferno"];
  const types = new Set(kinds.flatMap((k) => catalogueFor(k).flatMap((category) => category.types)));
  for (const type of [...types].sort((a, b) => a - b)) {
    const level = pictureLevel(type, kind);
    if (!newLookFor(type, level, kind)) continue;
    const art = resolveArt(type, level, ArtState.DEFAULT, kind);
    if (!art) continue;
    const whole = art.still ?? art.top;
    jobs.push({
      kind,
      type,
      name: art.name,
      top: { url: whole.url, x: whole.x, y: whole.y },
      shadow: art.shadow ? { url: art.shadow.url, x: art.shadow.x, y: art.shadow.y } : null,
    });
  }
}
console.log(JSON.stringify(jobs, null, 1));
