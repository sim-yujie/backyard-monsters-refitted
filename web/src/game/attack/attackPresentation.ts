import type { AttackSessionState } from "./AttackSession";

/**
 * What the screen is still showing of an attack the engine has already
 * settled (issue #148).
 *
 * A resource bomb is one event to the engine, applied whole on the tick it is
 * fired, while the battle layer rains it down over a few seconds and lets the
 * buildings lose their health particle by particle (#87). Two things read the
 * battle and should follow the screen rather than the engine: the HUD's
 * damage readout, which would otherwise jump before the particles land, and
 * the end panel, which would otherwise cover a winning bomb before it falls.
 *
 * The battle layer reports here; the scene and the end plugin read. Nothing
 * here reaches the session, the checkpoint or the save: the engine's result
 * is the same either way, only when and how it is shown moves.
 */
export class AttackPresentation {
  private readonly holds = new Set<() => boolean>();
  private damageView: ((state: AttackSessionState) => number) | null = null;

  /**
   * Registers something still playing out while `playing` answers true. The
   * end panel waits for every hold to clear. Returns the release.
   */
  hold(playing: () => boolean): () => void {
    this.holds.add(playing);
    return () => {
      this.holds.delete(playing);
    };
  }

  /** Whether anything on screen is still catching up with the engine. */
  playing(): boolean {
    for (const playing of this.holds) if (playing()) return true;
    return false;
  }

  /**
   * Hands in the damage the screen shows for a session state. Returns the
   * release; the session's own figure is used when none is set.
   */
  showDamageWith(view: (state: AttackSessionState) => number): () => void {
    this.damageView = view;
    return () => {
      if (this.damageView === view) this.damageView = null;
    };
  }

  /**
   * The damage percentage to show: what the screen has visibly applied, never
   * more than the engine's figure.
   */
  damageShown(state: AttackSessionState): number {
    const view = this.damageView;
    return view ? Math.min(state.damagePercent, view(state)) : state.damagePercent;
  }
}
