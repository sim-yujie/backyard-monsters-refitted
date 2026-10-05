/**
 * Attack-scene plugin for the "army" work package (issue #32, WP3).
 *
 * Mounts the {@link ArmyPanel} over the session's {@link Bucket} into the dock.
 * On a phone the dock is a bottom sheet, so whenever the panel's box changes
 * size the whole sheet is re-measured and reported through `setBottomInset`,
 * the way the scene itself measures it on resize; on a desktop the dock is a
 * side column and covers nothing, so nothing is reported.
 *
 * The Monster Baiter's test screen mounts the same panel in its test flavour
 * ({@link testArmyPlugin}, issue #22 WP3): the army is made up, so nothing of
 * it is kept — no last army in `localStorage` and no Mode saved on a
 * champion.
 */
import { championStance } from "@/api/yardChampion";
import { ATTACK_PLUGINS, type AttackPlugin } from "@/game/attack/attackPlugins";
import { bucketFor, type BucketOptions } from "@/game/attack/bucket";
import type { ChampionStance } from "@/game/combat/rules";
import { ArmyPanel } from "@/ui/attack/ArmyPanel";

/** How the drop and army packages differ on a Baiter test (#22, WP3). */
export interface TestFlavour {
  /** A made-up army: keep no last army and save no champion's Mode. */
  readonly test?: boolean;
}

/** The bucket options of a flavour; the drop package passes the same ones. */
export const bucketOptionsOf = (flavour: TestFlavour): BucketOptions | undefined =>
  flavour.test ? { storage: null } : undefined;

/** The army package, in a real attack's flavour or a Baiter test's. */
export const createArmyPlugin =
  (flavour: TestFlavour = {}): AttackPlugin =>
  (mounts) => {
    const bucket = bucketFor(mounts.session, bucketOptionsOf(flavour));
    const sheet = mounts.dock.closest<HTMLElement>(".attack-dock");
    const report = (): void => {
      if (!sheet || !sheet.classList.contains("attack-dock--sheet")) return;
      mounts.setBottomInset(sheet.getBoundingClientRect().height);
    };
    const session = mounts.session;
    const panel = new ArmyPanel(bucket, {
      onResize: report,
      // The champion row's Retreat (issue #222).
      onRetreatChampion: (t) => {
        session.retreatChampion(t);
      },
      // Remembered on the champion's save entry for the next attack (issue
      // #220). Only a preference: this attack's fling carries the Mode itself,
      // so a failed save costs nothing but the memory. A test champion is
      // made up, so there is nothing to remember it on.
      ...(flavour.test
        ? {}
        : {
            onStanceChange: (t: number, stance: ChampionStance) => {
              championStance(t, stance).catch(() => {});
            },
          }),
    }).mount(mounts.dock);
    panel.setChampionsOnField(session.state().championsOnField);
    const unsubscribe = session.subscribe((state) => panel.setChampionsOnField(state.championsOnField));
    return () => {
      unsubscribe();
      panel.destroy();
    };
  };

/** A real attack's army package. */
export const armyPlugin: AttackPlugin = createArmyPlugin();

/** The Baiter test's army package: the same panel, nothing kept. */
export const testArmyPlugin: AttackPlugin = createArmyPlugin({ test: true });

ATTACK_PLUGINS.push(armyPlugin);
