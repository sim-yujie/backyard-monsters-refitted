/**
 * Re-emits `ATTACK_MONSTER_PROPS` in `src/game/attack/attackStats.ts` from the
 * server's `server/src/game-data/stats/monsterStats.ts` (`props`), leaving the
 * header and the champion table as they are.
 *
 *   cd web && npm run gen:attack-stats
 *
 * Bun rather than Node, because it imports the server's TypeScript table.
 * Run it whenever `monsterStats.ts` changes (beta 10's rebalance, or a later
 * `CRABATRON_HATCH_SECONDS`); `serverCopies.test.ts` fails until you do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { monsterStats } from "../../server/src/game-data/stats/monsterStats.ts";

const FILE = fileURLToPath(new URL("../src/game/attack/attackStats.ts", import.meta.url));
const text = readFileSync(FILE, "utf8");
const start = text.indexOf("export const ATTACK_MONSTER_PROPS");
const open = text.indexOf("= {\n", start) + 4;
const close = text.indexOf("\n};\n", open);
if (start < 0 || open < 4 || close < 0) throw new Error(`${FILE}: ATTACK_MONSTER_PROPS not found`);

const value = (one) => (typeof one === "string" ? JSON.stringify(one) : String(one));
const body = Object.entries(monsterStats)
  .map(
    ([id, stat]) =>
      `  ${id}: {\n${Object.entries(stat.props)
        .map(([key, ladder]) => `    ${key}: [${ladder.map(value).join(", ")}],`)
        .join("\n")}\n  },`,
  )
  .join("\n");
const out = text.slice(0, open) + body + text.slice(close);
if (out === text) console.log("attackStats.ts already matches monsterStats.ts");
else {
  writeFileSync(FILE, out);
  console.log("attackStats.ts re-emitted from monsterStats.ts");
}
