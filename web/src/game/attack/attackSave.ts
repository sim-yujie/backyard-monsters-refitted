import type {
  AttackSavePayload,
  BuildingDataMap,
  ChampionSaveEntry,
  MonstersSave,
  Resources,
} from "@/api/types";
import {
  RESOURCE_KEYS,
  TICKS_PER_SECOND,
  VICTORY_THRESHOLD,
  derivedDestroyed,
  type BattleState,
  type FlingEvent,
  type FlingLog,
  type ResourceAmounts,
  type Roster,
} from "@/game/combat/rules";
import type { AttackEndReason, AttackSession, AttackSessionState } from "./AttackSession";
import type { AttackTargetKind, RosterSource, SiegeInventory } from "./attackTarget";

/**
 * The final `/base/save` of an attack, built from the session alone
 * (`docs/design/attack-flow.md` §5.2, §5.3, §6 WP6).
 *
 * Phase 1 is client-authoritative, as Flash is: the client computes the
 * outcome and reports it, and the server's attack-save path reads the same
 * keys it always has (`Save.attackSaveKeys`, `docs/server-api.md` "Save write
 * keys"). Every key here is what §5.2's table says the client computes it
 * from, and nothing is taken from anywhere but the session: its state, the
 * engine's {@link BattleState}, the fling log it accumulated, and the attack
 * load it was built from. Pure and DOM-free, so the payload is testable from
 * a fixture and the same builder serves a retry.
 *
 * Flash always sent the final save, whether or not anything was flung
 * (`ATTACK.End()` "saves if not already sent", `docs/specs/combat.md`
 * "Retreat"), and so does this: the save carrying `over` is what clears the
 * defender's `attackid` and ends the server's attack session, so an attack
 * with no fling still has to be closed.
 */

export interface AttackSaveOptions {
  /** Display names for the attack report; ids are used when absent. */
  readonly nameOf?: (id: string) => string;
}

/**
 * A missing battle or load is a programming error: the save is built only
 * once the session has ended, which needs both.
 */
const requireLoaded = (session: AttackSession) => {
  const load = session.attackLoad();
  const battle = session.battle();
  if (!load || !battle) throw new Error("buildAttackSave: the session was never loaded");
  return { load, battle };
};

/* ── Resources ──────────────────────────────────────────────────────────── */

/** Whole units; the engine carries fractions the server never stored. */
const wholeAmounts = (amounts: ResourceAmounts, sign: 1 | -1): Resources => {
  const out: Resources = {};
  for (const key of RESOURCE_KEYS) out[key] = sign * Math.floor(Math.max(0, amounts[key]));
  return out;
};

/** `attackloot`: the gain, before the storage cap the server does not apply. */
export const attackLootOf = (state: BattleState): Resources => wholeAmounts(state.loot, 1);

/**
 * `resources`: the defender's loss as a negative delta. The server honours
 * subtractions only (`defenderLootHandler.ts`), so the sign is the contract.
 */
export const defenderDeltaOf = (state: BattleState): Resources =>
  wholeAmounts(state.defenderLoss, -1);

/* ── Buildings ──────────────────────────────────────────────────────────── */

/**
 * `buildingdata` after the battle: the enemy yard as loaded, minus the traps
 * that fired. The server ignores every other change and honours only a trap's
 * absence (`buildingDataHandler.ts`), which is how it learns a trap went off.
 */
export const buildingDataAfter = (
  buildingdata: BuildingDataMap | null | undefined,
  firedTraps: readonly number[],
): BuildingDataMap => {
  const fired = new Set(firedTraps.map(String));
  const out: BuildingDataMap = {};
  for (const [key, building] of Object.entries(buildingdata ?? {})) {
    if (!fired.has(key)) out[key] = building;
  }
  return out;
};

/* ── Champions ──────────────────────────────────────────────────────────── */

/** The champion sent with a fling, if one was. */
const flungChampion = (events: readonly FlingEvent[]): { t: number; l: number } | null => {
  for (const event of events) {
    if (event.kind === "fling" && event.champion) return event.champion;
  }
  return null;
};

/**
 * `attackerchampion`: the attacker's own champions with the flung one's
 * health as the battle left it. The server overwrites `userSave.champion`
 * with this verbatim (`baseSave.ts`), so it is the whole list, or nothing at
 * all when the attacker has none.
 */
export const attackerChampionsAfter = (
  champions: readonly ChampionSaveEntry[],
  events: readonly FlingEvent[],
  championHp: number | null,
): ChampionSaveEntry[] | undefined => {
  if (champions.length === 0) return undefined;
  const flung = flungChampion(events);
  return champions.map((champion) => {
    if (!flung || champion.t !== flung.t || championHp === null) return { ...champion };
    return { ...champion, hp: Math.max(0, Math.floor(championHp)) };
  });
};

/* ── The attacker's housing ─────────────────────────────────────────────── */

/**
 * `monsterupdate`: each source cell's housing blob (`RosterSource`, the
 * cell's whole `m`) with what was flung taken out, in cell order — a fling
 * spends the first cell's monsters first, then the next, the way the roster
 * was summed. Cells that held nothing of what was flung are still listed with
 * their blob untouched, because the server also clears that cell's damage
 * protection on the way through (`updateMonsters.ts`), as it did for Flash.
 * With no sources the key is `[]`, which the server reads as nothing to
 * update — the shape Flash sends before any fling.
 */
export const monsterUpdateOf = (
  sources: readonly RosterSource[],
  flung: Roster,
): { baseid: string; m: MonstersSave }[] => {
  const left: Record<string, number> = { ...flung };
  return sources.map((source) => {
    const stored = source.m["housed"];
    const housed: Record<string, number | undefined> = {
      ...((typeof stored === "object" && stored !== null ? stored : {}) as Record<
        string,
        number | undefined
      >),
    };
    for (const [id, count] of Object.entries(housed)) {
      const owed = left[id] ?? 0;
      if (owed <= 0 || typeof count !== "number") continue;
      const taken = Math.min(count, owed);
      housed[id] = count - taken;
      left[id] = owed - taken;
    }
    return { baseid: source.baseid, m: { ...source.m, housed } };
  });
};

/**
 * `attackersiege`: the attacker's siege inventory with one `quantity` taken
 * off each weapon per siege event in the log, which is what activating one
 * does in Flash (`SiegeWeapons.as:52-68`, `docs/specs/combat.md` "Siege
 * weapons"). The server overwrites `userSave.siege` with it verbatim, so it
 * is the whole inventory as loaded, or nothing when the attacker has none.
 */
export const attackerSiegeAfter = (
  siege: SiegeInventory | null | undefined,
  events: readonly FlingEvent[],
): SiegeInventory | undefined => {
  if (!siege) return undefined;
  const out: Record<string, unknown> = { ...siege };
  for (const event of events) {
    if (event.kind !== "siege") continue;
    const entry = out[event.weapon];
    if (typeof entry !== "object" || entry === null) continue;
    const quantity = (entry as { quantity?: unknown }).quantity;
    if (typeof quantity !== "number") continue;
    out[event.weapon] = { ...entry, quantity: Math.max(0, quantity - 1) };
  }
  return out;
};

/** What the log says was flung, summed per id. */
export const flungOf = (events: readonly FlingEvent[]): Roster => {
  const flung: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== "fling") continue;
    for (const [id, count] of Object.entries(event.monsters)) {
      if (count > 0) flung[id] = (flung[id] ?? 0) + count;
    }
  }
  return flung;
};

/* ── The report ─────────────────────────────────────────────────────────── */

/** `m:ss` of a tick, the clock's own spelling. */
export const clockOf = (tick: number): string => {
  const whole = Math.max(0, Math.floor(tick / TICKS_PER_SECOND));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest < 10 ? "0" : ""}${rest}`;
};

const BOMB_RESOURCE: Readonly<Record<string, string>> = {
  tw: "twig",
  pb: "pebble",
  pu: "putty",
};

/** `tw2` reads as "twig bomb (tier 3)"; an id the table lacks is shown as is. */
const bombName = (id: string): string => {
  const resource = BOMB_RESOURCE[id.slice(0, 2)];
  const tier = Number(id.slice(2));
  if (!resource || !Number.isInteger(tier)) return `${id} bomb`;
  return `${resource} bomb (tier ${tier + 1})`;
};

const at = (x: number, y: number): string => `at (${Math.round(x)}, ${Math.round(y)})`;

/** One line for one event (§7, Q5). */
export const reportLine = (event: FlingEvent, nameOf: (id: string) => string): string => {
  const when = clockOf(event.t);
  switch (event.kind) {
    case "fling": {
      const parts = Object.entries(event.monsters)
        .filter(([, count]) => count > 0)
        .map(([id, count]) => `${count} ${nameOf(id)}`);
      if (event.champion) parts.push(`the champion (G${event.champion.t})`);
      return `${when} Flung ${parts.join(", ")} ${at(event.x, event.y)}`;
    }
    case "bomb":
      return `${when} Fired a ${bombName(event.id)} ${at(event.x, event.y)}`;
    case "siege":
      return `${when} Deployed ${event.weapon} ${at(event.x, event.y)}`;
    case "retreat":
      return `${when} Retreated`;
  }
};

/**
 * `attackreport`: plain text, one line per fling, bomb, siege and retreat in
 * the log, then one line with the result (§7, Q5). The server writes it
 * verbatim onto the defender's row; the web client renders it as text.
 */
export const attackReportOf = (
  log: FlingLog,
  state: AttackSessionState,
  nameOf: (id: string) => string = (id) => id,
): string => {
  const lines = log.events.map((event) => reportLine(event, nameOf));
  const loot = RESOURCE_KEYS.map((key) => Math.floor(state.loot[key]));
  lines.push(
    `Result: ${Math.floor(state.damagePercent)}% damage, ` +
      `${state.buildingsDestroyed} buildings destroyed, ` +
      `looted ${loot[0]} twigs, ${loot[1]} pebbles, ${loot[2]} putty, ${loot[3]} goo.`,
  );
  return lines.join("\n");
};

/* ── The payload ────────────────────────────────────────────────────────── */

/**
 * Builds the final save for an ended attack (§5.2's table, key by key).
 *
 * Also usable before the end for a checkpoint save, since every key is a
 * snapshot; `over` is set from the session's phase.
 */
export const buildAttackSave = (
  session: AttackSession,
  options: AttackSaveOptions = {},
): AttackSavePayload => {
  const { load, battle } = requireLoaded(session);
  const state = session.state();
  const battleState = battle.state();
  const log = session.flingLog();
  const damage = Math.round(state.damagePercent * 100) / 100;
  const destroyed = derivedDestroyed(damage, session.target.kind);
  const { roster } = session.target;
  const attackerchampion = attackerChampionsAfter(roster.champions, log.events, session.championHpAfter());
  const attackersiege = attackerSiegeAfter(roster.siege, log.events);

  const payload: AttackSavePayload = {
    baseid: load.baseid,
    basesaveid: load.basesaveid,
    attackid: load.attackid ?? 0,
    over: state.phase === "ended",
    buildingdata: buildingDataAfter(load.buildingdata, battleState.firedTraps),
    buildinghealthdata: { ...battleState.health },
    damage,
    monsterupdate: monsterUpdateOf(roster.sources ?? [], flungOf(log.events)),
    attackloot: attackLootOf(battleState),
    resources: defenderDeltaOf(battleState),
    attackreport: attackReportOf(log, state, options.nameOf),
    flinglog: log,
  };
  if (destroyed !== undefined) payload.destroyed = destroyed;
  // The defender's housing and champions go back as loaded: the session does
  // not dispatch bunker monsters (it passes the engine no `bunkers`), and the
  // engine does not fight the defender's champion, so neither changed. The
  // server honours only a lower champion hp anyway.
  if (load.monsters) payload.monsters = load.monsters;
  if (load.champion && load.champion.length > 0) payload.champion = load.champion;
  if (attackerchampion) payload.attackerchampion = attackerchampion;
  if (attackersiege) payload.attackersiege = attackersiege;
  return payload;
};

/* ── The summary the end panel shows ────────────────────────────────────── */

export type OutcomeTone = "win" | "lose" | "neutral";

/** What the end-of-attack panel shows (§F6), read once at the end. */
export interface AttackSummary {
  readonly targetName: string;
  readonly kind: AttackTargetKind;
  readonly endReason: AttackEndReason | null;
  readonly outcome: string;
  readonly tone: OutcomeTone;
  readonly damagePercent: number;
  readonly buildingsDestroyed: number;
  readonly buildingsTotal: number;
  readonly loot: ResourceAmounts;
  readonly monstersSent: number;
  readonly monstersLost: number;
  /** The champion's health at the end, or null when none was sent. */
  readonly championHp: number | null;
  readonly elapsedSeconds: number;
}

/** The defender's main-yard protection threshold (`damageProtection.ts`). */
const MAIN_PROTECTION_DAMAGE = 50;

/**
 * The outcome in one line. A camp or an outpost is won at the takeover
 * threshold, which is what `destroyed` reports (`damagePercent.ts`); a main
 * yard has no win, only the damage dealt and whether it will earn the
 * defender protection (`damageProtection.ts`, ≥ 50% for 36 hours).
 */
export const describeOutcome = (
  kind: AttackTargetKind,
  name: string,
  damagePercent: number,
): { outcome: string; tone: OutcomeTone } => {
  const damage = Math.floor(damagePercent);
  if (kind === "wild" || kind === "outpost") {
    const what = kind === "wild" ? "camp" : "outpost";
    return damagePercent >= VICTORY_THRESHOLD
      ? { outcome: `Victory! ${name}'s ${what} is destroyed.`, tone: "win" }
      : {
          outcome: `${name}'s ${what} still stands at ${damage}% damage (${VICTORY_THRESHOLD}% wins).`,
          tone: "lose",
        };
  }
  return damagePercent >= MAIN_PROTECTION_DAMAGE
    ? { outcome: `Heavy damage: ${damage}% of ${name}'s yard.`, tone: "win" }
    : { outcome: `${damage}% damage dealt to ${name}'s yard.`, tone: "neutral" };
};

export const summariseAttack = (session: AttackSession): AttackSummary => {
  const { load } = requireLoaded(session);
  const state = session.state();
  const { kind, name } = session.target;
  return {
    targetName: name,
    kind,
    endReason: state.endReason,
    ...describeOutcome(kind, name, state.damagePercent),
    damagePercent: state.damagePercent,
    buildingsDestroyed: state.buildingsDestroyed,
    buildingsTotal: Object.keys(load.buildingdata ?? {}).length,
    loot: { ...state.loot },
    monstersSent: state.creepsFlung,
    monstersLost: state.creepsKilled,
    championHp: session.championHpAfter(),
    elapsedSeconds: state.elapsedSeconds,
  };
};
