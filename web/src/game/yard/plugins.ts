/**
 * Side-effect imports that register every own-yard plugin (issue #227,
 * `yardPlugins.ts`). One file per tutorial package under ./plugins/ so the
 * agents building them in parallel never edit the same file, and one each for
 * the Hatchery walk-out (#228), the achievement unlock pop-up (#204) and wild
 * monster raids (#226). Imported once by YardScene.ts.
 */
import "./plugins/achievements";
import "./plugins/goals";
import "./plugins/guidedStart";
import "./plugins/hatchWalkOut";
import "./plugins/raid";
import "./plugins/tips";
