import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  atLevel,
  compareListOrder,
  hatchCost,
  hatchTime,
  housingSpace,
  isListed,
  LAB_ABILITIES,
  labAbility,
  labStep,
  LISTED_MONSTERS,
  maxTrainingLevel,
  MONSTER_CATALOGUE,
  monsterEntry,
  trainingStep,
} from "./monsterCatalogue";

/**
 * The generated monster catalogue, its helpers, the generator's tripwires and
 * the web/server sync.
 *
 * `server/src/game-data/monsterCatalogue.test.ts` checks the same rows from the
 * server's side, and cross-checks them against the server's combat stat table.
 */

const WEB = fileURLToPath(new URL("./monsterCatalogue.ts", import.meta.url));
const SERVER = fileURLToPath(
  new URL("../../../../server/src/game-data/monsterCatalogue.ts", import.meta.url),
);
const GENERATOR = fileURLToPath(
  new URL("../../../tools/gen-monster-catalogue.mjs", import.meta.url),
);
const SCRIPTS = fileURLToPath(new URL("../../../../client/scripts/", import.meta.url));

const lf = (path: string): string => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const ids = (list: readonly { id: string }[]): string[] => list.map((one) => one.id);

describe("the monster catalogue", () => {
  it("holds the nineteen surface monsters and nothing else", () => {
    expect(ids(MONSTER_CATALOGUE)).toEqual(Array.from({ length: 19 }, (_, k) => `C${k + 1}`));
    expect(monsterEntry("C200")).toBeUndefined();
    expect(monsterEntry("IC1")).toBeUndefined();
  });

  it("keeps Pokey's unlock price and time", () => {
    // `client/scripts/CREATURELOCKER.as:106-107`.
    const pokey = monsterEntry("C1");
    expect(pokey?.resource).toBe(4000);
    expect(pokey?.time).toBe(600);
    expect(pokey?.level).toBe(1);
    expect(pokey?.name).toBe("Pokey");
  });

  it("re-enables Vorg, Slimeattikus and Rezghul (D7)", () => {
    for (const id of ["C16", "C17", "C19"]) {
      expect(monsterEntry(id)?.blocked, id).toBe(false);
      expect(isListed(id), id).toBe(true);
    }
    expect(monsterEntry("C16")).toMatchObject({ resource: 384000, time: 36 * 3600, level: 2 });
    expect(monsterEntry("C17")).toMatchObject({ resource: 2048000, time: 36 * 3600, level: 3 });
    expect(monsterEntry("C19")).toMatchObject({ resource: 2048000, time: 36 * 3600, level: 3 });
    expect(monsterEntry("C19")).toMatchObject({ page: 4, order: 4 });
  });

  it("keeps Slimeattikus Mini hidden as C17's spawn", () => {
    expect(monsterEntry("C18")?.blocked).toBe(true);
    expect(monsterEntry("C18")?.spawnedBy).toBe("C17");
    expect(isListed("C18")).toBe(false);
    expect(ids(LISTED_MONSTERS)).not.toContain("C18");
    for (const one of MONSTER_CATALOGUE) {
      if (one.id !== "C18") expect(one.spawnedBy, one.id).toBeNull();
    }
  });

  it("lists eighteen monsters in hatchery order, C9 before C17", () => {
    const listed = ids(LISTED_MONSTERS);
    expect(listed).toHaveLength(18);
    expect(listed.slice(0, 11)).toEqual([
      "C1",
      "C2",
      "C3",
      "C4",
      "C5",
      "C6",
      "C7",
      "C8",
      "C16",
      "C9",
      "C17",
    ]);
    expect(listed.at(-1)).toBe("C19");
    expect([...LISTED_MONSTERS].sort(compareListOrder)).toEqual(LISTED_MONSTERS);
  });

  it("gives every listed monster its own locker slot", () => {
    const slots = LISTED_MONSTERS.map((one) => `${one.page}/${one.order}`);
    expect(new Set(slots).size).toBe(slots.length);
    for (const one of LISTED_MONSTERS) {
      expect(one.page, one.id).toBeGreaterThanOrEqual(1);
      expect(one.page, one.id).toBeLessThanOrEqual(4);
    }
  });

  it("has whole, positive numbers throughout", () => {
    for (const one of MONSTER_CATALOGUE) {
      for (const value of [one.resource, one.time, one.level]) {
        expect(Number.isInteger(value) && value > 0, one.id).toBe(true);
      }
      expect(one.trainingCosts.length, one.id).toBeGreaterThanOrEqual(4);
      for (const ladder of [one.cResource, one.cTime, one.cStorage, ...one.trainingCosts]) {
        expect(ladder.length, one.id).toBeGreaterThan(0);
        for (const value of ladder)
          expect(Number.isInteger(value) && value > 0, one.id).toBe(true);
      }
      expect(one.name.length, one.id).toBeGreaterThan(0);
    }
  });

  it("folds Rezghul's written-out goo cost", () => {
    // `"cResource": [3000000 / 3]`, `CREATURELOCKER.as:589`.
    expect(monsterEntry("C19")?.cResource).toEqual([1000000]);
  });
});

describe("the lab table", () => {
  it("has ten rows in the lab's own order", () => {
    expect(LAB_ABILITIES).toHaveLength(10);
    expect(ids(LAB_ABILITIES)).toEqual([
      "C3",
      "C4",
      "C7",
      "C8",
      "C5",
      "C9",
      "C11",
      "C13",
      "C14",
      "C12",
    ]);
    for (const one of LAB_ABILITIES) {
      expect(one.costs, one.id).toHaveLength(3);
      expect(one.effect, one.id).toHaveLength(3);
      expect(isListed(one.id), one.id).toBe(true);
    }
  });

  it("carries Bolt's and D.A.V.E.'s numbers", () => {
    // `client/scripts/MONSTERLAB.as:78-88`, `:155-165`.
    expect(labAbility("C3")).toMatchObject({
      name: "Teleportation",
      effectLabel: "Blink Range",
      costs: [
        [48000, 86400],
        [72000, 86400],
        [108000, 86400],
      ],
      effect: [150, 300, 450],
    });
    expect(labStep("C12", 3)).toEqual([33750000, 144 * 3600]);
    expect(labAbility("C1")).toBeUndefined();
    expect(labStep("C3", 4)).toBeUndefined();
  });
});

describe("the level helpers", () => {
  it("clamps a ladder the way CREATURES.GetProperty does", () => {
    expect(atLevel([15, 16], 1)).toBe(15);
    expect(atLevel([15, 16], 2)).toBe(16);
    expect(atLevel([15, 16], 6)).toBe(16);
    expect(atLevel([15, 16], 0)).toBe(15);
  });

  it("prices hatching and housing by academy level", () => {
    expect(hatchCost("C1", 1)).toBe(250);
    expect(hatchCost("C1", 6)).toBe(1250);
    expect(hatchTime("C2", 5)).toBe(16);
    expect(housingSpace("C1", 4)).toBe(9);
    expect(hatchCost("C200", 1)).toBeUndefined();
  });

  it("walks the training ladder to its end", () => {
    expect(trainingStep("C1", 1)).toEqual([4000, 7200]);
    expect(trainingStep("C1", 5)).toEqual([22000, 43200]);
    expect(trainingStep("C1", 6)).toBeUndefined();
    expect(maxTrainingLevel("C1")).toBe(6);
    expect(maxTrainingLevel("C15")).toBe(5);
    expect(maxTrainingLevel("nope")).toBe(0);
  });
});

describe("the web and server copies", () => {
  it("are the same file", () => {
    expect(lf(SERVER), "run `npm run gen:monster-catalogue` from web/").toBe(lf(WEB));
  });
});

describe("the generator", () => {
  let scratch: string | null = null;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = null;
  });

  const run = (...args: string[]) =>
    spawnSync(process.execPath, [GENERATOR, "--check", ...args], { encoding: "utf8" });

  /** A copy of the two Flash sources with `edit` applied to one of them. */
  const mutated = (file: string, edit: (source: string) => string): string => {
    scratch = mkdtempSync(join(tmpdir(), "monster-catalogue-"));
    for (const name of ["CREATURELOCKER.as", "MONSTERLAB.as"]) {
      copyFileSync(join(SCRIPTS, name), join(scratch, name));
    }
    const target = join(scratch, file);
    const before = readFileSync(target, "utf8");
    const after = edit(before);
    expect(after, "the edit must change something").not.toBe(before);
    writeFileSync(target, after);
    return scratch;
  };

  it("finds both copies up to date with the Flash sources", () => {
    const result = run();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });

  it("fails loudly when a monster loses a field", () => {
    const dir = mutated("CREATURELOCKER.as", (source) =>
      source.replace(`"resource": 4000,`, ""),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/CREATURELOCKER\.as:\d+: C1\.resource is not a whole number/);
  });

  it("fails loudly when a ladder holds something it cannot fold", () => {
    const dir = mutated("CREATURELOCKER.as", (source) =>
      source.replace(`"cResource": [250,`, `"cResource": [SOME_CONSTANT + 1,`),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/arithmetic on a non-number/);
  });

  it("fails loudly when the roster changes", () => {
    const dir = mutated("CREATURELOCKER.as", (source) =>
      source.replace(`"C200": {`, `"C20": {`),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/ids changed \(added C20; missing C200\)/);
  });

  it("fails loudly when D7 no longer matches the source", () => {
    const dir = mutated("CREATURELOCKER.as", (source) =>
      source.replace(/("C17": \{[\s\S]*?)"blocked": true,/, "$1"),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/C17 is no longer blocked in the source; revisit D7/);
  });

  it("fails loudly when a lab ability loses a rank", () => {
    const dir = mutated("MONSTERLAB.as", (source) =>
      source.replace(`"effect": [150, 300, 450]`, `"effect": [150, 300]`),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/MONSTERLAB\.as:\d+: C3\.effect is not three numbers/);
  });

  it("reports stale output rather than rewriting it under --check", () => {
    const dir = mutated("CREATURELOCKER.as", (source) =>
      source.replace(`"resource": 4000,`, `"resource": 4001,`),
    );
    const result = run("--scripts", dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/Stale monster catalogue/);
    expect(lf(WEB)).toContain("resource: 4000,");
  });
});
