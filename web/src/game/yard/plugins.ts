/**
 * Side-effect imports that register every own-yard plugin (issue #227,
 * `yardPlugins.ts`). One file per tutorial package under ./plugins/ so the
 * agents building them in parallel never edit the same file, and one each for
 * the Hatchery walk-out (#228), the achievement unlock pop-up (#204), wild
 * monster raids (#226), events (the Events button, "What's new"), Moloch's
 * cave (the Inferno, WP 1.10), "Korath unlocked" (Inferno WP 5.2) and the
 * owner's announcements, and the one-time "Slow internet?" suggestion.
 * Imported once by YardScene.ts.
 */
import "./plugins/achievements";
import "./plugins/announcements";
import "./plugins/events";
import "./plugins/goals";
import "./plugins/guidedStart";
import "./plugins/hatchWalkOut";
import "./plugins/inferno";
import "./plugins/korath";
import "./plugins/raid";
import "./plugins/slowInternet";
import "./plugins/tips";
