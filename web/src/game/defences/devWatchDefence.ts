import type { DefenceReplayResponse } from "@/api/defences";
import { fixtureRun, type DefenceReplayFixture } from "./defenceFixture";
import { CLIENT_RULES_VERSION, defenceWatchOf, type DefenceWatch } from "./defenceWatch";

/**
 * Development only (issue #362): a defence replay to open on the watch scene
 * without a server, for a look or a recording. App hangs it off the page as
 * `__defenceReplay.watch()`:
 *
 *     __defenceReplay.watch()               // the stored fixture, played to its end
 *     __defenceReplay.watch({ left: true }) // the same attack, left at 2:30
 *     __defenceReplay.watch({ answer })     // any `GET defences/:id/replay` answer
 *
 * The fixture is played under this bundle's rules version, so it still opens
 * after a rules change (a changed outcome then logs `defence-replay-drift`).
 * An answer is checked as the Defences screen will check it.
 */
export interface DevDefenceOptions {
  readonly left?: boolean;
  readonly answer?: Pick<DefenceReplayResponse, "defence" | "replay">;
}

export const devDefenceRun = async (options: DevDefenceOptions = {}): Promise<DefenceWatch> => {
  if (options.answer) {
    const checked = defenceWatchOf(options.answer);
    if ("refusal" in checked) throw new Error(`Defence replay refused: ${checked.refusal}`);
    return checked.run;
  }
  const fixture = (await import("../../../test/fixtures/defence-replay-mixed-waves.json"))
    .default as unknown as DefenceReplayFixture;
  return fixtureRun(fixture, { left: options.left ?? false, rulesVersion: CLIENT_RULES_VERSION });
};
