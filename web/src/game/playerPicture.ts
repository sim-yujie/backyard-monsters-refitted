import { photoUrl } from "@/api/profile";

import { avatarOf, avatarUrl, type AvatarId } from "./avatars";

/**
 * A player's picture wherever another player sees it (owner, 13 Nov 2026:
 * "Other players should be able to see the profile picture i set!"): their
 * uploaded photo when the server says one may be shown, else their critter.
 *
 * The server decides which photos may be shown (one rule, server
 * `services/profile/visiblePhoto.ts`: none hidden by reports, under review,
 * removed or blocked) and sends the photo's upload number as `photo` beside
 * `pic_square` in each list; null or absent means the critter. The upload
 * number is in the address, so a new photo is a new address and never an old
 * cached copy.
 *
 * A photo is a square snapshot, not a cut-out critter, so it fills its frame:
 * every picture spot marks it `is-photo` and its stylesheet stretches it to
 * the frame (`object-fit: cover`). A photo that will not load (taken down
 * since the list was sent) shows the critter instead.
 */

/** A visible photo's upload number as the server sends it; null or absent for the critter. */
export type PhotoVersion = number | null | undefined;

/** A `photo` field read off an answer: a whole number 0 or more, else absent. */
export const photoVersionOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export interface PlayerPicture {
  /** What to show: the photo's address, or the critter's. */
  readonly src: string;
  /** `src` is an uploaded photo. */
  readonly photo: boolean;
  /** The critter's address, for when the photo will not load. */
  readonly critter: string;
}

/**
 * The picture for player `userid` whose critter is `avatar` and whose visible
 * photo's upload number is `photo` (null or absent for none). `size` picks
 * the critter's copy: `small` for anything drawn at 48 px or less.
 */
export const pictureFor = (
  userid: number,
  avatar: AvatarId,
  photo: PhotoVersion,
  size: "full" | "small" = "full",
): PlayerPicture => {
  const critter = avatarUrl(avatar, size);
  const shown = typeof photo === "number" && Number.isFinite(photo) && photo >= 0 && userid > 0;
  return shown ? { src: photoUrl(userid, photo), photo: true, critter } : { src: critter, photo: false, critter };
};

/** {@link pictureFor} from the player's `pic_square` (`pic`): their picked critter, or their default. */
export const playerPicture = (
  userid: number,
  pic: string | null | undefined,
  photo: PhotoVersion,
  size: "full" | "small" = "full",
): PlayerPicture => pictureFor(userid, avatarOf(pic, userid), photo, size);

/**
 * Puts `picture` on `image`: marked `is-photo` for a photo, and back to the
 * critter (unmarked) if the photo will not load. Returns `image`.
 */
export const showPlayerPicture = (image: HTMLImageElement, picture: PlayerPicture): HTMLImageElement => {
  image.classList.toggle("is-photo", picture.photo);
  if (picture.photo) {
    image.addEventListener(
      "error",
      () => {
        image.classList.remove("is-photo");
        image.src = picture.critter;
      },
      { once: true },
    );
  }
  image.src = picture.src;
  return image;
};
