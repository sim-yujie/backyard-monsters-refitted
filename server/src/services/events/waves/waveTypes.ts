/**
 * The shapes of a wave event (beta 10: Wild Monster Invasion 1 and 2, later
 * Monster Blitzkrieg, Brukkarg War's defence waves and the Christmas winter
 * waves). An event is data: a {@link WaveTable}, its prizes and its art keys
 * ({@link WaveEventDefinition}); the engine (`wavePlan.ts`, `waveFight.ts`,
 * `waveLanding.ts`) is shared by all of them. See `README` in
 * `waveEvents.ts` for how to add one.
 */

/** A group of wild monsters, Flash's `{type: CREEP, wave: [[id, "bounce", count, spread, bearing]], level, powerup, rage}`. */
export interface WaveCreepGroup {
  readonly kind: "creep";
  /** Seconds after the wave starts that it lands. */
  readonly at: number;
  readonly monster: string;
  readonly count: number;
  /** Degrees, Flash's `DIR` (E 0, S 90, W 180, N 270), before the wave's random quarter turn. */
  readonly bearing: number;
  /** Its level, 1-6 (the stat tables clamp it). */
  readonly level: number;
  /** Monster Lab rank 0-3 (Flash's `powerup`); 0 leaves Moloch's fixed ranks for Balthazar and King Wormzer. */
  readonly rank: number;
  /** Seconds it lands enraged (Flash's `rage`: `Enrage(2, 0)`); 0 for none. */
  readonly rage: number;
}

/**
 * A champion raider, Flash's `{type: GUARDIAN, guardianID, level, angle,
 * health, foodbonus}`: 1 Gorgo, 2 Drull, 3 Fomor. Spawned through
 * {@link ChampionSpawner} (raid-core's champion raiders, `RaidEvent.champion`).
 */
export interface WaveChampionGroup {
  readonly kind: "champion";
  readonly at: number;
  readonly guardian: number;
  readonly level: number;
  readonly bearing: number;
  /** Its starting health (Flash's `health`, capped at full). */
  readonly health: number;
  /** Flash's `foodbonus`, 0-3. */
  readonly foodbonus: number;
}

export type WaveGroup = WaveCreepGroup | WaveChampionGroup;

/** One wave: its groups. */
export type WaveDefinition = readonly WaveGroup[];

/** Every wave of an event, wave 1 first (Flash: 30 waves and 2 bonus waves). */
export type WaveTable = readonly WaveDefinition[];

/** One creep group (the generated tables' shorthand). */
export const creep = (at: number, monster: string, count: number, bearing: number, level: number, rank = 0, rage = 0): WaveCreepGroup => ({
  kind: "creep",
  at,
  monster,
  count,
  bearing,
  level,
  rank,
  rage,
});

/** One champion group (the generated tables' shorthand). */
export const champ = (at: number, guardian: number, level: number, bearing: number, health: number, foodbonus = 0): WaveChampionGroup => ({
  kind: "champion",
  at,
  guardian,
  level,
  bearing,
  health,
  foodbonus,
});

/** A prize for a wave beaten: Glimmers (event coins) and the totem's level after it. */
export interface WavePrize {
  readonly glimmers: number;
  /** The totem's level once this wave is beaten, when this wave raises it (Flash's `isMajorWave`); absent otherwise. */
  readonly totemLevel?: number;
}

/**
 * One wave event. Everything the engine, the dashboard, the Events page and
 * the HUD need; nothing else in the code names an event.
 */
export interface WaveEventDefinition {
  /** Stable key, e.g. `wmi1`. A run's id is `<key>-<startsAt>`. Never reuse one. */
  readonly key: string;
  readonly title: string;
  /** One or two short sentences for the Events page. */
  readonly text: string;
  /** Days a run lasts when started from the dashboard (Flash: one week). */
  readonly days: number;
  /**
   * The waves; empty for an event that only borrows the event control and
   * its progress row (Creature Carnage's attack yards, `bruk-port`): such an
   * event has no wave card in Events, and "Next wave" refuses it (`noEvent`).
   */
  readonly waves: WaveTable;
  /** One prize per wave, the same length as {@link waves}. */
  readonly prizes: readonly WavePrize[];
  /** The decoration the event's totem is (WMI1 121, WMI2 131), kept at its level in storage (`decor.ts`). */
  readonly totemType?: number;
  /**
   * Waves from here on are bonus waves (Flash `BONUSWAVE` 31): the HUD says
   * "Bonus" and the wave list hides their armies. 1-based.
   */
  readonly firstBonusWave: number;
  /** Art: the Events card's banner, Modern and Classic (web paths under `/events/`). */
  readonly banner: { readonly modern: string; readonly classic: string };
  /** Who may take part; everyone with the guided start done (Flash gated its pop-ups on that). */
  readonly requires?: { readonly tutorial?: boolean };
}
