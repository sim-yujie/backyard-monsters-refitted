import type { AttackTarget } from "@/game/attack/attackTarget";
import { friendsStore } from "@/game/friends/friendsStore";
import { confirmAttackOnFriend } from "@/ui/friends/AttackFriendWarning";

/** The two things the warning needs: whether a player is a friend, and how to ask. */
export interface AttackWarningDeps {
  readonly isFriend: (userid: number) => boolean;
  readonly confirm: (container: HTMLElement, name: string) => Promise<boolean>;
  /** Makes sure the friends list has been fetched (a map screen may not have started the store). */
  readonly ready?: () => Promise<void>;
}

const DEFAULTS: AttackWarningDeps = {
  isFriend: (userid) => friendsStore.isFriend(userid),
  confirm: confirmAttackOnFriend,
  ready: async () => {
    if (!friendsStore.snapshot.loaded) await friendsStore.refresh().catch(() => undefined);
  },
};

/**
 * Runs `proceed` once the player is happy to attack `target`: at once for a
 * stranger or a wild camp, after an "are you sure?" for a friend (#377). Every
 * place that starts an attack on another player's yard goes through this.
 */
export const attackWithFriendWarning = async (
  target: Pick<AttackTarget, "owner" | "name">,
  container: HTMLElement,
  proceed: () => void | Promise<void>,
  deps: AttackWarningDeps = DEFAULTS,
): Promise<void> => {
  if (target.owner !== undefined) await deps.ready?.();
  if (target.owner !== undefined && deps.isFriend(target.owner)) {
    if (!(await deps.confirm(container, target.name))) return;
  }
  await proceed();
};
