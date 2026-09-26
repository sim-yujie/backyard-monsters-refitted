/**
 * Attack-scene plugin for the "army" work package (issue #32, WP3).
 *
 * Mounts the {@link ArmyPanel} over the session's {@link Bucket} into the dock.
 * On a phone the dock is a bottom sheet, so whenever the panel's box changes
 * size the whole sheet is re-measured and reported through `setBottomInset`,
 * the way the scene itself measures it on resize; on a desktop the dock is a
 * side column and covers nothing, so nothing is reported.
 */
import { ATTACK_PLUGINS, type AttackPlugin } from "@/app/scenes/AttackScene";
import { bucketFor } from "@/game/attack/bucket";
import { ArmyPanel } from "@/ui/attack/ArmyPanel";

const plugin: AttackPlugin = (mounts) => {
  const bucket = bucketFor(mounts.session);
  const sheet = mounts.dock.closest<HTMLElement>(".attack-dock");
  const report = (): void => {
    if (!sheet || !sheet.classList.contains("attack-dock--sheet")) return;
    mounts.setBottomInset(sheet.getBoundingClientRect().height);
  };
  const panel = new ArmyPanel(bucket, { onResize: report }).mount(mounts.dock);
  return () => {
    panel.destroy();
  };
};

ATTACK_PLUGINS.push(plugin);
