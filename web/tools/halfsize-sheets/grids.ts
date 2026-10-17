/**
 * Prints the cell grid of every repainted sheet as JSON, for
 * `make_halfsize.py`: the repaint file and its cell size in 1x units.
 *
 *   npx vite-node tools/halfsize-sheets/grids.ts > grids.json
 */
import { MONSTER_SPRITES } from "../../src/game/attack/monsterSpriteData";
import { applyLayout, REPAINTED_SHEETS } from "../../src/game/attack/monsterSprites";

const grids: { file: string; frameWidth: number; frameHeight: number }[] = [];
const seen = new Set<string>();
for (const sheet of Object.values(MONSTER_SPRITES)) {
  const repaint = REPAINTED_SHEETS[sheet.file];
  if (!repaint || seen.has(repaint)) continue;
  seen.add(repaint);
  const laid = applyLayout(sheet);
  grids.push({ file: repaint, frameWidth: laid.frameWidth, frameHeight: laid.frameHeight });
}
console.log(JSON.stringify(grids, null, 2));
