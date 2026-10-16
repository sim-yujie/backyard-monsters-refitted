import type { Defence, DefenceReplayPayload } from "@/api/defences";
import type { DefenceWatch } from "./defenceWatch";

/**
 * The stored defence replay the tests and the dev hook play
 * (`web/test/fixtures/defence-replay-mixed-waves.json`, issue #362): the
 * sandbox yard attacked as `combat/mixed-waves.json` attacks it, with the
 * figures the server's own replay of it gives, as WP2 stores them, and the
 * same attack landed by the finaliser from a checkpoint (`left`).
 */
export interface DefenceReplayFixture {
  readonly defence: Defence;
  /** The server's replay: the tick it ran to, its damage and building health. */
  readonly server: {
    readonly tick: number;
    readonly damage: number;
    readonly buildinghealthdata: Readonly<Record<string, number>>;
  };
  readonly replay: DefenceReplayPayload;
  /** The attack left at `tick`: only the events up to it, run to it. */
  readonly left: {
    readonly tick: number;
    readonly defence: Defence;
    readonly server: DefenceReplayFixture["server"];
  };
}

/** The fixture's run, or its `left` variant, fought under `rulesVersion`. */
export const fixtureRun = (
  fixture: DefenceReplayFixture,
  options: { readonly left?: boolean; readonly rulesVersion?: string } = {},
): DefenceWatch => {
  const defence = options.left ? fixture.left.defence : fixture.defence;
  const replay = options.left
    ? {
        ...fixture.replay,
        tick: fixture.left.tick,
        events: fixture.replay.events.filter((event) => (event as { t: number }).t <= fixture.left.tick),
      }
    : fixture.replay;
  return {
    kind: "defence",
    defence: { ...defence, ...(options.rulesVersion === undefined ? {} : { rulesVersion: options.rulesVersion }) },
    replay,
  };
};
