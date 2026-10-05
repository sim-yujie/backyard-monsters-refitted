/**
 * Whether achievements pay out (`docs/design/achievements.md` §13, issue
 * #204): `ACHIEVEMENT_REWARDS=on` credits each unlock's Shiny and writes its
 * bell line; anything else (the default) holds both back.
 *
 * The server counts and unlocks either way. While rewards are off, an unlock
 * is recorded `unpaid` (`services/achievements/state.ts`): no Shiny, no bell
 * line, no pop-up. The first evaluation after the switch is turned on pays
 * every unpaid unlock once, so nothing earned in the meantime is lost and
 * nothing is paid twice. The switch exists so nothing is paid before the
 * player can see why (the unlock pop-up, WP6, turns it on).
 *
 * Read once at import time, like `OWNER_SAVE_MODE` (`config/OwnerSaveConfig.ts`).
 * The field is writable so tests can flip it.
 */
export interface AchievementConfig {
  rewards: boolean;
}

/** `on` turns rewards on; anything else, or nothing, leaves them off. */
export const parseAchievementRewards = (raw: string | undefined): boolean => raw?.trim().toLowerCase() === "on";

export const achievementConfig: AchievementConfig = {
  rewards: parseAchievementRewards(process.env.ACHIEVEMENT_REWARDS),
};
