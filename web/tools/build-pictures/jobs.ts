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

/** The level whose look the menu shows: the one a new building has, as Flash's buttons did. */
export const PICTURE_LEVEL = 1;

const jobs: object[] = [];
for (const kind of ["main", "inferno"] as const satisfies readonly YardKind[]) {
  const kinds: readonly YardKind[] = kind === "main" ? ["main", "outpost"] : ["inferno"];
  const types = new Set(kinds.flatMap((k) => catalogueFor(k).flatMap((category) => category.types)));
  for (const type of [...types].sort((a, b) => a - b)) {
    if (!newLookFor(type, PICTURE_LEVEL, kind)) continue;
    const art = resolveArt(type, PICTURE_LEVEL, ArtState.DEFAULT, kind);
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
