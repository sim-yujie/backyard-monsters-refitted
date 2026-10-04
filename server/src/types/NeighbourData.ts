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
  seentime?: number;
  baseseed?: number;
  attacker?: string;
  friend?: number;
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
  trucestate?: string;
  truceexpire?: number;
  destroyed?: number;
  description?: string;
  type?: number;
  wm?: number;
}
