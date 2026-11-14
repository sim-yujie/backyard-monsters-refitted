/**
 * Represents the data for an Inferno Map Room neighbour.
 */
export interface NeighbourData {
  userid: number;
  baseid: string;
  level: number;
  username: string;
  attacksto?: number;
  attacksfrom?: number;
  attacksTodayCount: number;
  attacksTodayDate: number;
  helpsto?: number;
  helpsfrom?: number;
  retaliatecount?: number;
  /**
   * Map Room 1: attacks this neighbour made on the list's owner from more
   * than the level gap below, not yet paid back (`v1/mr1AttackRules.ts`).
   * On the wire, what is still owed now (`vengeanceOwed`).
   */
  vengeance?: number;
  /** Map Room 1: unix seconds of this neighbour's last attack on the list's owner. */
  lastattackfrom?: number;
  seentime?: number;
  baseseed?: number;
  attacker?: string;
  friend?: number;
  /** 1 when the viewer pinned this friend (beta 7), else 0. */
  friendpinned?: number;
  saved?: number;
  /**
   * 1 while the neighbour is online and so cannot be attacked, by the rule
   * the attack load applies (#275); `saved` alone is only a presence mark.
   */
  online?: number;
  attackpermitted?: number;
  /** When the neighbour's damage protection ends (unix seconds); 0 without any. */
  protectedUntil?: number;
  basename?: string;
  ownerName?: string;
  pic?: string;
  /**
   * Their uploaded photo's upload number when others may see it, null for
   * the critter (`services/profile/visiblePhoto.ts`); refreshed on each read.
   */
  photo?: number | null;
  trucestate?: string;
  truceexpire?: number;
  destroyed?: number;
  description?: string;
  type?: number;
  wm?: number;
}
