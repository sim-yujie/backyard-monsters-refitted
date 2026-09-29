import { avatarPath, type AvatarId } from "@/game/avatars";
import { setSessionPicSquare } from "./auth";
import { post } from "./http";
import type { SetAvatarResponse } from "./types";

/**
 * `POST /api/:apiVersion/player/avatar` (issue #175): stores the picked critter
 * as `pic_square`. The server takes only the twelve paths in its allow-list
 * and refuses anything else with `reason: "unknownAvatar"`.
 */
const AVATAR_PATH = "/api/:apiVersion/player/avatar";

/** Stores the avatar and records it on the session; resolves with the stored path. */
export const setAvatar = async (id: AvatarId): Promise<string> => {
  const response = await post<SetAvatarResponse>(AVATAR_PATH, { avatar: avatarPath(id) });
  setSessionPicSquare(response.pic_square);
  return response.pic_square;
};
