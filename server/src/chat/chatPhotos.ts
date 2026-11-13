import { postgres } from "../server.js";
import { visiblePhotos } from "../services/profile/visiblePhoto.js";
import { logger } from "../utils/logger.js";
import type { HistoryEntry } from "./chatProtocol.js";
import type { ChatClient } from "./chatState.js";

/**
 * Players' pictures in chat (owner, 13 Nov 2026: "Possible to put profile
 * icon inside world chat as well?").
 *
 * A line carries its speaker's critter (`picSquare`) and, when others may see
 * it, their uploaded photo's upload number (`photo`). Which photos may be seen
 * is the one rule every list uses (`services/profile/visiblePhoto.ts`): not
 * hidden by reports or waiting for review, not removed or blocked, the player
 * not banned. No visible photo means no `photo` field at all, so a line from a
 * player without one is exactly what it was before.
 *
 * How fast a change reaches chat:
 * - A room's history is read with everyone's photos as they are now, one
 *   query for the whole room, so anyone opening chat or changing room sees
 *   the change at once.
 * - A new line uses the speaker's photo as read at most
 *   {@link CHAT_PHOTO_TTL_MS} ago (one read by primary key a minute, not one
 *   a line).
 * - Lines already on someone's screen keep what they came with until that
 *   player's chat joins the room again (a reload, a reconnect, a room change).
 *   A photo taken down since is refused by its address, so the picture falls
 *   back to the critter whenever it has to be fetched again.
 */

/** How long a speaker's photo, read once, is used for their new lines. */
export const CHAT_PHOTO_TTL_MS = 60_000;

/** Visible photos for some players: the upload number of each who has one. */
export type PhotoReader = (userids: readonly number[]) => Promise<Map<number, number>>;

const readFromDatabase: PhotoReader = (userids) => visiblePhotos(postgres.orm.em.fork(), userids);

/** `entry` with `photo` set to `photo`, or without the field when it is null. */
export const withPhoto = <T extends { photo?: number }>(entry: T, photo: number | null | undefined): T => {
  const { photo: _old, ...rest } = entry;
  return (typeof photo === "number" ? { ...rest, photo } : rest) as T;
};

/**
 * The client's visible photo for a new line: read again when the last read is
 * older than {@link CHAT_PHOTO_TTL_MS}. A failed read keeps the last one known
 * (none at first) and tries again on the next line.
 */
export const speakerPhoto = async (
  client: ChatClient,
  now: number = Date.now(),
  read: PhotoReader = readFromDatabase,
): Promise<number | null> => {
  if (client.photoReadAt !== undefined && now - client.photoReadAt < CHAT_PHOTO_TTL_MS) return client.photo ?? null;
  try {
    const photos = await read([client.userId]);
    client.photo = photos.get(client.userId) ?? null;
    client.photoReadAt = now;
  } catch (err) {
    logger.warn(`Chat: photo of ${client.userId} not read: ${err}`);
  }
  return client.photo ?? null;
};

/**
 * A room's history with every speaker's photo as it is now: one read for the
 * whole room. A failed read leaves the lines without photos (critters) rather
 * than keep the room from opening.
 */
export const withCurrentPhotos = async (
  entries: HistoryEntry[],
  read: PhotoReader = readFromDatabase,
): Promise<HistoryEntry[]> => {
  if (entries.length === 0) return entries;
  let photos: Map<number, number>;
  try {
    photos = await read([...new Set(entries.map((entry) => entry.userId))]);
  } catch (err) {
    logger.warn(`Chat: photos for a room's history not read: ${err}`);
    photos = new Map();
  }
  return entries.map((entry) => withPhoto(entry, photos.get(entry.userId)));
};
