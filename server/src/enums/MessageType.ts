/**
 * Enum representing the types of messages that can be sent between players.
 * @enum {string}
 */
export enum MessageType {
  MESSAGE = "message",
  TRUCE_REQUEST = "trucerequest",
  TRUCE_ACCEPT = "truceaccept",
  TRUCE_REJECT = "trucereject",
  MIGRATE_REQUEST = "migraterequest",
  MIGRATE_REVOKE = "migraterevoke",
  /**
   * An alliance invite, written by the server when a Leader or Officer invites
   * a player (`services/alliance/inviteMail.ts`). Players cannot send it
   * themselves: it is not in `allowedMessageType`.
   */
  ALLIANCE_INVITE = "allianceinvite",
}
