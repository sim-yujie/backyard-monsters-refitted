/**
 * Whether achievements pay out (`docs/design/achievements.md` §13, issue
 * #204): on by default (owner, 2026-10-05), crediting each unlock's Shiny and
 * writing its bell line; `ACHIEVEMENT_REWARDS=off` holds both back.
 *
 * The server counts and unlocks either way. While rewards are off, an unlock
 * is recorded `unpaid` (`services/achievements/state.ts`): no Shiny, no bell
 * line, no pop-up. The first evaluation after the switch is turned on pays
 * every unpaid unlock once, so nothing earned in the meantime is lost and
 * nothing is paid twice. The switch existed so nothing was paid before the
 * player could see why; with the unlock pop-up (WP6) in, it stays as a way
 * to pause payouts.
 *
 * Read once at import time, like `OWNER_SAVE_MODE` (`config/OwnerSaveConfig.ts`).
 * The field is writable so tests can flip it.
 */
export interface AchievementConfig {
  rewards: boolean;
}

/** `off` turns rewards off; anything else, or nothing, leaves them on. */
export const parseAchievementRewards = (raw: string | undefined): boolean => raw?.trim().toLowerCase() !== "off";

export const achievementConfig: AchievementConfig = {
  rewards: parseAchievementRewards(process.env.ACHIEVEMENT_REWARDS),
};
