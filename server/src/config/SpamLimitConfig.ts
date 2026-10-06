/**
 * Spam limits (issue #323), in one place so they are easy to change.
 *
 * Each is per player and counted over a window of `minutes`. They are
 * set well above what a normal player does in an hour, so only a script or a
 * spammer ever meets them.
 */
export interface SpamLimit {
  readonly max: number;
  readonly minutes: number;
}

export const SPAM_LIMITS = {
  /** Mail sent or replied to (`sendmessage`), a truce request apart. */
  playerMail: { max: 30, minutes: 60 },
  /** Truces proposed, from a yard (`requesttruce`) or in a thread (`sendmessage` "trucerequest"). */
  truceRequest: { max: 20, minutes: 60 },
  /** Mail threads reported (`reportmessagethread`), which also blocks the player. */
  threadReport: { max: 20, minutes: 60 },
  /** Alliances created and edited, counted together. */
  allianceCreateEdit: { max: 10, minutes: 60 },
  /**
   * Lines said in alliance chat. Each is a database write, unlike global chat,
   * and chat runs faster than mail: this is five a minute held for an hour, on
   * top of the one-line-per-half-second throttle every room already has.
   */
  allianceChat: { max: 300, minutes: 60 },
} as const satisfies Record<string, SpamLimit>;

/**
 * Chat socket limits (issue #323). The web client caps a line at 200
 * characters, so its largest message is under 1 KB; its login message is
 * about 100 bytes.
 */
export const CHAT_SOCKET_LIMITS = {
  /** Largest message accepted once logged in; Bun closes the connection above it. */
  maxMessageBytes: 4 * 1024,
  /** Largest message accepted before login; the connection is closed above it. */
  maxUnauthenticatedBytes: 512,
  /** How long a connection may stay open without logging in. */
  authDeadlineMs: 10_000,
} as const;
