import type { EntityManager } from "@mikro-orm/postgresql";

import { playerAchievementsAnswer } from "../../controllers/achievements/player.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import { logger } from "../../utils/logger.js";
import {
  AUTO_HIDE_REPORTS,
  PHOTO_CHANGE_MS,
  PHOTO_MIN_LEVEL,
  uploadGate,
  type UploadRefusal,
} from "./profileRules.js";
import { visiblePhotoVersion, visiblePhotoWhere } from "./visiblePhoto.js";

/**
 * Player profiles (beta 7, owner 6 Nov 2026, grill Q27-28): what a profile
 * shows, the bio and photo writes, and "Report inappropriate image". The
 * rules are in `profileRules.ts`, the photo's re-encoding in `photo.ts`, the
 * owner's review in `services/admin/photoReports.ts`; the tables are made by
 * `20261112_CreatePlayerProfile.ts`. Every query is raw SQL so the photo's
 * bytes are only ever read by the one route that sends them.
 */

export interface ProfileStats {
  level: number;
  /** The main yard's Town Hall level; 0 when unknown. */
  townHall: number;
  empirePoints: number;
  /** Null when it could not be worked out (the profile still opens). */
  achievements: { earned: number; total: number } | null;
  friends: number;
  /** When their main yard was made (ISO); null when unknown. */
  joined: string | null;
  alliance: string | null;
}

/** What the player themself sees about their photo. */
export interface OwnPhotoState {
  /** Hidden by reports until the owner looks. */
  hidden: boolean;
  blocked: boolean;
  canUpload: boolean;
  /** Why not, when `canUpload` is false. */
  reason: UploadRefusal | null;
  /** When the next upload is allowed (ISO), for `tooSoon`. */
  nextAt: string | null;
  minLevel: number;
}

export interface ProfileView {
  userid: number;
  username: string;
  /** `pic_square`: their critter, the picture when there is no photo. */
  pic: string | null;
  bio: string;
  /** The photo's upload number for its address; null when there is none to show. */
  photoVersion: number | null;
  stats: ProfileStats;
  own: boolean;
  /** The viewer already reported this photo. */
  reported: boolean;
  /** Only on the player's own profile. */
  photoState: OwnPhotoState | null;
}

interface ProfileRow {
  userid: number | string;
  username: string;
  pic_square: string | null;
  banned: boolean;
  points: string | null;
  basevalue: string | null;
  thlevel: number | null;
  empirepoints: number | string | null;
  joined: Date | string | null;
  alliance: string | null;
  friends: number | string;
  bio: string | null;
  photo_version: number | null;
  has_photo: boolean | null;
  photo_hidden: boolean | null;
  photo_at: Date | string | null;
  upload_blocked: boolean | null;
}

const asDate = (value: Date | string | null): Date | null => (value === null ? null : new Date(value));

const levelOf = (row: { points: string | null; basevalue: string | null }): number =>
  row.points === null && row.basevalue === null ? 1 : calculateBaseLevel(row.points ?? "0", row.basevalue ?? "0");

/** A player's level, from their main yard; null for no such player. */
export const playerLevel = async (em: EntityManager, userid: number): Promise<number | null> => {
  const [row] = await em.execute<{ points: string | null; basevalue: string | null }[]>(
    `SELECT s.points, s.basevalue FROM bym."user" u LEFT JOIN bym.save s ON s.basesaveid = u.save_basesaveid WHERE u.userid = ?`,
    [userid],
  );
  return row ? levelOf(row) : null;
};

const achievementsOf = async (em: EntityManager, userid: number, now: Date): Promise<ProfileStats["achievements"]> => {
  try {
    const answer = await playerAchievementsAnswer(em, { userid }, Math.floor(now.getTime() / 1000));
    const { earned, total } = answer.body as { earned?: unknown; total?: unknown };
    return typeof earned === "number" && typeof total === "number" ? { earned, total } : null;
  } catch (error) {
    logger.warn(`Profiles: achievements of ${userid} could not be read: ${String(error)}`);
    return null;
  }
};

/**
 * One player's profile as `viewer` sees it, or null for no such player (or a
 * banned one).
 */
export const readProfile = async (
  em: EntityManager,
  viewer: number,
  userid: number,
  now: Date = new Date(),
): Promise<ProfileView | null> => {
  const [row] = await em.execute<ProfileRow[]>(
    `SELECT u.userid, u.username, u.pic_square, u.banned,
            s.points, s.basevalue, s.thlevel, s.empirepoints, s.created_at AS joined,
            a.name AS alliance,
            (SELECT count(*) FROM bym.friend f WHERE f.userid = u.userid) AS friends,
            p.bio, p.photo_version, (p.photo IS NOT NULL) AS has_photo, p.photo_hidden, p.photo_at, p.upload_blocked
       FROM bym."user" u
       LEFT JOIN bym.save s ON s.basesaveid = u.save_basesaveid
       LEFT JOIN bym.alliance a ON a.id = u.alliance_id
       LEFT JOIN bym.player_profile p ON p.userid = u.userid
      WHERE u.userid = ?`,
    [userid],
  );
  if (!row || row.banned) return null;

  const own = viewer === userid;
  const level = levelOf(row);
  const hidden = row.photo_hidden === true;
  // The same rule every list that shows this player's picture uses.
  const visible = visiblePhotoVersion(row);
  const showPhoto = visible !== null;
  const version = row.photo_version ?? 0;

  let reported = false;
  if (!own && showPhoto) {
    const [mine] = await em.execute<{ n: number | string }[]>(
      `SELECT count(*) AS n FROM bym.photo_report WHERE reporter_id = ? AND reported_id = ? AND photo_version = ?`,
      [viewer, userid, version],
    );
    reported = Number(mine?.n ?? 0) > 0;
  }

  let photoState: OwnPhotoState | null = null;
  if (own) {
    const gate = uploadGate({
      level,
      blocked: row.upload_blocked === true,
      underReview: hidden && row.has_photo === true,
      lastAt: asDate(row.photo_at),
      now,
    });
    photoState = {
      hidden: hidden && row.has_photo === true,
      blocked: row.upload_blocked === true,
      canUpload: gate.ok,
      reason: gate.ok ? null : gate.reason,
      nextAt: !gate.ok && gate.nextAt ? gate.nextAt.toISOString() : null,
      minLevel: PHOTO_MIN_LEVEL,
    };
  }

  const joined = asDate(row.joined);
  return {
    userid: Number(row.userid),
    username: row.username,
    pic: row.pic_square ?? null,
    bio: row.bio ?? "",
    photoVersion: visible,
    stats: {
      level,
      townHall: Number(row.thlevel ?? 0),
      empirePoints: Number(row.empirepoints ?? 0),
      achievements: await achievementsOf(em, userid, now),
      friends: Number(row.friends),
      joined: joined && !Number.isNaN(joined.getTime()) ? joined.toISOString() : null,
      alliance: row.alliance ?? null,
    },
    own,
    reported,
    photoState,
  };
};

/** Stores a bio (already checked by `checkBio`). */
export const saveBio = async (em: EntityManager, userid: number, bio: string): Promise<void> => {
  await em.execute(
    `INSERT INTO bym.player_profile (userid, bio, photo_version, photo_hidden, upload_blocked, updated_at)
     VALUES (?, ?, 0, false, false, now())
     ON CONFLICT (userid) DO UPDATE SET bio = EXCLUDED.bio, updated_at = now()`,
    [userid, bio],
  );
};

export type SavePhotoResult =
  | { outcome: "saved"; version: number }
  | { outcome: "refused"; reason: UploadRefusal; nextAt?: Date };

/**
 * Stores a new photo (the server's own 128x128 JPEG from `processPhoto`) in
 * place of the old one. The rules are checked again inside the write, so two
 * uploads at once cannot both get in. Reports of the old photo that were not
 * enough to hide it are closed as `replaced`.
 */
export const savePhoto = async (
  em: EntityManager,
  userid: number,
  bytes: Buffer,
  now: Date = new Date(),
): Promise<SavePhotoResult> => {
  const level = await playerLevel(em, userid);
  if (level === null) return { outcome: "refused", reason: "blocked" };
  const [current] = await em.execute<
    { upload_blocked: boolean; photo_hidden: boolean; has_photo: boolean; photo_at: Date | string | null }[]
  >(
    `SELECT upload_blocked, photo_hidden, (photo IS NOT NULL) AS has_photo, photo_at FROM bym.player_profile WHERE userid = ?`,
    [userid],
  );
  const gate = uploadGate({
    level,
    blocked: current?.upload_blocked === true,
    underReview: current?.photo_hidden === true && current.has_photo === true,
    lastAt: asDate(current?.photo_at ?? null),
    now,
  });
  if (!gate.ok) return { outcome: "refused", reason: gate.reason, ...(gate.nextAt && { nextAt: gate.nextAt }) };

  const dayAgo = new Date(now.getTime() - PHOTO_CHANGE_MS);
  const rows = await em.execute<{ photo_version: number }[]>(
    `INSERT INTO bym.player_profile (userid, bio, photo, photo_version, photo_at, photo_hidden, upload_blocked, updated_at)
     VALUES (?, '', ?, 1, ?, false, false, now())
     ON CONFLICT (userid) DO UPDATE
        SET photo = EXCLUDED.photo,
            photo_version = player_profile.photo_version + 1,
            photo_at = EXCLUDED.photo_at,
            photo_hidden = false,
            photo_kept_version = NULL,
            updated_at = now()
      WHERE player_profile.upload_blocked = false
        AND NOT (player_profile.photo_hidden AND player_profile.photo IS NOT NULL)
        AND (player_profile.photo_at IS NULL OR player_profile.photo_at <= ?)
     RETURNING photo_version`,
    [userid, bytes, now, dayAgo],
  );
  const saved = rows[0];
  if (!saved) {
    return { outcome: "refused", reason: "tooSoon", nextAt: new Date(now.getTime() + PHOTO_CHANGE_MS) };
  }
  await em.execute(
    `UPDATE bym.photo_report SET resolved_at = ?, outcome = 'replaced'
      WHERE reported_id = ? AND resolved_at IS NULL AND photo_version < ?`,
    [now, userid, saved.photo_version],
  );
  return { outcome: "saved", version: Number(saved.photo_version) };
};

/**
 * Takes the player's own photo down; their critter shows again. The day's
 * upload is still used up, and reports stay open for the owner.
 */
export const removeOwnPhoto = async (em: EntityManager, userid: number): Promise<void> => {
  await em.execute(
    `UPDATE bym.player_profile SET photo = NULL, photo_hidden = false, updated_at = now() WHERE userid = ?`,
    [userid],
  );
};

export type ReportOutcome = "reported" | "already" | "noPhoto" | "self" | "notFound";

/**
 * One player's report of another's photo. The photo is hidden once
 * {@link AUTO_HIDE_REPORTS} different players have reported the same upload
 * and it is not one the owner already looked at and kept.
 */
export const reportPhoto = async (
  em: EntityManager,
  reporter: number,
  reported: number,
  now: Date = new Date(),
): Promise<{ outcome: ReportOutcome; hidden: boolean }> => {
  if (reporter === reported) return { outcome: "self", hidden: false };
  const [profile] = await em.execute<
    { photo_version: number; has_photo: boolean; photo_hidden: boolean; photo_kept_version: number | null; banned: boolean }[]
  >(
    `SELECT p.photo_version, (p.photo IS NOT NULL) AS has_photo, p.photo_hidden, p.photo_kept_version, u.banned
       FROM bym."user" u LEFT JOIN bym.player_profile p ON p.userid = u.userid WHERE u.userid = ?`,
    [reported],
  );
  if (!profile || profile.banned) return { outcome: "notFound", hidden: false };
  if (!profile.has_photo || profile.photo_hidden) return { outcome: "noPhoto", hidden: profile.photo_hidden === true };

  const version = Number(profile.photo_version);
  const inserted = await em.execute<{ id: number }[]>(
    `INSERT INTO bym.photo_report (reporter_id, reported_id, photo_version, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
    [reporter, reported, version, now],
  );
  if (!inserted[0]) return { outcome: "already", hidden: false };

  if (profile.photo_kept_version !== null && Number(profile.photo_kept_version) === version) {
    return { outcome: "reported", hidden: false };
  }
  const [open] = await em.execute<{ n: number | string }[]>(
    `SELECT count(DISTINCT reporter_id) AS n FROM bym.photo_report
      WHERE reported_id = ? AND photo_version = ? AND resolved_at IS NULL`,
    [reported, version],
  );
  if (Number(open?.n ?? 0) < AUTO_HIDE_REPORTS) return { outcome: "reported", hidden: false };

  const hidden = await em.execute<{ userid: number }[]>(
    `UPDATE bym.player_profile SET photo_hidden = true, updated_at = now()
      WHERE userid = ? AND photo_version = ? AND photo IS NOT NULL AND photo_hidden = false
        AND (photo_kept_version IS NULL OR photo_kept_version <> photo_version)
      RETURNING userid`,
    [reported, version],
  );
  if (hidden[0]) logger.info(`Profiles: photo of ${reported} hidden after ${AUTO_HIDE_REPORTS} reports`);
  return { outcome: "reported", hidden: true };
};

/** A photo's bytes for its public address, or null when there is none to show (or it is hidden). */
export const readPhoto = async (em: EntityManager, userid: number): Promise<Buffer | null> => {
  const [row] = await em.execute<{ photo: Buffer | Uint8Array | null }[]>(
    `SELECT p.photo FROM bym.player_profile p JOIN bym."user" u ON u.userid = p.userid
      WHERE p.userid = ? AND ${visiblePhotoWhere("p", "u")}`,
    [userid],
  );
  return row?.photo ? Buffer.from(row.photo) : null;
};
