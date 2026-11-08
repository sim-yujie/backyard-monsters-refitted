import { apiUrl, get, post, postJson } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * Player profiles (server `controllers/profile/routes.ts`):
 *
 *   GET  /api/:apiVersion/bm/profile/:userid          { profile }
 *   POST /api/:apiVersion/bm/profile/bio      bio     { bio }: the bio as saved
 *   POST /api/:apiVersion/bm/profile/photo    photo   { profile }: a JPEG data URL
 *   POST /api/:apiVersion/bm/profile/photo/remove     { profile }
 *   POST /api/:apiVersion/bm/profile/:userid/report   { reported, already }
 *   GET  /api/:apiVersion/profile/photos/:userid?v=N  the 128x128 JPEG itself
 *
 * A refusal comes back as an ApiError whose message is the server's own
 * short words ("You can change your photo once a day."), so the window shows
 * `error.message` as it is. Refusals are 400/404/409, never 403, which the
 * game would read as signed out.
 */

export interface ProfileStats {
  readonly level: number;
  /** The main yard's Town Hall level; 0 when unknown. */
  readonly townHall: number;
  readonly empirePoints: number;
  readonly achievements: { readonly earned: number; readonly total: number } | null;
  readonly friends: number;
  /** When their main yard was made (ISO); null when unknown. */
  readonly joined: string | null;
  readonly alliance: string | null;
}

export type UploadRefusal = "lowLevel" | "blocked" | "underReview" | "tooSoon";

/** What the player sees about their own photo. */
export interface OwnPhotoState {
  /** Hidden by reports until the game team looks. */
  readonly hidden: boolean;
  readonly blocked: boolean;
  readonly canUpload: boolean;
  readonly reason: UploadRefusal | null;
  /** When the next upload is allowed (ISO), for `tooSoon`. */
  readonly nextAt: string | null;
  readonly minLevel: number;
}

export interface Profile {
  readonly userid: number;
  readonly username: string;
  /** `pic_square`: their critter, shown when there is no photo. */
  readonly pic: string | null;
  readonly bio: string;
  /** The photo's upload number; null when there is none to show (none, or hidden). */
  readonly photoVersion: number | null;
  readonly stats: ProfileStats;
  readonly own: boolean;
  /** The viewer already reported this photo. */
  readonly reported: boolean;
  /** Only on the player's own profile. */
  readonly photoState: OwnPhotoState | null;
}

/** Bio limits, the server's (`services/profile/profileRules.ts`). */
export const BIO_MAX = 150;
export const BIO_MAX_LINES = 3;

interface ProfileAnswer extends ApiEnvelope {
  profile?: Profile;
}

const need = (answer: ProfileAnswer): Profile => {
  if (!answer.profile) throw new Error("The server sent no profile.");
  return answer.profile;
};

export const fetchProfile = async (userid: number): Promise<Profile> =>
  need(await get<ProfileAnswer>(`/api/:apiVersion/bm/profile/${userid}`));

/** Saves the player's own bio; resolves to the bio as the server kept it. */
export const saveBio = async (bio: string): Promise<string> => {
  const answer = await post<ApiEnvelope & { bio?: string }>("/api/:apiVersion/bm/profile/bio", { bio });
  return typeof answer.bio === "string" ? answer.bio : bio;
};

/** Uploads a square JPEG data URL (the crop step's); the server keeps a 128x128 copy. */
export const uploadPhoto = async (dataUrl: string): Promise<Profile> =>
  need(await postJson<ProfileAnswer>("/api/:apiVersion/bm/profile/photo", { photo: dataUrl }));

export const removePhoto = async (): Promise<Profile> =>
  need(await post<ProfileAnswer>("/api/:apiVersion/bm/profile/photo/remove"));

/** Reports another player's photo; resolves true when it was already reported. */
export const reportPhoto = async (userid: number): Promise<boolean> => {
  const answer = await post<ApiEnvelope & { already?: boolean }>(`/api/:apiVersion/bm/profile/${userid}/report`);
  return answer.already === true;
};

/** The photo's address; the version makes a new photo a new address (cached a day). */
export const photoUrl = (userid: number, version: number): string =>
  `${apiUrl(`/api/:apiVersion/profile/photos/${userid}`)}?v=${version}`;
