/**
 * Lists every Modern building picture the yard can ask for, with how it is cut
 * (beta 9, for `make_copies.py`). Run from web/:
 *   npx vite-node tools/building-copies/list-art.ts > tools/building-copies/art-uses.json
 */
import { modernBuildingArtUses } from "@/game/yard/buildingArtUses";

process.stdout.write(
  JSON.stringify(Object.fromEntries(modernBuildingArtUses()), null, 1) + "\n",
);
