import type { ChampionSaveEntry } from "@/api/types";
import type { Defence, DefenceReplayPayload, DefenceReplayResponse } from "@/api/defences";
import type { AttackRoster, AttackTarget, SiegeInventory } from "@/game/attack/attackTarget";
import { flungOf } from "@/game/attack/attackSave";
import { RESOURCE_KEYS, type FlingEvent, type ResourceAmounts } from "@/game/combat/rules";
import manifest from "@/game/combat/rules/MANIFEST.json";

/**
 * Watch on a defence (issue #362, `docs/design/defence-replays.md` §7):
 * another player's attack on the player's Map Room 2 main yard, played back on
 * the watch scene as the server fought it. Like auto-attack's Watch, nothing
 * on that screen talks to the server: the yard is the one the battle found,
 * the drops and the seed are the server's, and the result shown is the one
 * stored when the attack landed.
 *
 * Only the client's own engine plays it, so the client decides whether it
 * can (§4): the replay must have been fought under the combat rules this
 * bundle carries, and the server must say the same of its own.
 */

/**
 * The combat rules this bundle plays with: the rules MANIFEST's `version`,
 * which `tools/sync-combat-rules.mjs` writes and the server stores with each
 * replay.
 */
export const CLIENT_RULES_VERSION: string = manifest.version;

/** A defence replay to watch. */
export interface DefenceWatch {
  readonly kind: "defence";
  /** The stored figures: who, when, and what the attack cost. */
  readonly defence: Defence;
  readonly replay: DefenceReplayPayload;
}

/** Why a defence cannot be watched: fought under other rules, or kept without its battle. */
export type DefenceRefusal = "update" | "missing";

/** What the player is told instead of Watch (owner decision 5). */
export const DEFENCE_REFUSAL_TEXT: Readonly<Record<DefenceRefusal, string>> = {
  update: "Replay not available after a game update",
  missing: "Replay not available",
};

/**
 * Why this defence cannot be watched on this client, or null when it can.
 * The client's own version decides, since its engine plays it; the server's
 * `playable` covers a client that has not reloaded since a server update.
 *
 * @param defence - The defence's stored figures.
 * @param ours - The client's rules version.
 */
export const defenceRefusal = (
  defence: Pick<Defence, "hasReplay" | "playable" | "rulesVersion">,
  ours: string = CLIENT_RULES_VERSION,
): DefenceRefusal | null => {
  if (!defence.hasReplay) return "missing";
  return defence.playable && defence.rulesVersion === ours ? null : "update";
};

/** {@link defenceRefusal} for a whole run, which also needs a payload this client reads. */
export const defenceWatchRefusal = (run: DefenceWatch, ours: string = CLIENT_RULES_VERSION): DefenceRefusal | null =>
  defenceRefusal(run.defence, ours) ?? (run.replay?.v === 1 ? null : "update");

/**
 * The run for a `GET defences/:id/replay` answer, or why it cannot be
 * watched. The Defences screen and the mailbox's Watch (WP6) open the watch
 * scene with the run.
 */
export const defenceWatchOf = (
  answer: Pick<DefenceReplayResponse, "defence" | "replay">,
  ours: string = CLIENT_RULES_VERSION,
): { readonly run: DefenceWatch } | { readonly refusal: DefenceRefusal } => {
  const run: DefenceWatch = { kind: "defence", defence: answer.defence, replay: answer.replay };
  const refusal = defenceWatchRefusal(run, ours);
  return refusal ? { refusal } : { run };
};

/**
 * The attacker's champions the battle flings, as save entries: the stored
 * one for each type flung, or, when none was stored, what the fling says of
 * it. The battle layer starts their sheets from these; the fling events carry
 * what each fights with.
 */
const flungChampions = (run: DefenceWatch, events: readonly FlingEvent[]): ChampionSaveEntry[] => {
  const stored = Array.isArray(run.replay.champion) ? (run.replay.champion as unknown[]) : [];
  const champions: ChampionSaveEntry[] = [];
  const seen = new Set<number>();
  for (const event of events) {
    if (event.kind !== "fling" || !event.champion || seen.has(event.champion.t)) continue;
    const { t, l, pl } = event.champion;
    seen.add(t);
    const entry = stored.find(
      (one): one is Record<string, unknown> =>
        typeof one === "object" && one !== null && (one as { t?: unknown }).t === t,
    );
    champions.push({
      ...entry,
      t,
      l: typeof entry?.l === "number" ? entry.l : l,
      hp: typeof entry?.hp === "number" ? entry.hp : 0,
      ft: typeof entry?.ft === "number" ? entry.ft : 0,
      fd: typeof entry?.fd === "number" ? entry.fd : 0,
      fb: typeof entry?.fb === "number" ? entry.fb : 0,
      pl: typeof entry?.pl === "number" ? entry.pl : (pl ?? 0),
      status: 0,
    });
  }
  return champions;
};

/**
 * The defence's roster: exactly what the battle flings, at the levels and
 * ranks it fought at, the attacker's flung champions, and their siege.
 * Nothing is sent from it: the session plays the fought log.
 */
export const defenceRoster = (run: DefenceWatch, events: readonly FlingEvent[]): AttackRoster => ({
  monsters: flungOf(events),
  levels: { ...run.replay.levels },
  ...(run.replay.ranks ? { ranks: { ...run.replay.ranks } } : {}),
  champions: flungChampions(run, events),
  flingerLevel: 0,
  catapultLevel: 0,
  sources: [],
  siege: (run.replay.siege as SiegeInventory | null | undefined) ?? null,
  resources: null,
});

/**
 * The attack scene's target for a defence: the player's own yard as the
 * battle found it, handed over already loaded. The load's frozen academy and
 * ranks are the ones the server fought at, so the session fights at them too.
 */
export const defenceTarget = (run: DefenceWatch, events: readonly FlingEvent[]): AttackTarget => {
  const { replay } = run;
  return {
    baseid: String(replay.load.baseid ?? ""),
    kind: "main",
    name: run.defence.attacker.name,
    load: {
      ...replay.load,
      attackeracademy: { ...replay.levels },
      ...(replay.ranks ? { attackerranks: { ...replay.ranks } } : {}),
    },
    roster: defenceRoster(run, events),
  };
};

/**
 * The whole % damage the yard was left at, as the server stores it
 * (`storedDamage`: truncated, 0 to 100).
 */
export const storedDamageOf = (percent: number): number =>
  Number.isFinite(percent) ? Math.min(100, Math.max(0, Math.trunc(percent))) : 0;

/** Whole amounts by resource, as the server stores a defence's loot. */
export type WholeLoot = Readonly<Record<"r1" | "r2" | "r3" | "r4", number>>;

const wholeLoot = (amounts: Partial<Record<"r1" | "r2" | "r3" | "r4", number>>): WholeLoot => {
  const out = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of RESOURCE_KEYS) out[key] = Math.max(0, Math.floor(Number(amounts[key] ?? 0)) || 0);
  return out;
};

/** The engine's end damage against the stored one, and its loot when that differs too. */
export interface DefenceDrift {
  readonly id: number;
  readonly rulesVersion: string;
  readonly stored: number;
  readonly replayed: number;
  readonly tick: number;
  /** The defender's loss stored and replayed, when they differ. */
  readonly loot?: { readonly stored: WholeLoot; readonly replayed: WholeLoot };
}

/**
 * The drift between the stored result and the one the engine played to, or
 * null when they agree. The screen shows the stored result either way.
 *
 * @param defenderLoss - The engine's defender loss at the end; the loot is
 *   not checked without it.
 */
export const defenceDrift = (
  run: DefenceWatch,
  damagePercent: number,
  tick: number,
  defenderLoss?: ResourceAmounts,
): DefenceDrift | null => {
  const replayed = storedDamageOf(damagePercent);
  const stored = run.defence.damageAfter;
  const loot = defenderLoss ? { stored: wholeLoot(run.defence.loot), replayed: wholeLoot(defenderLoss) } : null;
  const lootDrifts = loot !== null && RESOURCE_KEYS.some((key) => loot.stored[key] !== loot.replayed[key]);
  if (replayed === stored && !lootDrifts) return null;
  return {
    id: run.defence.id,
    rulesVersion: run.defence.rulesVersion,
    stored,
    replayed,
    tick,
    ...(lootDrifts && loot ? { loot } : {}),
  };
};

/** What the attack strip reads on a defence replay: this attack's damage and the defender's loss. */
export interface DefenceReadout {
  /** Whole % damage this attack has done. */
  readonly damage: number;
  readonly loot: WholeLoot;
}

/**
 * The attack strip's figures on a defence replay (#362). Not the attacker's
 * view: the loot is what the defender lost, without the attacker's low-level
 * bonus, and the damage is this attack's alone, not the yard's whole damage.
 * Once the battle is over it reads the STORED figures, as the result panel
 * does, so the two never disagree (owner decision).
 *
 * @param defence - The stored figures.
 * @param damageShown - The whole yard's % damage on screen now.
 * @param defenderLoss - What the engine has taken from the defender so far.
 * @param over - The battle has ended.
 */
export const defenceReadout = (
  defence: Pick<Defence, "damageDone" | "damageAfter" | "loot">,
  damageShown: number,
  defenderLoss: ResourceAmounts,
  over: boolean,
): DefenceReadout => {
  if (over) return { damage: Math.max(0, Math.round(defence.damageDone)), loot: wholeLoot(defence.loot) };
  const before = defence.damageAfter - defence.damageDone;
  const shown = Number.isFinite(damageShown) ? Math.floor(damageShown) : 0;
  return { damage: Math.min(100, Math.max(0, shown - before)), loot: wholeLoot(defenderLoss) };
};

/** Logs a drift as `defence-replay-drift`; there is no client telemetry to send it to. */
export const logDefenceDrift = (drift: DefenceDrift): void => {
  console.warn("defence-replay-drift", drift);
};
