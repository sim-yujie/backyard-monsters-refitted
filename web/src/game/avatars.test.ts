import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AVATARS,
  avatarName,
  avatarOf,
  avatarPath,
  avatarUrl,
  defaultAvatar,
  pickedAvatar,
} from "./avatars";

const at = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

describe("avatars", () => {
  it("offers the same twelve critters the server allows", () => {
    const server = readFileSync(at("../../../server/src/game-data/avatars.ts"), "utf8");
    const list = /AVATAR_IDS = \[([^\]]*)\]/.exec(server)?.[1] ?? "";
    const serverIds = [...list.matchAll(/"([a-z]+)"/g)].map((match) => match[1]);
    expect(serverIds).toHaveLength(12);
    expect(AVATARS.map(({ id }) => id)).toEqual(serverIds);
  });

  it("ships both sizes of every picture", () => {
    for (const { id } of AVATARS) {
      expect(existsSync(at(`../../public/avatars/${id}.webp`)), id).toBe(true);
      expect(existsSync(at(`../../public/avatars/${id}-64.webp`)), id).toBe(true);
    }
  });

  it("reads a picked critter back from pic_square", () => {
    expect(pickedAvatar("/avatars/owl.webp")).toBe("owl");
    expect(pickedAvatar(avatarPath("tortoise"))).toBe("tortoise");
  });

  it("treats anything else as not picked", () => {
    expect(pickedAvatar("https://cdn.bymrefitted.com/assets/bym-refitted-assets/placeholder.jpg")).toBeNull();
    expect(pickedAvatar("https://cdn.discordapp.com/avatars/1/abc.png?size=64")).toBeNull();
    expect(pickedAvatar("/avatars/dragon.webp")).toBeNull();
    expect(pickedAvatar("")).toBeNull();
    expect(pickedAvatar(null)).toBeNull();
    expect(pickedAvatar(undefined)).toBeNull();
  });

  it("gives a player who has not picked the same default every time, spread by user id", () => {
    expect(defaultAvatar(2505)).toBe(defaultAvatar(2505));
    const spread = new Set(Array.from({ length: 12 }, (_, i) => defaultAvatar(1000 + i)));
    expect(spread.size).toBe(12);
    expect(defaultAvatar(Number.NaN)).toBe("hedgehog");
    expect(defaultAvatar(-7)).toBe(defaultAvatar(7));
  });

  it("shows the pick when there is one and the default otherwise", () => {
    expect(avatarOf("/avatars/frog.webp", 2505)).toBe("frog");
    expect(avatarOf(null, 2505)).toBe(defaultAvatar(2505));
  });

  it("names and locates each picture", () => {
    expect(avatarName("bee")).toBe("Bee");
    expect(avatarUrl("bee")).toMatch(/avatars\/bee\.webp$/);
    expect(avatarUrl("bee", "small")).toMatch(/avatars\/bee-64\.webp$/);
  });
});
