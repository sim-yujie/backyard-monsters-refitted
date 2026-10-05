import { raidRefusal, type RaidApi, type RaidStartResponse, type RaidView } from "@/api/raid";
import { formatClock } from "@/game/attack/attackClock";

/**
 * A wild monster raid as the own main yard shows it (issue #226 WP4,
 * `docs/design/wild-raids.md` §4.3), up to the fight.
 *
 * The raid comes in its warning on a presence answer (`raidWatch.ts`). Until
 * the player answers, the WILD MONSTER ALERT is up, with "Engage now" and
 * "Prepare defences" and no way to skip it (D6). "Prepare defences" puts the
 * top bar's "WILD MONSTERS SPOTTED!" up, counting down to the fight, with
 * Flash's "I'm Ready Now" to bring it on at once. When the fight is due and
 * the Yard Planner is closed, the flow asks the server to fight it
 * (`/raid/start`) and hands the fight to the raid scene; with the Planner
 * open it waits, as Flash did, until the Planner closes. A raid the server
 * says is being fought, when this yard is not playing it, locks the yard.
 *
 * Quitting the game during the warning or the fight cancels the raid
 * (server side, Q2): nothing here needs to say so.
 */

/** What the yard shows of the raid now. */
export type RaidStage =
  | { readonly kind: "none" }
  /** The alert popup: the player has not answered yet. */
  | { readonly kind: "alert"; readonly raid: RaidView; readonly secondsLeft: number }
  /** "Prepare defences" was pressed: the top bar counts down. */
  | { readonly kind: "spotted"; readonly raid: RaidView; readonly secondsLeft: number }
  /** The fight is due: it starts now, or once the Planner closes. */
  | { readonly kind: "due"; readonly raid: RaidView; readonly planner: boolean }
  /** The server is fighting it, and not on this screen: the yard is locked. */
  | { readonly kind: "locked"; readonly raid: RaidView };

/** Which of the player's answers, or the start, is on its way. */
export type RaidBusy = "engage" | "prepare" | "start" | null;

/** The stage for a raid at a moment, server unix seconds. */
export const raidStage = (raid: RaidView | null, now: number, plannerOpen: boolean): RaidStage => {
  if (!raid) return { kind: "none" };
  if (raid.phase === "fighting") return { kind: "locked", raid };
  const secondsLeft = Math.ceil(raid.attackAt - now);
  if (secondsLeft > 0) return raid.warned === 1 ? { kind: "spotted", raid, secondsLeft } : { kind: "alert", raid, secondsLeft };
  return { kind: "due", raid, planner: plannerOpen };
};

/** The countdown to the fight, "4:59". */
export const raidCountdownText = (secondsLeft: number): string => formatClock(secondsLeft);

/** How long the flow waits before asking again after `busy` or `underAttack`. */
export const RAID_RETRY_MS = 5_000;
/** How often the countdown and the due check run. */
export const RAID_TICK_MS = 500;

/** What the flow reads the raid from (`RaidWatch`). */
export interface RaidSource {
  readonly current: RaidView | null;
  serverNow(): number;
  set(raid: RaidView | null): void;
  subscribe(listener: (raid: RaidView | null) => void): () => void;
}

/** What draws it (`RaidYardUi`). */
export interface RaidYardView {
  render(stage: RaidStage, busy: RaidBusy): void;
  /** A short line for a refusal or a failure; the stage stays as it is. */
  notice(message: string): void;
}

export interface RaidYardFlowOptions {
  readonly watch: RaidSource;
  readonly api: Pick<RaidApi, "engage" | "prepare" | "start">;
  readonly plannerOpen: () => boolean;
  readonly view: RaidYardView;
  /** The server fought it: play it (the raid scene). */
  readonly fight: (start: RaidStartResponse) => void;
  /**
   * The server says the fight already began, so this client lost it: open
   * the yard again, which cancels it on the server (§7.1).
   */
  readonly reload: () => void;
  /** Milliseconds; `Date.now` by default. */
  readonly now?: () => number;
  readonly retryMs?: number;
}

export class RaidYardFlow {
  private readonly options: RaidYardFlowOptions;
  private readonly now: () => number;
  private busy: RaidBusy = null;
  /** No start is asked for before this (ms), after `busy` or `underAttack`. */
  private holdUntil = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;
  private stopped = false;

  constructor(options: RaidYardFlowOptions) {
    this.options = options;
    this.now = options.now ?? Date.now;
  }

  /** Starts watching: renders now, then on every change and every half second. */
  start(): this {
    this.unsubscribe = this.options.watch.subscribe(() => this.tick());
    this.timer = setInterval(() => this.tick(), RAID_TICK_MS);
    this.tick();
    return this;
  }

  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** The stage now. */
  stage(): RaidStage {
    const { watch, plannerOpen } = this.options;
    return raidStage(watch.current, watch.serverNow(), plannerOpen());
  }

  /** Draws the stage, and starts the fight when it is due with the Planner closed. */
  tick(): void {
    if (this.stopped) return;
    const stage = this.stage();
    this.options.view.render(stage, this.busy);
    if (stage.kind === "due" && !stage.planner && this.busy === null && this.now() >= this.holdUntil) {
      void this.startFight(stage.raid);
    }
  }

  /** "Engage now", and the top bar's "I'm Ready Now": the fight is due at once. */
  engage(): Promise<void> {
    return this.answer("engage");
  }

  /** "Prepare defences": the alert goes and the top bar counts down. */
  prepare(): Promise<void> {
    return this.answer("prepare");
  }

  private async answer(kind: "engage" | "prepare"): Promise<void> {
    const raid = this.options.watch.current;
    if (!raid || raid.phase !== "warning" || this.busy !== null) return;
    this.setBusy(kind);
    try {
      const answer = await this.options.api[kind](raid.id);
      if (this.stopped) return;
      this.options.watch.set(answer.raid);
    } catch (caught) {
      if (this.stopped) return;
      this.refused(caught, raid);
    } finally {
      this.setBusy(null);
    }
    // "Engage now" makes the fight due at once.
    this.tick();
  }

  private async startFight(raid: RaidView): Promise<void> {
    this.setBusy("start");
    try {
      const answer = await this.options.api.start(raid.id);
      if (this.stopped) return;
      this.options.watch.set(answer.raid);
      this.busy = null;
      this.options.fight(answer);
      return;
    } catch (caught) {
      if (this.stopped) return;
      this.refused(caught, raid);
    }
    this.setBusy(null);
  }

  /** What a refusal or a failure does; the next tick carries on from there. */
  private refused(caught: unknown, raid: RaidView): void {
    const refusal = raidRefusal(caught);
    const { watch, view } = this.options;
    switch (refusal?.reason) {
      case "noRaid":
      case "notMainYard":
        watch.set(null);
        return;
      case "notYet":
        if (refusal.attackAt !== undefined) watch.set({ ...raid, attackAt: refusal.attackAt });
        this.holdUntil = this.now() + 1_000;
        return;
      case "notWarning":
        this.options.reload();
        return;
      case "underAttack":
        this.holdUntil = this.now() + (this.options.retryMs ?? RAID_RETRY_MS);
        view.notice("Another attack is on your yard. The wild monsters wait until it is over.");
        return;
      case "busy":
        this.holdUntil = this.now() + (this.options.retryMs ?? RAID_RETRY_MS);
        return;
      default:
        this.holdUntil = this.now() + (this.options.retryMs ?? RAID_RETRY_MS);
        view.notice("Could not reach the server about the wild monsters. Trying again…");
    }
  }

  private setBusy(busy: RaidBusy): void {
    this.busy = busy;
    if (!this.stopped) this.options.view.render(this.stage(), busy);
  }
}
