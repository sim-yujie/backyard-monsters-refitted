/**
 * What kind of room a channel is, which decides where its messages are stored
 * and which name form they carry.
 *
 * @enum {string}
 */
export enum ChannelType {
  Alliance = "alliance",
  Global = "global",
  /** A country's room (every country has one): stored and named like Global, joined only from the player's stored country. */
  Country = "country",
}

/**
 * A command published on the chat control channel, telling the gateway to act on
 * a connection rather than deliver a message.
 *
 * @enum {string}
 */
export enum ChatControlType {
  AllianceEvict = "alliance_evict",
  /** The player changed their country: out of the old country room. */
  CountryEvict = "country_evict",
  /** The game team banned the player: tell them and close the connection. */
  Kick = "kick",
  /** The game team warned or muted the player: tell their game to show it. */
  Notice = "notice",
  /** The game team muted (or unmuted) the player: `until` in ms, 0 for none. */
  Mute = "mute",
}
