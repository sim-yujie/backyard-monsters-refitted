/**
 * A save's `stats` column: Flash's `GLOBAL.StatGet`/`StatSet` store. `other`
 * holds the player's own switches (sound, `services/sound/soundSettings.ts`)
 * and whatever older Flash keys a save still carries (Flash's `wmi_wave`,
 * `wmi2_wave`; the wave events keep their own progress, `bym.event_progress`).
 */
export interface Stats {
  other?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
}
