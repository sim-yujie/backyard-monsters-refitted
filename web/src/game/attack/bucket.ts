import { getSession } from "@/api/auth";
import { bucketCost, dropRadius, flingerPayload, type Roster } from "@/game/combat/rules";
import type { AttackSession } from "./AttackSession";

/**
 * The bucket: what the next tap on the enemy yard will send
 * (`docs/design/attack-flow.md` §F2, §6 WP3).
 *
 * The army panel edits it, the drop input (WP4) reads {@link composition} and
 * hands it to `AttackSession.appendFling`, then calls {@link afterDrop}. It is
 * deliberately not part of the session: the session owns what *has* been sent
 * and refuses anything it cannot honour, while the bucket owns what the player
 * *wants* to send next and never lets that wish exceed what the session would
 * accept.
 *
 * ## Requested versus effective
 *
 * A row holds the number the player set — the *requested* count. After a drop
 * the session's `remaining()` shrinks, and §F2 ("after a drop, nothing resets")
 * decides that the figure on screen stays put rather than being rewritten out
 * from under the player. So the requested count may exceed what is still
 * housed; the *effective* count, `min(requested, remaining)`, is what
 * {@link composition} carries and what {@link cost} prices. {@link clamped}
 * names the rows where the two differ, for the panel's "20 left" note.
 *
 * ## Two ceilings
 *
 * A row's {@link max} is the smaller of what is still housed and what the
 * flinger's payload has room for once every other row's effective cost is
 * counted — the arithmetic `BucketAdd`'s silent refusal used to enforce one
 * click at a time (`docs/specs/combat.md:337-339`). Because the ceiling is
 * computed against the other rows, setting one row can never push the total
 * past the payload, and Fill walks the rows in roster order so two presses of
 * Fill all land on the same numbers (§7, Q11).
 *
 * ## The champion
 *
 * One at most, by type. The pick is dropped by {@link afterDrop} because the
 * champion is then on the field, and {@link champion} answers null whenever the
 * session says none can be sent, so a stale pick never reaches the log.
 *
 * ## Last army
 *
 * {@link saveLast} writes the requested rows and the champion pick under a
 * per-player `localStorage` key; {@link loadLast} reads them back through the
 * same clamps. Both go through try/catch and a blocked store means "nothing
 * saved", never an error (§F2 "Last army").
 */

/** What one tap sends: the rows above zero, and the champion if picked. */
export interface FlingComposition {
  readonly monsters: Roster;
  readonly champion?: { readonly t: number; readonly l: number };
}

/** A champion as the panel lists it. */
export interface BucketChampion {
  readonly t: number;
  readonly l: number;
  readonly hp: number;
  /** 0 active, 1 frozen, 2 juiced. Only 0 may be flung. */
  readonly status: number;
  /** Healthy, active, and no champion has been flung yet. */
  readonly available: boolean;
}

export interface BucketOptions {
  /**
   * Where the last army is kept. Defaults to `window.localStorage`, read
   * lazily and guarded; null disables saving.
   */
  readonly storage?: Storage | null;
  /**
   * The player the last army belongs to. Defaults to the signed-in user id,
   * so two accounts on one browser do not share a composition.
   */
  readonly playerKey?: string;
}

/** `localStorage` key prefix; the player id follows. */
export const LAST_ARMY_KEY_PREFIX = "bymr.attack.last-army.";

/** How the last army is written. Versioned so a later shape can skip an old one. */
interface LastArmyRecord {
  readonly v: 1;
  readonly monsters: Record<string, number>;
  readonly champion: number | null;
}

const defaultStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const defaultPlayerKey = (): string => {
  const id = getSession()?.userId;
  return id === undefined || id === null ? "anon" : String(id);
};

const wholeCount = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

export class Bucket {
  private readonly session: AttackSession;
  /** Roster order: the ids the map gathered, in the order it listed them. */
  private readonly order: readonly string[];
  private readonly requested: Record<string, number> = {};
  private championType: number | null = null;
  private readonly listeners = new Set<(bucket: Bucket) => void>();
  private readonly storage: Storage | null;
  private readonly playerKey: string;
  /** What the session last told us, to skip notifying on an unchanged clock tick. */
  private sessionSignature = "";

  constructor(session: AttackSession, options: BucketOptions = {}) {
    this.session = session;
    this.order = Object.keys(session.target.roster.monsters).filter(
      (id) => (session.target.roster.monsters[id] ?? 0) > 0,
    );
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.playerKey = options.playerKey ?? defaultPlayerKey();
    this.sessionSignature = this.signature();
    // The session notifies four times a battle-second; only a change in what
    // can still be sent is the panel's business.
    session.subscribe(() => {
      const next = this.signature();
      if (next === this.sessionSignature) return;
      this.sessionSignature = next;
      this.notify();
    });
  }

  /* ── Reading ────────────────────────────────────────────────────────── */

  /** Every monster id in roster order, whether or not any are left. */
  ids(): readonly string[] {
    return this.order;
  }

  /** The academy level a row is priced and drawn at. */
  level(id: string): number {
    return this.session.target.roster.levels[id] ?? 1;
  }

  /** Housed and not yet flung. */
  remaining(id: string): number {
    return this.session.remaining()[id] ?? 0;
  }

  /** What the player set, which may exceed {@link remaining} after a drop. */
  requestedCount(id: string): number {
    return this.requested[id] ?? 0;
  }

  /** What the next drop would actually send from this row. */
  count(id: string): number {
    return Math.min(this.requestedCount(id), this.remaining(id));
  }

  /** Bucket units one of this monster costs at its level. */
  unitCost(id: string): number {
    return bucketCost({ [id]: 1 }, this.session.target.roster.levels);
  }

  /** The rows above zero plus the champion if picked; already clamped. */
  composition(): FlingComposition {
    const monsters: Record<string, number> = {};
    for (const id of this.order) {
      const count = this.count(id);
      if (count > 0) monsters[id] = count;
    }
    const champion = this.champion();
    return champion ? { monsters, champion } : { monsters };
  }

  /** Nothing to drop: no row above zero and no champion picked. */
  isEmpty(): boolean {
    if (this.champion()) return false;
    return this.order.every((id) => this.count(id) === 0);
  }

  /** Bucket units the composition costs. */
  cost(): number {
    return bucketCost(this.composition().monsters, this.session.target.roster.levels);
  }

  /** The flinger's payload: what one drop may cost at most. */
  capacity(): number {
    return flingerPayload();
  }

  /** The drop ring's radius for the composition as it stands. */
  radius(): number {
    return dropRadius(this.cost());
  }

  /**
   * The most this row may hold right now: what is still housed, or what the
   * payload has room for once every other row is counted, whichever is less.
   */
  max(id: string): number {
    const housed = this.remaining(id);
    if (housed === 0) return 0;
    const unit = this.unitCost(id);
    if (unit <= 0) return housed;
    const others = this.cost() - unit * this.count(id);
    const room = Math.floor((this.capacity() - others) / unit);
    return Math.max(0, Math.min(housed, room));
  }

  /**
   * Rows whose requested count exceeds what is still housed, mapped to what
   * is: the panel's "20 left" note. A row that ran out is here too, at 0.
   */
  clamped(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.order) {
      const requested = this.requestedCount(id);
      const remaining = this.remaining(id);
      if (requested > remaining) out[id] = remaining;
    }
    return out;
  }

  /** Whether the session still takes drops. */
  live(): boolean {
    const phase = this.session.state().phase;
    return phase === "loaded" || phase === "running";
  }

  /* ── Editing ────────────────────────────────────────────────────────── */

  /** Sets a row, clamped to `[0, max(id)]`. An unknown id is ignored. */
  setCount(id: string, n: number): void {
    if (!this.order.includes(id)) return;
    const next = Math.min(wholeCount(n), this.max(id));
    if (next === this.requestedCount(id)) return;
    if (next === 0) delete this.requested[id];
    else this.requested[id] = next;
    this.notify();
  }

  /** Tops the row up to its maximum. */
  fill(id: string): void {
    this.setCount(id, this.max(id));
  }

  /**
   * Tops every row up in roster order, each to its own maximum given what the
   * rows before it took. Deterministic: two presses land on the same numbers.
   */
  fillAll(): void {
    let changed = false;
    for (const id of this.order) {
      const next = this.max(id);
      if (next === this.requestedCount(id)) continue;
      if (next === 0) delete this.requested[id];
      else this.requested[id] = next;
      changed = true;
    }
    if (changed) this.notify();
  }

  /** Empties every row and drops the champion pick. */
  clear(): void {
    const hadRows = Object.keys(this.requested).length > 0;
    for (const id of Object.keys(this.requested)) delete this.requested[id];
    const hadChampion = this.championType !== null;
    this.championType = null;
    if (hadRows || hadChampion) this.notify();
  }

  /* ── The champion ───────────────────────────────────────────────────── */

  /** Every champion the attacker owns, in the save's order, with whether it can go. */
  champions(): readonly BucketChampion[] {
    const canSend = this.session.championAvailable();
    return this.session.target.roster.champions.map((entry) => ({
      t: entry.t,
      l: entry.l,
      hp: entry.hp,
      status: entry.status,
      available: canSend && entry.hp > 0 && entry.status === 0,
    }));
  }

  /**
   * Picks a champion by type, or null to un-pick. A type that cannot be sent
   * — unknown, hurt, frozen, or already flung — leaves the pick empty.
   */
  pickChampion(t: number | null): void {
    const next =
      t !== null && this.champions().some((champion) => champion.t === t && champion.available)
        ? t
        : null;
    if (next === this.championType) return;
    this.championType = next;
    this.notify();
  }

  /** The picked champion as the fling wants it, or null. */
  champion(): { t: number; l: number } | null {
    if (this.championType === null) return null;
    const entry = this.champions().find((champion) => champion.t === this.championType);
    if (!entry || !entry.available) return null;
    return { t: entry.t, l: entry.l };
  }

  /* ── After a drop ───────────────────────────────────────────────────── */

  /**
   * Called right after `session.appendFling` with this composition.
   *
   * Remembers what was sent as the last army, drops the champion pick — it is
   * on the field now — and tells the panel, which re-reads every row against
   * the smaller `remaining()`. The requested counts stay as the player set
   * them (§F2, "after a drop, nothing resets").
   */
  afterDrop(): void {
    this.saveLast();
    this.championType = null;
    this.sessionSignature = this.signature();
    this.notify();
  }

  /* ── Listening ──────────────────────────────────────────────────────── */

  /** Hears about every change. Not called on subscribe. Returns the unsubscribe. */
  subscribe(fn: (bucket: Bucket) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /* ── Last army ──────────────────────────────────────────────────────── */

  /** Writes the requested rows and the champion pick. Silent when it cannot. */
  saveLast(): void {
    const monsters: Record<string, number> = {};
    for (const id of this.order) {
      const requested = this.requestedCount(id);
      if (requested > 0) monsters[id] = requested;
    }
    const record: LastArmyRecord = { v: 1, monsters, champion: this.championType };
    try {
      this.storage?.setItem(LAST_ARMY_KEY_PREFIX + this.playerKey, JSON.stringify(record));
    } catch {
      // A full or blocked store is not worth an error; the player types the
      // numbers again next time.
    }
  }

  /**
   * Restores the last saved composition through the usual clamps. True when a
   * record was found and applied, false when there was none or it could not
   * be read.
   */
  loadLast(): boolean {
    let record: LastArmyRecord | null = null;
    try {
      const raw = this.storage?.getItem(LAST_ARMY_KEY_PREFIX + this.playerKey);
      if (!raw) return false;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        (parsed as { v?: unknown }).v === 1 &&
        typeof (parsed as { monsters?: unknown }).monsters === "object"
      ) {
        record = parsed as LastArmyRecord;
      }
    } catch {
      return false;
    }
    if (!record) return false;

    for (const id of Object.keys(this.requested)) delete this.requested[id];
    for (const id of this.order) {
      const wanted = record.monsters[id];
      if (typeof wanted !== "number" || wanted <= 0) continue;
      const next = Math.min(wholeCount(wanted), this.max(id));
      if (next > 0) this.requested[id] = next;
    }
    const champion = record.champion;
    this.championType =
      typeof champion === "number" &&
      this.champions().some((entry) => entry.t === champion && entry.available)
        ? champion
        : null;
    this.notify();
    return true;
  }

  /* ── Internals ──────────────────────────────────────────────────────── */

  private signature(): string {
    const state = this.session.state();
    return `${state.phase}|${state.championAvailable}|${JSON.stringify(state.remaining)}`;
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this);
  }
}

const buckets = new WeakMap<AttackSession, Bucket>();

/** The one bucket for a session, made on first ask. */
export const bucketFor = (session: AttackSession): Bucket => {
  let bucket = buckets.get(session);
  if (!bucket) {
    bucket = new Bucket(session);
    buckets.set(session, bucket);
  }
  return bucket;
};
