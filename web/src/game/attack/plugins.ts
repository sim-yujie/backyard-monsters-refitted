/**
 * Side-effect imports that register every attack-scene plugin (issue #32).
 * One file per work package under ./plugins/ so agents working in parallel
 * never edit the same file. Imported once by AttackScene.ts.
 */
import "./plugins/army";
import "./plugins/drop";
import "./plugins/battle";
import "./plugins/end";
