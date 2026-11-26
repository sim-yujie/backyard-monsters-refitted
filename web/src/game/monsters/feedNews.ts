/**
 * Word that the server fed the champion some monsters (`api/yardChampion.ts`
 * `feed`), for the yard to show them walking into the champion and bursting
 * (`game/yard/feedShow.ts`). The feed is already done when this goes out:
 * listeners only draw. A Shiny feed eats no monsters and sends no word, as in
 * Flash, where only a monster feed sent creatures over (`CHAMPIONCAGE.as:819-843`).
 */
export interface FedNews {
  /** The champion that ate, `G1`..`G5` (`G` and its `t`). */
  readonly champion: string;
  /** Monsters eaten, by id. */
  readonly monsters: Readonly<Record<string, number>>;
  /** One of each's hatch cost at its academy level (Flash's `_goo`). */
  readonly hatchCost: Readonly<Record<string, number>>;
}

type Listener = (news: FedNews) => void;

const listeners = new Set<Listener>();

/** Hears every monster feed from now on; call the returned function to stop. */
export const onFed = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Tells every listener; one that throws does not stop the rest. */
export const announceFed = (news: FedNews): void => {
  for (const listener of [...listeners]) {
    try {
      listener(news);
    } catch (error) {
      console.error("feed listener failed", error);
    }
  }
};
