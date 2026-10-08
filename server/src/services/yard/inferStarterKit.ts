import { STARTER_KITS } from "../../game-data/starterKits.js";

const OUTPOST_CORE_TYPE = 112;

/** Share of a kit's buildings that must still stand where the kit put them. */
const MATCH_SHARE = 0.7;

type Placed = { t?: unknown; X?: unknown; Y?: unknown };

/**
 * Which Starter Kit (1 Regular, 2 Mega, 3 Ultra) an outpost's buildings look
 * like, 0 when none. For outposts that took a kit before `save.starterkit`
 * existed (issue #334): a kit places every building at a fixed spot, so the
 * layout is the only trace of it. A kit counts when most of its buildings
 * (core excluded) still stand at their kit spot; the biggest such kit wins,
 * so a Mega yard that also holds a Regular kit's spots reads as Mega.
 */
export const inferStarterKit = (buildings: Record<string, Placed> | null | undefined): number => {
  const placed = new Set<string>();
  for (const building of Object.values(buildings ?? {})) {
    placed.add(`${Number(building?.t)}:${Number(building?.X)}:${Number(building?.Y)}`);
  }
  let best = 0;
  for (const kit of STARTER_KITS) {
    const rows = kit.buildings.filter((row) => row.t !== OUTPOST_CORE_TYPE);
    if (rows.length === 0) continue;
    const found = rows.filter((row) => placed.has(`${row.t}:${row.X}:${row.Y}`)).length;
    if (found / rows.length >= MATCH_SHARE) best = Math.max(best, kit.id);
  }
  return best;
};
