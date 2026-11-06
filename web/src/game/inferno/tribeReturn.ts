import { INFERNO_YARD, setOwnYardTarget } from "@/game/yard/ownYards";
import { setYardIntent } from "@/game/yard/yardIntent";

/**
 * The way out of a Moloch tribe attack (Inferno WP 2.10): down to the
 * Inferno yard, where Flash went after one (`popup_attackend.End`,
 * `ATTACK.EndB`: `LoadBase(_infBaseURL, ..., "ibuild")`), and, for the map,
 * the Inferno map open over it. The surface's world map is no way out of
 * the Inferno.
 *
 * Asks the next yard screen only; the caller then goes to it.
 */
export const backToInferno = (openMap: boolean): void => {
  setOwnYardTarget(INFERNO_YARD);
  if (openMap) setYardIntent({ kind: "infernoMap" });
};
