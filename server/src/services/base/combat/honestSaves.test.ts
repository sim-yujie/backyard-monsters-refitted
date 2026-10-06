import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { derivedDestroyed, parseDefenderForces, type FlingLog } from "../../../game-rules/combat/index.js";
import { brainsOf, type AttackSession } from "../attackSession.js";
import { replayAbandonedAttack } from "./abandonedAttack.js";
import { battleMismatches, battleReplayInput, battleTick, type BattleDefender } from "./battle.js";

/**
 * The honest attack saves the real web client sent (issue #201), replayed as
 * the attack save replays them, and never refused.
 *
 * `web/src/game/attack/honestSaves.test.ts` plays each battle in a real
 * `AttackSession`, frame by frame, ends it the way a player does, and writes
 * what `buildAttackSave` sends to `web/test/fixtures/attack-saves/`. Here each
 * one goes through `battleReplayInput` and the replay `baseSave.ts` (or, for a
 * Map Room 1 tribe, `scaledMR1Tribes.ts`) runs, and `battleMismatches` must
 * find nothing: under `COMBAT_SAVE_VALIDATION=reject` an honest player is never
 * turned away.
 *
 * Two things made an honest save disagree before the attack load froze them
 * (issue #201): an attacker's academy that moved between the attack load and
 * the save, and a Declare War that ran out (or began) meanwhile. Every row
 * here says something other than the session; the session's copy is fought.
 */

const SAVES_DIR = fileURLToPath(new URL("../../../../../web/test/fixtures/attack-saves/", import.meta.url));
const COMBAT_DIR = fileURLToPath(new URL("../../../../../web/test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../../../web/test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8"));

// The longest battle replays in about a second on an idle machine (`battle.test.ts`).
const REPLAY_TIMEOUT_MS = 60_000;

type Kind = "main" | "outpost" | "wild" | "tribe";

interface Fixture {
  name: string;
  yard: "sandbox" | Record<string, Record<string, number>>;
  without?: number[];
  health?: Record<string, number>;
  height?: number;
  resources?: Record<string, number>;
  playerLevel: number;
  defence?: Record<string, unknown>;
}

/** A save file, as the web test writes it. */
interface HonestSave {
  name: string;
  fixture: string;
  kind: Kind;
  attacker: {
    monsters: Record<string, number>;
    academy: Record<string, number>;
    champion: { t: number; l: number; hp: number; pl?: number }[];
    siege: Record<string, { quantity: number }>;
    catapult: number;
    resources: Record<string, number>;
    brains?: Record<string, unknown>;
  };
  declareWar: boolean;
  save: {
    tick: number;
    damage: number;
    destroyed?: number;
    left?: boolean;
    buildinghealthdata: Record<string, number>;
    buildingdata: Record<string, unknown>;
    attackloot: Record<string, number>;
    attackerchampion?: unknown;
    attackersiege?: unknown;
    champion?: unknown;
    attackreport: string;
    flinglog: FlingLog;
  };
}

const read = (path: string): any => JSON.parse(readFileSync(path, "utf8"));

const saves: HonestSave[] = readdirSync(SAVES_DIR)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => read(`${SAVES_DIR}${file}`));

const TYPE_OF: Record<Kind, string> = { main: "main", outpost: "outpost", wild: "tribe", tribe: "tribe" };

/** The defender's row as the save finds it. */
const defenderOf = (one: HonestSave): { defender: BattleDefender; fixture: Fixture } => {
  const fixture: Fixture = read(`${COMBAT_DIR}${one.fixture}.json`);
  const kind = one.kind === "tribe" ? { kind: "tribe" as const } : {};
  if (fixture.yard === "sandbox") {
    const without = fixture.without ?? [];
    return {
      fixture,
      defender: {
        type: TYPE_OF[one.kind],
        buildingdata: Object.fromEntries(
          Object.entries(sandbox.buildingdata).filter(([key]) => !without.includes(Number(key)))
        ) as never,
        buildinghealthdata: sandbox.buildinghealthdata,
        resources: sandbox.resources,
        ...kind,
      },
    };
  }
  return {
    fixture,
    defender: {
      type: TYPE_OF[one.kind],
      buildingdata: fixture.yard as never,
      buildinghealthdata: fixture.health ?? {},
      resources: fixture.resources ?? {},
      ...(fixture.height !== undefined && { height: fixture.height }),
      ...kind,
    },
  };
};

/** The session the attack load minted: everything it froze, as `baseModeAttack.ts` freezes it. */
const sessionOf = (one: HonestSave, fixture: Fixture): AttackSession => {
  const defenderForces = parseDefenderForces(fixture.defence);
  const championBrains = one.attacker.brains
    ? brainsOf(Object.entries(one.attacker.brains).map(([t, b]) => ({ t: Number(t), b })))
    : undefined;
  return {
    attackerid: 2505,
    attackid: 4242,
    startedat: 0,
    entryHoused: { "3502": one.attacker.monsters },
    attackerResources: { r1: 0, r2: 0, r3: 0, r4: 0, ...one.attacker.resources },
    attackerlevel: fixture.playerLevel,
    attackerAcademy: one.attacker.academy,
    declareWar: one.declareWar,
    ...(defenderForces && { defenderForces }),
    ...(championBrains && { championBrains }),
  };
};

/**
 * The attacker's row by the time the save arrives, its academy no longer the
 * one the attack load froze (every monster at level 1 here; a training that
 * finished, or a row read in another tab, moves it either way).
 */
const attackerOf = (one: HonestSave) => ({
  academy: Object.fromEntries(Object.keys(one.attacker.academy).map((id) => [id, { level: 1 }])),
  champion: one.attacker.champion,
  catapult: one.attacker.catapult,
  buildingdata: {},
  siege: one.attacker.siege,
});

describe("an honest save from the real client is never refused (#201)", () => {
  test("there are saves to check", () => {
    expect(saves.length).toBeGreaterThanOrEqual(30);
  });

  for (const one of saves) {
    test(
      `${one.name}: the replay bears out every figure the save sent`,
      () => {
        const { defender, fixture } = defenderOf(one);
        const input = battleReplayInput({
          flinglog: one.save.flinglog,
          session: sessionOf(one, fixture),
          defender,
          attacker: attackerOf(one),
          tick: battleTick(one.save.tick),
          // Whatever Declare War is doing by the save, the session's copy is fought.
          declareWar: !one.declareWar,
          left: one.save.left === true,
        });
        expect(input).not.toBeNull();
        const fought = replayAbandonedAttack(input!);
        // A Map Room 1 tribe's `destroyed` is the camp threshold's (`scaledMR1Tribes.ts`).
        const battle =
          one.kind === "tribe" ? { ...fought, destroyed: derivedDestroyed(fought.damage, "wild") ?? 0 } : fought;

        const { save } = one;
        expect(
          battleMismatches(
            {
              damage: save.damage,
              destroyed: save.destroyed,
              buildinghealthdata: save.buildinghealthdata,
              buildingdata: save.buildingdata,
              attackloot: save.attackloot,
              attackerchampion: save.attackerchampion,
              attackersiege: save.attackersiege,
              // The tribe save compares no caged champion: a tribe has none.
              ...(one.kind !== "tribe" && { champion: save.champion }),
            },
            battle,
            defender.buildingdata
          )
        ).toEqual([]);
        // And the report the server writes is the one the player read (#23, C6).
        expect(battle.attackreport).toBe(save.attackreport);
        expect(battle.tick).toBe(save.tick);
      },
      REPLAY_TIMEOUT_MS
    );
  }
});

describe("what the session froze is what the replay fights (#201)", () => {
  const one = saves.find((save) => save.declareWar);
  const behind = saves.find((save) => save.name === "mixed-waves-own-academy-behind");

  test("without the session's Declare War, the save would have been refused", () => {
    expect(one).toBeDefined();
    const { defender, fixture } = defenderOf(one!);
    const { declareWar: _frozen, ...session } = sessionOf(one!, fixture);
    const battle = replayAbandonedAttack(
      battleReplayInput({
        flinglog: one!.save.flinglog,
        session,
        defender,
        attacker: attackerOf(one!),
        tick: battleTick(one!.save.tick),
        declareWar: false,
        left: false,
      })!
    );
    expect(battleMismatches({ destroyed: undefined, ...one!.save }, battle, defender.buildingdata)).not.toEqual([]);
  }, REPLAY_TIMEOUT_MS);

  test("without the session's academy, the save would have been refused", () => {
    expect(behind).toBeDefined();
    const { defender, fixture } = defenderOf(behind!);
    const { attackerAcademy: _frozen, ...session } = sessionOf(behind!, fixture);
    const battle = replayAbandonedAttack(
      battleReplayInput({
        flinglog: behind!.save.flinglog,
        session,
        defender,
        attacker: attackerOf(behind!),
        tick: battleTick(behind!.save.tick),
        declareWar: false,
        left: false,
      })!
    );
    expect(battleMismatches({ destroyed: undefined, ...behind!.save }, battle, defender.buildingdata)).not.toEqual([]);
  }, REPLAY_TIMEOUT_MS);
});
