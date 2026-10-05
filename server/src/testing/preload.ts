/**
 * Runs before every `bun test` file (`bunfig.toml`).
 *
 * Achievement rewards are on by default (issue #204), but most yard tests
 * drive the action wrapper with a fake entity manager and count Shiny to the
 * coin. Paying an unlock there would write a bell line and move the balance,
 * so the suite starts with rewards off; the achievement tests turn them on
 * themselves (`achievementConfig.rewards = true`). Set here, before any test
 * imports `config/AchievementConfig.ts`, which reads it once.
 */
process.env.ACHIEVEMENT_REWARDS = "off";
