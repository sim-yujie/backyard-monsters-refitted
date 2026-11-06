/**
 * Word that the server juiced some monsters (`api/yardJuice.ts`), for the yard
 * to show them walking into the Juicer (`game/yard/juicerShow.ts`). The goo is
 * already banked when this goes out: listeners only draw.
 */
export interface JuicedNews {
  /** The Juicer that did it, by building id. */
  readonly juicer: number;
  readonly level: number;
  /** Monsters juiced, by id. */
  readonly monsters: Readonly<Record<string, number>>;
  /** One of each's hatch cost at its academy level (Flash's `_goo`). */
  readonly hatchCost: Readonly<Record<string, number>>;
  /** The Juicer's rate, goo per unit of hatch cost. */
  readonly rate: number;
}

type Listener = (news: JuicedNews) => void;

const listeners = new Set<Listener>();

/** Hears every juice from now on; call the returned function to stop. */
export const onJuiced = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Tells every listener; one that throws does not stop the rest. */
export const announceJuiced = (news: JuicedNews): void => {
  for (const listener of [...listeners]) {
    try {
      listener(news);
    } catch (error) {
      console.error("juice listener failed", error);
    }
  }
};
