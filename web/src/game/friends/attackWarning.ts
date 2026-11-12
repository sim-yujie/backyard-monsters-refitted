import type { AttackTarget } from "@/game/attack/attackTarget";
import { friendsStore } from "@/game/friends/friendsStore";
import { confirmAttackOnFriend } from "@/ui/friends/AttackFriendWarning";
import { confirmAttackOnMate, type MateAlliance } from "@/ui/alliance/AttackMateWarning";

/** What the warning needs: whether a player is a friend, and how to ask. */
export interface AttackWarningDeps {
  readonly isFriend: (userid: number) => boolean;
  readonly confirm: (container: HTMLElement, name: string) => Promise<boolean>;
  /** Asks before an attack on an alliance mate (beta 7). */
  readonly confirmMate?: (container: HTMLElement, name: string, alliance: MateAlliance) => Promise<boolean>;
  /** Makes sure the friends list has been fetched (a map screen may not have started the store). */
  readonly ready?: () => Promise<void>;
}

const DEFAULTS: AttackWarningDeps = {
  isFriend: (userid) => friendsStore.isFriend(userid),
  confirm: confirmAttackOnFriend,
  confirmMate: confirmAttackOnMate,
  ready: async () => {
    if (!friendsStore.snapshot.loaded) await friendsStore.refresh().catch(() => undefined);
  },
};

/**
 * Runs `proceed` once the player is happy to attack `target`: at once for a
 * stranger or a wild camp, after an "are you sure?" for a friend (#377) or an
 * alliance mate (beta 7, Flash's "X is in your alliance, attack anyway?").
 * A mate who is also a friend is asked about once, as a mate. Every place
 * that starts an attack on another player's yard goes through this.
 */
export const attackWithFriendWarning = async (
  target: Pick<AttackTarget, "owner" | "name" | "ally">,
  container: HTMLElement,
  proceed: () => void | Promise<void>,
  deps: AttackWarningDeps = DEFAULTS,
): Promise<void> => {
  if (target.ally && deps.confirmMate) {
    if (!(await deps.confirmMate(container, target.name, target.ally))) return;
    await proceed();
    return;
  }
  if (target.owner !== undefined) await deps.ready?.();
  if (target.owner !== undefined && deps.isFriend(target.owner)) {
    if (!(await deps.confirm(container, target.name))) return;
  }
  await proceed();
};
