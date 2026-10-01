import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import {
  ATTACK_COUNTDOWN_SECONDS,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  TICKS_PER_SECOND,
  championStatWithPower,
} from "@/game/combat/rules";
import {
  AttackSession,
  combatKind,
  hasDeclareWar,
  mintSeed,
  servedBrain,
  servedHeight,
} from "./AttackSession";
import type { AttackTarget } from "./attackTarget";

/**
 * The session's state machine and its end rules (`docs/design/attack-flow.md`
 * §6 WP2's unit-test focus: idle → loaded → running → ended), plus the log it
 * writes. The battle itself is the engine's business and is tested there;
 * these use one Cannon Tower and a handful of Pokeys, enough to see a fling
 * land and a field clear.
 */

/** A lone level 1 Cannon Tower at the origin: 6,000 health, one shot a second. */
const towerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const targetOf = (overrides: Partial<AttackTarget> = {}): AttackTarget => ({
  baseid: "3502",
  kind: "wild",
  cell: { col: 241, row: 208 },
  name: "Kozu",
  roster: {
    monsters: { C1: 3 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
  ...overrides,
});

const sessionOf = (overrides: Partial<AttackTarget> = {}): AttackSession => {
  const session = new AttackSession({ target: targetOf(overrides), seed: 1 });
  session.load(towerYard());
  return session;
};

/** Runs `seconds` of battle time through `advance`, a frame at a time. */
const play = (session: AttackSession, seconds: number): void => {
  const frames = Math.ceil(seconds * 60);
  for (let frame = 0; frame < frames; frame += 1) session.advance(1 / 60);
};

describe("AttackSession lifecycle", () => {
  it("starts idle, is loaded by the attack load, and runs once started", () => {
    const session = new AttackSession({ target: targetOf(), seed: 1 });
    expect(session.state().phase).toBe("idle");
    expect(session.battle()).toBeNull();

    session.load(towerYard());
    expect(session.state().phase).toBe("loaded");
    expect(session.battle()).not.toBeNull();
    expect(session.state().tick).toBe(0);

    session.start();
    expect(session.state().phase).toBe("running");
  });

  it("loads itself from a pre-fetched target and refuses a second load", () => {
    const session = new AttackSession({ target: targetOf({ load: towerYard() }), seed: 1 });
    expect(session.state().phase).toBe("loaded");
    expect(() => session.load(towerYard())).toThrow(/already loaded/);
  });

  it("does not advance the clock before start, and runs in battle time after", () => {
    const session = sessionOf();
    session.advance(1);
    expect(session.state().tick).toBe(0);

    session.start();
    play(session, 2);
    const state = session.state();
    expect(state.tick).toBe(2 * TICKS_PER_SECOND);
    expect(state.elapsedSeconds).toBe(2);
    expect(state.remainingSeconds).toBe(ATTACK_COUNTDOWN_SECONDS - 2);
  });

  it("advances twice as far per frame at 2x", () => {
    const session = sessionOf();
    session.start();
    session.setSpeed(2);
    play(session, 1);
    expect(session.state().tick).toBe(2 * TICKS_PER_SECOND);
    expect(session.speed).toBe(2);
  });

  it("uses the Declare War countdown when the load says the powerup is running", () => {
    const session = new AttackSession({ target: targetOf(), seed: 1 });
    session.load({ ...towerYard(), attpowerups: [{ id: "ap_declarewar", endtime: 1 }] });
    const state = session.state();
    expect(state.declareWar).toBe(true);
    expect(state.countdownSeconds).toBe(DECLARE_WAR_COUNTDOWN_SECONDS);
    expect(state.hardStopSeconds).toBe(DECLARE_WAR_COUNTDOWN_SECONDS + 120);
  });
});

describe("AttackSession loot level (#167)", () => {
  /** A Town Hall on 1 health: the first swing fells it for a tenth of 100,000 twigs. */
  const hallYard = (attackerlevel?: number): BaseLoadResponse =>
    ({
      ...towerYard(),
      buildingdata: { "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } },
      buildinghealthdata: { "1": 1 },
      resources: { r1: 100_000, r2: 0, r3: 0, r4: 0 },
      ...(attackerlevel === undefined ? {} : { attackerlevel }),
    }) as unknown as BaseLoadResponse;

  const twigsTaken = (load: BaseLoadResponse, playerLevel?: number): number => {
    const session = new AttackSession({
      target: targetOf(),
      seed: 1,
      ...(playerLevel === undefined ? {} : { playerLevel }),
    });
    session.load(load);
    session.appendFling({ x: -60, y: -60, monsters: { C1: 3 } });
    play(session, 20);
    return session.battle()!.state().loot.r1;
  };

  it("runs at the level the attack load serves, for the low-level bonus", () => {
    expect(twigsTaken(hallYard())).toBe(10_000);
    expect(twigsTaken(hallYard(1))).toBe(15_700);
    expect(twigsTaken(hallYard(20))).toBe(10_000);
  });

  it("prefers a level it was handed, and ignores a served level that is not one", () => {
    expect(twigsTaken(hallYard(1), 20)).toBe(10_000);
    expect(twigsTaken({ ...hallYard(), attackerlevel: 0 } as BaseLoadResponse)).toBe(10_000);
  });
});

describe("AttackSession on an outpost (#179)", () => {
  /**
   * A level 1 Laser (range 160) and a Town Hall 200 away that three Pokeys
   * attack: out of the laser's reach on flat ground, inside it on a cell of
   * height 250, which the load serves as `cellheight` (`BTOWER.as:80-85`).
   */
  const laserShots = (cellheight?: number): number => {
    const session = new AttackSession({ target: targetOf({ kind: "outpost" }), seed: 1 });
    session.load({
      ...towerYard(),
      buildingdata: {
        "1": { id: 1, t: 23, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 14, l: 5, X: 200, Y: 0 },
      },
      ...(cellheight === undefined ? {} : { cellheight }),
    } as unknown as BaseLoadResponse);
    session.appendFling({ x: 400, y: 60, monsters: { C1: 3 } });
    play(session, 20);
    return session.battle()!.state().towers[0]?.shots ?? 0;
  };

  it("stretches tower range by the served cell height", () => {
    expect(laserShots(250)).toBeGreaterThan(0);
    expect(laserShots()).toBe(0);
    expect(laserShots(90)).toBe(0);
  });

  it("reads a served height only when it is a whole number of 0 or more", () => {
    expect(servedHeight(250)).toBe(250);
    expect(servedHeight(0)).toBe(0);
    expect(servedHeight(-5)).toBe(0);
    expect(servedHeight(12.5)).toBe(0);
    expect(servedHeight("250")).toBe(0);
    expect(servedHeight(undefined)).toBe(0);
  });
});

describe("AttackSession against a defence (#195)", () => {
  /** A Monster Bunker holding two Fangs, and a Champion Cage with its Gorgo home. */
  const defended = (defenderforces?: unknown): AttackSession => {
    const session = new AttackSession({ target: targetOf({ kind: "main" }), seed: 1 });
    session.load({
      ...towerYard(),
      buildingdata: {
        "1": { id: 1, t: 22, l: 1, X: 0, Y: 0 },
        "2": { id: 2, t: 114, l: 1, X: 150, Y: -150 },
        "3": { id: 3, t: 14, l: 1, X: 200, Y: 200 },
      },
      ...(defenderforces === undefined ? {} : { defenderforces }),
    } as unknown as BaseLoadResponse);
    session.appendFling({ x: 150, y: 150, monsters: { C1: 3 } });
    play(session, 2);
    return session;
  };

  it("fights the garrison and the champion the load served", () => {
    const session = defended({
      bunkers: { 1: { C8: 2 } },
      defenderLevels: { C8: 3 },
      defenderChampion: { t: 1, l: 2, hp: 5000, pl: 0 },
    });
    const friendly = session.battle()!.creeps().filter((creep) => creep.friendly);
    expect(friendly.some((creep) => creep.monsterId === "C8" && creep.level === 3)).toBe(true);
    expect(friendly.some((creep) => creep.champion && creep.monsterId === "G1")).toBe(true);
  });

  it("fights none when the load served none, as before", () => {
    const session = defended();
    expect(session.battle()!.creeps().filter((creep) => creep.friendly)).toHaveLength(0);
    expect(session.battle()!.state().defenderChampionHp).toBeNull();
  });
});

describe("AttackSession events and the fling log", () => {
  it("stamps the tick and radius on a fling, spends the roster and logs it", () => {
    const session = sessionOf();
    session.start();
    play(session, 1);
    const event = session.appendFling({ x: -100, y: -100, monsters: { C1: 2 } });
    expect(event).toMatchObject({ kind: "fling", t: TICKS_PER_SECOND, x: -100, y: -100, r: 100 });
    expect(session.remaining()).toEqual({ C1: 1 });
    expect(session.state().creepsFlung).toBe(2);
    expect(session.flingLog()).toEqual({ v: 1, seed: 1, events: [event] });
  });

  it("starts the clock itself when a fling arrives before start", () => {
    const session = sessionOf();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    expect(session.state().phase).toBe("running");
  });

  it("refuses more than is housed, an empty drop, and the same champion twice", () => {
    const champion = { t: 1, hp: 100, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };
    const session = sessionOf({
      roster: { monsters: { C1: 3 }, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    expect(() => session.appendFling({ x: 0, y: 0, monsters: { C1: 4 } })).toThrow(/exceeds/);
    expect(() => session.appendFling({ x: 0, y: 0, monsters: {} })).toThrow(/empty/);
    expect(session.state().championAvailable).toBe(true);
    session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 1, l: 1 } });
    expect(session.state().championAvailable).toBe(false);
    expect(() =>
      session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 1, l: 1 } }),
    ).toThrow(/\(flung\)/);
  });

  it("logs a flung champion at the power level its roster entry holds (#202)", () => {
    const champion = { t: 1, hp: 100, l: 2, ft: 0, fd: 0, fb: 0, pl: 3, status: 0 };
    const session = sessionOf({
      roster: { monsters: {}, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    const event = session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 1, l: 2 } });
    expect(event.champion).toEqual({ t: 1, l: 2, pl: 3 });
    expect(session.battle()!.creeps().find((creep) => creep.champion)?.maxHp).toBe(
      championStatWithPower("G1", "health", 2, 3),
    );
  });

  it("calls a flung champion back with the Retreat champion button, and logs it (#222)", () => {
    const champion = { t: 1, hp: 40_000, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };
    const session = sessionOf({
      roster: { monsters: { C1: 3 }, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    expect(session.state().championsOnField).toEqual([]);
    expect(session.retreatChampion(1)).toBe(false);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 }, champion: { t: 1, l: 1 } });
    play(session, 1);
    expect(session.state().championsOnField).toEqual([1]);
    const hp = session.battle()!.creeps().find((creep) => creep.champion)!.hp;
    expect(session.retreatChampion(1)).toBe(true);
    expect(session.state().championsOnField).toEqual([]);
    // Once only: it is off the field.
    expect(session.retreatChampion(1)).toBe(false);
    const log = session.flingLog().events;
    expect(log[log.length - 1]).toMatchObject({ kind: "championRetreat", c: 1 });
    play(session, 1);
    expect(session.battle()!.creeps().some((creep) => creep.champion)).toBe(false);
    expect(session.championsHpAfter()[1]).toBe(hp);
    expect(session.state().phase).toBe("running");
  });

  it("logs no power level for a champion at power level 0, which fights at its level alone", () => {
    const champion = { t: 1, hp: 100, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };
    const session = sessionOf({
      roster: { monsters: {}, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    expect(session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 1, l: 1 } }).champion).toEqual({
      t: 1,
      l: 1,
    });
  });

  it("logs the Mode a champion is flung in, which the battle fights it in (#220)", () => {
    const champion = { t: 1, hp: 100, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };
    const session = sessionOf({
      roster: { monsters: {}, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    const event = session.appendFling({
      x: -100,
      y: -100,
      monsters: {},
      champion: { t: 1, l: 1, s: "defensive" },
    });
    expect(event.champion).toEqual({ t: 1, l: 1, s: "defensive" });
    expect(session.flingLog().events[0]).toMatchObject({ champion: { s: "defensive" } });
  });

  it("logs the brain the attack load froze, never the own-yard copy (#219)", () => {
    // The roster's copy is stale on purpose: the load's is what the server replays.
    const champion = {
      t: 1, hp: 100, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0,
      b: { tower: 5, loot: 5, finish: 5, focus: 5, threat: 5 },
    };
    const roster = { monsters: {}, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null };
    const session = new AttackSession({ target: targetOf({ roster }), seed: 1 });
    session.load({
      ...towerYard(),
      attackerbrains: { "1": { tower: 120.4, loot: -60, finish: 0, focus: 999, threat: 0 } },
    } as BaseLoadResponse);
    session.start();
    const event = session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 1, l: 1, s: "hybrid" } });
    // Made safe as the server makes it: rounded, and clamped to the bound.
    expect(event.champion?.b).toEqual({ tower: 120, loot: -60, finish: 0, focus: 200, threat: 0 });
  });

  it("logs no brain for a champion the load froze none for (#219)", () => {
    expect(servedBrain(undefined, 1)).toBeNull();
    expect(servedBrain({ "1": { tower: 0 } }, 1)).toBeNull();
    expect(servedBrain({ "2": { tower: 80 } }, 1)).toBeNull();
    const champion = { t: 1, hp: 100, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };
    const session = sessionOf({
      roster: { monsters: {}, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    const event = session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 1, l: 1 } });
    expect(event.champion).toEqual({ t: 1, l: 1 });
  });

  it("logs a radius that counts the champion's bucket (#143)", () => {
    const champion = { t: 1, hp: 100, l: 1, ft: 0, fd: 0, fb: 0, pl: 0, status: 0 };
    const session = sessionOf({
      roster: { monsters: { C1: 400 }, levels: {}, champions: [champion], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    // 200 Pokeys are 1,400 bucket units: a zone of 350, radius 175.
    expect(session.appendFling({ x: -100, y: -100, monsters: { C1: 200 } }).r).toBe(175);
    // With Gorgo's 240 on top (`ATTACK.as:645-653`): a zone of 410, radius 205.
    const withChampion = session.appendFling({
      x: -100,
      y: -100,
      monsters: { C1: 200 },
      champion: { t: 1, l: 1 },
    });
    expect(withChampion.r).toBe(205);
  });

  describe("no automatic end before the first action (#79)", () => {
    /** A yard with nothing a creep could attack: one wall, already the whole camp. */
    const flatYard = (): BaseLoadResponse =>
      ({
        ...towerYard(),
        buildingdata: { "1": { id: 1, t: 17, l: 1, X: 0, Y: 0 } },
      }) as unknown as BaseLoadResponse;

    const flatSession = (): AttackSession => {
      const session = new AttackSession({ target: targetOf(), seed: 1 });
      session.load(flatYard());
      session.start();
      return session;
    };

    it("keeps a yard that opens with nothing standing running until the first drop", () => {
      const session = flatSession();
      play(session, 5);
      expect(session.state().phase).toBe("running");
      expect(session.state().acted).toBe(false);
      expect(session.hasActed()).toBe(false);

      session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
      expect(session.hasActed()).toBe(true);
      expect(session.state().phase).toBe("ended");
      expect(session.state().endReason).toBe("destroyed");
    });

    it("counts a bomb or a siege weapon as the first action too", () => {
      const bombed = flatSession();
      bombed.appendBomb({ x: 0, y: 0, id: "tw0" });
      expect(bombed.hasActed()).toBe(true);
      expect(bombed.state().endReason).toBe("destroyed");

      const sieged = flatSession();
      sieged.appendSiege({ x: 0, y: 0, weapon: "jars" });
      expect(sieged.hasActed()).toBe(true);
      expect(sieged.state().endReason).toBe("destroyed");
    });

    it("does not end as exhausted when the attacker opens with nothing to send", () => {
      const session = sessionOf({
        roster: { monsters: {}, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
      });
      session.start();
      play(session, 5);
      expect(session.state().phase).toBe("running");
    });

    it("still ends an untouched attack when the countdown and its grace run out", () => {
      const session = flatSession();
      play(session, 300 + 120 + 1);
      expect(session.state().phase).toBe("ended");
      expect(session.state().endReason).toBe("expired");
      expect(session.hasActed()).toBe(false);
    });
  });

  describe("champions (Flash: one ordinary champion plus Krallen, UI_TOP.as:336-347)", () => {
    const entry = (t: number, hp = 1000, status = 0) => ({
      t,
      hp,
      l: 1,
      ft: 0,
      fd: 0,
      fb: 0,
      pl: 0,
      status,
    });
    const withChampions = (...champions: ReturnType<typeof entry>[]): AttackSession => {
      const session = sessionOf({
        roster: { monsters: { C1: 3 }, levels: {}, champions, flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
      });
      session.start();
      return session;
    };

    it("sends Krallen after Fomor, each once, and reports both", () => {
      const session = withChampions(entry(3), entry(5));
      session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 3, l: 1 } });
      expect(session.championBlock(3)).toBe("flung");
      expect(session.championBlock(5)).toBeNull();
      expect(session.state().championAvailable).toBe(true);

      session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 5, l: 1 } });
      expect(session.championBlock(5)).toBe("flung");
      expect(session.state().championAvailable).toBe(false);
      const hp = session.championsHpAfter();
      expect(Object.keys(hp).map(Number).sort()).toEqual([3, 5]);
      expect(hp[3]).toBeGreaterThan(0);
      expect(hp[5]).toBeGreaterThan(0);
      expect(session.state().championsHp).toEqual(hp);
    });

    it("sends Fomor after Krallen", () => {
      const session = withChampions(entry(5), entry(3));
      session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 5, l: 1 } });
      expect(session.championBlock(3)).toBeNull();
      session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 3, l: 1 } });
      expect(session.state().championAvailable).toBe(false);
    });

    it("offers only the first healthy, active ordinary champion, before and after it goes", () => {
      const session = withChampions(entry(1, 0), entry(3), entry(4), entry(5));
      expect(session.championBlock(1)).toBe("hurt");
      expect(session.championBlock(3)).toBeNull();
      expect(session.championBlock(4)).toBe("oneChampion");
      expect(() =>
        session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 4, l: 1 } }),
      ).toThrow(/oneChampion/);

      session.appendFling({ x: -100, y: -100, monsters: {}, champion: { t: 3, l: 1 } });
      expect(session.championBlock(4)).toBe("oneChampion");
      expect(session.championBlock(5)).toBeNull();
    });

    it("says why a champion cannot go: unknown, hurt or away", () => {
      const session = withChampions(entry(2, 0), entry(5, 1000, 1));
      expect(session.championBlock(9)).toBe("unknown");
      expect(session.championBlock(2)).toBe("hurt");
      expect(session.championBlock(5)).toBe("away");
      expect(session.state().championAvailable).toBe(false);
      expect(session.championsHpAfter()).toEqual({});
    });
  });

  it("logs bombs and siege weapons at the current tick", () => {
    const session = sessionOf();
    session.start();
    play(session, 0.5);
    // The smallest twig bomb: a full-strength tw1 now flattens the fixture's
    // only building, which would end the attack before the siege weapon.
    const bomb = session.appendBomb({ x: 10, y: 20, id: "tw0" });
    const siege = session.appendSiege({ x: 30, y: 40, weapon: "jars" });
    expect(bomb).toEqual({ kind: "bomb", t: 40, x: 10, y: 20, id: "tw0" });
    expect(siege).toEqual({ kind: "siege", t: 40, x: 30, y: 40, weapon: "jars" });
    expect(session.flingLog().events.map((event) => event.kind)).toEqual(["bomb", "siege"]);
  });

  it("refuses events once the attack has ended", () => {
    const session = sessionOf();
    session.start();
    session.retreat();
    expect(() => session.appendFling({ x: 0, y: 0, monsters: { C1: 1 } })).toThrow(/ended/);
  });
});

describe("AttackSession ending", () => {
  it("retreat logs the event and ends with reason retreat", () => {
    const session = sessionOf();
    session.start();
    play(session, 1);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    session.retreat();
    const state = session.state();
    expect(state.phase).toBe("ended");
    expect(state.endReason).toBe("retreat");
    expect(session.flingLog().events.at(-1)).toEqual({ kind: "retreat", t: TICKS_PER_SECOND });
    // Idempotent, and the clock stops.
    session.retreat();
    session.advance(1);
    expect(session.state().tick).toBe(TICKS_PER_SECOND);
  });

  it("leave ends the battle where it stands, logging nothing (#138)", () => {
    const session = sessionOf();
    session.start();
    play(session, 1);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    play(session, 1);
    const events = session.flingLog().events.length;
    session.leave();
    const state = session.state();
    expect(state.phase).toBe("ended");
    expect(state.endReason).toBe("left");
    expect(session.flingLog().events).toHaveLength(events);
    // The clock stops there, and a second leave or a retreat changes nothing.
    session.advance(5);
    session.leave();
    session.retreat();
    expect(session.state()).toMatchObject({ tick: 2 * TICKS_PER_SECOND, endReason: "left" });
  });

  it("ends as exhausted once the field is empty and nothing is left to send", () => {
    const session = sessionOf();
    session.start();
    // Three Pokeys against a Cannon Tower all die well inside a minute.
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    expect(session.state().creepsAlive).toBe(3);
    play(session, 60);
    const state = session.state();
    expect(state.creepsAlive).toBe(0);
    expect(state.phase).toBe("ended");
    expect(state.endReason).toBe("exhausted");
    expect(state.remainingSeconds).toBeGreaterThan(0);
  });

  it("does not end as exhausted while a tool is still unused or a monster is housed", () => {
    const session = sessionOf();
    session.start();
    session.setUnusedTools(1);
    session.appendFling({ x: -100, y: -100, monsters: { C1: 3 } });
    play(session, 60);
    expect(session.state().creepsAlive).toBe(0);
    expect(session.state().phase).toBe("running");
    session.setUnusedTools(0);
    expect(session.state().endReason).toBe("exhausted");

    const partial = sessionOf();
    partial.start();
    partial.appendFling({ x: -100, y: -100, monsters: { C1: 2 } });
    play(partial, 60);
    expect(partial.state().phase).toBe("running");
    expect(partial.state().remaining).toEqual({ C1: 1 });
  });

  it("ends as expired when the countdown runs out with nothing sent", () => {
    const session = sessionOf();
    session.start();
    session.setSpeed(2);
    play(session, (ATTACK_COUNTDOWN_SECONDS + 121) / 2);
    const state = session.state();
    expect(state.phase).toBe("ended");
    expect(state.endReason).toBe("expired");
    expect(state.remainingSeconds).toBe(0);
  });

  it("ends as destroyed at 100% damage", () => {
    const session = sessionOf({
      roster: { monsters: { C1: 60 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
    });
    session.start();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 60 } });
    play(session, 120);
    const state = session.state();
    expect(state.damagePercent).toBe(100);
    expect(state.buildingsDestroyed).toBe(1);
    expect(state.endReason).toBe("destroyed");
  });

  it("ends as destroyed once nothing a creep could attack is standing (#71)", () => {
    // The tower is the only target; the trap sits far from every path and the
    // decoration is never chosen, so the percentage stops short of 100 and one
    // Pokey stays housed. Flash ended here (`ATTACK.as:276-291`); so do we.
    const trappedYard = towerYard();
    trappedYard.buildingdata = {
      ...trappedYard.buildingdata,
      "2": { id: 2, t: 24, l: 1, X: 300, Y: 300 },
      "3": { id: 3, t: 30, l: 1, X: -300, Y: 300 },
    } as never;
    const session = new AttackSession({
      target: targetOf({
        roster: { monsters: { C1: 61 }, levels: {}, champions: [], flingerLevel: 4, catapultLevel: 0, sources: [], siege: null, resources: null },
      }),
      seed: 1,
    });
    session.load(trappedYard);
    session.start();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 60 } });
    play(session, 120);
    const state = session.state();
    expect(state.buildingsDestroyed).toBe(1);
    expect(state.damagePercent).toBeLessThan(100);
    expect(state.remaining).toEqual({ C1: 1 });
    expect(state.phase).toBe("ended");
    expect(state.endReason).toBe("destroyed");
  });

  it("tells subscribers about phase changes and events, and lets them leave", () => {
    const session = sessionOf();
    const phases: string[] = [];
    const stop = session.subscribe((state) => phases.push(state.phase));
    session.start();
    session.appendFling({ x: -100, y: -100, monsters: { C1: 1 } });
    session.retreat();
    expect(phases).toEqual(["running", "running", "ended"]);
    stop();
    session.setSpeed(2);
    expect(phases).toHaveLength(3);
  });
});

describe("helpers", () => {
  it("reads Declare War off the running powerups", () => {
    expect(hasDeclareWar(undefined)).toBe(false);
    expect(hasDeclareWar([{ id: "ap_armament" }])).toBe(false);
    expect(hasDeclareWar([{ id: "ap_armament" }, { id: "ap_declarewar", endtime: 9 }])).toBe(true);
  });

  // `BSTORAGE.as:77-85`, `:111`, `:117`: a camp's half and lower fall caps
  // are Map Room 2's; a Map Room 1 tribe gets only the wild monster fifth.
  it("names a Map Room 1 tribe `tribe` and leaves every other kind as it is", () => {
    expect(combatKind({ kind: "wild", mapversion: 1 })).toBe("tribe");
    expect(combatKind({ kind: "wild" })).toBe("wild");
    expect(combatKind({ kind: "wild", mapversion: 2 })).toBe("wild");
    expect(combatKind({ kind: "main", mapversion: 1 })).toBe("main");
    expect(combatKind({ kind: "outpost" })).toBe("outpost");
    expect(combatKind({ kind: "main" })).toBe("main");
  });

  it("mints a 32-bit seed", () => {
    const seed = mintSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(0x1_0000_0000);
  });
});
