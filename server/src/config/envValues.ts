/**
 * Reading on/off switches and numbers from the environment, shared by the
 * config files. (They lived in `BotConfig.ts` until the bot system was
 * removed in beta 9.)
 */

/** Whether a switch is turned on: `on` or `true`, any case; anything else is off. */
export const isSwitchOn = (raw: string | undefined): boolean => {
  const value = raw?.trim().toLowerCase();
  return value === "on" || value === "true";
};

/** A positive number from the environment, or the fallback when absent or not one. */
export const positiveNumber = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw?.trim());
  return raw?.trim() && Number.isFinite(value) && value > 0 ? value : fallback;
};
