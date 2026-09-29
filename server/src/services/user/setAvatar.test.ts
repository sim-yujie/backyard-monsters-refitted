import { beforeEach, describe, expect, test } from "bun:test";
import type { User } from "../../database/models/user.model.js";
import {
  AVATAR_IDS,
  avatarPath,
  isAvatarPath,
  picSquareAfterDiscordRefresh,
} from "../../game-data/avatars.js";
import { setAvatarFor } from "./setAvatar.js";

/**
 * `POST /player/avatar` (issue #175): a player picks one of the twelve critters
 * and it lands in `pic_square`; anything off the allow-list is refused and
 * nothing is written.
 */

type Row = Record<string, unknown>;

let flushed: number;

const em = {
  flush: async () => {
    flushed += 1;
  },
};

const PLACEHOLDER = "https://cdn.bymrefitted.com/assets/bym-refitted-assets/placeholder.jpg";

let user: Row;

const run = async (body: unknown) => {
  try {
    return { stored: await setAvatarFor(em, user as unknown as User, body), status: 200, refused: undefined };
  } catch (caught) {
    const error = caught as { status?: number; data?: { reason?: string } };
    return { stored: undefined, status: error.status, refused: error.data?.reason };
  }
};

beforeEach(() => {
  flushed = 0;
  user = { userid: 2505, username: "agenttester", pic_square: PLACEHOLDER };
});

describe("setAvatarFor", () => {
  test("stores a critter's path in pic_square and hands it back", async () => {
    const result = await run({ avatar: "/avatars/owl.webp" });
    expect(result.stored).toBe("/avatars/owl.webp");
    expect(user.pic_square).toBe("/avatars/owl.webp");
    expect(flushed).toBe(1);
  });

  test("every critter on the list can be picked", async () => {
    for (const id of AVATAR_IDS) {
      expect((await run({ avatar: avatarPath(id) })).status).toBe(200);
      expect(user.pic_square).toBe(`/avatars/${id}.webp`);
    }
  });

  test("anything off the allow-list is refused and nothing is written", async () => {
    for (const body of [
      { avatar: "https://evil.example/me.png" },
      { avatar: "/avatars/dragon.webp" },
      { avatar: "/avatars/owl.webp?x=1" },
      { avatar: "owl" },
      { avatar: "" },
      { avatar: 3 },
      {},
      null,
    ]) {
      const result = await run(body);
      expect(result.refused).toBe("unknownAvatar");
      expect(result.status).toBe(400);
    }
    expect(user.pic_square).toBe(PLACEHOLDER);
    expect(flushed).toBe(0);
  });
});

describe("avatar allow-list", () => {
  test("twelve distinct critters, each a local webp path", () => {
    expect(new Set(AVATAR_IDS).size).toBe(12);
    for (const id of AVATAR_IDS) expect(isAvatarPath(avatarPath(id))).toBe(true);
    expect(isAvatarPath(PLACEHOLDER)).toBe(false);
    expect(isAvatarPath(null)).toBe(false);
    expect(isAvatarPath(undefined)).toBe(false);
  });

  test("the login's Discord refresh keeps a picked critter but replaces anything else", () => {
    const discord = "https://cdn.discordapp.com/avatars/1/abc.png?size=64";
    expect(picSquareAfterDiscordRefresh("/avatars/frog.webp", discord)).toBe("/avatars/frog.webp");
    expect(picSquareAfterDiscordRefresh(PLACEHOLDER, discord)).toBe(discord);
    expect(picSquareAfterDiscordRefresh(null, discord)).toBe(discord);
  });
});
