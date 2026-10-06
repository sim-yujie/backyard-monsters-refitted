import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import {
  ATTACK_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
  ticks,
  type FlingEvent,
} from "@/game/combat/rules";
import { monsterName } from "@/ui/attack/ArmyPanel";
import { AttackSession, type AttackSpeed } from "./AttackSession";
import { buildAttackSave, forKeepalive } from "./attackSave";
import type { AttackTarget } from "./attackTarget";

/**
 * Honest attack saves, as the web client really builds them (issue #201).
 *
 * Before the server refuses a save its replay does not bear out
 * (`COMBAT_SAVE_VALIDATION=reject`), it has to be shown that an honest client
 * never trips the check. `server/.../battle.test.ts` proves it against a copy
 * of the client written on the server side; this proves it against the
 * client itself: a real {@link AttackSession}, driven frame by frame the way
 * the attack scene drives it (each drop made between frames, at whatever tick
 * the battle has reached), ended the ways a player ends one, and saved with
 * {@link buildAttackSave}. What the save carries is written to
 * `test/fixtures/attack-saves/`, and the server's
 * `services/base/combat/honestSaves.test.ts` replays each one as `baseSave.ts`
 * would and requires no mismatch.
 *
 * The battles are the golden replay fixtures' (`test/fixtures/combat/`): their
 * yards, defences and drops, with a few more cases on top — a siege weapon and
 * a Retreat, a wild monster camp, a Map Room 1 tribe, an own-yard load with
 * an academy older than the attack's, and a Declare War that ran out before
 * the save.
 *
 * The saves are compared with the committed files; a changed rule of combat
 * changes them. Regenerate with `UPDATE_ATTACK_SAVES=1 npx vitest run
 * src/game/attack/honestSaves.test.ts`, then run the server's test.
 */

const COMBAT_DIR = fileURLToPath(new URL("../../../test/fixtures/combat/", import.meta.url));
const SANDBOX = fileURLToPath(new URL("../../../test/fixtures/baseload-sandbox-yard.json", import.meta.url));
const OUT_DIR = fileURLToPath(new URL("../../../test/fixtures/attack-saves/", import.meta.url));
const UPDATE = process.env["UPDATE_ATTACK_SAVES"] === "1";

/** A sandbox yard battle at 60 frames a second runs a few seconds on an idle machine. */
const BATTLE_TIMEOUT_MS = 120_000;

type Kind = "main" | "outpost" | "wild" | "tribe";

interface Fixture {
  name: string;
  yard: "sandbox" | Record<string, Record<string, number>>;
  without?: number[];
  kind: Kind;
  health?: Record<string, number>;
  height?: number;
  resources?: Record<string, number>;
  levels: Record<string, number>;
  playerLevel: number;
  defence?: { defenderChampions?: { t: number; l: number; hp: number; pl?: number }[] } & Record<string, unknown>;
  raid?: unknown;
  log: { v: 1; seed: number; events: FlingEvent[] };
}

interface Scenario {
  readonly name: string;
  readonly fixture: string;
  /** The yard's kind, when not the fixture's own. */
  readonly kind?: Kind;
  /** `auto`: played until the attack ends by itself; else left, or retreated, at a tick. */
  readonly end: "auto" | { readonly leaveAt: number } | { readonly retreatAt: number };
  readonly speed?: AttackSpeed;
  /** Events added to the fixture's drops. */
  readonly extra?: readonly FlingEvent[];
  /** The own-yard load's academy is a level behind the one the attack load serves. */
  readonly staleAcademy?: boolean;
  /** Declare War was running at launch (and has run out by the save). */
  readonly declareWar?: boolean;
}

/** What a save file holds: how to rebuild the battle's inputs, and what the save carried. */
export interface HonestSave {
  name: string;
  fixture: string;
  kind: Kind;
  attacker: {
    /** What the attacker's yards housed: the session's `entryHoused`. */
    monsters: Record<string, number>;
    academy: Record<string, number>;
    champion: ChampionSaveEntry[];
    siege: Record<string, unknown>;
    catapult: number;
    resources: Record<string, number>;
    brains?: Record<string, unknown>;
  };
  declareWar: boolean;
  endReason: string | null;
  save: Record<string, unknown>;
}

const sandbox = JSON.parse(readFileSync(SANDBOX, "utf8")) as BaseLoadResponse;

const fixtures = new Map<string, Fixture>(
  readdirSync(COMBAT_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(`${COMBAT_DIR}${file}`, "utf8")) as Fixture)
    // A raid's log is the server's own (#226), never an attack save's.
    .filter((fixture) => !fixture.raid)
    .map((fixture) => [fixture.name, fixture]),
);

/** The attacker's champions, as `battle.test.ts` gives them: Krallen, Gorgo, Korath, Fomor. */
const CHAMPIONS: readonly ChampionSaveEntry[] = [
  { t: 5, l: 5, hp: 62_000, pl: 2 },
  { t: 1, l: 4, hp: 190_000, pl: 3 },
  { t: 4, l: 6, hp: 179_000, pl: 3 },
  { t: 3, l: 6, hp: 44_000, pl: 3 },
].map((champion) => ({ ...champion, ft: 0, fd: 0, fb: 0, status: 0 }));

const SIEGE = { jars: { quantity: 2 }, decoy: { quantity: 1 } };
const POOL = { r1: 50_000_000, r2: 50_000_000, r3: 50_000_000, r4: 50_000_000 };
const TYPE_OF: Record<Kind, string> = { main: "main", outpost: "outpost", wild: "tribe", tribe: "tribe" };

const housedOf = (events: readonly FlingEvent[]): Record<string, number> => {
  const housed: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== "fling") continue;
    for (const [id, count] of Object.entries(event.monsters)) housed[id] = (housed[id] ?? 0) + count;
  }
  return housed;
};

/** The champions in the order the army panel offers them: the one the log flings first. */
const championsFor = (events: readonly FlingEvent[]): ChampionSaveEntry[] => {
  const flung = events.flatMap((event) =>
    event.kind === "fling" && event.champion && event.champion.t !== 5 ? [event.champion.t] : [],
  );
  const first = flung[0];
  return [...CHAMPIONS].sort((one, other) => Number(other.t === first) - Number(one.t === first));
};

/** The brains a log's champions carry, as the attack load serves them (`attackerbrains`). */
const brainsFor = (events: readonly FlingEvent[]): Record<string, unknown> | undefined => {
  const brains: Record<string, unknown> = {};
  for (const event of events) {
    if (event.kind === "fling" && event.champion?.b) brains[String(event.champion.t)] = event.champion.b;
  }
  return Object.keys(brains).length > 0 ? brains : undefined;
};

const loadOf = (fixture: Fixture, kind: Kind, scenario: Scenario, brains?: Record<string, unknown>): BaseLoadResponse => {
  const caged = fixture.defence?.defenderChampions ?? [];
  const base: Record<string, unknown> =
    fixture.yard === "sandbox"
      ? {
          ...sandbox,
          buildingdata: Object.fromEntries(
            Object.entries(sandbox.buildingdata ?? {}).filter(([key]) => !fixture.without?.includes(Number(key))),
          ),
        }
      : {
          error: 0,
          worldsize: [800, 800],
          currenttime: 1_700_000_000,
          buildingdata: fixture.yard,
          buildinghealthdata: fixture.health ?? {},
          resources: fixture.resources ?? {},
        };
  delete base["champion"];
  return {
    ...base,
    baseid: "9001",
    basesaveid: 9001,
    attackid: 4242,
    type: TYPE_OF[kind],
    attackerlevel: fixture.playerLevel,
    attackeracademy: fixture.levels,
    attpowerups: scenario.declareWar ? [{ id: "ap_declarewar" }] : [],
    ...(fixture.defence && { defenderforces: fixture.defence }),
    ...(fixture.height !== undefined && { cellheight: fixture.height }),
    ...(brains && { attackerbrains: brains }),
    ...(caged.length > 0 && {
      champion: caged.map((champion) => ({ ft: 0, fd: 0, fb: 0, pl: 0, ...champion, status: 0 })),
    }),
  } as unknown as BaseLoadResponse;
};

/** An academy a level behind, as an own-yard load read before a training finished. */
const levelBehind = (levels: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, Math.max(1, level - 1)]));

/** One drop, made the way the attack screen makes it; false when the client would not have. */
const drop = (session: AttackSession, event: FlingEvent): boolean => {
  try {
    switch (event.kind) {
      case "fling":
        session.appendFling({
          x: event.x,
          y: event.y,
          monsters: event.monsters,
          ...(event.champion && {
            champion: { t: event.champion.t, l: event.champion.l, ...(event.champion.s && { s: event.champion.s }) },
          }),
        });
        return true;
      case "bomb":
        session.appendBomb({ x: event.x, y: event.y, id: event.id });
        return true;
      case "siege":
        session.appendSiege({ x: event.x, y: event.y, weapon: event.weapon });
        return true;
      case "retreat":
        session.retreat();
        return true;
      case "championRetreat":
        return session.retreatChampion(event.c);
      default:
        return false;
    }
  } catch {
    return false;
  }
};

/** Plays a scenario at 60 frames a second and returns the save the client sends. */
const play = (scenario: Scenario): HonestSave => {
  const fixture = fixtures.get(scenario.fixture);
  if (!fixture) throw new Error(`no fixture ${scenario.fixture}`);
  const kind = scenario.kind ?? fixture.kind;
  const events = [...fixture.log.events, ...(scenario.extra ?? [])].sort((one, other) => one.t - other.t);
  const champions = championsFor(events);
  const brains = brainsFor(events);
  const monsters = housedOf(events);
  const load = loadOf(fixture, kind, scenario, brains);
  const target: AttackTarget = {
    baseid: "9001",
    kind: kind === "tribe" ? "wild" : kind,
    ...(kind === "tribe" ? { mapversion: 1 } : { cell: { col: 1, row: 1 } }),
    name: fixture.name,
    roster: {
      monsters,
      levels: scenario.staleAcademy ? levelBehind(fixture.levels) : fixture.levels,
      champions,
      flingerLevel: 4,
      catapultLevel: 5,
      sources: [{ baseid: "3502", m: { housed: monsters } }],
      siege: SIEGE,
      resources: POOL,
    },
    load,
  };

  const session = new AttackSession({ target, seed: fixture.log.seed });
  session.start();
  session.setSpeed(scenario.speed ?? 1);
  const queue = [...events];
  const { end } = scenario;
  for (let frame = 0; frame < 200_000 && !session.ended; frame += 1) {
    const tick = session.battle()!.tick;
    while (queue.length > 0 && queue[0]!.t <= tick && !session.ended) drop(session, queue.shift()!);
    if (session.ended) break;
    if (end !== "auto" && "leaveAt" in end && tick >= end.leaveAt) session.leave();
    else if (end !== "auto" && "retreatAt" in end && tick >= end.retreatAt) session.retreat();
    else session.advance(1 / 60);
  }
  expect(session.ended).toBe(true);

  // With the names the end plugin gives the report (`plugins/end.ts`).
  const payload = buildAttackSave(session, { nameOf: monsterName });
  const slim = forKeepalive(payload);
  return {
    name: scenario.name,
    fixture: fixture.name,
    kind,
    attacker: {
      monsters,
      academy: fixture.levels,
      champion: champions,
      siege: SIEGE,
      catapult: 5,
      resources: POOL,
      ...(brains && { brains }),
    },
    declareWar: scenario.declareWar ?? false,
    endReason: session.state().endReason,
    save: {
      tick: payload.tick,
      damage: payload.damage,
      ...(payload.destroyed !== undefined && { destroyed: payload.destroyed }),
      ...(payload.left && { left: payload.left }),
      buildinghealthdata: payload.buildinghealthdata,
      // Only the traps still standing: all the server reads of it (`forKeepalive`).
      buildingdata: slim.buildingdata,
      attackloot: payload.attackloot,
      resources: payload.resources,
      ...(payload.attackerchampion && { attackerchampion: payload.attackerchampion }),
      ...(payload.attackersiege !== undefined && { attackersiege: payload.attackersiege }),
      ...(payload.champion && { champion: payload.champion }),
      attackreport: payload.attackreport,
      flinglog: payload.flinglog,
    },
  };
};

const lastTick = (name: string): number => Math.max(...fixtures.get(name)!.log.events.map((event) => event.t));

const scenarios: Scenario[] = [
  ...[...fixtures.keys()].sort().flatMap((name): Scenario[] => [
    { name: `${name}-to-end`, fixture: name, end: "auto" },
    { name: `${name}-left-at-2x`, fixture: name, end: { leaveAt: lastTick(name) + 4000 }, speed: 2 },
  ]),
  {
    name: "pokey-rush-siege-then-retreat",
    fixture: "pokey-rush",
    extra: [{ kind: "siege", t: lastTick("pokey-rush") + 200, x: 0, y: 0, weapon: "jars" }],
    end: { retreatAt: lastTick("pokey-rush") + 6000 },
  },
  { name: "burrow-rush-on-a-wild-camp", fixture: "burrow-rush", kind: "wild", end: "auto" },
  { name: "maze-on-a-map-room-1-tribe", fixture: "maze", kind: "tribe", end: "auto" },
  { name: "mixed-waves-own-academy-behind", fixture: "mixed-waves", staleAcademy: true, end: "auto" },
  { name: "pokey-rush-declare-war", fixture: "pokey-rush", declareWar: true, end: "auto" },
];

/** One line per key, each value compact: small diffs, small files. */
const serialise = (save: HonestSave): string =>
  `{\n${Object.entries(save)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(",\n")}\n}\n`;

describe("honest attack saves from the real client (#201)", () => {
  if (UPDATE) mkdirSync(OUT_DIR, { recursive: true });

  for (const scenario of scenarios) {
    it(
      `${scenario.name}: the save the attack screen sends`,
      () => {
        // Through JSON, as the server gets it: an engine -0 arrives as 0.
        const save = JSON.parse(JSON.stringify(play(scenario))) as HonestSave;
        const path = `${OUT_DIR}${scenario.name}.json`;
        if (UPDATE) {
          writeFileSync(path, serialise(save));
          return;
        }
        expect(existsSync(path), `${path} is missing: regenerate with UPDATE_ATTACK_SAVES=1`).toBe(true);
        expect(save).toEqual(JSON.parse(readFileSync(path, "utf8")));
      },
      BATTLE_TIMEOUT_MS,
    );
  }

  it("the Declare War battle ran past a plain attack's longest end, so it tests what it says", () => {
    const save = play(scenarios.find((one) => one.declareWar)!);
    expect(save.save["tick"]).toBeGreaterThan(ticks(ATTACK_COUNTDOWN_SECONDS + RETREAT_GRACE_SECONDS));
  }, BATTLE_TIMEOUT_MS);

  it("the academy a level behind fought at the attack load's levels, so it tests what it says", () => {
    const behind = play(scenarios.find((one) => one.staleAcademy)!);
    const plain = play({ ...scenarios.find((one) => one.staleAcademy)!, staleAcademy: false });
    expect(behind.save).toEqual(plain.save);
  }, BATTLE_TIMEOUT_MS);
});
