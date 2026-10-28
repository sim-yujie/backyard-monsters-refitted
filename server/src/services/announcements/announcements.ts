import type { EntityManager } from "@mikro-orm/postgresql";

import { sniffImageType, type BugReportImageType } from "../bugReports/bugReportImage.js";

/**
 * In-game announcements (migration `20261028_CreateAnnouncementTables`): the
 * owner writes them on the dashboard (`controllers/announcements/routes.ts`,
 * the admin half), and the game pops up each current one a player has not
 * dismissed, newest first, after their yard loads.
 *
 * - **Text** is plain: a title and words with line breaks. The game and the
 *   dashboard put it on the page as text and turn only `http(s)://` addresses
 *   into links, so nothing the owner types is ever read as HTML.
 * - **Pictures** are JPEG, PNG or WebP bytes in `bym.announcement_image`
 *   (checked by their first bytes, as bug report pictures are), at most
 *   {@link ANNOUNCEMENT_LIMITS.images}. A picture never changes: editing one
 *   out and in again makes a new id, so the game may cache them.
 * - **Current** means published, started (no start time, or a past one) and
 *   not ended. Drafts and pictures of drafts are the dashboard's alone.
 * - **Dismissed** ("Got it") is kept per account, so it does not come back on
 *   another device.
 */

export const ANNOUNCEMENT_LIMITS = {
  titleMax: 80,
  bodyMax: 2000,
  images: 3,
  imageBytesMax: 1_000_000,
  /** The most current announcements a player is sent. */
  playerList: 20,
} as const;

export type AnnouncementStatus = "draft" | "published";

/** A picture in an edit: one already saved (by id), or a new one. */
export type AnnouncementImageInput = { readonly keep: number } | { readonly type: BugReportImageType; readonly bytes: Buffer };

export interface AnnouncementInput {
  readonly title: string;
  readonly body: string;
  readonly status: AnnouncementStatus;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly images: readonly AnnouncementImageInput[];
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;
// Control characters other than tab and line break.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

const cleanText = (raw: unknown): string =>
  typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim() : "";

const positiveId = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;

/** A time from the form: an ISO date, or empty for none. Undefined when it cannot be read. */
const timeOf = (raw: unknown): Date | null | undefined => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms) : undefined;
};

const megabytes = (bytes: number): string => `${Math.round(bytes / 100_000) / 10} MB`;

const imageOf = (raw: unknown, n: number): Parsed<AnnouncementImageInput> => {
  const item = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (item.keep !== undefined) {
    const keep = positiveId(item.keep);
    return keep === null ? { ok: false, message: `Picture ${n} is not right. Reload the page.` } : { ok: true, value: { keep } };
  }
  const value = item.data;
  const tooBig = { ok: false, message: `Picture ${n} is too big. The largest is ${megabytes(ANNOUNCEMENT_LIMITS.imageBytesMax)}.` } as const;
  const notImage = { ok: false, message: `Picture ${n} must be a PNG, JPEG or WebP picture.` } as const;
  if (typeof value !== "string") return notImage;
  // Base64 is 4 characters per 3 bytes: refuse a long one before decoding it.
  if (value.length > Math.ceil(ANNOUNCEMENT_LIMITS.imageBytesMax / 3) * 4 + 64) return tooBig;
  const match = DATA_URL.exec(value);
  if (!match) return notImage;
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length > ANNOUNCEMENT_LIMITS.imageBytesMax) return tooBig;
  const type = sniffImageType(bytes);
  return type ? { ok: true, value: { type, bytes } } : notImage;
};

/**
 * The pictures' list. The server hands a JSON body's arrays on as JSON text
 * (`middleware/jsonBody.ts`), so it is read back here.
 */
const imagesOf = (raw: unknown): unknown => {
  if (raw === undefined || raw === null || raw === "") return [];
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

/**
 * The dashboard's form, checked: `{ title, body, status, startsAt, endsAt,
 * images: [{ keep: id } | { data: "data:image/png;base64,..." }] }`.
 */
export const parseAnnouncement = (body: unknown): Parsed<AnnouncementInput> => {
  const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const title = cleanText(raw.title).replace(/\s+/g, " ");
  if (!title) return { ok: false, message: "Give it a title." };
  if (title.length > ANNOUNCEMENT_LIMITS.titleMax) {
    return { ok: false, message: `Keep the title to ${ANNOUNCEMENT_LIMITS.titleMax} characters.` };
  }
  const text = cleanText(raw.body).replace(/\n{3,}/g, "\n\n");
  if (!text) return { ok: false, message: "Write what it says." };
  if (text.length > ANNOUNCEMENT_LIMITS.bodyMax) {
    return { ok: false, message: `Keep the text to ${ANNOUNCEMENT_LIMITS.bodyMax} characters.` };
  }
  if (raw.status !== "draft" && raw.status !== "published") return { ok: false, message: "Pick Draft or Published." };
  const startsAt = timeOf(raw.startsAt);
  const endsAt = timeOf(raw.endsAt);
  if (startsAt === undefined) return { ok: false, message: "The start time is not a date." };
  if (endsAt === undefined) return { ok: false, message: "The end time is not a date." };
  if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, message: "The end time must be after the start time." };
  const list = imagesOf(raw.images);
  if (!Array.isArray(list)) return { ok: false, message: "The pictures are not right. Reload the page." };
  if (list.length > ANNOUNCEMENT_LIMITS.images) {
    return { ok: false, message: `At most ${ANNOUNCEMENT_LIMITS.images} pictures.` };
  }
  const images: AnnouncementImageInput[] = [];
  for (const [index, item] of list.entries()) {
    const image = imageOf(item, index + 1);
    if (!image.ok) return image;
    images.push(image.value);
  }
  return { ok: true, value: { title, body: text, status: raw.status, startsAt, endsAt, images } };
};

/** What a player is sent about one current announcement. */
export interface PlayerAnnouncement {
  id: number;
  title: string;
  body: string;
  imageIds: number[];
  /** When it became current (its start, or when it was published), ISO. */
  shownFrom: string;
  endsAt: string | null;
  /** Whether this player pressed "Got it" on it. */
  dismissed: boolean;
}

/** What the dashboard shows about one announcement. */
export interface AdminAnnouncement {
  id: number;
  title: string;
  body: string;
  status: AnnouncementStatus;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  imageIds: number[];
  /** Whether players see it now. */
  live: boolean;
  /** How many players pressed "Got it". */
  dismissals: number;
}

const iso = (value: Date | string | null): string | null => (value === null ? null : new Date(value).toISOString());
const ids = (value: (number | string)[] | null): number[] => (value ?? []).map(Number);

/** The SQL test for "players see it now". Takes `[now, now]`. */
const CURRENT = `a.status = 'published' AND (a.starts_at IS NULL OR a.starts_at <= ?) AND (a.ends_at IS NULL OR a.ends_at > ?)`;
const IMAGE_IDS = `coalesce((SELECT array_agg(i.id ORDER BY i.position, i.id) FROM bym.announcement_image i WHERE i.announcement_id = a.id), '{}') AS image_ids`;

/** The current announcements, newest first, each saying whether `userid` dismissed it. */
export const listForPlayer = async (em: EntityManager, userid: number, now: Date): Promise<PlayerAnnouncement[]> => {
  const rows = await em.execute<
    {
      id: string;
      title: string;
      body: string;
      shown_from: Date;
      ends_at: Date | null;
      dismissed: boolean;
      image_ids: (number | string)[] | null;
    }[]
  >(
    `SELECT a.id, a.title, a.body, coalesce(a.starts_at, a.published_at, a.created_at) AS shown_from, a.ends_at,
            EXISTS (SELECT 1 FROM bym.announcement_dismissal d WHERE d.announcement_id = a.id AND d.userid = ?) AS dismissed,
            ${IMAGE_IDS}
       FROM bym.announcement a
      WHERE ${CURRENT}
      ORDER BY shown_from DESC, a.id DESC
      LIMIT ${ANNOUNCEMENT_LIMITS.playerList}`,
    [userid, now, now]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    body: row.body,
    imageIds: ids(row.image_ids),
    shownFrom: iso(row.shown_from)!,
    endsAt: iso(row.ends_at),
    dismissed: Boolean(row.dismissed),
  }));
};

/**
 * Records "Got it" for one player. `notFound` when no current announcement
 * has this id (a draft, an ended one or a deleted one); pressing it twice is
 * fine.
 */
export const dismissForPlayer = async (
  em: EntityManager,
  userid: number,
  id: number,
  now: Date
): Promise<"dismissed" | "notFound"> => {
  const rows = await em.execute<{ id: string }[]>(
    `INSERT INTO bym.announcement_dismissal (userid, announcement_id)
     SELECT ?, a.id FROM bym.announcement a WHERE a.id = ? AND ${CURRENT}
     ON CONFLICT (userid, announcement_id) DO UPDATE SET dismissed_at = bym.announcement_dismissal.dismissed_at
     RETURNING announcement_id AS id`,
    [userid, id, now, now]
  );
  return rows.length > 0 ? "dismissed" : "notFound";
};

/**
 * One picture's bytes, or null. `publishedOnly` is the game's route: a draft's
 * pictures are not served there.
 */
export const getAnnouncementImage = async (
  em: EntityManager,
  id: number,
  publishedOnly: boolean
): Promise<{ bytes: Buffer; type: string } | null> => {
  const [row] = await em.execute<{ bytes: Buffer | Uint8Array; type: string }[]>(
    `SELECT i.bytes, i.type FROM bym.announcement_image i JOIN bym.announcement a ON a.id = i.announcement_id
      WHERE i.id = ?${publishedOnly ? ` AND a.status = 'published'` : ""}`,
    [id]
  );
  return row ? { bytes: Buffer.from(row.bytes), type: row.type } : null;
};

/** Every announcement for the dashboard, newest first. */
export const listForAdmin = async (em: EntityManager, now: Date): Promise<AdminAnnouncement[]> => {
  const rows = await em.execute<
    {
      id: string;
      title: string;
      body: string;
      status: AnnouncementStatus;
      starts_at: Date | null;
      ends_at: Date | null;
      published_at: Date | null;
      created_at: Date;
      updated_at: Date;
      image_ids: (number | string)[] | null;
      live: boolean;
      dismissals: number;
    }[]
  >(
    `SELECT a.id, a.title, a.body, a.status, a.starts_at, a.ends_at, a.published_at, a.created_at, a.updated_at,
            ${IMAGE_IDS},
            (${CURRENT}) AS live,
            (SELECT count(*)::int FROM bym.announcement_dismissal d WHERE d.announcement_id = a.id) AS dismissals
       FROM bym.announcement a
      ORDER BY a.created_at DESC, a.id DESC`,
    [now, now]
  );
  return rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    body: row.body,
    status: row.status,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    publishedAt: iso(row.published_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
    imageIds: ids(row.image_ids),
    live: Boolean(row.live),
    dismissals: Number(row.dismissals),
  }));
};

/** One announcement for the dashboard, or null. */
export const getForAdmin = async (em: EntityManager, id: number, now: Date): Promise<AdminAnnouncement | null> =>
  (await listForAdmin(em, now)).find((a) => a.id === id) ?? null;

/** Saves the pictures of an edit in order: kept ones move, dropped ones go, new ones are added. */
const saveImages = async (
  tx: EntityManager,
  announcementId: number,
  images: readonly AnnouncementImageInput[]
): Promise<"saved" | "badImage"> => {
  const kept = images.flatMap((image) => ("keep" in image ? [image.keep] : []));
  const existing = await tx.execute<{ id: string }[]>(
    `SELECT id FROM bym.announcement_image WHERE announcement_id = ?`,
    [announcementId]
  );
  const have = new Set(existing.map((row) => Number(row.id)));
  if (kept.some((id) => !have.has(id)) || new Set(kept).size !== kept.length) return "badImage";
  const dropped = [...have].filter((id) => !kept.includes(id));
  if (dropped.length > 0) {
    await tx.execute(`DELETE FROM bym.announcement_image WHERE id IN (${dropped.map(() => "?").join(", ")})`, dropped);
  }
  for (const [position, image] of images.entries()) {
    if ("keep" in image) {
      await tx.execute(`UPDATE bym.announcement_image SET position = ? WHERE id = ?`, [position, image.keep]);
    } else {
      await tx.execute(
        `INSERT INTO bym.announcement_image (announcement_id, position, type, bytes) VALUES (?, ?, ?, ?)`,
        [announcementId, position, image.type, image.bytes]
      );
    }
  }
  return "saved";
};

class BadImage extends Error {}

/** Writes a new announcement; its id, or `badImage` when it names a picture it does not have. */
export const createAnnouncement = async (
  em: EntityManager,
  input: AnnouncementInput,
  by: number,
  now: Date
): Promise<number | "badImage"> => {
  try {
    return await em.transactional(async (tx) => {
      const [row] = await tx.execute<{ id: string }[]>(
        `INSERT INTO bym.announcement (title, body, status, starts_at, ends_at, published_at, created_by, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [input.title, input.body, input.status, input.startsAt, input.endsAt, input.status === "published" ? now : null, by, by, now, now]
      );
      const id = Number(row!.id);
      if ((await saveImages(tx, id, input.images)) === "badImage") throw new BadImage();
      return id;
    });
  } catch (error) {
    if (error instanceof BadImage) return "badImage";
    throw error;
  }
};

/** Changes an announcement; `notFound` when there is none, `badImage` as for a new one. */
export const updateAnnouncement = async (
  em: EntityManager,
  id: number,
  input: AnnouncementInput,
  by: number,
  now: Date
): Promise<"saved" | "notFound" | "badImage"> => {
  try {
    return await em.transactional(async (tx) => {
      const rows = await tx.execute<{ id: string }[]>(
        `UPDATE bym.announcement
            SET title = ?, body = ?, status = ?, starts_at = ?, ends_at = ?, updated_by = ?, updated_at = ?,
                published_at = CASE WHEN ? = 'published' THEN coalesce(published_at, ?) ELSE published_at END
          WHERE id = ? RETURNING id`,
        [input.title, input.body, input.status, input.startsAt, input.endsAt, by, now, input.status, now, id]
      );
      if (rows.length === 0) return "notFound" as const;
      if ((await saveImages(tx, id, input.images)) === "badImage") throw new BadImage();
      return "saved" as const;
    });
  } catch (error) {
    if (error instanceof BadImage) return "badImage";
    throw error;
  }
};

/** Deletes an announcement with its pictures and "Got it" records. */
export const deleteAnnouncement = async (em: EntityManager, id: number): Promise<boolean> => {
  const rows = await em.execute<{ id: string }[]>(`DELETE FROM bym.announcement WHERE id = ? RETURNING id`, [id]);
  return rows.length > 0;
};
