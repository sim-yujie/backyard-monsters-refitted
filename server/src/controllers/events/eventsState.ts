import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import type { User } from "../../database/models/user.model.js";
import { eventView, type EventView } from "../../services/events/eventViews.js";
import type { EventProgressStore } from "../../services/events/progressStore.js";
import { visibleEvents } from "../../services/events/schedule.js";
import { logger } from "../../utils/logger.js";

/**
 * The Events page's reads, and the "What's new" screen's record:
 *
 * - `GET /bm/events`: the server's clock (`now`, so countdowns are right
 *   whatever the device's clock says), every event on now or starting within
 *   30 days with the player's progress (`services/events/eventViews.ts`),
 *   and the last "What's new" release the player has seen. Claims are yard
 *   actions (`controllers/yard/events.ts`).
 * - `POST /bm/whatsnew/seen { version }`: records that the player has seen
 *   the "What's new" cards up to `version` (a release name such as
 *   `2.0.0-beta.4`), so they pop up once per release on any device.
 *
 * The seen release is `bym.user.whatsnew_seen` (migration
 * `20261020_CreateEventProgressTable.ts`), read and written in raw SQL and
 * forgiving: if it cannot be read the answer says null and the client falls
 * back to what the device remembers.
 */

export interface EventsBody {
  error: 0;
  now: number;
  events: EventView[];
  whatsNewSeen: string | null;
}

export const WhatsNewSeenSchema = z.object({
  version: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[0-9A-Za-z.+-]+$/),
});

/** The release the player last saw, or null (none yet, or not readable). */
export const readWhatsNewSeen = async (em: EntityManager, userid: number): Promise<string | null> => {
  try {
    const [row] = await em.execute<{ whatsnew_seen: string | null }[]>(
      `SELECT whatsnew_seen FROM bym."user" WHERE userid = ?`,
      [userid]
    );
    return row?.whatsnew_seen ?? null;
  } catch (error) {
    logger.warn("Could not read whatsnew_seen for {userid}: {error}", { userid, error: String(error) });
    return null;
  }
};

/** `GET /bm/events`. */
export const eventsAnswer = async (
  em: EntityManager,
  store: EventProgressStore,
  user: User,
  now: number
): Promise<EventsBody> => {
  const shown = visibleEvents(now);
  const [progress, whatsNewSeen] = await Promise.all([
    store.read(
      em,
      user.userid,
      shown.map((one) => one.event.id)
    ),
    readWhatsNewSeen(em, user.userid),
  ]);
  return {
    error: 0,
    now,
    events: shown.map((one) => eventView(one, progress.get(one.event.id), now)),
    whatsNewSeen,
  };
};

/** `POST /bm/whatsnew/seen`. */
export const whatsNewSeenAnswer = async (
  em: EntityManager,
  user: User,
  body: unknown
): Promise<{ error: 0; version: string }> => {
  const { version } = WhatsNewSeenSchema.parse(body);
  await em.execute(`UPDATE bym."user" SET whatsnew_seen = ? WHERE userid = ?`, [version, user.userid]);
  return { error: 0, version };
};
