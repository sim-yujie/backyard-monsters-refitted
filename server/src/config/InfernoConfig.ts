import { isSwitchOn } from "./BotConfig.js";

/**
 * The Inferno's switch.
 *
 * `enabled` is the new Inferno (`docs/design/inferno.md` §3.1): the cave on
 * the main yard, the emergence raids, and every `/bm/inferno/*` route. Off
 * unless `INFERNO_ENABLED` is `on` (or `true`), so a server turns it on while
 * the Inferno is built and tested, and production waits until it ships. Read
 * on each use, so tests can flip it.
 *
 * The Flash Inferno's routes are gone (Inferno WP 7.1). What is left of it on
 * the shared routes is refused whatever this says
 * (`services/inferno/infernoGate.ts`, `refuseOldInferno`).
 */
export const infernoConfig = {
  /** True turns the new Inferno on (`INFERNO_ENABLED`); off by default. */
  get enabled(): boolean {
    return infernoEnabled();
  },
};

/** Whether the new Inferno is on: `INFERNO_ENABLED` is `on` or `true`. */
export const infernoEnabled = (env: Record<string, string | undefined> = process.env): boolean =>
  isSwitchOn(env.INFERNO_ENABLED);
