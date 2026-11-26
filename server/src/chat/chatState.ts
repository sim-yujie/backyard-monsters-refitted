import type { ChannelType } from "../enums/Chat.js";

type ServerWebSocket<T> = import("bun").ServerWebSocket<T>;

/**
 * What Bun stores on the socket itself, which is only enough to find the
 * client's ChatClient and to answer before authentication completes.
 */
export interface SocketData {
  userId: number | null;
  displayName: string;
  lastMsgAt: number;
  /** Closes the connection if it has not logged in in time (`chatLimits.ts`). */
  loginDeadline?: ReturnType<typeof setTimeout> | null;
  /** When this socket's last presence ping was taken, ms (`chatPresence.ts`). */
  lastPresenceAt?: number;
  /** Set once the socket signed in as the live map, not chat (`liveGateway.ts`, beta 9). */
  live?: import("./liveGateway.js").LiveSocket;
}

/**
 * What kind of room a channel is, carried alongside the key so nothing has to
 * parse an alliance id back out of the channel string.
 */
export type ChannelInfo =
  | { type: ChannelType.Alliance; allianceId: number }
  | { type: ChannelType.Global }
  | { type: ChannelType.Country; country: string };

/** An authenticated connection and every channel it currently holds. */
export interface ChatClient {
  ws: ServerWebSocket<SocketData>;
  userId: number;
  displayName: string;
  username: string;
  picSquare: string | null;
  /** Their visible photo's upload number as last read (`chatPhotos.ts`); null or absent for none. */
  photo?: number | null;
  /** When `photo` was read (ms); absent before the first read. */
  photoReadAt?: number;
  channels: Map<string, ChannelInfo>;
  lastMsgAt: number;
  /** One of `ADMIN_USER_IDS`: their lines carry the game team's mark (`gm`). */
  gm?: boolean;
  /** No lines accepted before this time (ms since the epoch); 0 or absent when not muted. */
  mutedUntil?: number;
  /**
   * When their main yard was made (ms), read at sign-in: the chat filter
   * treats them as new while it is younger than three days. Null: no main
   * yard (new); absent: not read (a test client), counted as not new.
   */
  yardCreatedAt?: number | null;
}

/**
 * The two registries every other module in the subsystem layers on top of.
 *
 * They live in a module with no dependencies of its own deliberately. Local
 * fan-out needs both maps, and joining a channel needs channelMembers plus the
 * Redis subscription — so if either registry lived beside the code that used
 * it, transport and rooms would have to import each other.
 */
export const clients = new Map<number, ChatClient>();
export const channelMembers = new Map<string, Set<number>>();
