import type { TrojanApi, TrojanSpringResponse } from "@/api/trojan";

/**
 * Springing the trap from the letter popup (issue #327 WP4,
 * `docs/design/trojan-horse.md` §3.3-§3.4): one call to the server, then the
 * hand-off to the raid scene, which plays the fight the server already
 * fought (`raidSession.ts`'s `setRaidRun`, as a wild raid's `/raid/start`
 * does). Kept apart from the popup and the yard scene so each can be tested
 * without the other: the popup only ever says a button was pressed, the flow
 * only ever asks the server and reports what happened.
 */

export interface TrojanFlowDeps {
  readonly api: Pick<TrojanApi, "spring">;
  /** The server sprang it: play the fight. */
  readonly fight: (response: TrojanSpringResponse) => void;
  /** The server refused it, or could not be reached: a short line for the yard. */
  readonly notice: (message: string) => void;
}

/** Shown while the server is asked, and once it has answered either way. */
export type TrojanFlowState = "idle" | "sending" | "done";

export const TROJAN_SPRING_FAILED = "Could not spring the trap. Try the horse again.";

/**
 * One spring, start to finish. Both letter buttons call {@link spring}; the
 * second call while the first is still out, or after it has settled, is a
 * no-op (issue #327 "done when": "both buttons call the route once").
 */
export class TrojanFlow {
  private state: TrojanFlowState = "idle";

  constructor(private readonly deps: TrojanFlowDeps) {}

  get busy(): boolean {
    return this.state === "sending";
  }

  async spring(): Promise<void> {
    if (this.state !== "idle") return;
    this.state = "sending";
    try {
      const response = await this.deps.api.spring();
      this.state = "done";
      this.deps.fight(response);
    } catch {
      this.state = "idle";
      this.deps.notice(TROJAN_SPRING_FAILED);
    }
  }
}
