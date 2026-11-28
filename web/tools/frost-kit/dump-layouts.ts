// Prints the sheet rows the comparison sheets need (bun tools/frost-kit/dump-layouts.ts > layouts.json).
import { applyLayout, directionColumn, REPAINTED_SHEETS, frameRect } from "../../src/game/attack/monsterSprites";
import { MONSTER_SPRITES } from "../../src/game/attack/monsterSpriteData";
import { KRAMPUS_SPRITES } from "../../src/game/attack/krampusSprites";

const ids = ["C1", "C5", "C6", "C8", "C9", "C10", "C14", "C16"];
const out: Record<string, unknown> = {};
const add = (name: string, id: string, level: number) => {
  const key = id.startsWith("G") ? `${id}_${level}` : id;
  const flash = MONSTER_SPRITES[key] ?? KRAMPUS_SPRITES[key]!;
  const modern = applyLayout(flash);
  // the front-left heading (135 degrees on screen), first walk frame
  const pick = (sheet: typeof modern) => {
    const column = directionColumn((135 * Math.PI) / 180, sheet.directions, sheet.directionOffset);
    const row = sheet.animations.walk?.first ?? 0;
    return { rect: frameRect(sheet, column, row), anchorX: sheet.anchorX, anchorY: sheet.anchorY };
  };
  out[name] = { file: flash.file, repaint: REPAINTED_SHEETS[flash.file] ?? null, classic: pick(flash), modern: pick(modern) };
};
for (const id of ids) add(id, id, 1);
for (const [id, level] of [["G1", 1], ["G1", 3], ["G1", 6], ["G2", 1], ["G2", 3], ["G2", 6], ["G4", 1], ["G4", 3], ["G4", 6], ["G6", 1], ["G6", 3], ["G6", 6]] as const) add(`${id}_${level}`, id, level);
console.log(JSON.stringify(out));
