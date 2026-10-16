import { get } from "./http";
import type { ApiEnvelope, BaseLoadResponse } from "./types";

/**
 * Defence replays (issue #357, `docs/design/defence-replays.md` §6): the
 * attacks other players landed on the player's Map Room 2 main yard, and the
 * battle of each, kept so it can be watched
 * (`server/src/controllers/defences/defences.ts`, issue #360).
 */

/** What the defender lost, whole positive amounts by resource. */
export type DefenceLoot = Readonly<Partial<Record<"r1" | "r2" | "r3" | "r4", number>>>;

/** One defence, as the list and the replay's figures send it. */
export interface Defence {
  readonly id: number;
  /** The attacker's name and picture, frozen when the attack landed. */
  readonly attacker: { readonly name: string; readonly pic: string | null };
  /** Unix seconds: when the attack started, and when it landed. */
  readonly attackedAt: number;
  readonly landedAt: number;
  /** The damage % this attack did (after - before), and the % it left the yard at. */
  readonly damageDone: number;
  readonly damageAfter: number;
  readonly loot: DefenceLoot;
  /** Housed monsters lost with the yard's fallen Housings. */
  readonly housedLost: number;
  /** The attacker left (tab closed, timed out): the server finished it from its checkpoint. */
  readonly left: boolean;
  /** The combat rules it was fought under (the rules MANIFEST's `version`). */
  readonly rulesVersion: string;
  /** Its battle was kept. */
  readonly hasReplay: boolean;
  /** Kept, and fought under the server's own rules; Watch also needs the client's to match. */
  readonly playable: boolean;
}

/** The battle a defence replay holds (`DefenceReplayPayload` on the server, `v: 1`). */
export interface DefenceReplayPayload {
  readonly v: 1;
  /** The attack load the attacker was served, with the yard as the server fought it. */
  readonly load: BaseLoadResponse;
  readonly seed: number;
  /** The fought log's events. */
  readonly events: readonly unknown[];
  /** The tick the server ran the battle to. */
  readonly tick: number;
  /** The attacker's academy levels and Lab ranks as fought. */
  readonly levels: Readonly<Record<string, number>>;
  readonly ranks?: Readonly<Record<string, number>>;
  /** The attacker's champions as fought, without their learned brains. */
  readonly champion?: unknown;
  /** The attacker's siege inventory as fought. */
  readonly siege?: Readonly<Record<string, unknown>> | null;
  readonly declareWar: boolean;
  /** The attack report text. */
  readonly report?: unknown;
}

export interface DefenceReplayResponse extends ApiEnvelope {
  readonly defence: Defence;
  readonly replay: DefenceReplayPayload;
}

/**
 * `GET /api/:apiVersion/defences/:id/replay`: one of the player's own defences with its
 * battle. A `404` is another player's or a missing one; a `410` one kept
 * without its battle.
 */
export const getDefenceReplay = (id: number): Promise<DefenceReplayResponse> =>
  get<DefenceReplayResponse>(`/api/:apiVersion/defences/${encodeURIComponent(String(id))}/replay`);
